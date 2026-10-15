const SNAPSHOTS_URL = "snapshots.json";
const DATA_URL = "data.json";

const STEP_MS = 2600;         // pause between steps while playing
const TRANSITION_MS = 450;    // how long circles take to grow/shrink
const FADE_MS = 340;          // keep this just above --fade in styles.css (300ms)

// Node size rules. Radius grows with the SQUARE ROOT of severity so
// that one very severe node can't grow into a giant circle.
const MIN_RADIUS = 9;
const MAX_RADIUS = 22;
const HALO_EXTRA = 6;         // how far the soft ring sticks out around critical nodes

const ISLAND_COLORS = 4;      // Stage 5: how many pastel tints cut-off pieces cycle through

const PLAY_ICON =
  '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>';
const PAUSE_ICON =
  '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">' +
  '<rect x="2.5" y="1.8" width="2.5" height="8.4" rx="0.6" fill="currentColor"/>' +
  '<rect x="7" y="1.8" width="2.5" height="8.4" rx="0.6" fill="currentColor"/></svg>';

// ---------- Page elements ----------
const canvasEl = document.getElementById("canvas");
const svg = d3.select("#graph");
const tooltipEl = document.getElementById("tooltip");
const messageEl = document.getElementById("message");
const statsEl = document.getElementById("stats");
const rankingListEl = document.getElementById("ranking-list");
const rankingEmptyEl = document.getElementById("ranking-empty");
const selectedBodyEl = document.getElementById("selected-body");
const captionEl = document.getElementById("timeline-caption");
const countEl = document.getElementById("timeline-count");
const trackEl = document.getElementById("track");
const prevBtn = document.getElementById("btn-prev");
const nextBtn = document.getElementById("btn-next");
const playBtn = document.getElementById("btn-play");

// Stage 5: simulation card elements
const simBannerEl = document.getElementById("sim-banner");
const keyIslandEl = document.getElementById("key-island");
const simModeTargetedBtn = document.getElementById("sim-mode-targeted");
const simModeRandomBtn = document.getElementById("sim-mode-random");
const simModeNoteEl = document.getElementById("sim-mode-note");
const simRunBtn = document.getElementById("sim-run");
const simResetBtn = document.getElementById("sim-reset");
const simHintEl = document.getElementById("sim-hint");
const simResultEl = document.getElementById("sim-result");
const simResultTitleEl = document.getElementById("sim-result-title");
const simStatCutEl = document.getElementById("sim-stat-cut");
const simStatPiecesEl = document.getElementById("sim-stat-pieces");
const simCompareEl = document.getElementById("sim-compare");
const simFailedEl = document.getElementById("sim-failed");

// The default "no critical nodes" sentence from index.html (we swap it only when the network is empty)
const RANKING_EMPTY_TEXT = rankingEmptyEl.textContent.trim();

// ---------- Things we keep between steps ----------
let snapshots = [];           // the list of steps (NEVER modified after loading)
let currentIndex = 0;         // which step is showing
let playing = false;
let playTimer = null;
let hasRendered = false;

let width = 0;                // canvas size in pixels
let height = 0;
let simulation, linkForce, chargeForce;   // simulation = the d3 physics engine (not the failure simulation)
let edgeLayer, nodeLayer;

// The d3 selections currently on screen (updated on every step)
let nodeSel = d3.selectAll(null);
let linkSel = d3.selectAll(null);
let rankingRows = d3.selectAll(null);

let neighbors = new Map();    // node id -> set of directly connected node ids

// Which node is selected right now (null = nothing). Both the graph and the
// ranking read this one value, so they can never disagree.
let selectedId = null;

// One persistent object per node ID. Reusing the same object between steps is
// what lets a node stay where it was instead of jumping to a new position.
const nodeById = new Map();

// Stage 5: failure-simulation state. All of it belongs to ONE timeline step;
// moving to another step wipes it (see goTo).
let simMode = "targeted";     // "targeted" or "random"
let simFailedIds = [];        // nodes failed so far in this simulation, in order
let simView = null;           // { state, pieceCount } for the simulated network, or null
let simLast = null;           // details of the most recent failure, for the result panel
let simMessage = "";          // short status text shown under the buttons


// ---------- Helper functions ----------

function radiusFor(node) {
  const radius = 7 + 5 * Math.sqrt(node.severity);
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius));
}

// Does the node's ID text fit inside the circle? (about 7px per character)
function labelFitsInside(node) {
  return String(node.id).length * 7 + 4 <= radiusFor(node) * 2;
}

