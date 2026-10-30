"""
tarjan.py: iterative Tarjan: articulation points, bridges, and severity in ONE pass.
No recursion, so it works on graphs with thousands of nodes.

severity(node) = how many nodes get cut off from the largest surviving piece
of that node's component if the node fails.
"""

from collections import defaultdict, deque
from graph import Graph


def analyze_network(graph):
    disc, low, size, parent = {}, {}, {}, {}
    sep = defaultdict(list)       # node -> sizes of child subtrees it would cut off
    bridges, components, severities = [], [], {}
    timer = 0

    for root in graph.nodes():
        if root in disc:
            continue
        comp = [root]
        disc[root] = low[root] = timer
        timer += 1
        size[root] = 1
        parent[root] = None
        stack = [(root, iter(graph.get_neighbors(root)))]

        while stack:
            u, it = stack[-1]
            descended = False
            for v in it:
                if v == parent[u]:
                    continue
                if v in disc:
                    low[u] = min(low[u], disc[v])
                else:
                    parent[v] = u
                    disc[v] = low[v] = timer
                    timer += 1
                    size[v] = 1
                    comp.append(v)
                    stack.append((v, iter(graph.get_neighbors(v))))
                    descended = True
                    break
            if descended:
                continue

            stack.pop()
            p = parent[u]
            if p is not None:
                size[p] += size[u]
                low[p] = min(low[p], low[u])
                if low[u] >= disc[p]:
                    sep[p].append(size[u])
                if low[u] > disc[p]:
                    bridges.append((p, u))

        components.append(comp)
        csize = len(comp)
        for u in comp:
            cut = sep.get(u, [])
            is_ap = len(cut) >= 2 if u == root else len(cut) >= 1
            if is_ap:
                rest = csize - 1 - sum(cut)
                pieces = cut + ([rest] if rest > 0 else [])
                severities[u] = (csize - 1) - max(pieces)

    return {"articulation_points": severities, "bridges": bridges, "components": components}


def find_articulation_points(graph):
    """Returns { node_id: severity }. Same interface as before."""
    return analyze_network(graph)["articulation_points"]


def component_of(graph, start):
    seen, q = {start}, deque([start])
    while q:
        u = q.popleft()
        for v in graph.get_neighbors(u):
            if v not in seen:
                seen.add(v)
                q.append(v)
    return seen


def _compute_severity(graph, removed_node):
    """Brute-force severity (BFS), scoped to the node's own component.
    Used by incremental.py, attack_simulation.py and as a cross-check in tests."""
    if not graph.has_node(removed_node):
        return 0
    comp = component_of(graph, removed_node)
    if len(comp) < 3:
        return 0
    seen, sizes = {removed_node}, []
    for nb in graph.get_neighbors(removed_node):
        if nb in seen:
            continue
        count, q = 0, deque([nb])
        seen.add(nb)
        while q:
            u = q.popleft()
            count += 1
            for v in graph.get_neighbors(u):
                if v not in seen:
                    seen.add(v)
                    q.append(v)
        sizes.append(count)
    if len(sizes) < 2:
        return 0
    return (len(comp) - 1) - max(sizes)


if __name__ == "__main__":
    g = Graph()
    for u, v in [(1, 2), (2, 3), (3, 1), (3, 4), (4, 5)]:
        g.add_edge(u, v)
    result = analyze_network(g)
    print("Articulation points:", result["articulation_points"])
    print("Bridges:", result["bridges"])
    ok = result["articulation_points"] == {3: 2, 4: 1}
    print("PASS" if ok else "FAIL")