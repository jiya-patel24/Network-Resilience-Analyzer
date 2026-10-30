"""export.py: turns engine state into the JSON the dashboard reads."""

import json
from graph import Graph
from tarjan import analyze_network
from structures import MaxHeap
from suggestions import suggest_fixes
from severity import composite_severity
from security import security_report
from scoring import network_metrics

BIG_GRAPH = 300   # above this: sampled centrality, no suggestions


def export_graph_state(graph, critical_nodes=None, weights=None):
    analysis = analyze_network(graph)
    if critical_nodes is None:
        critical_nodes = analysis["articulation_points"]
    n_nodes = len(graph.nodes())
    comp = composite_severity(graph, analysis, weights, sample=None if n_nodes <= BIG_GRAPH else 64)
    report = security_report(graph)

    bridge_keys = {frozenset(b) for b in analysis["bridges"]}
    viol_keys = {frozenset((v["source"], v["target"])) for v in report["violations"]}

    nodes = []
    for node_id in graph.nodes():
        meta = graph.meta.get(node_id, {})
        nodes.append({
            "id": node_id,
            "label": meta.get("label", f"Node {node_id}"),
            "role": meta.get("role", "server"),
            "zone": meta.get("zone"),
            "criticality": meta.get("criticality", 3),
            "is_critical": node_id in critical_nodes,
            "severity": critical_nodes.get(node_id, 0),
            "composite": comp[node_id]["score"],
            "factors": comp[node_id]["factors"],
            "degree": graph.degree(node_id),
        })

    edges = [{"source": u, "target": v,
              "is_bridge": frozenset((u, v)) in bridge_keys,
              "is_violation": frozenset((u, v)) in viol_keys}
             for u, v in graph.edges()]

    heap = MaxHeap()
    for n in nodes:
        heap.push(n["composite"], n["id"])
    top_threats = [{"id": i, "score": s} for s, i in heap.top_k(3)]

    metrics = network_metrics(graph, analysis)
    metrics["security"] = report["score"]
    metrics["violations"] = len(report["violations"])

    return {
        "nodes": nodes, "edges": edges, "top_threats": top_threats, "metrics": metrics,
        "security": report,
        "suggestions": suggest_fixes(graph, critical_nodes) if n_nodes <= BIG_GRAPH else [],
    }


def export_graph_state_json(graph, critical_nodes=None):
    return json.dumps(export_graph_state(graph, critical_nodes), indent=2)