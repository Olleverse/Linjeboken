let DATA = null;

async function loadData() {
  if (DATA) return DATA;
  DATA = await fetch("data.json").then(r => r.json());
  buildAutoSuggest(DATA);
  return DATA;
}

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function buildAutoSuggest(data) {
  const list = document.getElementById("dpList");
  if (!list) return;
  list.innerHTML = "";

  // Ex: "Skövde central (Sk)"
  for (const dp of (data.driftplatser || [])) {
    const opt = document.createElement("option");
    opt.value = `${dp.name} (${dp.code})`;
    list.appendChild(opt);

    // även kod ensam, så man kan välja direkt
    const opt2 = document.createElement("option");
    opt2.value = dp.code;
    list.appendChild(opt2);
  }
}

function parseCodeFromInput(input, driftsplatser) {
  const q = normalize(input);

  // Om användaren skrev "Namn (CODE)"
  const m = input.match(/\(([^)]+)\)\s*$/);
  if (m) {
    const code = normalize(m[1]);
    const dp = driftsplatser.find(d => normalize(d.code) === code);
    if (dp) return dp;
  }

  // Exakt kod
  const exactCode = driftsplatser.find(d => normalize(d.code) === q);
  if (exactCode) return exactCode;

  // Exakt namn
  const exactName = driftsplatser.find(d => normalize(d.name) === q);
  if (exactName) return exactName;

  // Innehåller
  return driftsplatser.find(d => normalize(d.name).includes(q)) || null;
}

function buildGraph(edges) {
  const g = new Map();
  for (const e of edges) {
    if (!g.has(e.from)) g.set(e.from, []);
    if (!g.has(e.to)) g.set(e.to, []);
    g.get(e.from).push(e);
    g.get(e.to).push({ ...e, from: e.to, to: e.from }); // spegel
  }
  return g;
}

function bfsPath(graph, startCode, endCode) {
  const queue = [startCode];
  const prev = new Map();
  prev.set(startCode, null);

  while (queue.length) {
    const cur = queue.shift();
    if (cur === endCode) break;

    for (const edge of (graph.get(cur) || [])) {
      const nxt = edge.to;
      if (prev.has(nxt)) continue;
      prev.set(nxt, { node: cur, edge });
      queue.push(nxt);
    }
  }

  if (!prev.has(endCode)) return null;

  const pathEdges = [];
  let cur = endCode;
  while (cur !== startCode) {
    const p = prev.get(cur);
    pathEdges.push(p.edge);
    cur = p.node;
  }
  pathEdges.reverse();
  return pathEdges;
}

function unique(arr) {
  return [...new Set(arr)];
}

function pathCodesFromEdges(startCode, pathEdges) {
  const codes = [startCode];
  for (const e of pathEdges) codes.push(e.to);
  return codes;
}

function segmentCodesBetween(pathCodes, start, end) {
  const i1 = pathCodes.indexOf(start);
  const i2 = pathCodes.indexOf(end);
  if (i1 === -1 || i2 === -1) return null;
  if (i1 <= i2) return pathCodes.slice(i1, i2 + 1);
  return pathCodes.slice(i2, i1 + 1).reverse();
}

function matchFastaStrackor(pathCodes, fastaStrackor) {
  const used = [];
  for (const fs of (fastaStrackor || [])) {
    const seg = segmentCodesBetween(pathCodes, fs.start, fs.end);
    if (!seg) continue;

    // Ta med om rutten faktiskt träffar intervallet
    const anyInside = seg.some(c => pathCodes.includes(c));
    if (!anyInside) continue;

    // Vill vi vara striktare? (Både start och end på rutten)
    // För nu: om rutten korsar eller innehåller intervallet, ta med.
    used.push(fs);
  }

  const seen = new Set();
  return used.filter(u => (seen.has(u.id) ? false : (seen.add(u.id), true)));
}

function renderSimple({ start, end, pathEdges, data }) {
  const output = document.getElementById("output");

  const lbById = new Map((data.linjebocker || []).map(lb => [lb.id, lb]));
  const allLB = unique(pathEdges.flatMap(e => e.linjebocker || []));

  const pathCodes = pathCodesFromEdges(start.code, pathEdges);
  const usedFasta = matchFastaStrackor(pathCodes, data.fastaStrackor);

  const linjebockerHtml = allLB.length
    ? allLB.map(id => {
        const lb = lbById.get(id);
        return `<div class="line"><strong>${lb ? lb.id : id}</strong><div>${lb ? lb.name : ""}</div></div>`;
      }).join("")
    : `<div class="line">—</div>`;

  const fastaHtml = usedFasta.length
    ? usedFasta.map(fs =>
        `<div class="line"><strong>${fs.name}</strong><div>Klass: ${fs.klass}</div></div>`
      ).join("")
    : `<div class="line">—</div>`;

  output.innerHTML = `
    <div><strong>${start.name} (${start.code})</strong> → <strong>${end.name} (${end.code})</strong></div>
    <br>
    <div><strong>1) Linjebok</strong></div>
    ${linjebockerHtml}
    <br>
    <div><strong>2) Fast sträcka</strong></div>
    ${fastaHtml}
  `;
}

async function searchRoute() {
  const data = await loadData();
  const driftsplatser = data.driftplatser || [];
  const edges = data.edges || [];

  const startInput = document.getElementById("start").value;
  const endInput = document.getElementById("slut").value;
  const output = document.getElementById("output");

  const start = parseCodeFromInput(startInput, driftsplatser);
  const end = parseCodeFromInput(endInput, driftsplatser);

  if (!start || !end) {
    output.innerHTML = "Kunde inte hitta start/slut. Välj från listan eller skriv driftplatskod.";
    return;
  }

  const graph = buildGraph(edges);
  const pathEdges = bfsPath(graph, start.code, end.code);

  if (!pathEdges) {
    output.innerHTML = "Ingen rutt hittades i din data (saknar någon länk/edge i data.json).";
    return;
  }

  renderSimple({ start, end, pathEdges, data });
}

// Ladda data direkt så autosuggest fylls när sidan öppnas
loadData();

