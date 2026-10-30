"""
Driver script: builds a 14-device network with security zones, queues scripted events,
processes them in order, and writes dashboard/snapshots.json (also used by api.py).
Run:  python generate_snapshots.py
"""

import json
import os
from time import perf_counter

from graph import Graph
from tarjan import find_articulation_points
from incremental import add_node_incremental
from export import export_graph_state, BIG_GRAPH
from redesign import redesign
from delta import diff_states
from structures import Queue, Stack, ChangeLog

# (id, label, role, zone, business criticality 1-10)
NODES = [
    (1, "Internet Gateway", "gateway", "internet", 5), (2, "Edge Firewall", "firewall", "dmz", 7),
    (3, "Core Router A", "router", "internal", 8),     (4, "Core Router B", "router", "internal", 8),
    (5, "Engineering Switch", "switch", "internal", 6), (6, "Datacenter Switch", "switch", "internal", 8),
    (7, "Web Server", "server", "dmz", 8),             (8, "App Server", "server", "internal", 7),
    (9, "DB Primary", "database", "data", 10),         (10, "DB Replica", "database", "data", 8),
    (11, "Wi-Fi Controller", "wifi", "internal", 3),   (12, "Office Workstations", "client", "internal", 2),
    (13, "Auth Server", "server", "internal", 8),      (14, "Backup Vault", "storage", "data", 7),
]
EDGES = [(1, 2), (2, 3), (2, 4), (3, 4), (3, 5), (4, 5), (4, 6), (5, 7), (5, 8),
         (7, 8), (6, 9), (6, 10), (9, 10), (5, 11), (11, 12), (6, 13), (13, 14)]

EVENTS = [
    {"type": "add_node", "id": 15, "label": "Monitoring Hub", "role": "monitor", "zone": "internal", "criticality": 4, "attach_to": 2},
    {"type": "add_link", "u": 3, "v": 6},
    {"type": "fail", "id": 5},
    {"type": "add_node", "id": 16, "label": "Standby Switch", "role": "switch", "zone": "internal", "criticality": 5, "attach_to": 8},
    {"type": "add_link", "u": 16, "v": 3},
]


def build_network():
    g = Graph()
    for node_id, label, role, zone, crit in NODES:
        g.add_node(node_id, label=label, role=role, zone=zone, criticality=crit)
    for u, v in EDGES:
        g.add_edge(u, v)
    return g


def name(g, node_id):
    return g.meta.get(node_id, {}).get("label", f"Node {node_id}")


def apply_event(g, critical, ev):
    if ev["type"] == "add_node":
        desc = f'{ev["label"]} joined the network (attached to {name(g, ev["attach_to"])})'
        add_node_incremental(g, ev["id"], ev["attach_to"], critical)
        g.set_meta(ev["id"], label=ev["label"], role=ev["role"], zone=ev["zone"], criticality=ev["criticality"])
        return desc, "add_node", "Incremental update", critical, ("remove_node", ev["id"])
    if ev["type"] == "add_link":
        desc = f'New redundant link: {name(g, ev["u"])} \u2194 {name(g, ev["v"])}'
        g.add_edge(ev["u"], ev["v"])
        return desc, "add_link", "Full recompute", find_articulation_points(g), ("remove_link", ev["u"], ev["v"])
    if ev["type"] == "fail":
        node = ev["id"]
        desc = f"{name(g, node)} failed and was removed"
        undo_op = ("restore", node, dict(g.meta.get(node, {})), list(g.get_neighbors(node)))
        g.remove_node(node)
        return desc, "failure", "Full recompute", find_articulation_points(g), undo_op
    raise ValueError(f"Unknown event type: {ev['type']}")


def undo(g, op):
    if op[0] == "remove_node":
        g.remove_node(op[1])
    elif op[0] == "remove_link":
        g.remove_edge(op[1], op[2])
    elif op[0] == "restore":
        _, node, meta, neighbors = op
        g.add_node(node, **meta)
        for n in neighbors:
            g.add_edge(node, n)


def snapshot(g, critical, event, kind, method, ms, prev_state=None, budget=15):
    state = export_graph_state(g, critical)
    plan = None
    if len(g.nodes()) <= BIG_GRAPH:
        plan = redesign(g, budget=budget)
        after_graph = plan.pop("graph")
        plan["state_after"] = export_graph_state(after_graph)
    return {"event": event, "kind": kind, "method": method, "compute_ms": round(ms, 3),
            "state": state, "delta": diff_states(prev_state, state), "redesign": plan}


def build_snapshot_sequence():
    g = build_network()
    log, undo_stack, queue = ChangeLog(), Stack(), Queue()
    for ev in EVENTS:
        queue.enqueue(ev)

    t = perf_counter()
    critical = find_articulation_points(g)
    ms = (perf_counter() - t) * 1000
    snaps = [snapshot(g, critical, "Initial network scan", "baseline", "Tarjan (iterative)", ms)]
    log.append("Initial network scan")

    while not queue.is_empty():
        ev = queue.dequeue()
        t = perf_counter()
        desc, kind, method, critical, undo_op = apply_event(g, critical, ev)
        ms = (perf_counter() - t) * 1000
        undo_stack.push(undo_op)
        log.append(desc)
        snaps.append(snapshot(g, critical, desc, kind, method, ms, snaps[-1]["state"]))
    return snaps, g, log, undo_stack


if __name__ == "__main__":
    snaps, g, log, undo_stack = build_snapshot_sequence()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dashboard", "snapshots.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(snaps, f, indent=2)
    print(f"Wrote {len(snaps)} snapshots -> {os.path.normpath(out)}")
    for i, entry in enumerate(log.to_list()):
        rd = snaps[i]["redesign"]
        print(f"  {i}. {entry}   [overall {rd['before']['overall']} -> {rd['after']['overall']} after redesign]")