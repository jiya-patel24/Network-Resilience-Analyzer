from generate_snapshots import build_network
from security import security_report
from redesign import redesign
from severity import composite_severity
from tarjan import analyze_network
from scoring import score_summary

g = build_network()
rep = security_report(g)
assert len(rep["violations"]) == 5, rep["violations"]
assert rep["score"] is not None

comp = composite_severity(g, analyze_network(g))
assert comp[6]["score"] > comp[12]["score"], "an articulation point must outrank a leaf workstation"

before = score_summary(g)
plan = redesign(g, budget=15)
after = score_summary(plan["graph"])
assert after["violations"] == 0, "segmentation should remove every violation"
assert after["security"] > before["security"]
assert after["overall"] > before["overall"]
assert plan["spent"] <= 15

print("before:", before)
print("after: ", after)
for s in plan["plan"]:
    print(f'  {s["step"]}. [{s["type"]}] {s["description"]}  (cost {s["cost"]}, overall {s["overall_after"]})')
print("ALL PHASE 1+2 TESTS PASSED")