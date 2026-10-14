# Network Resilience Analyzer: Summary, Progress & Roadmap

Repo: https://github.com/jiya-patel24/Network-Resilience-Analyzer
Course: CS2305 Data Structures-I (mostly Unit 6, Graphs)

## 1. Summary
Finds single points of failure (**articulation points**) in a network, ranks them by **severity** (nodes cut off if that node fails), keeps the analysis updated **incrementally** as the network changes, and **simulates attacks** (targeted vs random) to show why critical nodes matter.

- Network is a **general graph** (cycles, redundant links). On a tree every non-leaf is critical, so there's nothing to compute.
- It is a **simulated** network, not a real monitored one (deliberate scope choice).
- Algorithm: Tarjan's DFS with `disc[]` and `low[]` in O(V+E).

## 2. Current Progress

| Feature | Status | Unique? |
|---|---|---|
| Graph with adjacency list (`graph.py`) | Done | Standard (Unit 6) |
| Articulation points via Tarjan (`tarjan.py`) | Done | Standard |
| Severity scoring | Done | Semi-unique |
| Incremental node addition (`incremental.py`) | Partial | Unique |
| Targeted attack simulation (`attack_simulation.py`) | Done | Unique (cybersecurity angle) |
| Random attack simulation | Done | Unique |
| Targeted vs random comparison | Done | Unique (project payoff) |
| Edge-case tests (`test_edge_cases.py`): disconnected, single-node, complete graph | Done | Testing |
| JSON export (`export.py`) | Done | Glue |
| Dashboard (`index.html` + `data.json`): D3 force graph, red/blue nodes, size = severity, legend, tooltips | Done (static) | Mostly standard |

## 3. What Still Needs To Be Done

**Known gaps**
1. **Incremental addition is thin.** It only attaches a new node to one existing node, and it still recomputes severity for every critical node. It is not yet a true "update only the affected part".
2. **Scoping decision not made:** additions-only, or additions + deletions? State it in the report (viva risk).
3. **Deletions** are not handled incrementally (`remove_node` exists in the graph, but critical nodes are not updated).
4. **Bridge detection** (critical links) was planned for Phase 1 but is not in `tarjan.py`.
5. **Recursive Tarjan** can hit Python's recursion limit (~1000) on large graphs.
6. **Dashboard is static.** No attack buttons, no removal animation, no "play events" button.
7. **No driver script** feeding scripted events into the engine with delays.
8. **Report + viva prep** (see checklist below).

**Timeline**

| Phase | Weeks | Work | Status |
|---|---|---|---|
| 1 | 1-4 | Articulation points, severity (bridges missing) | Mostly done |
| 2 | 5-10 | Incremental maintenance | Partial |
| 3 | 11-13 | Attack simulation, cascading disconnection | Engine done, UI missing |
| 4 | 14-16 | Edge-case tests, report, viva | Tests done, report pending |

**Viva checklist**
- Why is this cybersecurity, not just graph theory? (attack simulation)
- How does incremental update really work? (must differ from "rerun the algorithm")
- What's the data source? (simulated topology, on purpose)
- Are deletions incremental or additions-only? (decide beforehand)

## 4. Additional Features We CAN Add

| Unit | Feature | What it adds | Effort |
|---|---|---|---|
| 5 Heaps | Max-heap of critical nodes by severity | Instant "top 3 most dangerous nodes" | Low |
| 3 Stacks/Queues | Event queue for the driver script | Events processed in order (live-network simulation) | Low |
| 3 Stacks/Queues | Undo/redo with stacks | Undo the last network change | Low |
| 3 Stacks/Queues | Iterative Tarjan (explicit stack) | Fixes the recursion-limit bug | Medium |
| 3 Stacks/Queues | Custom queue for BFS | Replaces slow `pop(0)` | Low |
| 2 Linked Lists | Change log as a linked list | History of every event | Low |
| 2 Hashing | Own hash table for node lookup | Replaces `dict` ("no library shortcuts") | Medium |
| 1 Sorting | Merge/quick sort to rank by severity | Uses the sorts from the syllabus | Low |
| 1 Complexity | Benchmark: incremental vs full recompute | Proof that incremental is faster | Medium |
| 1 Sparse Matrix | Adjacency matrix mode | Matrix vs list memory comparison | Medium |
| 4 Trees | Block-cut tree | Weak spots shown as a clean tree | High |
| 6 Graphs | Bridge detection | Critical links, tiny change to Tarjan | Low |
| 6 Graphs | Fix suggestions ("add this edge") | Recommends a link that removes a weak point | Medium |
| 6 Graphs | Dijkstra with weighted links | Fastest path before/after failure (Lab 14) | Medium |
| 6 Graphs | Prim/Kruskal backbone | Cheapest connected link set | Medium |
| 6 Graphs | Cascading failure | Overloaded neighbors fail too | Medium |
| Frontend | Attack buttons, animation, "play events" | Needed for the demo | Medium |

**Recommended picks:** max-heap, event queue + undo stack, bridge detection, benchmark chart, fix suggestions, frontend attack buttons.
**Skip for now:** Dijkstra, Prim/Kruskal, cascading failure (they drift toward a general network toolkit).
**Only if time remains:** block-cut tree.