// How far apart connected nodes should sit. Bigger canvas = more spread out.
// Many nodes = tighter, so a large network still fits.
function linkDistanceFor(canvasWidth, canvasHeight, nodeCount) {
  const crowdingFactor = Math.min(1, Math.sqrt(8 / Math.max(nodeCount, 1)));
  const distance = Math.min(canvasWidth, canvasHeight) * 0.26 * crowdingFactor;
  return Math.max(60, Math.min(200, distance));
}

// d3 replaces an edge's source/target IDs with the actual node objects once the
// layout starts. This returns the ID either way.
function endpointId(endpoint) {
  return typeof endpoint === "object" ? endpoint.id : endpoint;
}

// A key that identifies an edge no matter which direction it is written in
function linkKey(edge) {
  const a = String(endpointId(edge.source));
  const b = String(endpointId(edge.target));
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function showLoadError() {
  messageEl.hidden = false;
  messageEl.textContent =
    "Couldn't load snapshots.json or data.json. Open this page through Live Server " +
    "(right-click index.html, then Open with Live Server) rather than double-clicking the file.";
}

function updateStats(state) {
  const criticalCount = state.nodes.filter(n => n.is_critical).length;
  statsEl.innerHTML =
    `${state.nodes.length} nodes · ${state.edges.length} links · ` +
    `<span class="stat-critical">${criticalCount} critical</span>` +
    (isSimulating() ? ` · <span class="stat-sim">simulated</span>` : "");
}


// ---------- Fade in / fade out ----------

// New elements are created with the class "is-entering" (opacity 0).
// Two animation frames later we remove it, and CSS fades them in.
function fadeIn(selection) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => selection.classed("is-entering", false));
  });
}

// Leaving elements fade out, then get deleted from the page.
function fadeOutAndRemove(selection) {
  selection.classed("is-leaving", true)
    .transition()
    .duration(FADE_MS)
    .remove();
}


// ---------- Tooltip ----------

function showTooltip(event, node) {
  tooltipEl.innerHTML = "";

  const title = document.createElement("div");
  title.className = "tip-title";
  title.textContent = `Node ${node.id}`;

  const row = document.createElement("div");
  row.className = node.is_critical ? "tip-row is-critical" : "tip-row";
  row.textContent = node.is_critical
    ? `Critical · severity ${node.severity}`
    : "Not critical";

  tooltipEl.appendChild(title);
  tooltipEl.appendChild(row);
  tooltipEl.classList.add("is-visible");
  moveTooltip(event);

  // Reveal the ID below the node if it didn't fit inside
  d3.select(event.currentTarget).select(".node-label.outside").classed("is-visible", true);
}

function moveTooltip(event) {
  const box = canvasEl.getBoundingClientRect();
  let x = event.clientX - box.left + 14;
  let y = event.clientY - box.top + 14;

  // Flip to the other side of the cursor if it would run off the canvas
  if (x + tooltipEl.offsetWidth > box.width - 8) {
    x = event.clientX - box.left - tooltipEl.offsetWidth - 14;
  }
  if (y + tooltipEl.offsetHeight > box.height - 8) {
    y = event.clientY - box.top - tooltipEl.offsetHeight - 14;
  }

  tooltipEl.style.transform = `translate(${x}px, ${y}px)`;
}

function hideTooltip(event) {
  tooltipEl.classList.remove("is-visible");
  d3.select(event.currentTarget).select(".node-label.outside").classed("is-visible", false);
}


// ---------- Hover focus (shared by graph nodes and ranking rows) ----------

// Keep the hovered node and its neighbours at full strength, fade everything else.
function focusOn(activeId) {
  const keep = new Set([activeId, ...(neighbors.get(activeId) || [])]);

  nodeSel
    .classed("is-dimmed", d => !keep.has(d.id))
    .classed("is-active", d => d.id === activeId);

  linkSel.classed("is-dimmed", d =>
    endpointId(d.source) !== activeId && endpointId(d.target) !== activeId
  );

  rankingRows.classed("is-active", d => d.id === activeId);
}

function clearFocus() {
  nodeSel.classed("is-dimmed", false).classed("is-active", false);
  linkSel.classed("is-dimmed", false);
  rankingRows.classed("is-active", false);
}


// ---------- Ranking card ----------

