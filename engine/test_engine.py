"""Checks iterative Tarjan against brute force on 300 random graphs."""

import random
from collections import deque
from graph import Graph
from tarjan import analyze_network, _compute_severity


def count_components(g, skip=None):
    seen, count = set(), 0
    for s in g.nodes():
        if s == skip or s in seen:
            continue
        count += 1
        seen.add(s)
        q = deque([s])
        while q:
            u = q.popleft()
            for v in g.get_neighbors(u):
                if v != skip and v not in seen:
                    seen.add(v)
                    q.append(v)
    return count


def brute_aps(g):
    base = count_components(g)
    return {n for n in g.nodes() if count_components(g, skip=n) > base}


def brute_bridges(g):
    base, out = count_components(g), set()
    for u, v in g.edges():
        t = g.copy()
        t.remove_edge(u, v)
        if count_components(t) > base:
            out.add(frozenset((u, v)))
    return out


def random_graph(rng):
    n = rng.randint(1, 14)
    g = Graph()
    for i in range(n):
        g.add_node(i)
    p = rng.choice([0.1, 0.2, 0.35, 0.6])
    for i in range(n):
        for j in range(i + 1, n):
            if rng.random() < p:
                g.add_edge(i, j)
    return g


if __name__ == "__main__":
    rng = random.Random(42)
    for trial in range(300):
        g = random_graph(rng)
        res = analyze_network(g)
        aps = res["articulation_points"]
        assert set(aps) == brute_aps(g), f"AP mismatch on trial {trial}"
        assert {frozenset(b) for b in res["bridges"]} == brute_bridges(g), f"Bridge mismatch on trial {trial}"
        for node, sev in aps.items():
            assert sev == _compute_severity(g, node), f"Severity mismatch on trial {trial}"

    # Deep path graph: a recursive version would crash here
    big = Graph()
    for i in range(5000):
        big.add_edge(i, i + 1)
    assert len(analyze_network(big)["articulation_points"]) == 4999
    print("ALL TESTS PASSED (300 random graphs + 5000-node path)")