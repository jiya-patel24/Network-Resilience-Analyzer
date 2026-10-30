"""suggestions.py: recommends new links that remove single points of failure."""

from collections import deque
from tarjan import find_articulation_points


def _pieces_around(graph, ap):
    seen, pieces = {ap}, []
    for nb in graph.get_neighbors(ap):
        if nb in seen:
            continue
        piece, q = [], deque([nb])
        seen.add(nb)
        while q:
            u = q.popleft()
            piece.append(u)
            for v in graph.get_neighbors(u):
                if v not in seen:
                    seen.add(v)
                    q.append(v)
        pieces.append(piece)
    return pieces


def suggest_fixes(graph, critical_nodes=None, limit=3):
    if critical_nodes is None:
        critical_nodes = find_articulation_points(graph)

    results, used = [], set()
    ranked = sorted(critical_nodes.items(), key=lambda kv: (-kv[1], str(kv[0])))
    for ap, sev in ranked:
        pieces = _pieces_around(graph, ap)
        if len(pieces) < 2:
            continue
        pieces.sort(key=len, reverse=True)
        pick = lambda piece: min(piece, key=lambda n: (graph.degree(n), str(n)))
        a, b = pick(pieces[0]), pick(pieces[1])
        key = tuple(sorted((a, b), key=str))
        if key in used or graph.has_edge(a, b):
            continue
        trial = graph.copy()
        trial.add_edge(a, b)
        after = find_articulation_points(trial)       # verify the suggestion really helps
        results.append({
            "from": a, "to": b, "fixes": ap,
            "resolves": ap not in after,
            "severity_before": sev, "severity_after": after.get(ap, 0),
            "spofs_before": len(critical_nodes), "spofs_after": len(after),
        })
        used.add(key)

    results.sort(key=lambda r: (not r["resolves"],
                                r["spofs_after"] - r["spofs_before"],
                                -r["severity_before"]))
    return results[:limit]