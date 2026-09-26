"""
test_edge_cases.py

Runs the engine (graph.py, tarjan.py, incremental.py, attack_simulation.py)
against three graphs that don't come up in the main test graph, to check
nothing crashes and the results make sense:

1. A disconnected graph (two separate clusters, no edge between them)
2. A single-node graph (just one node, no edges at all)
3. A fully-connected graph (every node touches every other node directly)

This does NOT replace your existing PASS/FAIL tests in each file's
__main__ block - it's a separate check specifically for these edge cases.

Drop this file in the same folder as graph.py, tarjan.py, incremental.py,
and attack_simulation.py, then run: python test_edge_cases.py
"""

from graph import Graph
from tarjan import find_articulation_points
from incremental import add_node_incremental
from attack_simulation import compare_attacks


def print_header(title):
    print()
    print("=" * 60)
    print(title)
    print("=" * 60)


def run_case(label, graph):
    """
    Runs the standard pipeline (find critical nodes, then compare
    attacks) on a graph, and prints what happened.
    """
    print(f"\n--- {label} ---")
    print("Nodes:", graph.nodes())

    critical_nodes = find_articulation_points(graph)
    print("Critical nodes and severity:", critical_nodes)

    result = compare_attacks(graph, critical_nodes)

    if result["targeted"] is None:
        print("Targeted attack: None (no critical nodes to attack)")
    else:
        print("Targeted attack:", result["targeted"])

    if result["random"] is None:
        print("Random attack: None (empty graph, nothing to remove)")
    else:
        print("Random attack:  ", result["random"])

    return critical_nodes


# ---------------------------------------------------------------------
# Case 1: Disconnected graph
# Two separate triangles - {1, 2, 3} and {4, 5, 6} - with NO edge
# connecting the two groups at all.
# ---------------------------------------------------------------------
print_header("CASE 1: Disconnected graph (two separate islands)")

g1 = Graph()
g1.add_edge(1, 2)
g1.add_edge(2, 3)
g1.add_edge(3, 1)
g1.add_edge(4, 5)
g1.add_edge(5, 6)
g1.add_edge(6, 4)

run_case("Two disconnected triangles", g1)

print("""
What to expect by hand:
- Each triangle is fully-connected on its own, so within each triangle
  there are no articulation points (removing any one node still leaves
  the other two connected to each other).
- Since the two triangles were never connected to begin with, removing
  any single node can't possibly connect or disconnect them further.
- Expected: critical_nodes should be empty ({}), and targeted attack
  should be None.
""")


# ---------------------------------------------------------------------
# Case 2: Single-node graph
# Just one node, no edges.
# ---------------------------------------------------------------------
print_header("CASE 2: Single-node graph")

g2 = Graph()
g2.add_node(1)

run_case("One lone node, no edges", g2)

print("""
What to expect by hand:
- There's only one node and nothing connects to it, so there's nothing
  that removing it could possibly disconnect.
- Expected: critical_nodes should be empty ({}), and targeted attack
  should be None. Random attack should still run (there's one node to
  pick), and removing it should cause 0 nodes to be cut off, since
  there's nothing left afterward at all.
""")


# ---------------------------------------------------------------------
# Case 3: Fully-connected graph
# Every node has a direct edge to every other node - a "complete graph".
# Using 4 nodes here: 1-2, 1-3, 1-4, 2-3, 2-4, 3-4.
# ---------------------------------------------------------------------
print_header("CASE 3: Fully-connected graph (complete graph, 4 nodes)")

g3 = Graph()
g3.add_edge(1, 2)
g3.add_edge(1, 3)
g3.add_edge(1, 4)
g3.add_edge(2, 3)
g3.add_edge(2, 4)
g3.add_edge(3, 4)

run_case("Complete graph on 4 nodes", g3)

print("""
What to expect by hand:
- Every node is directly connected to every other node, so removing
  any single node still leaves the rest fully connected to each other.
- Expected: critical_nodes should be empty ({}), and targeted attack
  should be None - this is the exact case that used to crash before
  the None-check fix in simulate_targeted_attack's caller.
""")


# ---------------------------------------------------------------------
# Bonus check: does incremental.py still behave on a graph that starts
# as a single isolated node, then grows?
# ---------------------------------------------------------------------
print_header("BONUS: Incremental addition starting from a single node")

g4 = Graph()
g4.add_node(1)

critical_nodes_4 = find_articulation_points(g4)
print("Before addition:", critical_nodes_4)

add_node_incremental(g4, new_node_id=2, attach_to=1, critical_nodes=critical_nodes_4)
print("After attaching node 2 to node 1:", critical_nodes_4)

full_recompute_4 = find_articulation_points(g4)
print("Full recompute for comparison:   ", full_recompute_4)

if critical_nodes_4 == full_recompute_4:
    print("PASS: incremental result matches full recompute.")
else:
    print("FAIL: incremental result does NOT match full recompute.")

print("""
What to expect by hand:
- Node 1 starts alone (degree 0). Attaching node 2 to it just creates
  a single edge - a straight line of 2 nodes. A 2-node line has no
  articulation points (removing either node just leaves one isolated
  node behind, but there's no "in-between" node to be critical).
- Expected: critical_nodes should stay empty ({}) after the addition.
""")

print_header("All edge cases run. Check the output above against the expectations.")