"""
The "Driver Script" component from the project design doc. Since there's
no real live network to monitor, this fakes one: it runs a scripted list
of events (add a node, remove a node, etc.) through the real engine, and
after EACH event it calls export_graph_state() to freeze a snapshot of
the graph at that exact moment.

All snapshots get written to one JSON file: dashboard/snapshots.json
The frontend's only job is to play these back one at a time with a delay -
it does NOT run any graph algorithms itself.
"""

import json
from graph import Graph
from tarjan import find_articulation_points
from incremental import add_node_incremental
from export import export_graph_state


def snapshot(graph, critical_nodes, event_description):
    """
    Freeze the current graph + critical-node info into one dict,
    tagged with a human-readable label saying what just happened.
    The frontend will show this label as a caption for each step.
    """
    state = export_graph_state(graph, critical_nodes)
    return {
        "event": event_description,
        "state": state
    }


def build_snapshot_sequence():
    snapshots = []

    # --- Starting point: our usual test graph ---
    g = Graph()
    g.add_edge(1, 2)
    g.add_edge(2, 3)
    g.add_edge(3, 1)
    g.add_edge(3, 4)
    g.add_edge(4, 5)

    critical_nodes = find_articulation_points(g)
    snapshots.append(snapshot(g, critical_nodes, "Initial network"))

    # --- Event 1: node 6 joins, attached to node 5 (incremental add) ---
    add_node_incremental(g, new_node_id=6, attach_to=5, critical_nodes=critical_nodes)
    snapshots.append(snapshot(g, critical_nodes, "Node 6 joined the network (attached to node 5)"))

    # --- Event 2: node 3 fails and is removed ---
    # Node 3 is currently critical, so removing it should visibly split
    # the network into separate pieces. Deletions trigger a full
    # recompute (locked scope decision), not an incremental update.
    g.remove_node(3)
    critical_nodes = find_articulation_points(g)
    snapshots.append(snapshot(g, critical_nodes, "Node 3 failed and was removed"))

    # --- Event 3: node 7 joins, attached to node 1 ---
    add_node_incremental(g, new_node_id=7, attach_to=1, critical_nodes=critical_nodes)
    snapshots.append(snapshot(g, critical_nodes, "Node 7 joined the network (attached to node 1)"))

    return snapshots


if __name__ == "__main__":
    sequence = build_snapshot_sequence()

    with open("../dashboard/snapshots.json", "w") as f:
        json.dump(sequence, f, indent=2)

    print(f"Wrote {len(sequence)} snapshots to dashboard/snapshots.json")
    for s in sequence:
        print(" -", s["event"])