"""severity.py: composite severity index S(v) = wI*I + wB*B + wC*C + wT*T + wR*R  (0-100).
Every factor is 0..1 and returned per node, so the score is EXPLAINABLE."""

import random
from collections import deque
from tarjan import analyze_network
from suggestions import _pieces_around

DEFAULT_WEIGHTS = {"I": 0.35, "B": 0.25, "C": 0.15, "T": 0.15, "R": 0.10}


def betweenness(graph, sample=None, seed=1):
    """Brandes betweenness (unweighted, undirected), normalised to 0..1.
    sample=k uses k random source nodes (approximation for big graphs)."""
    nodes = graph.nodes()
    cb = {v: 0.0 for v in nodes}
    sources = nodes if (sample is None or sample >= len(nodes)) else random.Random(seed).sample(nodes, sample)
    for s in sources:
        stack, pred = [], {v: [] for v in nodes}
        sigma, dist = dict.fromkeys(nodes, 0), dict.fromkeys(nodes, -1)
        sigma[s], dist[s] = 1, 0
        q = deque([s])
        while q:
            v = q.popleft()
            stack.append(v)
            for w in graph.get_neighbors(v):
                if dist[w] < 0:
                    dist[w] = dist[v] + 1
                    q.append(w)
                if dist[w] == dist[v] + 1:
                    sigma[w] += sigma[v]
                    pred[w].append(v)
        delta = dict.fromkeys(nodes, 0.0)
        while stack:
            w = stack.pop()
            for v in pred[w]:
                delta[v] += sigma[v] / sigma[w] * (1 + delta[w])
            if w != s:
                cb[w] += delta[w]
    mx = max(cb.values(), default=0)
    return {v: (cb[v] / mx if mx > 0 else 0.0) for v in nodes}


def composite_severity(graph, analysis=None, weights=None, sample=None):
    analysis = analysis or analyze_network(graph)
    w = dict(DEFAULT_WEIGHTS)
    if weights:
        w.update(weights)
    total_w = sum(w.values()) or 1.0
    nodes = graph.nodes()
    if not nodes:
        return {}
    aps = analysis["articulation_points"]
    crit = {n: float(graph.meta.get(n, {}).get("criticality", 3)) for n in nodes}
    total_crit = sum(crit.values()) or 1.0

    # I: business-weighted amount cut off from the main piece if v fails
    I = {n: 0.0 for n in nodes}
    for ap in aps:
        pieces = _pieces_around(graph, ap)
        if len(pieces) < 2:
            continue
        main = max(pieces, key=lambda p: (len(p), sum(crit[x] for x in p)))
        I[ap] = sum(crit[x] for p in pieces if p is not main for x in p) / total_crit
    imax = max(I.values()) or 1.0

    # B: share of v's links that are non-trivial bridges (both ends have degree >= 2)
    B, touches = {n: 0.0 for n in nodes}, {n: 0 for n in nodes}
    for u, v in analysis["bridges"]:
        for x, y in ((u, v), (v, u)):
            touches[x] += 1
            if graph.degree(x) >= 2 and graph.degree(y) >= 2:
                B[x] += 1
    for n in nodes:
        B[n] = B[n] / max(1, graph.degree(n))

    C = betweenness(graph, sample)

    def redundancy_deficit(n):
        d = graph.degree(n)
        if n in aps:
            return 1.0
        if touches[n] > 0 and d >= 2:
            return 0.6
        if d <= 1:
            return 0.5
        return 0.2 if d == 2 else 0.0

    out = {}
    for n in nodes:
        T = min(1.0, max(0.0, float(graph.meta.get(n, {}).get("risk", 0))))  # simulated telemetry / ML risk
        f = {"I": I[n] / imax, "B": B[n], "C": C[n], "T": T, "R": redundancy_deficit(n)}
        score = 100 * sum(w[k] * f[k] for k in f) / total_w
        out[n] = {"score": int(score + 0.5), "factors": {k: round(v, 2) for k, v in f.items()}}
    return out