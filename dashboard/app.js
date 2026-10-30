"use strict";

/* ================================================================
   Network Resilience Analyzer: dashboard
   - Timeline comes from engine/generate_snapshots.py (snapshots.json)
   - What-if tools (attack lab, hardening advisor) re-run the same
     analysis in the browser so they respond instantly.
   ================================================================ */

const SNAPSHOTS_URL = "snapshots.json";
const STEP_MS = 3600;
const CIRC = 2 * Math.PI * 42;
const ISLAND = ["#A78BFA", "#F472B6", "#FBBF24", "#38BDF8", "#FB923C"];
const GLYPH = { gateway: "GW", firewall: "FW", router: "RT", switch: "SW", server: "SV",
                database: "DB", wifi: "AP", client: "PC", monitor: "MN", storage: "ST" };
const KIND = { baseline: ["Baseline", "k-base"], add_node: ["Node joined", "k-add"],
               add_link: ["Link added", "k-link"], failure: ["Failure", "k-fail"] };

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const keyOf = (a, b) => { a = String(a); b = String(b); return a < b ? a + "|" + b : b + "|" + a; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

/* ------------------------- state ------------------------- */
let snapshots = [], scores = [], idx = 0;
let playing = false, timer = null;
let selectedId = null, mode = "targeted";
let extraEdges = [], failed = [], lastFailure = null;
let view = null, width = 0, height = 0, hasRendered = false;
const nodeCache = new Map();
let sim, linkSel, nodeSel, linkLayer, fxLayer, nodeLayer;

/* ================= ANALYSIS (mirrors the Python engine) ================= */
function bfs(adj, start, seen = new Set()) {
  const out = [start]; seen.add(start);
  for (let i = 0; i < out.length; i++)
    for (const nb of adj.get(out[i])) if (!seen.has(nb)) { seen.add(nb); out.push(nb); }
  return out;
}

function analyze(nodes, edges, removed = new Set()) {
  const ids = nodes.map((n) => n.id).filter((id) => !removed.has(id));
  const adj = new Map(ids.map((id) => [id, new Set()]));
  const live = [];
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source).add(e.target); adj.get(e.target).add(e.source); live.push(e);
    }
  }
  const comps = [], compOf = new Map();
  for (const id of ids) {
    if (compOf.has(id)) continue;
    const comp = bfs(adj, id);
    comp.forEach((x) => compOf.set(x, comps.length));
    comps.push(comp);
  }
  const severity = new Map(), critical = new Set();
  for (const id of ids) {
    severity.set(id, 0);
    const size = comps[compOf.get(id)].length;
    if (size < 3) continue;
    const seen = new Set([id]), pieces = [];
    for (const nb of adj.get(id)) if (!seen.has(nb)) pieces.push(bfs(adj, nb, seen).length);
    if (pieces.length >= 2) { critical.add(id); severity.set(id, size - 1 - Math.max(...pieces)); }
  }
  const bridges = new Set();
  for (const e of live) {
    adj.get(e.source).delete(e.target); adj.get(e.target).delete(e.source);
    if (!bfs(adj, e.source).includes(e.target)) bridges.add(keyOf(e.source, e.target));
    adj.get(e.source).add(e.target); adj.get(e.target).add(e.source);
  }
  const n = ids.length, m = new Set(live.map((e) => keyOf(e.source, e.target))).size;
  const largest = comps.length ? Math.max(...comps.map((c) => c.length)) : 0;
  const maxSev = Math.max(0, ...severity.values());
  const raw = 1 - (0.5 * critical.size / Math.max(n, 1) + 0.25 * bridges.size / Math.max(m, 1) + 0.25 * maxSev / Math.max(n, 1));
  const score = n ? Math.max(0, Math.min(100, Math.round(100 * raw * (largest / n)))) : 0;
  return { adj, comps, compOf, severity, critical, bridges, n, m, largest, maxSev, score };
}

