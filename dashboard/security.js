"use strict";
/* security.js: Phase 1+2 layer. Loaded AFTER app.js.
   Adds: zone rings, policy-violation links, crown jewels, attack path, composite risk ranking,
   explainable inspector, before/after redesign, delta chips, network upload. */

const ZONE_LVL = { internet: 0, dmz: 1, internal: 2, data: 3 };
const ZONE_COLOR = { internet: "#FF5C7A", dmz: "#FFB547", internal: "#38BDF8", data: "#A78BFA" };
const FACTOR_LABEL = { I: "Isolation impact", B: "Link fragility", C: "Traffic centrality", T: "Telemetry risk", R: "Redundancy deficit" };
let afterMode = false, showPath = false;

function baseState() {
  const s = snapshots[idx];
  return afterMode && s.redesign ? s.redesign.state_after : s.state;
}
const whatIf = () => failed.length > 0 || extraEdges.length > 0;

// same policy as engine/security.py
function violates(a, b) {
  if (!a || !b) return false;
  const za = ZONE_LVL[a.zone], zb = ZONE_LVL[b.zone];
  if (za === undefined || zb === undefined) return false;
  const fa = a.role === "firewall", fb = b.role === "firewall";
  if (fa && fb) return false;
  if (fa || fb) return Math.abs(za - zb) > 1;
  return za !== zb;
}

/* ---------- wrap app.js functions ---------- */
const _render = render;
render = function () { _render(); secDecorate(); renderRedesign(); };
const _utu = updateTimelineUI;
updateTimelineUI = function () { _utu(); addDeltaChips(); };
const _rs = renderSelected;
renderSelected = function () { _rs(); inspectorExtra(); };
const _sf = suggestFixes;   // advisor must respect the segmentation policy
suggestFixes = function (v, limit = 3) {
  return _sf(v, 12).filter((s) => !violates(v.byId.get(s.a), v.byId.get(s.b))).slice(0, limit);
};

/* ---------- ranking by composite risk index ---------- */
renderThreats = function () {
  const list = $("threat-list"); list.replaceChildren();
  const { an } = view;
  const useComposite = !whatIf() && view.nodes.some((n) => n.composite !== undefined);
  const rows = useComposite
    ? view.nodes.filter((n) => !view.removed.has(n.id) && n.composite > 0)
        .sort((a, b) => b.composite - a.composite).slice(0, 5)
        .map((n) => ({ id: n.id, val: n.composite, crit: an.critical.has(n.id) }))
    : [...an.critical].sort((a, b) => an.severity.get(b) - an.severity.get(a)).slice(0, 5)
        .map((id) => ({ id, val: an.severity.get(id), crit: true }));
  $("threat-empty").hidden = rows.length > 0;
  const top = Math.max(1, ...rows.map((r) => r.val));
  rows.forEach((r, i) => {
    const li = el("li", "threat"); li.tabIndex = 0;
    li.append(el("span", "rk", String(i + 1)));
    const mid = el("div"); mid.append(el("div", "nm", nameOf(r.id) + (r.crit ? " · SPOF" : "")));
    const bar = el("div", "bar"), fill = el("i"); fill.style.width = `${(r.val / top) * 100}%`; bar.append(fill); mid.append(bar);
    const sv = el("div", "sv", String(r.val)); sv.append(el("small", "", useComposite ? "risk index" : "nodes cut"));
    li.append(mid, sv);
    li.onclick = () => selectNode(r.id);
    li.onkeydown = (e) => { if (e.key === "Enter") selectNode(r.id); };
    list.append(li);
  });
};

/* ---------- decorate graph + KPIs ---------- */
function secDecorate() {
  if (!view) return;
  const st = baseState();

  nodeSel.each(function (d) {
    const meta = view.byId.get(d.id) || {}, g = d3.select(this);
    let ring = g.select("circle.zone-ring");
    if (ring.empty()) ring = g.insert("circle", ".core").attr("class", "zone-ring");
    ring.attr("r", d.r + 5).style("stroke", ZONE_COLOR[meta.zone] || "transparent");
    const jewel = meta.zone === "data" && meta.role !== "firewall";
    if (jewel && g.select("text.jewel").empty()) g.append("text").attr("class", "jewel").text("★");
    if (!jewel) g.select("text.jewel").remove();
    g.select("text.jewel").attr("y", -d.r - 7);
  });

  linkSel.classed("viol", (d) => !d.dead && violates(view.byId.get(d.source.id), view.byId.get(d.target.id)));

  const ap = showPath && !whatIf() && st.security && st.security.attack_paths && st.security.attack_paths[0];
  const path = ap ? ap.path : [];
  const pk = new Set();
  for (let i = 0; i < path.length - 1; i++) pk.add(keyOf(path[i], path[i + 1]));
  linkSel.classed("atk", (d) => pk.has(d.key));
  nodeSel.classed("atk", (d) => path.includes(d.id));

  let viol = 0;
  for (const e of view.edges) {
    if (view.removed.has(e.source) || view.removed.has(e.target)) continue;
    if (violates(view.byId.get(e.source), view.byId.get(e.target))) viol++;
  }
  const sec = st.security, score = sec && sec.score !== null && sec.score !== undefined ? sec.score : null;
  const secEl = $("kpi-sec");
  if (score === null || whatIf()) {
    secEl.textContent = "–";
    $("kpi-sec-sub").textContent = score === null ? "no zones defined" : "what-if view";
  } else {
    secEl.textContent = score;
    secEl.style.color = score >= 70 ? "var(--green)" : score >= 40 ? "var(--amber)" : "var(--red)";
    $("kpi-sec-sub").textContent = ap ? `weakest path: ${ap.firewalls} firewall(s)` : "zones & firewalls";
  }
  $("kpi-viol").textContent = viol;
}

