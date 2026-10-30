"""delta.py: patch between two exported states (never send the whole graph again)."""


def diff_states(prev, curr):
    if prev is None:
        return None
    pn = {n["id"]: n for n in prev["nodes"]}
    cn = {n["id"]: n for n in curr["nodes"]}
    pe = {frozenset((e["source"], e["target"])): [e["source"], e["target"]] for e in prev["edges"]}
    ce = {frozenset((e["source"], e["target"])): [e["source"], e["target"]] for e in curr["edges"]}
    updated = [{"id": i, "severity": cn[i]["severity"], "is_critical": cn[i]["is_critical"]}
               for i in cn if i in pn and (pn[i]["severity"] != cn[i]["severity"]
                                           or pn[i]["is_critical"] != cn[i]["is_critical"])]
    return {
        "added_nodes": [i for i in cn if i not in pn],
        "removed_nodes": [i for i in pn if i not in cn],
        "added_edges": [ce[k] for k in ce if k not in pe],
        "removed_edges": [pe[k] for k in pe if k not in ce],
        "updated_nodes": updated,
        "resilience_change": curr["metrics"]["resilience"] - prev["metrics"]["resilience"],
        "spof_change": curr["metrics"]["spofs"] - prev["metrics"]["spofs"],
    }