function suggestFixes(v, limit = 3) {
  const { nodes, edges, removed, an } = v;
  const existing = new Set(edges.map((e) => keyOf(e.source, e.target)));
  const used = new Set(), out = [];
  const ranked = [...an.critical].sort((a, b) => an.severity.get(b) - an.severity.get(a));
  for (const ap of ranked) {
    const seen = new Set([ap]), pieces = [];
    for (const nb of an.adj.get(ap)) if (!seen.has(nb)) pieces.push(bfs(an.adj, nb, seen));
    if (pieces.length < 2) continue;
    pieces.sort((a, b) => b.length - a.length);
    const pick = (p) => p.reduce((best, x) => (an.adj.get(x).size < an.adj.get(best).size ? x : best), p[0]);
    const a = pick(pieces[0]), b = pick(pieces[1]), key = keyOf(a, b);
    if (used.has(key) || existing.has(key)) continue;
    used.add(key);
    const an2 = analyze(nodes, edges.concat([{ source: a, target: b }]), removed);
    out.push({ a, b, ap, resolves: !an2.critical.has(ap), gain: an2.score - an.score, after: an2.score });
  }
  return out.filter((s) => s.gain > 0 || s.resolves)
            .sort((x, y) => y.gain - x.gain || Number(y.resolves) - Number(x.resolves)).slice(0, limit);
}

