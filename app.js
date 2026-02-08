let DATA = null;

async function loadData() {
  if (DATA) return DATA;
  DATA = await fetch("data.json").then(r => r.json());
  return DATA;
}

function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function findDriftplats(input, driftsplatser) {
  const q = normalize(input);
  if (!q) return null;

  const exactCode = driftsplatser.find(d => normalize(d.code) === q);
  if (exactCode) return exactCode;

  const exactName = driftsplatser.find(d => normalize(d.name) === q);
  if (exactName) return exactName;

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
  // Returnera bara de fasta sträckor som faktiskt korsas av rutten
  const used = [];
  for (const fs of (fastaStrackor || [])) {
    const seg = segmentCodesBetween(pathCodes, fs.start, fs.end);
    if (!seg) continue;

    // “korsas” om rutten innehåller minst en nod inom intervallet
    const covered = seg.some(c => pathCodes.includes(c));
    if (!covered) continue;

    // Mer strikt: rutten måste gå över en del av intervallet
    // Vi tar med den om både start och end ligger på rutten, eller om rutten passerar gränsen (t.ex. P)
    const startOn = pathCodes.includes(fs.start);
    const endOn = pathCodes.includes(fs.end);

    if (startOn && endOn) {
      used.push({ ...fs, codes: seg });
      continue;
    }

    // Om rutten börjar/slutar inne i intervallet, eller passerar en gränspunkt:
    const anyInside = seg.some(c => pathCodes.includes(c));
    if (anyInside) used.push({ ...fs, codes: seg });
  }

  // Dedupe på id
  const seen = new Set();
  return used.filter(u => (seen.has(u.id) ? false : (seen.add(u.id), true)));
}

function renderResult({ start, end, pathEdges, data }) {
  const output = document.getElementById("output");
  const lbById = new Map((data.linjebocker || []).map(lb => [lb.id, lb]));

  const allLB = unique(pathEdges.flatMap(e => e.linjebocker || []));
  const linjebockerHtml = allLB.map(id => {
    const lb = lbById.get(id);
    return lb ? `${lb.id}: ${lb.name}` : id;
  }).join("<br>");

  const pathCodes = pathCodesFromEdges(start.code, pathEdges);
  const usedFasta = matchFastaStrackor(pathCodes, data.fastaStrackor);

  const fastaHtml = usedFasta.length
    ? usedFasta.map(fs => {
        const routeHit = segmentCodesBetween(pathCodes, fs.start, fs.end);
        // visa just den del av fasta sträckan som matchar rutten
        const shown = routeHit ? routeHit.join(" → ") : fs.start + " → " + fs.end;
        return `<div style="padding:6px 0;border-bottom:1px solid #ddd;">
          <div><strong>${fs.name}</strong> (klass ${fs.klass})</div>
          <div style="opacity:.85;font-size:.95em;">${shown}</div>
        </div>`;
      }).join("")
    : "—";

  const segmentsHtml = pathEdges.map((e, i) => {
    const lbs = (e.linjebocker || []).map(id => lbById.get(id)?.name || id).join(", ");
    return `
      <div style="padding:8px 0;border-bottom:1px solid #ddd;">
        <div><strong>${i + 1}.</strong> ${e.from} → ${e.to}</div>
        <div>Linjebok: ${lbs || "?"}</div>
      </div>
    `;
  }).join("");

  output.innerHTML = `
    <div><strong>Start:</strong> ${start.name} (${start.code})</div>
    <div><strong>Slut:</strong> ${end.name} (${end.code})</div>
    <br>

    <div><strong>Linjebok/underlag som träffas:</strong><br>${linjebockerHtml || "—"}</div>
    <br>

    <div><strong>Fasta sträckor (för tabeller):</strong></div>
    ${fastaHtml}
    <br>

    <div><strong>Delsträckor (i ordning):</strong></div>
    ${segmentsHtml || "—"}
  `;
}

async function searchRoute() {
  const data = await loadData();
  const startInput = document.getElementById("start").value;
  const endInput = document.getElementById("slut").value;
  const output = document.getElementById("output");

  const start = findDriftplats(startInput, data.driftplatser || []);
  const end = findDriftplats(endInput, data.driftplatser || []);

  if (!start || !end) {
    output.innerHTML = "Kunde inte hitta start och/eller slut. Testa driftplatskod (t.ex. Sk, G) eller del av namnet.";
    return;
  }

  const graph = buildGraph(data.edges || []);
  const pathEdges = bfsPath(graph, start.code, end.code);

  if (!pathEdges) {
    output.innerHTML = "Ingen rutt hittades i din data (du saknar troligen någon länk/edge i data.json).";
    return;
  }

  renderResult({ start, end, pathEdges, data });
}

