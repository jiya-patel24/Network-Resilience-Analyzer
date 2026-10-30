"""security.py: zones, segmentation policy, attack paths, security score."""

import heapq

ZONE_LEVEL = {"internet": 0, "dmz": 1, "internal": 2, "data": 3}
LEVEL_ZONE = {v: k for k, v in ZONE_LEVEL.items()}
REQUIRED_DEPTH = 2   # defense in depth: >= 2 firewalls between internet and any crown jewel


def zone_of(g, n):
    return g.meta.get(n, {}).get("zone")


def is_firewall(g, n):
    return g.meta.get(n, {}).get("role") == "firewall"


def link_violation(g, u, v):
    """Policy: two non-firewall devices may only link inside the same zone.
    A firewall may link to a device in its own zone or an adjacent zone."""
    zu, zv = zone_of(g, u), zone_of(g, v)
    if zu not in ZONE_LEVEL or zv not in ZONE_LEVEL:
        return False
    fu, fv = is_firewall(g, u), is_firewall(g, v)
    if fu and fv:
        return False
    if fu or fv:
        return abs(ZONE_LEVEL[zu] - ZONE_LEVEL[zv]) > 1
    return zu != zv


def find_violations(g):
    out = []
    for u, v in g.edges():
        if link_violation(g, u, v):
            zu, zv = zone_of(g, u), zone_of(g, v)
            if is_firewall(g, u) or is_firewall(g, v):
                reason = f"Firewall link skips a security zone ({zu} <-> {zv})"
            else:
                reason = f"Direct {zu} <-> {zv} link with no firewall in between"
            out.append({"source": u, "target": v, "reason": reason})
    return out


def entry_points(g):
    return [n for n in g.nodes() if zone_of(g, n) == "internet"]


def crown_jewels(g, min_criticality=10):
    return [n for n in g.nodes()
            if not is_firewall(g, n)
            and (zone_of(g, n) == "data"
                 or float(g.meta.get(n, {}).get("criticality", 0)) >= min_criticality)]


def _attack_path(g, entry, target):
    """Attacker's easiest route: fewest firewalls first, then fewest hops."""
    best = {entry: (0, 0)}
    parent, counter = {}, 0
    heap = [(0, 0, counter, entry)]
    while heap:
        fw, hops, _, u = heapq.heappop(heap)
        if best.get(u) != (fw, hops):
            continue
        if u == target:
            break
        for v in g.get_neighbors(u):
            nf = fw + (1 if is_firewall(g, v) and v != target else 0)
            cand = (nf, hops + 1)
            if v not in best or cand < best[v]:
                best[v] = cand
                parent[v] = u
                counter += 1
                heapq.heappush(heap, (nf, hops + 1, counter, v))
    if target not in best:
        return None
    path = [target]
    while path[-1] != entry:
        path.append(parent[path[-1]])
    path.reverse()
    return {"entry": entry, "target": target, "path": path,
            "hops": len(path) - 1, "firewalls": best[target][0]}


def attack_paths(g, jewels=None, entries=None):
    entries = entry_points(g) if entries is None else entries
    jewels = crown_jewels(g) if jewels is None else jewels
    out = []
    for t in jewels:
        best = None
        for e in entries:
            if e == t:
                continue
            p = _attack_path(g, e, t)
            if p and (best is None or (p["firewalls"], p["hops"]) < (best["firewalls"], best["hops"])):
                best = p
        if best:
            out.append(best)
    out.sort(key=lambda p: (p["firewalls"], p["hops"]))
    return out


def security_report(g):
    configured = any(zone_of(g, n) in ZONE_LEVEL for n in g.nodes())
    violations = find_violations(g)
    entries, jewels = entry_points(g), crown_jewels(g)
    paths = attack_paths(g, jewels, entries) if configured else []
    score = None
    if configured:
        depth = (sum(min(p["firewalls"], REQUIRED_DEPTH) for p in paths)
                 / (REQUIRED_DEPTH * len(paths))) if paths else 1.0
        ratio = min(1.0, len(violations) / max(1.0, 0.25 * g.edge_count()))
        score = int(100 * (0.6 * depth + 0.4 * (1 - ratio)) + 0.5)
    return {"configured": configured, "score": score, "violations": violations,
            "attack_paths": paths[:3], "jewels": jewels, "entries": entries,
            "required_depth": REQUIRED_DEPTH}