/* ============================ LOAD ============================ */
async function load() {
  try {
    let res = await fetch("/api/snapshots", { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) res = await fetch(SNAPSHOTS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    snapshots = await res.json();
    if (!Array.isArray(snapshots) || !snapshots.length) throw new Error("empty");
  } catch (err) {
    const m = $("message"); m.hidden = false; m.replaceChildren();
    const box = el("div"); box.append(
      el("p", "", "Couldn't load the network data."),
    );
    const p = el("p"); p.append("1. In a terminal: ", el("code", "", "cd engine"), " then ", el("code", "", "uvicorn api:app --port 8000"));
    const p2 = el("p"); p2.append("2. Open ", el("code", "", "http://127.0.0.1:8000"));
    box.append(p, p2); m.append(box);
    return;
  }
  scores = snapshots.map((s) => analyze(s.state.nodes, s.state.edges).score);
  setupSvg(); verifyEngine(); buildTrack(); buildSpark(); bindUI();
  goTo(0);
}

function verifyEngine() {
  const badge = $("engine-badge");
  const checkable = snapshots.every((s) => s.state.nodes.every((n) => "is_critical" in n));
  if (!checkable) { badge.textContent = "Engine: live"; return; }
  const ok = snapshots.every((s) => {
    const py = new Set(s.state.nodes.filter((n) => n.is_critical).map((n) => n.id));
    const js = analyze(s.state.nodes, s.state.edges).critical;
    return py.size === js.size && [...py].every((x) => js.has(x));
  });
  badge.textContent = ok ? "✓ Python engine cross-verified" : "⚠ engine mismatch";
  badge.classList.add(ok ? "ok" : "warn");
}

/* ============================ SVG / D3 ============================ */
function setupSvg() {
  const svg = d3.select("#graph");
  linkLayer = svg.append("g"); fxLayer = svg.append("g"); nodeLayer = svg.append("g");
  sim = d3.forceSimulation()
    .force("link", d3.forceLink().id((d) => d.id).distance(100).strength(0.5))
    .force("charge", d3.forceManyBody().strength(-420))
    .force("collide", d3.forceCollide().radius((d) => d.r + 18))
    .force("x", d3.forceX().strength(0.05)).force("y", d3.forceY().strength(0.07))
    .on("tick", tick);
  const ro = new ResizeObserver(() => { measure(); buildSpark(); updateSpark(); });
  ro.observe($("canvas")); measure();
}

function measure() {
  const r = $("canvas").getBoundingClientRect();
  width = r.width; height = r.height;
  if (!sim) return;
  sim.force("x").x(width / 2); sim.force("y").y(height / 2);
  sim.alpha(0.3).restart();
}

function tick() {
  nodeSel && nodeSel.attr("transform", (d) => {
    d.x = Math.max(d.r + 12, Math.min(width - d.r - 12, d.x));
    d.y = Math.max(d.r + 40, Math.min(height - d.r - 50, d.y));
    return `translate(${d.x},${d.y})`;
  });
  linkSel && linkSel.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y)
                    .attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
}

function seedNode(id, edges) {
  for (const e of edges) {
    const other = e.source === id ? e.target : e.target === id ? e.source : null;
    const o = other !== null && nodeCache.get(other);
    if (o && o.x != null) return { id, x: o.x + (Math.random() - 0.5) * 30, y: o.y + (Math.random() - 0.5) * 30 };
  }
  return { id, x: width / 2 + (Math.random() - 0.5) * 240, y: height / 2 + (Math.random() - 0.5) * 240 };
}

function neighborsOf(id) {
  const s = new Set();
  for (const e of view.edges) { if (e.source === id) s.add(e.target); else if (e.target === id) s.add(e.source); }
  return s;
}

/* ============================ RENDER ============================ */
function currentView() {
  const base = baseState();
  const edges = base.edges.map((e) => ({ source: e.source, target: e.target }))
    .concat(extraEdges.map((e) => ({ source: e.source, target: e.target, added: true })));
  const removed = new Set(failed);
  return { nodes: base.nodes, edges, removed, an: analyze(base.nodes, edges, removed),
           byId: new Map(base.nodes.map((n) => [n.id, n])) };
}

const nameOf = (id) => (view.byId.get(id) && view.byId.get(id).label) || `Node ${id}`;

function render() {
  view = currentView();
  const { an, removed, edges } = view;

  for (const k of [...nodeCache.keys()]) if (!view.byId.has(k)) nodeCache.delete(k);

  const order = an.comps.map((c, i) => [i, c.length]).sort((a, b) => b[1] - a[1]);
  const colorOfComp = new Map();
  order.forEach(([ci], rank) => colorOfComp.set(ci, rank === 0 ? "#38E1C6" : ISLAND[(rank - 1) % ISLAND.length]));
  const split = an.comps.length > 1;
  const maxSev = Math.max(1, an.maxSev);

  const simNodes = view.nodes.map((n) => {
    let o = nodeCache.get(n.id);
    if (!o) { o = seedNode(n.id, edges); nodeCache.set(n.id, o); }
    const dead = removed.has(n.id), sev = an.severity.get(n.id) || 0;
    o.name = n.label || `Node ${n.id}`; o.role = n.role; o.dead = dead; o.sev = sev;
    o.critical = !dead && an.critical.has(n.id);
    o.r = dead ? 15 : 15 + (o.critical ? 13 * sev / maxSev : 0);
    o.color = dead ? "#FF5C7A" : split ? colorOfComp.get(an.compOf.get(n.id)) : "#38E1C6";
    return o;
  });

  const simLinks = edges.map((e) => {
    const key = keyOf(e.source, e.target);
    return { source: e.source, target: e.target, key, added: !!e.added,
             bridge: an.bridges.has(key), dead: removed.has(e.source) || removed.has(e.target) };
  });

  // ----- links -----
  linkSel = linkLayer.selectAll("line.link").data(simLinks, (d) => d.key);
  linkSel.exit().remove();
  linkSel = linkSel.enter().append("line").merge(linkSel)
    .attr("class", (d) => "link" + (d.bridge ? " bridge" : "") + (d.dead ? " dead" : "") + (d.added ? " added" : ""));

  // ----- nodes -----
  nodeSel = nodeLayer.selectAll("g.node").data(simNodes, (d) => d.id);
  nodeSel.exit().transition().duration(350).style("opacity", 0).remove();
  const enter = nodeSel.enter().append("g").attr("class", "node").style("opacity", 0);
  enter.append("circle").attr("class", "halo");
  enter.append("circle").attr("class", "core");
  enter.append("text").attr("class", "glyph");
  enter.append("text").attr("class", "name");
  enter.transition().duration(500).style("opacity", 1);
  enter
    .on("pointerenter", (ev, d) => { showTooltip(ev, d); focusOn(d.id); })
    .on("pointermove", moveTooltip)
    .on("pointerleave", () => { hideTooltip(); clearFocus(); })
    .on("click", (ev, d) => { ev.stopPropagation(); selectNode(d.id); })
    .on("dblclick", (ev, d) => { ev.stopPropagation(); failNode(d.id, "manual"); })
    .call(d3.drag()
      .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on("end", (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  nodeSel = enter.merge(nodeSel)
    .attr("class", (d) => "node" + (d.critical ? " critical" : "") + (d.dead ? " dead" : "") + (d.id === selectedId ? " selected" : ""))
    .style("--c", (d) => d.color);
  nodeSel.select(".core").transition().duration(450).attr("r", (d) => d.r);
  nodeSel.select(".halo").transition().duration(450).attr("r", (d) => d.r + 8);
  nodeSel.select(".glyph").text((d) => GLYPH[d.role] || "•");
  nodeSel.select(".name").attr("y", (d) => d.r + 16).text((d) => d.name);

  sim.nodes(simNodes); sim.force("link").links(simLinks);
  sim.alpha(hasRendered ? 0.6 : 1).restart(); hasRendered = true;

  renderKPIs(); renderThreats(); renderSelected(); renderAdvisor(); renderSim(); updateTimelineUI();
}

/* ---------- hover / tooltip ---------- */
function focusOn(id) {
  const nb = neighborsOf(id);
  nodeSel.classed("dim", (n) => n.id !== id && !nb.has(n.id));
  linkSel.classed("dim", (l) => l.source.id !== id && l.target.id !== id);
}
function clearFocus() { nodeSel.classed("dim", false); linkSel.classed("dim", false); }

function showTooltip(ev, d) {
  const t = $("tooltip"); t.replaceChildren();
  t.append(el("b", "", d.name), el("span", "t-role", d.role || "device"));
  const deg = neighborsOf(d.id).size;
  const l1 = el("div", "t-line"); l1.append("Connections: ", el("strong", "", String(deg)));
  t.append(l1);
  const l2 = el("div", "t-line");
  if (d.dead) l2.append("Status: ", el("strong", "t-bad", "Failed"));
  else if (d.critical) { l2.append("If lost: ", el("strong", "t-bad", plural(d.sev, "node") + " cut off")); }
  else l2.append("Status: ", el("strong", "", "Redundant"));
  t.append(l2); t.classList.add("show"); moveTooltip(ev);
}
function moveTooltip(ev) {
  const r = $("canvas").getBoundingClientRect(), t = $("tooltip");
  let x = ev.clientX - r.left + 16, y = ev.clientY - r.top + 16;
  if (x + 220 > r.width) x -= 240; if (y + 110 > r.height) y -= 120;
  t.style.left = x + "px"; t.style.top = y + "px";
}
function hideTooltip() { $("tooltip").classList.remove("show"); }

/* ---------- KPIs + gauge ---------- */
let shownScore = 0, scoreRaf = 0;
function renderKPIs() {
  const { an } = view, total = view.nodes.length;
  $("kpi-nodes").textContent = an.n;
  $("kpi-nodes-sub").textContent = failed.length ? `of ${total} · ${failed.length} failed` : "all operational";
  $("kpi-links").textContent = an.m;
  $("kpi-spofs").textContent = an.critical.size;
  $("kpi-bridges").textContent = an.bridges.size;
  $("kpi-pieces").textContent = an.comps.length;
  $("kpi-pieces-sub").textContent = an.comps.length > 1 ? "network is split!" : "fully connected";
  animateScore(an.score);
}
function animateScore(target) {
  cancelAnimationFrame(scoreRaf);
  const from = shownScore, t0 = performance.now(), D = 800;
  const card = $("kpi-score-card");
  card.classList.remove("tone-good", "tone-warn", "tone-bad");
  card.classList.add(target >= 70 ? "tone-good" : target >= 40 ? "tone-warn" : "tone-bad");
  $("score-grade").textContent = target >= 80 ? "Hardened" : target >= 60 ? "Moderate risk" : target >= 35 ? "Fragile" : "Critical exposure";
  (function step(t) {
    const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
    shownScore = from + (target - from) * e;
    $("kpi-score").textContent = Math.round(shownScore);
    $("gauge-ring").style.strokeDashoffset = CIRC * (1 - shownScore / 100);
    if (k < 1) scoreRaf = requestAnimationFrame(step);
  })(t0);
}

/* ---------- threats ---------- */
function renderThreats() {
  const list = $("threat-list"); list.replaceChildren();
  const { an } = view;
  const ranked = [...an.critical].sort((a, b) => an.severity.get(b) - an.severity.get(a));
  $("threat-empty").hidden = ranked.length > 0;
  const top = Math.max(1, an.maxSev);
  ranked.slice(0, 5).forEach((id, i) => {
    const sev = an.severity.get(id);
    const li = el("li", "threat"); li.tabIndex = 0;
    li.append(el("span", "rk", String(i + 1)));
    const mid = el("div"); mid.append(el("div", "nm", nameOf(id)));
    const bar = el("div", "bar"), fill = el("i"); fill.style.width = `${(sev / top) * 100}%`; bar.append(fill); mid.append(bar);
    const sv = el("div", "sv", String(sev)); sv.append(el("small", "", "nodes cut"));
    li.append(mid, sv);
    li.onclick = () => selectNode(id);
    li.onkeydown = (e) => { if (e.key === "Enter") selectNode(id); };
    list.append(li);
  });
}

/* ---------- inspector ---------- */
function selectNode(id) { selectedId = id; nodeSel.classed("selected", (d) => d.id === id); renderSelected(); }
function clearSelection() { selectedId = null; nodeSel.classed("selected", false); renderSelected(); }

function renderSelected() {
  const body = $("selected-body"); body.replaceChildren();
  const n = selectedId !== null && view.byId.get(selectedId);
  if (!n) { body.append(el("p", "muted small", "Click any device to inspect it. Double-click a device to fail it instantly.")); return; }
  const dead = failed.includes(n.id), crit = !dead && view.an.critical.has(n.id), sev = view.an.severity.get(n.id) || 0;

  const head = el("div", "sel-head");
  head.append(el("div", "sel-glyph" + (crit ? " crit" : ""), GLYPH[n.role] || "•"));
  const t = el("div"); t.append(el("div", "sel-name", nameOf(n.id)), el("div", "sel-role", n.role || "device"));
  head.append(t); body.append(head);

  body.append(el("span", "status " + (dead ? "dead" : crit ? "bad" : "ok"),
    dead ? "Failed" : crit ? "Single point of failure" : "Redundant"));

  const nbs = [...neighborsOf(n.id)].filter((x) => !view.removed.has(x));
  const stats = el("div", "stat-pair");
  const s1 = el("div"); s1.append(el("b", "", String(nbs.length)), el("span", "", "live connections"));
  const s2 = el("div"); s2.append(el("b", "", dead ? "—" : String(sev)), el("span", "", "nodes cut off if lost"));
  stats.append(s1, s2); body.append(stats);

  body.append(el("p", "sel-note", dead ? "This device is offline."
    : crit ? `Losing ${nameOf(n.id)} would isolate ${plural(sev, "device")} from the main network.`
    : "Safe to lose: every other device can still reach the main network."));

  if (nbs.length) {
    const chips = el("div", "chips");
    nbs.forEach((x) => { const c = el("button", "chip btn-chip", nameOf(x)); c.onclick = () => selectNode(x); chips.append(c); });
    body.append(chips);
  }
  if (!dead) {
    const b = el("button", "btn danger", "💥 Simulate failure of this device");
    b.style.marginTop = "12px"; b.style.width = "100%"; b.onclick = () => failNode(n.id, "manual");
    body.append(b);
  }
}

/* ---------- advisor ---------- */
function renderAdvisor() {
  const box = $("advisor-list"); box.replaceChildren();
  const sugg = suggestFixes(view);
  $("advisor-empty").hidden = sugg.length > 0 || view.an.critical.size > 0;
  if (!sugg.length && view.an.critical.size > 0) box.append(el("p", "muted small", "No single extra link fixes the remaining weak points."));
  sugg.forEach((s) => {
    const card = el("div", "sugg"), top = el("div", "sugg-top");
    top.append(el("span", "sugg-link", `${nameOf(s.a)} ↔ ${nameOf(s.b)}`));
    const btn = el("button", "btn good", "Apply"); btn.onclick = () => applyFix(s); top.append(btn);
    const why = el("p", "sugg-why");
    why.append(s.resolves ? `Removes the single point of failure at ${nameOf(s.ap)}. ` : `Reduces the damage if ${nameOf(s.ap)} fails. `,
      "Resilience ", el("span", "gain", `+${s.gain}`), ` → ${s.after}`);
    card.append(top, why); box.append(card);
  });
}

function applyFix(s) {
  const before = view.an.score;
  extraEdges.push({ source: s.a, target: s.b });
  render();
  const A = nodeCache.get(s.a), B = nodeCache.get(s.b);
  if (A) pulseAt(A, "#4ADE80", 70); if (B) pulseAt(B, "#4ADE80", 70);
  toast(`Link added · resilience ${before} → ${view.an.score}`);
}

/* ============================ ATTACK LAB ============================ */
function setMode(m) {
  mode = m;
  $("mode-targeted").classList.toggle("is-on", m === "targeted");
  $("mode-random").classList.toggle("is-on", m === "random");
  $("mode-note").textContent = m === "targeted"
    ? "An informed attacker hits the most damaging single point of failure."
    : "A random device fails: the kind of everyday outage that usually does little harm.";
}

function runAttack() {
  const { an } = view;
  const alive = view.nodes.filter((n) => !view.removed.has(n.id));
  if (!alive.length) return setHint("Nothing left to attack.");
  let target;
  if (mode === "targeted") {
    if (!an.critical.size) return setHint("No critical devices: a targeted attack has nothing to exploit. This network is resilient. ✓");
    target = [...an.critical].sort((a, b) => an.severity.get(b) - an.severity.get(a))[0];
  } else target = alive[Math.floor(Math.random() * alive.length)].id;
  failNode(target, mode);
}

function failNode(id, how) {
  if (failed.includes(id) || !view.byId.has(id)) return;
  const sevs = [...view.an.severity.values()];
  const before = { max: Math.max(0, ...sevs), avg: sevs.length ? sevs.reduce((a, b) => a + b, 0) / sevs.length : 0 };
  const o = nodeCache.get(id);
  if (o) { pulseAt(o, "#FF5C7A", 110); setTimeout(() => pulseAt(o, "#FF5C7A", 70), 180); }
  const c = $("canvas"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
  failed.push(id); lastFailure = { id, how, before };
  setHint(""); render();
}

function resetSim() { failed = []; extraEdges = []; lastFailure = null; setHint(""); render(); }
function setHint(t) { $("sim-hint").textContent = t || "Tip: double-click any node to fail it."; }

function renderSim() {
  const active = failed.length > 0, { an } = view;
  const banner = $("sim-banner");
  banner.hidden = !active; $("sim-result").hidden = !active;
  $("key-island").hidden = !(active && an.comps.length > 1);
  $("btn-reset").disabled = !(active || extraEdges.length);
  if (!active) return;

  const cut = an.n - an.largest;
  banner.textContent = `⚠ SIMULATION · ${failed.map(nameOf).join(", ")} down · ${plural(cut, "device")} cut off`;
  const how = { targeted: "Targeted strike", random: "Random failure", manual: "Manual failure" }[lastFailure.how];
  $("sim-title").textContent = `${how}: ${nameOf(lastFailure.id)} went down`;
  $("sim-cut").textContent = cut;
  $("sim-pieces").textContent = an.comps.length;
  const { max, avg } = lastFailure.before;
  $("sim-compare").textContent = max > 0
    ? `Before this failure: the worst single device could cut off ${plural(max, "node")}, while a random failure averages ${avg.toFixed(1)}${avg > 0 ? ` (${(max / avg).toFixed(1)}× less damage)` : ""}.`
    : "Before this failure the network had no single point of failure.";
  const chips = $("sim-failed"); chips.replaceChildren();
  failed.forEach((id) => chips.append(el("span", "chip k-fail", nameOf(id))));
}

function pulseAt(d, color, reach) {
  const c = fxLayer.append("circle").attr("class", "pulse").attr("cx", d.x).attr("cy", d.y)
    .attr("r", d.r).style("stroke", color).style("opacity", 0.95);
  c.transition().duration(950).ease(d3.easeCubicOut).attr("r", d.r + reach).style("opacity", 0).on("end", () => c.remove());
}

/* ============================ TIMELINE ============================ */
function buildTrack() {
  const track = $("track"); track.replaceChildren();
  snapshots.forEach((s, i) => {
    const b = el("button", "step" + (s.kind === "failure" ? " fail" : "")); b.type = "button";
    b.title = s.event; b.setAttribute("aria-label", s.event); b.append(el("i"));
    b.onclick = () => { stop(); goTo(i); };
    track.append(b);
  });
}

function buildSpark() {
  const svg = d3.select("#spark"); svg.selectAll("*").remove();
  if (!scores.length) return;
  const W = $("spark").clientWidth || 600, H = 64, px = 18, py = 14;
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  const pts = scores.map((s, i) => [px + (scores.length === 1 ? 0.5 : i / (scores.length - 1)) * (W - 2 * px), py + (1 - s / 100) * (H - 2 * py - 6)]);
  const line = d3.line().curve(d3.curveMonotoneX)(pts);
  svg.append("defs").html('<linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38E1C6" stop-opacity=".28"/><stop offset="1" stop-color="#38E1C6" stop-opacity="0"/></linearGradient>');
  svg.append("path").attr("d", `${line}L${pts[pts.length - 1][0]},${H}L${pts[0][0]},${H}Z`).attr("fill", "url(#sg)");
  svg.append("path").attr("class", "sp-line").attr("d", line);
  svg.selectAll("circle").data(pts).enter().append("circle").attr("class", "sp-dot").attr("r", 4.5)
    .attr("cx", (d) => d[0]).attr("cy", (d) => d[1]).on("click", (e, d) => { stop(); goTo(pts.indexOf(d)); })
    .append("title").text((d, i) => `${snapshots[i].event} · score ${scores[i]}`);
  svg.selectAll("text").data(pts).enter().append("text").attr("class", "sp-label")
    .attr("x", (d) => d[0]).attr("y", (d) => d[1] - 10).text((d, i) => scores[i]);
}
function updateSpark() { d3.selectAll(".sp-dot").classed("on", (d, i) => i === idx); }

function updateTimelineUI() {
  const s = snapshots[idx];
  $("timeline-caption").textContent = s.event;
  $("timeline-count").textContent = `Step ${idx + 1} / ${snapshots.length}`;
  const chips = $("timeline-chips"); chips.replaceChildren();
  const [label, cls] = KIND[s.kind] || ["Event", ""];
  chips.append(el("span", "chip " + cls, label));
  if (s.method) chips.append(el("span", "chip", s.method));
  if (s.compute_ms !== undefined) chips.append(el("span", "chip", `${s.compute_ms} ms`));
  [...$("track").children].forEach((b, i) => { b.classList.toggle("done", i <= idx); b.classList.toggle("now", i === idx); });
  $("btn-prev").disabled = idx === 0; $("btn-next").disabled = idx === snapshots.length - 1;
  $("btn-play").textContent = playing ? "Pause" : idx === snapshots.length - 1 ? "Replay" : "Play";
  updateSpark();
}

function goTo(i) {
  idx = Math.max(0, Math.min(snapshots.length - 1, i));
  failed = []; extraEdges = []; lastFailure = null; setHint("");
  render();
}
function play() {
  if (idx === snapshots.length - 1) goTo(0);
  playing = true; updateTimelineUI();
  timer = setInterval(() => { if (idx >= snapshots.length - 1) stop(); else goTo(idx + 1); }, STEP_MS);
}
function stop() { playing = false; clearInterval(timer); timer = null; if (snapshots.length) updateTimelineUI(); }

/* ============================ UI wiring ============================ */
let toastT;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}

function bindUI() {
  $("btn-prev").onclick = () => { stop(); goTo(idx - 1); };
  $("btn-next").onclick = () => { stop(); goTo(idx + 1); };
  $("btn-play").onclick = () => (playing ? stop() : play());
  $("btn-demo").onclick = () => { stop(); goTo(0); setTimeout(play, 500); };
  $("btn-full").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  $("mode-targeted").onclick = () => setMode("targeted");
  $("mode-random").onclick = () => setMode("random");
  $("btn-attack").onclick = runAttack;
  $("btn-reset").onclick = resetSim;
  $("canvas").addEventListener("click", clearSelection);
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { stop(); goTo(idx + 1); }
    else if (e.key === "ArrowLeft") { stop(); goTo(idx - 1); }
    else if (e.key === " " && e.target.tagName !== "BUTTON") { e.preventDefault(); playing ? stop() : play(); }
    else if (e.key === "Escape") clearSelection();
  });
  setMode("targeted");
}

// Wait until security.js (loaded after this file) has patched the render functions.
window.addEventListener("load", load);