/* ---------- inspector: explainable risk ---------- */
function inspectorExtra() {
  const body = $("selected-body");
  const n = selectedId !== null && view && view.byId.get(selectedId);
  if (!n || whatIf() || n.composite === undefined) return;
  const box = el("div", "factors");
  const head = el("div", "factors-head"); head.append(el("span", "", "Risk index"), el("b", "", `${n.composite} / 100`));
  box.append(head, el("p", "sel-note", `Zone: ${n.zone || "unassigned"} · Business criticality: ${n.criticality ?? "–"}/10`));
  Object.entries(n.factors || {}).forEach(([k, v]) => {
    const row = el("div", "factor"); row.append(el("span", "", FACTOR_LABEL[k] || k));
    const bar = el("div", "bar"), f = el("i"); f.style.width = `${Math.round(v * 100)}%`; bar.append(f); row.append(bar);
    box.append(row);
  });
  body.append(box);
}

/* ---------- redesign panel ---------- */
function setAfter(v) { afterMode = v; goTo(idx); }

function renderRedesign() {
  const box = $("redesign-body"); box.replaceChildren();
  const rd = snapshots[idx].redesign;
  if (!rd) { box.append(el("p", "muted small", "No redesign available (network too large or no data).")); return; }

  const seg = el("div", "seg");
  const b1 = el("button", "seg-btn" + (afterMode ? "" : " is-on"), "Current");
  const b2 = el("button", "seg-btn" + (afterMode ? " is-on" : ""), "After redesign");
  b1.type = "button"; b2.type = "button";
  b1.onclick = () => setAfter(false); b2.onclick = () => setAfter(true);
  seg.append(b1, b2); box.append(seg);

  const lowerBetter = new Set(["spofs", "violations"]);
  const tbl = el("div", "cmp");
  [["Overall", "overall"], ["Resilience", "resilience"], ["Security", "security"],
   ["Single points of failure", "spofs"], ["Policy violations", "violations"]].forEach(([label, key]) => {
    const a = rd.before[key], b = rd.after[key];
    const better = a !== null && b !== null && (lowerBetter.has(key) ? b < a : b > a);
    const r = el("div", "cmp-row");
    r.append(el("span", "", label), el("span", "cmp-a", a === null ? "–" : String(a)), el("span", "cmp-arrow", "→"),
             el("span", "cmp-b" + (better ? " good" : ""), b === null ? "–" : String(b)));
    tbl.append(r);
  });
  box.append(tbl);

  if (!rd.plan.length) box.append(el("p", "empty", "Nothing to change within this budget."));
  else {
    const ol = el("ol", "plan");
    rd.plan.forEach((s) => {
      const li = el("li"); li.append(el("span", "plan-d", s.description), el("span", "plan-c", `cost ${s.cost} · overall score ${s.overall_after}`));
      ol.append(li);
    });
    box.append(ol);
  }
  box.append(el("p", "plan-foot", `Budget used: ${rd.spent} / ${rd.budget}`));
}

/* ---------- timeline delta chips ---------- */
function addDeltaChips() {
  const d = snapshots[idx] && snapshots[idx].delta;
  if (!d) return;
  const parts = [];
  if (d.added_nodes.length) parts.push(`+${d.added_nodes.length} node`);
  if (d.removed_nodes.length) parts.push(`−${d.removed_nodes.length} node`);
  if (d.added_edges.length) parts.push(`+${d.added_edges.length} link`);
  if (d.removed_edges.length) parts.push(`−${d.removed_edges.length} link`);
  const sign = d.resilience_change > 0 ? "+" : "";
  parts.push(`resilience ${sign}${d.resilience_change}`);
  $("timeline-chips").append(el("span", "chip", "Δ " + parts.join(" · ")));
}

/* ---------- upload ---------- */
async function uploadNetwork(file) {
  try {
    const payload = JSON.parse(await file.text());
    const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail ? JSON.stringify(e.detail).slice(0, 120) : res.status); }
    const snap = await res.json();
    stop(); afterMode = false;
    snapshots = [snap]; scores = [analyze(snap.state.nodes, snap.state.edges).score];
    nodeCache.clear(); buildTrack(); buildSpark(); verifyEngine(); goTo(0);
    toast(`Loaded ${snap.state.nodes.length} devices from ${file.name}`);
  } catch (err) { toast("Upload failed: " + err.message); }
}

$("file-upload").addEventListener("change", (e) => { if (e.target.files[0]) uploadNetwork(e.target.files[0]); e.target.value = ""; });
$("btn-path").addEventListener("click", () => { showPath = !showPath; $("btn-path").classList.toggle("on", showPath); secDecorate(); });