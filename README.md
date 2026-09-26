# Network Resilience Analyzer

Detects single points of failure (articulation points / cut vertices) in a network graph, ranks them by how damaging their failure would be, and keeps that analysis updated as the network changes — instead of recomputing everything from scratch every time.

## What this project does

A network (computer network, infrastructure, organization chart, etc.) usually has redundant connections, so it can survive most nodes going down. But some nodes are **critical**: if they fail, the network splits into pieces that can no longer reach each other. This project:

1. Finds those critical nodes using **Tarjan's algorithm**.
2. Scores each one by **severity** — how many nodes would be cut off if it failed.
3. Updates that analysis **incrementally** when nodes are added, instead of re-running the whole algorithm every time.

## Current status

This repo currently contains the **core engine only** — the graded data structures deliverable. The D3.js visualization dashboard is a separate, ungraded planned next step.

| Component | Status |
|---|---|
| Graph representation (`graph.py`) | Done |
| Articulation point detection + severity scoring (`tarjan.py`) | Done |
| Incremental updates on node addition (`incremental.py`) | Done |
| Attack simulation (targeted vs. random failure) | Done |
| D3.js visualization dashboard | Planned |

## Scope decision: what "incremental" means here

This is a deliberate, locked design decision, not an oversight:

> **Incremental updates only handle new nodes being attached to the graph.** Any node deletion, or adding an edge between two nodes that already both exist, triggers a **full recompute** of articulation points instead of an incremental update.

**Why:** Adding a new node can only ever merge parts of the graph together — it can't create a new critical point or break the existing structure in a way that needs re-deriving everything. That makes it tractable to update incrementally. Removing a node can *split* the graph and create brand-new critical points, which is a much harder problem (closer to graduate-level dynamic graph research) and is out of scope for this project. We chose to state this boundary explicitly rather than leave it ambiguous.

## Project structure

```
graph.py         # Graph data structure (adjacency list): add/remove nodes and edges, get neighbors
tarjan.py        # Articulation point detection (Tarjan's algorithm) + severity scoring
incremental.py   # Incremental update logic for node additions only
attack_simulation.py   # Simulates targeted vs. random node failure, reports damage comparison
```

## How to run

Each file has a built-in test at the bottom that runs automatically and prints a PASS/FAIL result — no setup or extra arguments needed.

```bash
python graph.py         # demonstrates basic graph operations (add edges, remove a node, check neighbors)
python tarjan.py         # runs articulation point detection on a sample graph and checks the result
python incremental.py    # tests incremental node-addition updates against a full recompute, for two cases
python attack_simulation.py   # compares damage from removing the worst critical node vs. a random node
```

Requirements: Python 3, no external libraries.

## Why this problem is non-trivial

This only works as a meaningful project because the network is modeled as a **general graph with cycles**, not a tree. On a plain tree, every non-leaf node is automatically a critical node — there's nothing to compute. Critical-node detection only becomes interesting once there are redundant paths, which is also what real networks actually look like.
