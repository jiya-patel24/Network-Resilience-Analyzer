"""
redesign.py: budget-based network redesign.
Phase A (compliance, mandatory): fix every segmentation violation by inserting ONE
         redundant (HA) firewall pair per boundary, so the firewall is not a new SPOF.
Phase B (optimisation, greedy): spend the remaining budget on the action with the best
         overall-score gain per cost: policy-safe redundant links, or extra firewall layers.
Honest claim: "best design found by greedy search within the budget", not a proven optimum.
"""

from tarjan import analyze_network
from suggestions import _pieces_around
from security import (find_violations, link_violation, zone_of, is_firewall,
                      attack_paths, ZONE_LEVEL, LEVEL_ZONE, REQUIRED_DEPTH)
from scoring import score_summary

SEGMENT_COST = 3   # one HA firewall pair
LINK_COST = 1


def _name(g, n):
    return g.meta.get(n, {}).get("label", f"Node {n}")


def _new_id(g):
    nodes = g.nodes()
    ints = [n for n in nodes if isinstance(n, int)]
    if len(ints) == len(nodes):
        return (max(ints) + 1) if ints else 1
    i = 1
    while f"fw-{i}" in g.adjacency_list:
        i += 1
    return f"fw-{i}"


def _insert_pair(g, outer, inner_nodes, zone, tag):
    ids = []
    for suffix in ("A", "B"):
        fid = _new_id(g)
        g.add_node(fid, label=f"{tag} FW-{suffix}", role="firewall", zone=zone, criticality=7)
        ids.append(fid)
    for w in inner_nodes:
        g.remove_edge(outer, w)
    for fid in ids:
        g.add_edge(outer, fid)
        for w in inner_nodes:
            g.add_edge(fid, w)
    return ids


def _violation_groups(g):
    groups = {}
    for v in find_violations(g):
        u, w = v["source"], v["target"]
        if ZONE_LEVEL[zone_of(g, u)] > ZONE_LEVEL[zone_of(g, w)]:
            u, w = w, u                                   # u = outer (less trusted) side
        fw_zone = LEVEL_ZONE[ZONE_LEVEL[zone_of(g, u)] + 1]
        groups.setdefault((u, fw_zone), []).append(w)
    return groups


def _link_candidates(g, critical):
    out, seen = [], set()
    for ap, _ in sorted(critical.items(), key=lambda kv: (-kv[1], str(kv[0]))):
        pieces = _pieces_around(g, ap)
        if len(pieces) < 2:
            continue
        pieces.sort(key=len, reverse=True)
        A = sorted(pieces[0], key=lambda n: (g.degree(n), str(n)))[:6]
        B = sorted(pieces[1], key=lambda n: (g.degree(n), str(n)))[:6]
        done = False
        for a in A:
            for b in B:
                key = frozenset((a, b))
                if g.has_edge(a, b) or link_violation(g, a, b) or key in seen:
                    continue
                seen.add(key)
                out.append({"type": "ADD_LINK", "a": a, "b": b, "fixes": ap, "cost": LINK_COST})
                done = True
                break
            if done:
                break
    return out


def _depth_candidates(g):
    out, seen = [], set()
    for p in attack_paths(g):
        if p["firewalls"] >= REQUIRED_DEPTH:
            continue
        path = p["path"]
        links = [(path[i], path[i + 1]) for i in range(len(path) - 1)
                 if not is_firewall(g, path[i]) and not is_firewall(g, path[i + 1])
                 and zone_of(g, path[i]) in ZONE_LEVEL and zone_of(g, path[i]) == zone_of(g, path[i + 1])]
        for a, b in ([links[-1], links[0]] if links else []):
            key = frozenset((a, b))
            if key not in seen:
                seen.add(key)
                out.append({"type": "ADD_DEPTH", "a": a, "b": b, "target": p["target"], "cost": SEGMENT_COST})
    return out


def _apply(g, act):
    if act["type"] == "ADD_LINK":
        g.add_edge(act["a"], act["b"])
    elif act["type"] == "ADD_DEPTH":
        _insert_pair(g, act["a"], [act["b"]], zone_of(g, act["b"]), f"Layer {_name(g, act['a'])}")


def _describe(g, act):
    if act["type"] == "ADD_LINK":
        return (f"Add redundant link {_name(g, act['a'])} <-> {_name(g, act['b'])} "
                f"(removes the single point of failure at {_name(g, act['fixes'])})")
    return (f"Add a redundant firewall pair between {_name(g, act['a'])} and {_name(g, act['b'])} "
            f"(second layer of defense for {_name(g, act['target'])})")


def redesign(graph, budget=15, w_res=0.5):
    cur = graph.copy()
    before = score_summary(cur, w_res)
    plan, spent = [], 0

    def record(kind, desc, cost):
        nonlocal spent
        spent += cost
        s = score_summary(cur, w_res)
        plan.append({"step": len(plan) + 1, "type": kind, "description": desc, "cost": cost,
                     "overall_after": s["overall"], "resilience_after": s["resilience"],
                     "security_after": s["security"]})
        return s

    # Phase A: mandatory segmentation
    for _ in range(50):
        groups = _violation_groups(cur)
        if not groups or spent + SEGMENT_COST > budget:
            break
        (outer, zone), inner = max(groups.items(), key=lambda kv: len(kv[1]))
        desc = (f"Segment: insert a redundant firewall pair between {_name(cur, outer)} and "
                f"{', '.join(_name(cur, w) for w in inner)} (enforces the {zone} boundary)")
        _insert_pair(cur, outer, inner, zone, f"Segment {_name(cur, outer)}")
        record("SEGMENT", desc, SEGMENT_COST)

    # Phase B: greedy optimisation within the remaining budget
    summary = score_summary(cur, w_res)
    while True:
        crit = analyze_network(cur)["articulation_points"]
        best = None
        for act in _link_candidates(cur, crit) + _depth_candidates(cur):
            if spent + act["cost"] > budget:
                continue
            trial = cur.copy()
            _apply(trial, act)
            s = score_summary(trial, w_res)
            gain = s["overall"] - summary["overall"]
            if gain > 0 and (best is None or gain / act["cost"] > best[0]):
                best = (gain / act["cost"], act)
        if not best:
            break
        act = best[1]
        desc = _describe(cur, act)
        _apply(cur, act)
        summary = record(act["type"], desc, act["cost"])

    after = score_summary(cur, w_res)
    return {"budget": budget, "spent": spent, "before": before, "after": after,
            "plan": plan, "graph": cur}