class Graph:
    def __init__(self):
        self.adjacency_list = {}

    def add_node(self, node_id):
        if node_id not in self.adjacency_list:
            self.adjacency_list[node_id] = []

    def add_edge(self, node_u, node_v):
        self.add_node(node_u)
        self.add_node(node_v)
        self.adjacency_list[node_u].append(node_v)
        self.adjacency_list[node_v].append(node_u)  # Assuming undirected graph

    def get_neighbors(self, node_id):
        return self.adjacency_list.get(node_id, [])

    def remove_node(self, node_id):
        if node_id not in self.adjacency_list:
            return
        
        for neighbor in self.adjacency_list[node_id]:
            self.adjacency_list[neighbor].remove(node_id)
           
        del self.adjacency_list[node_id]

    def nodes(self):
        """Return a list of every node currently in the graph."""
        return list(self.adjacency_list.keys())
    
    def has_node(self, node_id):
        """Check whether a node exists in the graph."""
        return node_id in self.adjacency_list
    
    def degree(self, node_id):
        """How many neighbors does this node currently have?"""
        return len(self.get_neighbors(node_id))

if __name__ == "__main__":
    g = Graph()
    g.add_edge(1, 2)
    g.add_edge(2, 3)
    g.add_edge(3, 1)
    g.add_edge(3, 4)
    g.add_edge(4, 5)

    print("Neighbors of 3:", g.get_neighbors(3))
    print("Neighbors of 5:", g.get_neighbors(5))

    g.remove_node(4)
    print("After removing node 4:")
    print("Neighbors of 3:", g.get_neighbors(3))
    print("Neighbors of 5:", g.get_neighbors(5))