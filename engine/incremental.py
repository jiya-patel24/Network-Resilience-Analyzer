import random
from graph import Graph
from tarjan import find_articulation_points, _compute_severity, component_of


def add_node_incremental(graph, new_node_id, attach_to, critical_nodes):
    """
    Attach a brand-new node to an existing node and update critical_nodes
    WITHOUT re-running Tarjan.

    - A new leaf can never create another articulation point except attach_to itself.
    - Severities can only change inside the component that grew, so only
      critical nodes in THAT component are refreshed.
    """
    if not graph.has_node(attach_to):
        raise ValueError(f"Cannot attach new node to '{attach_to}': that node doesn't exist yet.")
    if graph.has_node(new_node_id):
        raise ValueError(f"Node '{new_node_id}' already exists.")

    had_other_neighbors = graph.degree(attach_to) >= 1
    graph.add_edge(attach_to, new_node_id)

    if had_other_neighbors and attach_to not in critical_nodes:
        critical_nodes[attach_to] = 0

    affected = component_of(graph, attach_to)
    for node_id in critical_nodes:
        if node_id in affected:
            critical_nodes[node_id] = _compute_severity(graph, node_id)
    return critical_nodes


if __name__ == "__main__":
    # Test 1: attach to a normal node
    g = Graph()
    for u, v in [(1, 2), (2, 3), (3, 1), (3, 4), (4, 5)]:
        g.add_edge(u, v)
    crit = find_articulation_points(g)
    add_node_incremental(g, 6, 5, crit)
    print("PASS 1" if crit == find_articulation_points(g) else "FAIL 1")

    # Test 2: attach to an isolated node
    g2 = Graph()
    g2.add_edge(1, 2)
    g2.add_node(10)
    crit2 = find_articulation_points(g2)
    add_node_incremental(g2, 11, 10, crit2)
    print("PASS 2" if crit2 == find_articulation_points(g2) else "FAIL 2")

    # Test 3: attach to an ALREADY-critical node (the old bug)
    g3 = Graph()
    for u, v in [(1, 2), (2, 3), (3, 1), (3, 4), (4, 5)]:
        g3.add_edge(u, v)
    crit3 = find_articulation_points(g3)
    add_node_incremental(g3, 6, 3, crit3)
    print("PASS 3" if crit3 == find_articulation_points(g3) else "FAIL 3")

    # Test 4: 300 random attachments vs full recompute
    random.seed(7)
    g4 = Graph()
    for u, v in [(0, 1), (1, 2), (2, 0)]:
        g4.add_edge(u, v)
    crit4 = find_articulation_points(g4)
    ok = True
    for new_id in range(3, 303):
        add_node_incremental(g4, new_id, random.choice(g4.nodes()), crit4)
        if crit4 != find_articulation_points(g4):
            ok = False
            break
    print("PASS 4 (300 random additions)" if ok else "FAIL 4")