// Builds the list of critical nodes (highest severity first).
// Returns the d3 selection of rows so the graph can highlight them too.
function renderRanking(nodes) {
  const criticalNodes = nodes
    .filter(n => n.is_critical)
    .sort((a, b) =>
      b.severity - a.severity ||
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
    );

  // No critical nodes: show the calm "all good" message instead of a list
  rankingEmptyEl.hidden = criticalNodes.length > 0;
  // Stage 5: a simulation can remove every node, so say that instead of "all good"
  rankingEmptyEl.textContent = nodes.length === 0
    ? "No nodes left in the network."
    : RANKING_EMPTY_TEXT;

  const maxSeverity = d3.max(criticalNodes, d => d.severity) || 1;

  const rows = d3.select(rankingListEl)
    .selectAll("li")
    .data(criticalNodes, d => d.id)
    .join("li")
    .order()                                   // keep the rows in ranked order
    .attr("class", "rank-row")
    .attr("tabindex", 0)
    .attr("role", "button")
    .on("mouseenter", (event, d) => focusOn(d.id))
    .on("mouseleave", () => clearFocus())
    .on("click", (event, d) => selectNode(d.id))
    .on("keydown", (event, d) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(d.id);
      }
    });

  rows.each(function (d, index) {
    const row = d3.select(this);
    row.html("");   // clear, then rebuild the row's contents

    row.append("span").attr("class", "rank-pos").text(index + 1);
    row.append("span").attr("class", "rank-name").text(`Node ${d.id}`);

    row.append("div").attr("class", "rank-bar")
      .append("div").attr("class", "rank-fill")
      .style("width", `${(d.severity / maxSeverity) * 100}%`);

    row.append("span").attr("class", "rank-value").text(d.severity);
  });

  return rows;
}


// ---------- Selection and the "Selected node" card ----------

// Small helper: make an element with a class and (optionally) some text.
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Sort ids "naturally" so 2 comes before 10.
function compareIds(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

// Click on something that is already selected = deselect it.
function selectNode(id) {
  selectedId = (selectedId === id) ? null : id;
  refreshSelection();
}

function clearSelection() {
  if (selectedId === null) return;
  selectedId = null;
  refreshSelection();
}

// Redraw everything that depends on the selection.
function refreshSelection() {
  applySelectionStyles();
  renderSelectedCard();
  updateSimulationUI();   // Stage 5: the "Fail node X" button depends on the selection
}

// Mark the selected node in the graph and the selected row in the ranking.
function applySelectionStyles() {
  // Use the whole node layer (not just nodeSel) so a node that is mid-fade-out loses its ring too
  nodeLayer.selectAll("g.node").classed("is-selected", d => d.id === selectedId);

  rankingRows
    .classed("is-selected", d => d.id === selectedId)
    .attr("aria-pressed", d => (d.id === selectedId ? "true" : "false"));
}

// Fills the lilac card with the details of the selected node.
function renderSelectedCard() {
  selectedBodyEl.innerHTML = "";

  const node = selectedId === null ? null : nodeById.get(selectedId);

  // Nothing selected (or the selected node no longer exists): show the hint
  if (!node) {
    selectedBodyEl.appendChild(
      makeEl("p", "placeholder", "Click a node, or a row in the ranking, to inspect it.")
    );
    return;
  }

  const connectedIds = [...(neighbors.get(node.id) || [])].sort(compareIds);

  // Title + status badge
  const head = makeEl("div", "sel-head");
  head.appendChild(makeEl("h2", "sel-title", `Node ${node.id}`));
  head.appendChild(makeEl(
    "span",
    node.is_critical ? "sel-badge is-critical" : "sel-badge",
    node.is_critical ? "Critical" : "Not critical"
  ));
  selectedBodyEl.appendChild(head);

  // Two number tiles: severity and number of connections
  const stats = makeEl("div", "sel-stats");

  const severityTile = makeEl("div", "sel-stat");
  severityTile.appendChild(makeEl("span", "sel-stat-value", String(node.severity)));
  severityTile.appendChild(makeEl("span", "sel-stat-label", "Severity"));
  stats.appendChild(severityTile);

  const connectionsTile = makeEl("div", "sel-stat");
  connectionsTile.appendChild(makeEl("span", "sel-stat-value", String(connectedIds.length)));
  connectionsTile.appendChild(makeEl("span", "sel-stat-label", "Connections"));
  stats.appendChild(connectionsTile);

  selectedBodyEl.appendChild(stats);

  // One sentence saying what the severity number means for THIS node
  const severityNote = node.severity > 0
    ? `If this node fails, ${node.severity} node${node.severity === 1 ? "" : "s"} get cut off from the main part of the network.`
    : "If this node fails, no nodes get cut off from the main part of the network.";
  selectedBodyEl.appendChild(makeEl("p", "sel-note", severityNote));

  // The neighbours, as small buttons. Clicking one selects that node instead.
  selectedBodyEl.appendChild(makeEl("span", "sel-sub", "Connected to"));

  if (connectedIds.length === 0) {
    selectedBodyEl.appendChild(makeEl("p", "sel-note", "Nothing. This node is on its own."));
    return;
  }

  const chips = makeEl("div", "chips");
  connectedIds.forEach(otherId => {
    const other = nodeById.get(otherId);
    const chip = makeEl("button", other && other.is_critical ? "chip is-critical" : "chip");
    chip.type = "button";
    chip.title = `Select node ${otherId}`;
    chip.setAttribute("aria-label", `Select node ${otherId}`);
    chip.appendChild(makeEl("span", "chip-dot"));
    chip.appendChild(document.createTextNode(String(otherId)));
    chip.addEventListener("click", () => selectNode(otherId));
    chips.appendChild(chip);
  });
  selectedBodyEl.appendChild(chips);
}

// Clicking empty canvas, or pressing Escape, clears the selection.
// (Node clicks call stopPropagation, so they never reach this canvas handler.)
function wireSelection() {
  svg.on("click", () => clearSelection());

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") clearSelection();
  });
}


