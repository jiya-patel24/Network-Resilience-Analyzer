import random
from graph import Graph
from tarjan import find_articulation_points, _compute_severity

def count_components_excluding(graph, excluded_node):
    """
    Counts how many separate, disconnected pieces the graph breaks into
    if we pretend `excluded_node` doesn't exist - without actually
    removing it from the real graph.
    """
    remaining_nodes = [n for n in graph.nodes() if n != excluded_node]
    visited = set()
    component_count = 0

    for start in remaining_nodes:
        if start in visited:
            continue

        # Found an unvisited node -> this starts a brand new island
        component_count += 1

        queue = [start]
        visited.add(start)

        while queue:
            curr = queue.pop(0)
            for neighbor in graph.get_neighbors(curr):
                if neighbor == excluded_node:
                    continue
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)

    return component_count

def simulate_targeted_attack(graph, critical_nodes):
    """
    Simulates removing the single most damaging critical node
    (highest severity score) and reports the fallout.
    Does NOT actually modify the graph.
    """
    if not critical_nodes:
        return None  

    target_node = max(critical_nodes, key=critical_nodes.get)

    nodes_cut_off = _compute_severity(graph, target_node)
    components_after = count_components_excluding(graph, target_node)

    return {
        "attack_type": "targeted",
        "removed_node": target_node,
        "nodes_cut_off": nodes_cut_off,
        "remaining_components": components_after
    }

def simulate_random_attack(graph):
    """
    Simulates removing a random node from the graph (critical or not)
    and reports the fallout. Does NOT actually modify the graph.
    """
    all_nodes = graph.nodes()

    if not all_nodes:
        return None  # empty graph, nothing to attack

    target_node = random.choice(all_nodes)

    nodes_cut_off = _compute_severity(graph, target_node)
    components_after = count_components_excluding(graph, target_node)

    return {
        "attack_type": "random",
        "removed_node": target_node,
        "nodes_cut_off": nodes_cut_off,
        "remaining_components": components_after
    }

def compare_attacks(graph, critical_nodes):
    """
    Runs both a targeted attack and a random attack on the same graph
    and returns both results side by side, so you can see the contrast.
    """
    targeted_result = simulate_targeted_attack(graph, critical_nodes)
    random_result = simulate_random_attack(graph)

    return {
        "targeted": targeted_result,
        "random": random_result
    }

if __name__ == "__main__":
    g = Graph()
    g.add_edge(1, 2)
    g.add_edge(2, 3)
    g.add_edge(3, 1)
    g.add_edge(3, 4)
    g.add_edge(4, 5)

    critical_nodes = find_articulation_points(g)
    print("Critical nodes and severity:", critical_nodes)

    result = compare_attacks(g, critical_nodes)

    print()
    print("Targeted attack result:", result["targeted"])
    print("Random attack result:  ", result["random"])

    if result["targeted"] is None:
        print()
        print("No critical nodes exist in this graph — targeted attack has nothing to target.")
    else:
        targeted_damage = result["targeted"]["nodes_cut_off"]
        random_damage = result["random"]["nodes_cut_off"]

        print()
        if targeted_damage >= random_damage:
            print(f"PASS: targeted attack caused >= damage ({targeted_damage} vs {random_damage})")
        else:
            print(f"FAIL: targeted attack caused LESS damage than random ({targeted_damage} vs {random_damage})")