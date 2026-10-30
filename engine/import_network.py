"""
import_network.py: convert a real topology file into the dashboard's JSON upload format.
Standard library only.

Usage (inside /engine):
    python import_network.py input.graphml output.json
    python import_network.py edges.txt output.json
Optional:  --budget 20
"""

import csv
import json
import re
import sys
import xml.etree.ElementTree as ET

MAX_NODES = 2000


def from_graphml(path):
    root = ET.parse(path).getroot()
    ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
    keys = {k.get("id"): k.get("attr.name") for k in root.iter(ns + "key")}
    nodes, edges = [], []
    for n in root.iter(ns + "node"):
        attrs = {keys.get(d.get("key"), d.get("key")): (d.text or "").strip()
                 for d in n.iter(ns + "data")}
        label = attrs.get("label") or attrs.get("name") or n.get("id")
        nodes.append({"id": str(n.get("id")), "label": label, "role": "router", "criticality": 3})
    for e in root.iter(ns + "edge"):
        edges.append({"source": str(e.get("source")), "target": str(e.get("target"))})
    return nodes, edges


def from_edge_list(path):
    seen, edges = {}, []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line[0] in "#%/":
                continue
            parts = [p for p in re.split(r"[,\s;]+", line) if p]
            if len(parts) < 2:
                continue
            a, b = parts[0], parts[1]
            if a.lower() in ("source", "from", "src", "u") and not seen and not edges:
                continue                                  # header row
            for x in (a, b):
                seen.setdefault(x, {"id": x, "label": f"Node {x}", "role": "router", "criticality": 3})
            if a != b:
                edges.append({"source": a, "target": b})
    return list(seen.values()), edges


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    budget = 15
    if "--budget" in sys.argv:
        budget = int(sys.argv[sys.argv.index("--budget") + 1])
        args = [a for a in args if a != str(budget)]
    if len(args) != 2:
        sys.exit(__doc__)
    src, dst = args
    nodes, edges = from_graphml(src) if src.lower().endswith((".graphml", ".xml")) else from_edge_list(src)

    ids = {n["id"] for n in nodes}
    edges = [e for e in edges if e["source"] in ids and e["target"] in ids]
    if len(nodes) > MAX_NODES:
        sys.exit(f"{len(nodes)} nodes is over the server limit of {MAX_NODES}. Use a smaller network.")

    with open(dst, "w", encoding="utf-8") as f:
        json.dump({"budget": budget, "nodes": nodes, "edges": edges}, f, indent=2)
    print(f"Wrote {len(nodes)} nodes and {len(edges)} links -> {dst}")
    if len(nodes) > 300:
        print("Note: above 300 nodes the dashboard skips the redesign and suggestions (sampled centrality).")


if __name__ == "__main__":
    main()