// ---------- Stage 5: failure simulation ----------
//
// How it works, in plain words:
//   * The timeline snapshot (snapshots[currentIndex].state) is the ORIGINAL network. We never edit it.
//   * A simulation is just a list of failed node IDs (simFailedIds).
//   * To show the simulated network we take the original, leave out the failed nodes (and their
//     links), re-run the same critical-node analysis the Python engine uses, and hand the result
//     to the normal renderState(). Reset = render the original again.

function isSimulating() {
  return simFailedIds.length > 0;
}

function getBaseState() {
  return snapshots[currentIndex].state;
}

// What is on screen right now: the simulated network if there is one, else the snapshot.
function getDisplayedState() {
  return simView ? simView.state : getBaseState();
}

// Turn a state into { nodeId: [neighbour ids] }, leaving out any removed nodes.
function buildAdjacency(state, removedIds) {
  const adjacency = new Map();
  state.nodes.forEach(n => {
    if (!removedIds.has(n.id)) adjacency.set(n.id, []);
  });
  state.edges.forEach(e => {
    if (adjacency.has(e.source) && adjacency.has(e.target)) {
      adjacency.get(e.source).push(e.target);
      adjacency.get(e.target).push(e.source);
    }
  });
  return adjacency;
}

// Split the network into connected "pieces" (breadth-first search).
// skipId (optional) = pretend that node doesn't exist.
function findComponents(adjacency, skipId) {
  const seen = new Set();
  if (skipId !== undefined) seen.add(skipId);

  const pieces = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;

    const queue = [start];
    seen.add(start);
    for (let i = 0; i < queue.length; i++) {
      for (const neighbor of adjacency.get(queue[i])) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    pieces.push(queue);
  }
  return pieces;
}

// Same rule as _compute_severity in tarjan.py:
// (nodes left after removal) minus (size of the biggest remaining piece).
function severityIfRemoved(adjacency, nodeId) {
  const pieces = findComponents(adjacency, nodeId);
  if (pieces.length === 0) return 0;

  const sizes = pieces.map(piece => piece.length);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total - Math.max(...sizes);
}

// Same logic as find_articulation_points in tarjan.py (disc / low values).
function findCriticalIds(adjacency) {
  const disc = new Map();
  const low = new Map();
  const critical = new Set();
  let timer = 0;

  function dfs(u, parent) {
    disc.set(u, timer);
    low.set(u, timer);
    timer++;
    let children = 0;

    for (const neighbor of adjacency.get(u)) {
      if (neighbor === parent) continue;

      if (disc.has(neighbor)) {
        low.set(u, Math.min(low.get(u), disc.get(neighbor)));
      } else {
        children++;
        dfs(neighbor, u);
        low.set(u, Math.min(low.get(u), low.get(neighbor)));

        if (parent === null && children >= 2) critical.add(u);
        if (parent !== null && low.get(neighbor) >= disc.get(u)) critical.add(u);
      }
    }
  }

  for (const node of adjacency.keys()) {
    if (!disc.has(node)) dfs(node, null);
  }
  return critical;
}

