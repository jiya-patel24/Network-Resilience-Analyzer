"""
tarjan.py

Finds articulation points (critical nodes / cut-vertices) in a Graph,
and scores how severe each one's failure would be.

Built on top of graph.py's Graph class, using only get_neighbors().
"""

from graph import Graph


def find_articulation_points(graph):
    """
    Runs Tarjan's algorithm on the given Graph.

    Returns a dict: { node_id: severity_score }
    where severity_score = number of nodes that would become
    unreachable from the main component if that node were removed.

    If the graph has multiple disconnected pieces already, we run the
    DFS starting fresh from every unvisited node, so all pieces get
    covered.
    """

    disc = {}          # node -> discovery time (when we first visited it)
    low = {}           # node -> earliest reachable ancestor's discovery time
    visited = set()     # nodes we've already visited
    articulation_points = set()  # nodes identified as critical (before scoring)

    timer = [0]  # shared counter, wrapped in a list so the inner dfs() can modify it

    def dfs(u, parent):
        visited.add(u)
        disc[u] = timer[0]
        low[u] = timer[0]
        timer[0] += 1

        children = 0

        for neighbor in graph.get_neighbors(u):
            if neighbor == parent:
                continue

            if neighbor in visited:
                low[u] = min(low[u], disc[neighbor])
            else:
                children += 1
                dfs(neighbor, u)
                low[u] = min(low[u], low[neighbor])

                if parent is None and children >= 2:
                    articulation_points.add(u)

                if parent is not None and low[neighbor] >= disc[u]:
                    articulation_points.add(u)

    for node in graph.nodes():
        if node not in visited:
            dfs(node, None)

    severity_scores = {}
    for ap in articulation_points:
        severity_scores[ap] = _compute_severity(graph, ap)

    return severity_scores


def _compute_severity(graph, removed_node):
    remaining_nodes = [n for n in graph.nodes() if n != removed_node]
    visited = set()
    component_sizes = []

    for start in remaining_nodes:
        if start in visited:
            continue

        component = []
        queue = [start]
        visited.add(start)

        while queue:
            curr = queue.pop(0)
            component.append(curr)
            for neighbor in graph.get_neighbors(curr):
                if neighbor == removed_node:
                    continue
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

        component_sizes.append(len(component))

    if not component_sizes:
        return 0

    largest_component = max(component_sizes)
    total_remaining = len(remaining_nodes)
    severity = total_remaining - largest_component
    return severity


if __name__ == "__main__":
    g = Graph()
    g.add_edge(1, 2)
    g.add_edge(2, 3)
    g.add_edge(3, 1)
    g.add_edge(3, 4)
    g.add_edge(4, 5)

    result = find_articulation_points(g)
    print("Articulation points and severity scores:", result)

    expected_points = {3, 4}
    found_points = set(result.keys())

    if found_points == expected_points:
        print(f"PASS: found {found_points}, matches expected {expected_points}")
    else:
        print(f"FAIL: found {found_points}, expected {expected_points}")