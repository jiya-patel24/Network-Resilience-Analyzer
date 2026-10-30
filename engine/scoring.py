"""scoring.py: resilience, security and overall scores (resilience formula mirrors dashboard/app.js)."""

from tarjan import analyze_network
from security import security_report


def resilience_score(n, m, spofs, bridges, max_sev, largest):
    if n == 0:
        return 0
    raw = 1 - (0.5 * spofs / n + 0.25 * bridges / max(m, 1) + 0.25 * max_sev / n)
    return max(0, min(100, int(100 * raw * (largest / n) + 0.5)))


def network_metrics(graph, analysis=None):
    a = analysis or analyze_network(graph)
    n, m = len(graph.nodes()), graph.edge_count()
    aps = a["articulation_points"]
    largest = max((len(c) for c in a["components"]), default=0)
    return {"nodes": n, "links": m, "spofs": len(aps), "bridges": len(a["bridges"]),
            "components": len(a["components"]),
            "resilience": resilience_score(n, m, len(aps), len(a["bridges"]),
                                           max(aps.values(), default=0), largest)}


def score_summary(graph, w_res=0.5):
    m = network_metrics(graph)
    sec = security_report(graph)
    s = sec["score"]
    overall = m["resilience"] if s is None else int(w_res * m["resilience"] + (1 - w_res) * s + 0.5)
    return {"resilience": m["resilience"], "security": s, "overall": overall,
            "spofs": m["spofs"], "violations": len(sec["violations"]), "bridges": m["bridges"]}
            