// Original snapshot minus the failed nodes, with fresh critical flags and severities.
// Returns a NEW state object in the same shape as a snapshot (plus an optional "island"
// tint number on nodes). The original state is only read, never changed.
function buildSimulatedState(baseState, failedIds) {
  const removed = new Set(failedIds);
  const adjacency = buildAdjacency(baseState, removed);
  const criticalIds = findCriticalIds(adjacency);
  const pieces = findComponents(adjacency);

  // Biggest piece = "main network" (no tint). Every other piece gets a pastel tint.
  const islandOf = new Map();
  pieces
    .slice()
    .sort((a, b) => b.length - a.length)
    .slice(1)
    .forEach((piece, index) => {
      piece.forEach(id => islandOf.set(id, index % ISLAND_COLORS));
    });

  const nodes = baseState.nodes
    .filter(n => !removed.has(n.id))
    .map(n => {
      const isCritical = criticalIds.has(n.id);
      return {
        id: n.id,
        is_critical: isCritical,
        severity: isCritical ? severityIfRemoved(adjacency, n.id) : 0,
        island: islandOf.has(n.id) ? islandOf.get(n.id) : null
      };
    });

  const edges = baseState.edges
    .filter(e => !removed.has(e.source) && !removed.has(e.target))
    .map(e => ({ source: e.source, target: e.target }));

  return { state: { nodes, edges }, pieceCount: pieces.length };
}

// Forget the simulation (does NOT redraw anything by itself).
function clearSimulationState() {
  simFailedIds = [];
  simView = null;
  simLast = null;
  simMessage = "";
}

function setSimMode(mode) {
  simMode = mode;
  simMessage = "";
  updateSimulationUI();
}

// The main action: fail one node (the selected one, or a random one).
function runFailure() {
  const displayed = getDisplayedState();

  // Edge case: nothing left to fail
  if (displayed.nodes.length === 0) {
    simMessage = "No nodes left to fail. Reset the simulation to bring them back.";
    updateSimulationUI();
    return;
  }

  let targetId;
  if (simMode === "targeted") {
    // Edge case: targeted mode needs a selected node that still exists
    if (selectedId === null || !displayed.nodes.some(n => n.id === selectedId)) {
      simMessage = "Select a node on the graph or in the ranking first.";
      updateSimulationUI();
      return;
    }
    targetId = selectedId;
  } else {
    const pick = Math.floor(Math.random() * displayed.nodes.length);
    targetId = displayed.nodes[pick].id;
  }

  // The severity the ranking was showing for this node right before it fails
  const failedNode = displayed.nodes.find(n => n.id === targetId);
  const cutOff = failedNode.severity;
  const mode = simMode;

  stopPlaying();   // a simulation and auto-playback shouldn't fight over the screen

  simFailedIds = [...simFailedIds, targetId];
  simView = buildSimulatedState(getBaseState(), simFailedIds);
  simLast = {
    id: targetId,
    mode: mode,
    cutOff: cutOff,
    pieces: simView.pieceCount,
    round: simFailedIds.length
  };
  simMessage = "";

  renderState(simView.state);   // redraws graph, stats, ranking, selected card, and this card

  // If the Fail button just got disabled (targeted failure clears the selection),
  // move keyboard focus somewhere useful instead of losing it.
  if (simRunBtn.disabled) simResetBtn.focus();
}

// Back to the untouched snapshot. Timeline position does not change.
function resetSimulation() {
  if (!isSimulating()) return;

  clearSimulationState();
  simMessage = `Reset. Showing the original network for step ${currentIndex + 1} again.`;
  renderState(getBaseState());

  (simRunBtn.disabled ? simModeTargetedBtn : simRunBtn).focus();
}

