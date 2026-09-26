"""
export.py

Turns the engine's internal graph state (a Graph object, plus the
critical-node/severity info from tarjan.py) into a plain dictionary
that can be saved as JSON. This is the ONLY thing the frontend reads -
it never touches the Python code directly.
"""

import json
from graph import Graph
from tarjan import find_articulation_points


def export_graph_state(graph, critical_nodes=None):
    """
    Parameters:
        graph: a Graph object from graph.py
        critical_nodes: optional dict of {node_id: severity_score}.
                        Pass this in if you've already computed it
                        (e.g. after an incremental update), so we don't
                        waste time recomputing it here. If you don't
                        pass anything, it's computed fresh.

    Returns a dictionary shaped like:
        {
            "nodes": [{"id": ..., "is_critical": ..., "severity": ...}, ...],
            "edges": [{"source": ..., "target": ...}, ...]
        }
    """
    if critical_nodes is None:
        critical_nodes = find_articulation_points(graph)

    # Build the nodes list. Every node gets a severity (0 if it's not critical),
    # so the frontend doesn't need an "if severity exists" check later.
    nodes_list = []
    for node_id in graph.nodes():
        nodes_list.append({
            "id": node_id,
            "is_critical": node_id in critical_nodes,
            "severity": critical_nodes.get(node_id, 0)
        })

    # Build the edges list, deduping. adjacency_list stores each edge
    # twice (u->v and v->u), so without this we'd emit every edge twice.
    edges_list = []
    seen_edges = set()
    for node_id in graph.nodes():
        for neighbor in graph.get_neighbors(node_id):
            edge_key = tuple(sorted((node_id, neighbor)))
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                edges_list.append({"source": edge_key[0], "target": edge_key[1]})

    return {
        "nodes": nodes_list,
        "edges": edges_list
    }


def export_graph_state_json(graph, critical_nodes=None):
    """Same as export_graph_state, but returns a ready-to-save JSON string."""
    return json.dumps(export_graph_state(graph, critical_nodes), indent=2)


if __name__ == "__main__":
    # Same test graph you've been using everywhere else, so the output
    # here should line up with what you already know: critical points
    # {3, 4} with severities {3: 2, 4: 1}.
    g = Graph()
    g.add_edge(1, 2)
    g.add_edge(2, 3)
    g.add_edge(3, 1)
    g.add_edge(3, 4)
    g.add_edge(4, 5)

    print(export_graph_state_json(g))