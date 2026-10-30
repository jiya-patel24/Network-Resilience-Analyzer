import copy


class Graph:
    def __init__(self):
        self.adjacency_list = {}
        self.meta = {}  # node_id -> {"label": ..., "role": ...}

    def add_node(self, node_id, **meta):
        if node_id not in self.adjacency_list:
            self.adjacency_list[node_id] = []
        if meta:
            self.meta.setdefault(node_id, {}).update(meta)

    def set_meta(self, node_id, **meta):
        self.meta.setdefault(node_id, {}).update(meta)

    def add_edge(self, node_u, node_v):
        if node_u == node_v:
            return
        self.add_node(node_u)
        self.add_node(node_v)
        if node_v not in self.adjacency_list[node_u]:   # no duplicate links
            self.adjacency_list[node_u].append(node_v)
            self.adjacency_list[node_v].append(node_u)

    def has_edge(self, node_u, node_v):
        return node_v in self.adjacency_list.get(node_u, [])

    def remove_edge(self, node_u, node_v):
        if self.has_edge(node_u, node_v):
            self.adjacency_list[node_u].remove(node_v)
            self.adjacency_list[node_v].remove(node_u)

    def get_neighbors(self, node_id):
        return self.adjacency_list.get(node_id, [])

    def remove_node(self, node_id):
        if node_id not in self.adjacency_list:
            return
        for neighbor in list(self.adjacency_list[node_id]):
            self.adjacency_list[neighbor].remove(node_id)
        del self.adjacency_list[node_id]
        self.meta.pop(node_id, None)

    def nodes(self):
        return list(self.adjacency_list.keys())

    def edges(self):
        seen, out = set(), []
        for u in self.adjacency_list:
            for v in self.adjacency_list[u]:
                key = frozenset((u, v))
                if key not in seen:
                    seen.add(key)
                    out.append((u, v))
        return out

    def has_node(self, node_id):
        return node_id in self.adjacency_list

    def degree(self, node_id):
        return len(self.get_neighbors(node_id))

    def edge_count(self):
        return sum(len(v) for v in self.adjacency_list.values()) // 2

    def copy(self):
        g = Graph()
        g.adjacency_list = {k: list(v) for k, v in self.adjacency_list.items()}
        g.meta = copy.deepcopy(self.meta)
        return g


if __name__ == "__main__":
    g = Graph()
    g.add_edge(1, 2)
    g.add_edge(2, 3)
    g.add_edge(3, 1)
    g.add_edge(3, 4)
    g.add_edge(4, 5)
    print("Neighbors of 3:", g.get_neighbors(3))
    g.remove_node(4)
    print("After removing node 4 -> neighbors of 3:", g.get_neighbors(3))