// Updates every piece of the Simulation card (and the "this is simulated" markers).
// It only changes text and attributes, never rebuilds the buttons, so keyboard focus stays put.
function updateSimulationUI() {
  const simulating = isSimulating();
  const displayed = getDisplayedState();
  const noNodes = displayed.nodes.length === 0;
  const targeted = simMode === "targeted";
  const hasSelection = selectedId !== null && displayed.nodes.some(n => n.id === selectedId);

  // Mode switch
  simModeTargetedBtn.classList.toggle("is-on", targeted);
  simModeTargetedBtn.setAttribute("aria-pressed", String(targeted));
  simModeRandomBtn.classList.toggle("is-on", !targeted);
  simModeRandomBtn.setAttribute("aria-pressed", String(!targeted));

  simModeNoteEl.textContent = targeted
    ? "Fails the node you have selected, like an attacker aiming at one chosen target."
    : "Fails any node still in the network, picked by chance, like an accidental outage.";

  // Buttons
  if (targeted) {
    simRunBtn.textContent = hasSelection ? `Fail node ${selectedId}` : "Fail selected node";
  } else {
    simRunBtn.textContent = "Fail a random node";
  }
  simRunBtn.disabled = noNodes || (targeted && !hasSelection);
  simResetBtn.disabled = !simulating;

  // Hint line under the buttons
  let hint = simMessage;
  if (noNodes) {
    hint = "No nodes left to fail. Reset the simulation to bring them back.";
  } else if (targeted && !hasSelection) {
    hint = "Select a node on the graph or in the ranking first.";
  }
  simHintEl.textContent = hint;

  // Result panel
  simResultEl.hidden = !simulating || simLast === null;
  if (simulating && simLast) {
    const modeLabel = simLast.mode === "targeted" ? "targeted" : "random";
    simResultTitleEl.textContent = `Node ${simLast.id} failed · ${modeLabel}`;
    simStatCutEl.textContent = String(simLast.cutOff);
    simStatPiecesEl.textContent = String(simView.pieceCount);

    const base = getBaseState();
    const baseCritical = base.nodes.filter(n => n.is_critical).length;
    const nowCritical = simView.state.nodes.filter(n => n.is_critical).length;
    simCompareEl.textContent =
      `Compared with the original: ${base.nodes.length} → ${simView.state.nodes.length} nodes, ` +
      `${baseCritical} → ${nowCritical} critical.`;

    simFailedEl.innerHTML = "";
    simFailedIds.forEach(id => simFailedEl.appendChild(makeEl("span", "sim-tag", String(id))));
  }

  // "This is a simulation" markers on the canvas
  canvasEl.classList.toggle("is-simulated", simulating);
  simBannerEl.hidden = !simulating;
  if (simulating) {
    simBannerEl.textContent =
      `Simulated · step ${currentIndex + 1} of ${snapshots.length} · ${simFailedIds.length} failed`;
  }
  keyIslandEl.hidden = !(simulating && simView.pieceCount > 1);
}

function wireSimulation() {
  simModeTargetedBtn.addEventListener("click", () => setSimMode("targeted"));
  simModeRandomBtn.addEventListener("click", () => setSimMode("random"));
  simRunBtn.addEventListener("click", runFailure);
  simResetBtn.addEventListener("click", resetSimulation);
}


// ---------- Graph canvas ----------

// Called once: creates the drawing layers and the physics simulation.
function setupCanvas() {
  const box = canvasEl.getBoundingClientRect();
  width = box.width;
  height = box.height;

  // Draw order: edges first, then nodes, so nodes sit on top of lines
  edgeLayer = svg.append("g");
  nodeLayer = svg.append("g");

  // Force simulation: nodes push apart, edges pull connected nodes together,
  // and a collision force stops circles overlapping.
  linkForce = d3.forceLink([]).id(d => d.id);
  chargeForce = d3.forceManyBody();

  simulation = d3.forceSimulation([])
    .force("link", linkForce)
    .force("charge", chargeForce)
    .force("collide", d3.forceCollide().radius(d => radiusFor(d) + HALO_EXTRA + 4))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .on("tick", positionElements);

  updateSpacing();

  // When the canvas changes size (window resize), re-centre and re-spread the graph
  new ResizeObserver(() => {
    const newBox = canvasEl.getBoundingClientRect();
    width = newBox.width;
    height = newBox.height;
    updateSpacing();
    simulation.force("center", d3.forceCenter(width / 2, height / 2));
    simulation.alpha(0.3).restart();
  }).observe(canvasEl);
}

function updateSpacing() {
  const distance = linkDistanceFor(width, height, simulation.nodes().length);
  linkForce.distance(distance);
  chargeForce.strength(-distance * 4);
}

// Moves every circle and line to where the simulation says it should be.
function positionElements() {
  // Keep every node inside the canvas
  simulation.nodes().forEach(d => {
    const margin = radiusFor(d) + HALO_EXTRA;
    d.x = Math.max(margin, Math.min(width - margin, d.x));
    d.y = Math.max(margin, Math.min(height - margin, d.y));
  });

  linkSel
    .attr("x1", d => d.source.x)
    .attr("y1", d => d.source.y)
    .attr("x2", d => d.target.x)
    .attr("y2", d => d.target.y);

  nodeSel.attr("transform", d => `translate(${d.x}, ${d.y})`);
}

// A brand-new node starts next to a node it connects to (so it appears to grow
// out of the network). If it has no such neighbour, it starts near the centre.
function placeNewNode(node, state) {
  for (const edge of state.edges) {
    let otherId = null;
    if (edge.source === node.id) otherId = edge.target;
    if (edge.target === node.id) otherId = edge.source;

    const other = otherId === null ? null : nodeById.get(otherId);
    if (other && other.x !== undefined) {
      node.x = other.x + (Math.random() - 0.5) * 30;
      node.y = other.y + (Math.random() - 0.5) * 30;
      return;
    }
  }
  node.x = width / 2 + (Math.random() - 0.5) * 60;
  node.y = height / 2 + (Math.random() - 0.5) * 60;
}

