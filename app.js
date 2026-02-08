/* app.js — kompatibel med din index.html
   - Kräver element: #start, #slut, #dpList, #output
   - Exponerar: searchRoute()
   - Laddar ./data.json (cache-bust)
   - Bygger graf av korridorer och hittar väg över flera korridorer (BFS)
*/

(function () {
  const $ = (id) => document.getElementById(id);

  let DATA = null;
  let dpByCode = new Map();
  let dpList = [];
  let lbById = new Map();
  let corridorById = new Map();
  let adj = new Map(); // code -> [{to, corridorId}]

  // ---------- Helpers ----------
  function fetchJsonNoCache(url) {
    const sep = url.includes("?") ? "&" : "?";
    return fetch(url + sep + "v=" + Date.now(), { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`Kunde inte hämta ${url} (${r.status})`);
      return r.json();
    });
  }

  function esc(s) {
    return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function formatDp(code) {
    const dp = dpByCode.get(code);
    return dp ? `${dp.name} (${dp.code})` : code;
  }

  function normalizeToCode(input) {
    const v = (input || "").trim();
    if (!v) return "";

    // "... (CODE)"
    const m = v.match(/\(([^)]+)\)\s*$/);
    if (m && m[1]) return m[1].trim();

    // exakt kod
    if (dpByCode.has(v)) return v;

    // match på namn
    const lower = v.toLowerCase();
    for (const dp of dpList) {
      if ((dp.name || "").toLowerCase() === lower) return dp.code;
    }
    return "";
  }

  function corridorDirection(corridor, fromCode, toCode) {
    const ord = corridor?.ordning || [];
    const i1 = ord.indexOf(fromCode);
    const i2 = ord.indexOf(toCode);
    if (i1 === -1 || i2 === -1) return "okänd";
    return i2 > i1 ? "fram" : "bak";
  }

  // ---------- Index builders ----------
  function buildIndexes(data) {
    DATA = data;

    // linjeböcker
    lbById = new Map();
    (data.linjebocker || []).forEach((lb) => lbById.set(lb.id, lb));

    // driftplatser, dedupe på code
    dpByCode = new Map();
    for (const dp of data.driftplatser || []) {
      if (!dp?.code) continue;
      if (!dpByCode.has(dp.code)) dpByCode.set(dp.code, dp);
    }
    dpList = Array.from(dpByCode.values()).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "sv")
    );

    // korridorer + graf
    corridorById = new Map();
    adj = new Map();

    function ensureNode(c) {
      if (!adj.has(c)) adj.set(c, []);
    }

    for (const c of data.korridorer || []) {
      if (!c?.id || !Array.isArray(c.ordning) || c.ordning.length < 2) continue;
      corridorById.set(c.id, c);

      const ord = c.ordning;
      for (let i = 0; i < ord.length - 1; i++) {
        const a = ord[i], b = ord[i + 1];
        if (!a || !b) continue;
        ensureNode(a); ensureNode(b);
        adj.get(a).push({ to: b, corridorId: c.id });
        adj.get(b).push({ to: a, corridorId: c.id });
      }
    }
  }

  function fillDatalist() {
    const dl = $("dpList");
    if (!dl) return;
    dl.innerHTML = dpList.map((dp) => `<option value="${esc(dp.name)} (${esc(dp.code)})"></option>`).join("");
  }

  // ---------- Pathfinding ----------
  function bfs(start, goal) {
    if (!adj.has(start) || !adj.has(goal)) return null;

    const q = [start];
    const visited = new Set([start]);
    const prev = new Map(); // node -> {prevNode, viaCorridorId}

    while (q.length) {
      const cur = q.shift();
      if (cur === goal) break;
      for (const e of adj.get(cur) || []) {
        if (!e?.to) continue;
        if (visited.has(e.to)) continue;
        visited.add(e.to);
        prev.set(e.to, { prevNode: cur, viaCorridorId: e.corridorId });
        q.push(e.to);
      }
    }

    if (!visited.has(goal)) return null;

    const nodes = [];
    const corridors = [];
    let cur = goal;

    while (cur !== start) {
      const p = prev.get(cur);
      if (!p) return null;
      nodes.push(cur);
      corridors.push(p.viaCorridorId);
      cur = p.prevNode;
    }
    nodes.push(start);
    nodes.reverse();
    corridors.reverse();
    return { nodes, corridors };
  }

  function compressSegments(path) {
    const nodes = path.nodes;
    const corrs = path.corridors;
    const segments = [];
    let i = 0;
    while (i < corrs.length) {
      const corridorId = corrs[i];
      let j = i;
      while (j < corrs.length && corrs[j] === corridorId) j++;
      segments.push({ corridorId, from: nodes[i], to: nodes[j] });
      i = j;
    }
    return segments;
  }

  // ---------- Rendering ----------
  function renderError(msg) {
    const out = $("output");
    if (!out) return;
    out.innerHTML = `<div class="bad">Fel:</div><div>${esc(msg)}</div>
      <div class="muted" style="margin-top:8px;">Testa att öppna <code>data.json?v=1</code> i en ny flik.</div>`;
  }

  function renderResult(fromCode, toCode, path) {
    const out = $("output");
    if (!out) return;

    const segments = compressSegments(path).map((seg) => {
      const corridor = corridorById.get(seg.corridorId);
      const lb = corridor ? lbById.get(corridor.linjebokId) : null;
      return {
        linjebokName: lb?.name || corridor?.linjebokId || "(okänd linjebok)",
        corridorName: corridor?.name || seg.corridorId,
        direction: corridor ? corridorDirection(corridor, seg.from, seg.to) : "okänd",
        from: seg.from,
        to: seg.to
      };
    });

    out.innerHTML = `
      <div><strong>Resultat:</strong> ${esc(formatDp(fromCode))} → ${esc(formatDp(toCode))}</div>
      <div class="muted" style="margin-top:6px;">Hittade ${segments.length} korridor(er) i kedja.</div>
      <div style="margin-top:10px;">
        ${segments.map((s, i) => `
          <div class="line">
            <div><strong>${i + 1}. Linjebok:</strong> ${esc(s.linjebokName)}</div>
            <div><strong>Fast sträcka:</strong> ${esc(s.corridorName)}</div>
            <div class="muted">Del av rutt: ${esc(formatDp(s.from))} → ${esc(formatDp(s.to))} <span class="pill">(${esc(s.direction)})</span></div>
          </div>
        `).join("")}
      </div>

      <details style="margin-top:12px;">
        <summary style="cursor:pointer;"><strong>Visa hela kedjan av driftplatser</strong></summary>
        <div class="muted" style="margin-top:8px; line-height:1.6;">
          ${path.nodes.map((c) => esc(formatDp(c))).join(" → ")}
        </div>
      </details>
    `;
  }

  // ---------- Public API (för din onclick) ----------
  window.searchRoute = function searchRoute() {
    try {
      if (!DATA) return renderError("Data är inte laddad ännu. Ladda om sidan.");

      const fromRaw = $("start")?.value || "";
      const toRaw = $("slut")?.value || "";

      const fromCode = normalizeToCode(fromRaw);
      const toCode = normalizeToCode(toRaw);

      if (!fromCode) return renderError("Start driftplats kunde inte tolkas. Välj från listan eller skriv en giltig kod.");
      if (!toCode) return renderError("Slut driftplats kunde inte tolkas. Välj från listan eller skriv en giltig kod.");
      if (fromCode === toCode) return renderError("Start och slut är samma. Välj två olika driftplatser.");

      const path = bfs(fromCode, toCode);
      if (!path) return renderError("Hittar ingen väg i din data mellan dessa driftplatser. (Saknas korridorer som kopplar ihop?)");

      renderResult(fromCode, toCode, path);
    } catch (e) {
      renderError(String(e?.message || e));
    }
  };

  // Du har admin-knappar i HTML — men du sa att du vill stänga av redigering.
  // För att din sida inte ska ge "function not defined"-fel om du klickar:
  window.requestAdmin = function () {
    alert("Admin-läget är avstängt i denna version. Data ligger i data.json.");
  };
  window.undoLastSave = function () {
    alert("Ångra är avstängt i denna version. Ändra data.json i GitHub istället.");
  };
  window.resetToDefault = function () {
    alert("Återställ är avstängt i denna version. Ändra data.json i GitHub istället.");
  };
  window.previewAdmin = function () {};
  window.saveAdmin = function () {};
  window.hideAdmin = function () {};

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", async () => {
    const out = $("output");
    if (out) out.textContent = "Laddar data…";

    try {
      // data.json ligger i samma mapp som index.html på GitHub Pages:
      // https://olleverse.github.io/Linjeboken/data.json
      const data = await fetchJsonNoCache("./data.json");

      // enkel validering
      if (!data || !Array.isArray(data.driftplatser) || !Array.isArray(data.korridorer)) {
        throw new Error("Fel format i data.json: saknar driftplatser/korridorer.");
      }

      buildIndexes(data);
      fillDatalist();

      if (out) out.innerHTML = `<span class="ok">Redo.</span> (${dpList.length} driftplatser, ${(DATA.korridorer || []).length} korridorer)`;
    } catch (e) {
      renderError(String(e?.message || e));
    }
  });
})();




