from graph import Graph
from tarjan import find_articulation_points, _compute_severity


def add_node_incremental(graph, new_node_id, attach_to, critical_nodes):
    if not graph.has_node(attach_to):
        raise ValueError(f"Cannot attach new node to '{attach_to}': that node doesn't exist yet.")
    if graph.has_node(new_node_id):
        raise ValueError(f"Node '{new_node_id}' already exists. This function is only for adding brand-new nodes.")

    had_other_neighbors_before = graph.degree(attach_to) >= 1

    graph.add_edge(attach_to, new_node_id)

    if had_other_neighbors_before and attach_to not in critical_nodes:
        critical_nodes[attach_to] = 0

        for node_id in critical_nodes:
            critical_nodes[node_id] = _compute_severity(graph, node_id)

    return critical_nodes

if __name__ == "__main__":
    g = Graph()
    g.add_edge(1, 2)
    g.add_edge(2, 3)
    g.add_edge(3, 1)
    g.add_edge(3, 4)
    g.add_edge(4, 5)

    critical_nodes = find_articulation_points(g)
    print("Before addition:", critical_nodes)

    add_node_incremental(g, new_node_id=6, attach_to=5, critical_nodes=critical_nodes)
    print("After adding node 6 (attached to 5):", critical_nodes)

    full_recompute_result = find_articulation_points(g)
    print("Full recompute for comparison:      ", full_recompute_result)

    if critical_nodes == full_recompute_result:
        print("PASS: incremental result matches full recompute.")
    else:
        print("FAIL: incremental result does NOT match full recompute.")