// Creates the page elements for brand-new nodes: halo ring + circle + ID text.
function createNodeGroups(enterSelection) {
  const groups = enterSelection.append("g")
    .attr("class", "node is-entering")
    .on("mouseenter", (event, d) => {
      showTooltip(event, d);
      focusOn(d.id);
    })
    .on("mousemove", moveTooltip)
    .on("mouseleave", (event) => {
      hideTooltip(event);
      clearFocus();
    })
    .on("click", (event, d) => {
      event.stopPropagation();   // don't let the canvas treat this as "click on empty space"
      selectNode(d.id);
    });

  groups.append("circle").attr("class", "node-halo").attr("r", 0);
  groups.append("circle").attr("class", "node-body").attr("r", 0);
  groups.append("text").attr("class", "node-label");

  fadeIn(groups);
  return groups;
}

// Shows one step of the story: updates the graph, counts, ranking and selected card.
// (Stage 5: also used to show a simulated network. It only READS the state it is given.)
function renderState(state) {
  // Cancel any hover state left over from the previous step
  tooltipEl.classList.remove("is-visible");

  updateStats(state);

  // 1. Work out the node objects for this step (reuse the old ones where possible)
  const incomingIds = new Set(state.nodes.map(n => n.id));
  for (const id of [...nodeById.keys()]) {
    if (!incomingIds.has(id)) nodeById.delete(id);   // this node was removed
  }

  const nodes = state.nodes.map(n => {
    let node = nodeById.get(n.id);
    if (!node) {
      node = { id: n.id };
      placeNewNode(node, state);
      nodeById.set(n.id, node);
    }
    node.is_critical = n.is_critical;
    node.severity = n.severity;
    node.island = n.island === undefined ? null : n.island;   // Stage 5: tint for cut-off pieces
    return node;
  });

  // Fresh edge objects every step (d3 changes them as it runs)
  const edges = state.edges.map(e => ({ source: e.source, target: e.target }));

  // Remember who is connected to whom (used by hover focus)
  neighbors = new Map(nodes.map(n => [n.id, new Set()]));
  edges.forEach(e => {
    if (neighbors.has(e.source)) neighbors.get(e.source).add(e.target);
    if (neighbors.has(e.target)) neighbors.get(e.target).add(e.source);
  });

  // 2. Give the simulation the new data
  linkForce.links([]);          // clear old edges first so removed nodes can't cause errors
  simulation.nodes(nodes);
  linkForce.links(edges);
  updateSpacing();

  // 3. Update the picture. "Enter" = new, "exit" = gone, "update" = still here.
  //    The :not(.is-leaving) part ignores elements that are mid-fade-out.
  linkSel = edgeLayer.selectAll("line.edge:not(.is-leaving)")
    .data(edges, linkKey)
    .join(
      enter => {
        const lines = enter.append("line").attr("class", "edge is-entering");
        fadeIn(lines);
        return lines;
      },
      update => update,
      exit => fadeOutAndRemove(exit)
    );

  nodeSel = nodeLayer.selectAll("g.node:not(.is-leaving)")
    .data(nodes, d => d.id)
    .join(
      enter => createNodeGroups(enter),
      update => update,
      exit => fadeOutAndRemove(exit)
    );

  // 4. Apply this step's look to every node: colour, size, label
  nodeSel.classed("is-critical", d => d.is_critical);
  nodeSel.attr("data-island", d => (d.island === null ? null : d.island));   // Stage 5

  nodeSel.select(".node-halo")
    .transition().duration(TRANSITION_MS).ease(d3.easeCubicOut)
    .attr("r", d => radiusFor(d) + HALO_EXTRA);

  nodeSel.select(".node-body")
    .transition().duration(TRANSITION_MS).ease(d3.easeCubicOut)
    .attr("r", d => radiusFor(d));

  nodeSel.select(".node-label")
    .attr("class", d => (labelFitsInside(d) ? "node-label inside" : "node-label outside"))
    .attr("dy", d => (labelFitsInside(d) ? "0.35em" : null))
    .attr("y", d => (labelFitsInside(d) ? null : radiusFor(d) + 14))
    .text(d => d.id);

  // 5. Ranking card
  rankingRows = renderRanking(nodes);

  // 5b. Selection: keep it if the node still exists, clear it if it was removed.
  //     (nodeById already had removed nodes deleted at the top of this function.)
  //     refreshSelection() also refreshes the Simulation card (Stage 5).
  if (selectedId !== null && !nodeById.has(selectedId)) selectedId = null;
  refreshSelection();   // restyle graph + ranking, and rebuild the card with this step's numbers

  // 6. Put everything at its starting position, then let the physics settle it
  positionElements();
  simulation.alpha(hasRendered ? 0.5 : 1).restart();
  hasRendered = true;
}


