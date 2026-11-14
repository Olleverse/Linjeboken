/* app.js — kompatibel med din index.html
   - Kräver element: #start, #slut, #dpList, #output
   - Exponerar: searchRoute()
   - Laddar data från mappen data/ (config, driftplatser, en korridorfil per linjebok)
   - Bygger graf av korridorer och hittar väg över flera korridorer.
     Vägsökningen föredrar att stanna kvar i samma korridor och samma linjebok,
     så att resultatet följer den naturliga banan i stället för den väg som
     råkar ha färst driftplatser.
*/

(function () {
  const $ = (id) => document.getElementById(id);

  // Straff för att byta korridor / linjebok längs vägen (räknat i "antal driftplatser").
  // Höj om resultatet hoppar mellan korridorer i onödan, sänk om det tar för stora omvägar.
  const BYTE_KORRIDOR = 8;
  const BYTE_LINJEBOK = 4; // läggs ovanpå BYTE_KORRIDOR

  let DATA = null;
  let dpByCode = new Map();
  let dpByLowerCode = new Map();
  let dpList = [];
  let lbById = new Map();
  let corridorById = new Map();
  let adj = new Map(); // code -> [{to, corridorId}]

  // ---------- Helpers ----------
  function fetchJsonNoCache(url) {
    const sep = url.includes("?") ? "&" : "?";
    return fetch(url + sep + "v=" + Date.now(), { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error(`Kunde inte hämta ${url} (${r.status})`);
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`${url} innehåller ett formatfel och kan inte läsas (${e.message}). ` +
          `Vanligast är ett saknat eller extra kommatecken.`);
      }
    });
  }

  function esc(s) {
    return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function formatDp(code) {
    const dp = dpByCode.get(code);
    return dp && dp.name !== code ? `${dp.name} (${dp.code})` : code;
  }

  function normalizeToCode(input) {
    const v = (input || "").trim();
    if (!v) return "";

    // "... (CODE)"
    const m = v.match(/\(([^)]+)\)\s*$/);
    if (m && m[1] && dpByCode.has(m[1].trim())) return m[1].trim();

    // exakt kod, sedan kod oavsett versaler (sk, SK, Sk)
    if (dpByCode.has(v)) return v;
    const byLower = dpByLowerCode.get(v.toLowerCase());
    if (byLower) return byLower;

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

  // Vilka tabellsträckor (i hastighets-PDF:en) berör den här delen av korridoren?
  function tabellStrackorFor(corridor, fromCode, toCode) {
    const ord = corridor?.ordning || [];
    const a = ord.indexOf(fromCode), b = ord.indexOf(toCode);
    if (a === -1 || b === -1) return [];
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const hits = [];
    for (const t of corridor.tabellStrackor || []) {
      const s = ord.indexOf(t.start), e = ord.indexOf(t.end);
      if (s === -1 || e === -1) continue; // sträckan ligger utanför korridorens ordning
      const tlo = Math.min(s, e), thi = Math.max(s, e);
      if (Math.max(lo, tlo) < Math.min(hi, thi)) hits.push(t);
    }
    // visa i körordning
    const forward = b >= a;
    hits.sort((x, y) => {
      const ix = Math.min(ord.indexOf(x.start), ord.indexOf(x.end));
      const iy = Math.min(ord.indexOf(y.start), ord.indexOf(y.end));
      return forward ? ix - iy : iy - ix;
    });
    return hits;
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

    // korridorer + graf
    corridorById = new Map();
    adj = new Map();

    function ensureNode(c) {
      if (!adj.has(c)) adj.set(c, []);
      // Driftplats som finns i en korridor men saknar namn: ta med den ändå,
      // så att den går att söka på med sin kod.
      if (!dpByCode.has(c)) dpByCode.set(c, { code: c, name: c, saknarNamn: true });
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

    dpByLowerCode = new Map();
    for (const code of dpByCode.keys()) {
      const k = code.toLowerCase();
      if (!dpByLowerCode.has(k)) dpByLowerCode.set(k, code);
    }

    dpList = Array.from(dpByCode.values()).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "sv")
    );
  }

  function fillDatalist() {
    const dl = $("dpList");
    if (!dl) return;
    dl.innerHTML = dpList.map((dp) => `<option value="${esc(formatDp(dp.code))}"></option>`).join("");
  }

  // ---------- Pathfinding ----------
  // Dijkstra där tillståndet är (driftplats, korridor vi kom via).
  // Varje steg kostar 1, att byta korridor kostar extra, och att byta linjebok ännu mer.
  function findRoute(start, goal) {
    if (!adj.has(start) || !adj.has(goal)) return null;

    const key = (node, corr) => node + "\u0000" + (corr ?? "");
    const dist = new Map([[key(start, null), 0]]);
    const prev = new Map();
    const heap = [[0, start, null]];

    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };

    let endKey = null;
    while (heap.length) {
      const [cost, node, corr] = pop();
      const k = key(node, corr);
      if (dist.get(k) !== cost) continue;
      if (node === goal) { endKey = k; break; }

      for (const e of adj.get(node) || []) {
        let step = 1;
        if (corr && e.corridorId !== corr) {
          step += BYTE_KORRIDOR;
          const lbA = corridorById.get(corr)?.linjebokId;
          const lbB = corridorById.get(e.corridorId)?.linjebokId;
          if (lbA !== lbB) step += BYTE_LINJEBOK;
        }
        const nk = key(e.to, e.corridorId);
        const nc = cost + step;
        if (nc < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nc);
          prev.set(nk, { node, corr, prevKey: k });
          push([nc, e.to, e.corridorId]);
        }
      }
    }

    if (!endKey) return null;

    const nodes = [goal];
    const corridors = [];
    let k = endKey;
    while (prev.has(k)) {
      const p = prev.get(k);
      corridors.push(k.split("\u0000")[1]);
      nodes.push(p.node);
      k = p.prevKey;
    }
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
    out.innerHTML = `<div class="bad">Fel:</div><div>${esc(msg)}</div>`;
  }

  function renderResult(fromCode, toCode, path) {
    const out = $("output");
    if (!out) return;

    const segments = compressSegments(path).map((seg) => {
      const corridor = corridorById.get(seg.corridorId);
      const lb = corridor ? lbById.get(corridor.linjebokId) : null;
      return {
        linjebokId: corridor?.linjebokId || "",
        linjebokName: lb?.name || corridor?.linjebokId || "(okänd linjebok)",
        corridorName: corridor?.name || seg.corridorId,
        direction: corridor ? corridorDirection(corridor, seg.from, seg.to) : "okänd",
        tabell: corridor ? tabellStrackorFor(corridor, seg.from, seg.to) : [],
        from: seg.from,
        to: seg.to
      };
    });

    const books = [...new Set(segments.map((s) => s.linjebokName))];
    const bookText = books.length === 1
      ? `Hela sträckan finns i linjebok <strong>${esc(books[0])}</strong>.`
      : `Sträckan är uppdelad på <strong>${books.length} linjeböcker</strong>: ${books.map(esc).join(" → ")}.`;

    out.innerHTML = `
      <div><strong>Resultat:</strong> ${esc(formatDp(fromCode))} → ${esc(formatDp(toCode))}</div>
      <div style="margin-top:6px;">${bookText}</div>
      <div style="margin-top:10px;">
        ${segments.map((s, i) => `
          <div class="line">
            <div><strong>${i + 1}. Linjebok ${esc(s.linjebokName)}</strong></div>
            <div>${esc(formatDp(s.from))} → ${esc(formatDp(s.to))}</div>
            <div class="muted">Korridor: ${esc(s.corridorName)} (${esc(s.direction)})</div>
            ${s.tabell.length ? `
              <div class="muted" style="margin-top:4px;">Slå upp i hastighets-PDF:en:
                <ul style="margin:4px 0 0 18px; padding:0;">
                  ${s.tabell.map((t) => `<li>${esc(t.name)}</li>`).join("")}
                </ul>
              </div>` : ""}
          </div>
        `).join("")}
      </div>

      <details style="margin-top:12px;">
        <summary style="cursor:pointer;"><strong>Visa hela kedjan av driftplatser</strong> (${path.nodes.length} st)</summary>
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

      const path = findRoute(fromCode, toCode);
      if (!path) return renderError("Hittar ingen väg i din data mellan dessa driftplatser. (Saknas korridorer som kopplar ihop?)");

      renderResult(fromCode, toCode, path);
    } catch (e) {
      renderError(String(e?.message || e));
    }
  };

  // Admin-knapparna i index.html är avstängda i denna version.
  window.requestAdmin = function () {
    alert("Admin-läget är avstängt i denna version. Data ligger i mappen data/.");
  };
  window.undoLastSave = function () {
    alert("Ångra är avstängt i denna version. Ändra filerna i mappen data/ på GitHub istället.");
  };
  window.resetToDefault = function () {
    alert("Återställ är avstängt i denna version. Ändra filerna i mappen data/ på GitHub istället.");
  };
  window.previewAdmin = function () {};
  window.saveAdmin = function () {};
  window.hideAdmin = function () {};

  // Enter i fälten startar sökningen
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target?.id === "start" || e.target?.id === "slut")) window.searchRoute();
  });

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", async () => {
    const out = $("output");
    if (out) out.textContent = "Laddar data…";

    try {
      // All data ligger i mappen data/:
      //   data/config.json             – vilka linjeböcker som finns
      //   data/driftplatser.json       – kod + namn för alla driftplatser
      //   data/korridorer/<ID>.json    – en fil per linjebok (ID från config.json)
      const config = await fetchJsonNoCache("./data/config.json");
      const linjebocker = config?.linjebocker;
      if (!Array.isArray(linjebocker)) throw new Error("data/config.json saknar listan \"linjebocker\".");

      const [dpFile, ...corridorFiles] = await Promise.all([
        fetchJsonNoCache("./data/driftplatser.json"),
        ...linjebocker.map((lb) => fetchJsonNoCache(`./data/korridorer/${lb.id}.json`))
      ]);
      if (!Array.isArray(dpFile?.driftplatser)) throw new Error("data/driftplatser.json saknar listan \"driftplatser\".");

      const korridorer = [];
      corridorFiles.forEach((f, i) => {
        if (!Array.isArray(f?.korridorer)) throw new Error(`data/korridorer/${linjebocker[i].id}.json saknar listan "korridorer".`);
        korridorer.push(...f.korridorer);
      });

      buildIndexes({ linjebocker, driftplatser: dpFile.driftplatser, korridorer });
      fillDatalist();

      if (out) out.innerHTML = `<span class="ok">Redo.</span> (${dpList.length} driftplatser, ${(DATA.korridorer || []).length} korridorer)`;
    } catch (e) {
      renderError(String(e?.message || e));
    }
  });
})();