// ---------- Timeline ----------

// One dot per event, joined by a line. Clicking a dot jumps to that step.
function buildTrack() {
  trackEl.innerHTML = "";

  const line = document.createElement("div");
  line.className = "track-line";

  const progress = document.createElement("div");
  progress.className = "track-progress";
  progress.id = "track-progress";

  const dots = document.createElement("div");
  dots.className = "track-dots";

  snapshots.forEach((snapshot, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "track-dot";
    dot.title = snapshot.event;
    dot.setAttribute("aria-label", `Step ${index + 1}: ${snapshot.event}`);
    dot.addEventListener("click", () => {
      stopPlaying();
      goTo(index);
    });
    dots.appendChild(dot);
  });

  trackEl.appendChild(line);
  trackEl.appendChild(progress);
  trackEl.appendChild(dots);
}

function updateTimelineUI() {
  const last = snapshots.length - 1;

  captionEl.textContent = snapshots[currentIndex].event;
  countEl.textContent = `${currentIndex + 1} / ${snapshots.length}`;

  const progress = document.getElementById("track-progress");
  progress.style.setProperty("--p", last > 0 ? currentIndex / last : 0);

  trackEl.querySelectorAll(".track-dot").forEach((dot, index) => {
    dot.classList.toggle("is-past", index < currentIndex);
    dot.classList.toggle("is-current", index === currentIndex);
  });

  prevBtn.disabled = currentIndex === 0;
  nextBtn.disabled = currentIndex === last;
  updatePlayButton();
}

function updatePlayButton() {
  const atEnd = currentIndex === snapshots.length - 1;
  let icon = PLAY_ICON;
  let label = "Play";

  if (playing) {
    icon = PAUSE_ICON;
    label = "Pause";
  } else if (atEnd && snapshots.length > 1) {
    label = "Replay";
  }

  playBtn.innerHTML = `${icon}<span>${label}</span>`;
  playBtn.disabled = snapshots.length < 2;
}

function goTo(index) {
  // Stage 5: a simulation belongs to one step, so leave it behind when the step changes.
  const hadSimulation = isSimulating();
  clearSimulationState();
  if (hadSimulation) simMessage = "You moved to another step, so the simulation was cleared.";

  currentIndex = index;
  renderState(snapshots[index].state);
  updateTimelineUI();
}

function startPlaying() {
  if (currentIndex === snapshots.length - 1) goTo(0);   // "Replay" starts over
  playing = true;
  updatePlayButton();
  scheduleNextStep();
}

function scheduleNextStep() {
  playTimer = setTimeout(() => {
    goTo(currentIndex + 1);
    if (currentIndex < snapshots.length - 1) {
      scheduleNextStep();
    } else {
      stopPlaying();
    }
  }, STEP_MS);
}

function stopPlaying() {
  clearTimeout(playTimer);
  playing = false;
  updatePlayButton();
}

function wireControls() {
  prevBtn.addEventListener("click", () => {
    stopPlaying();
    if (currentIndex > 0) goTo(currentIndex - 1);
  });

  nextBtn.addEventListener("click", () => {
    stopPlaying();
    if (currentIndex < snapshots.length - 1) goTo(currentIndex + 1);
  });

  playBtn.addEventListener("click", () => {
    if (playing) stopPlaying();
    else startPlaying();
  });

  // Left / right arrow keys also step through events
  document.addEventListener("keydown", event => {
    if (event.key === "ArrowRight" && currentIndex < snapshots.length - 1) {
      stopPlaying();
      goTo(currentIndex + 1);
    }
    if (event.key === "ArrowLeft" && currentIndex > 0) {
      stopPlaying();
      goTo(currentIndex - 1);
    }
  });
}


// ---------- Start ----------

function start(data) {
  if (!Array.isArray(data) || data.length === 0) {
    showLoadError();
    return;
  }

  snapshots = data;
  setupCanvas();
  buildTrack();
  wireControls();
  wireSelection();
  wireSimulation();   // Stage 5
  goTo(0);
}

// Try snapshots.json first. If it isn't there, show data.json as a single step.
d3.json(SNAPSHOTS_URL)
  .catch(() => d3.json(DATA_URL).then(state => [{ event: "Current network", state: state }]))
  .then(start, showLoadError);