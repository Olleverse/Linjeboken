// app.js — statisk GitHub Pages-version (ingen Vite/React)
// - Laddar ./data.json (cache-bust)
// - Autosuggest med datalist
// - BFS-rutt över flera korridorer i kedja
// Kräver data.json-format:
// { linjebocker:[], driftplatser:[], korridorer:[] }

(function () {
  const $ = (sel) => document.querySelector(sel);

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const ch of children) node.appendChild(typeof ch === "string" ? document.createTextNode(ch) : ch);
    return node;
  }

  function safeText(s) {
    return (s ?? "").toString();
  }

  function loadJsonNoCache(url) {
    const bust = `v=${Date.now()}`;
    const sep = url.includes("?") ? "&" : "?";
    return fetch(url + sep + bust, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(`Kunde inte hämta ${url} (${r.status})`);
      return r.json();
    });
  }

  // --- Data + index ---
  let DATA = null;
  let dpByCode = new Map();
  let dpList = [];
  let lbById = new Map();
  let corridorById = new Map();
  let adj = new Map(); // code -> [{to, corridorId}]

  function buildIndexes(data) {
    DATA = data;

    // linjeböcker
    lbById = new Map();
    (data.linjebocker || []).forEach((lb) => lbById.set(lb.id, lb));

    // driftplatser (dedupe på code)
    dpByCode = new Map();
    for (const dp of data.driftplatser || []) {
      if (!dp || !dp.code) continue;
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

  function normalizeToCode(input) {
    const v = (input || "").trim();
    if (!v) return "";

    // match "... (CODE)"
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

  function formatDp(code) {
    const dp = dpByCode.get(code);
    return dp ? `${dp.name} (${dp.code})` : code;
  }

  function corridorDirection(corridor, fromCode, toCode) {
    const ord = corridor?.ordning || [];
    const i1 = ord.indexOf(fromCode);
    const i2 = ord.indexOf(toCode);
    if (i1 === -1 || i2 === -1) return "okänd";
    return i2 > i1 ? "fram" : "bak";
  }

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

  // --- UI ---
  function renderApp() {
    const root = $("#app");
    root.innerHTML = "";

    const title = el("h1", { textContent: "Linjeboken – hitta rätt linjebok & fast sträcka" });
    const hint = el("div", { style: "opacity:.8;margin-bottom:12px;", textContent: "Skriv start och slut (namn eller kod). Appen listar vilka fasta sträckor (korridorer) du behöver slå upp." });

    const errBox = el("div", { id: "errBox", style: "display:none;padding:10px;border:1px solid #f00;border-radius:10px;margin:12px 0;" });

    const fromInput = el("input", { id: "from", placeholder: "Start: t.ex. Skövde central (Sk) eller Sk", list: "dpList", style: "width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" });
    const toInput = el("input", { id: "to", placeholder: "Slut: t.ex. Göteborgs central (G) eller G", list: "dpList", style: "width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;" });

    const btn = el("button", {
      textContent: "Hitta sträcka",
      style: "padding:10px 14px;border-radius:10px;border:1px solid #111;background:#111;color:#fff;font-weight:700;cursor:pointer;white-space:nowrap;"
    });

    const grid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;" }, [
      el("div", {}, [el("label", { textContent: "Start", style: "display:block;font-weight:700;margin:0 0 6px;" }), fromInput]),
      el("div", {}, [el("label", { textContent: "Slut", style: "display:block;font-weight:700;margin:0 0 6px;" }), toInput]),
      btn
    ]);

    const datalist = el("datalist", { id: "dpList" }, dpList.map(dp => el("option", { value: `${dp.name} (${dp.code})` })));

    const out = el("div", { id: "out", style: "margin-top:14px;" });

    btn.addEventListener("click", () => {
      errBox.style.display = "none";
      errBox.textContent = "";
      out.innerHTML = "";

      const fromCode = normalizeToCode(fromInput.value);
      const toCode = normalizeToCode(toInput.value);

      if (!fromCode) return showErr("Start driftplats kunde inte tolkas. Välj från listan eller skriv en giltig kod.");
      if (!toCode) return showErr("Slut driftplats kunde inte tolkas. Välj från listan eller skriv en giltig kod.");
      if (fromCode === toCode) return showErr("Start och slut är samma. Välj två olika driftplatser.");

      const path = bfs(fromCode, toCode);
      if (!path) return showErr("Hittar ingen väg i din data mellan dessa driftplatser. (Saknas korridorer som kopplar ihop?)");

      const segments = compressSegments(path).map(seg => {
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

      const header = el("div", { style: "padding:12px;border:1px solid #ddd;border-radius:12px;" }, [
        el("div", { style: "font-weight:800;margin-bottom:6px;", textContent: `Resultat: ${formatDp(fromCode)} → ${formatDp(toCode)}` }),
        el("div", { style: "opacity:.85;margin-bottom:10px;", textContent: `Hittade ${segments.length} korridor(er) i kedja.` })
      ]);

      const list = el("div", { style: "display:grid;gap:10px;" }, segments.map((s, idx) => {
        return el("div", { style: "padding:12px;border:1px solid #eee;border-radius:12px;" }, [
          el("div", { style: "font-weight:800;margin-bottom:6px;", textContent: `${idx + 1}. Linjebok: ${s.linjebokName}` }),
          el("div", { style: "margin-bottom:6px;" }, [
            el("span", { style: "font-weight:700;", textContent: "Fast sträcka: " }),
            el("span", { textContent: safeText(s.corridorName) })
          ]),
          el("div", { style: "font-size:13px;opacity:.9;" }, [
            el("span", { style: "font-weight:700;", textContent: "Del av rutt: " }),
            el("span", { textContent: `${formatDp(s.from)} → ${formatDp(s.to)} ` }),
            el("span", { style: "margin-left:6px;padding:2px 8px;border:1px solid #ccc;border-radius:999px;", textContent: `riktning: ${s.direction}` })
          ])
        ]);
      }));

      const details = el("details", { style: "margin-top:12px;" }, [
        el("summary", { style: "cursor:pointer;font-weight:700;", textContent: "Visa hela kedjan av driftplatser" }),
        el("div", { style: "margin-top:10px;line-height:1.7;" }, [
          el("span", { textContent: path.nodes.map(formatDp).join(" → ") })
        ])
      ]);

      header.appendChild(list);
      header.appendChild(details);
      out.appendChild(header);
    });

    function showErr(msg) {
      errBox.style.display = "block";
      errBox.textContent = msg;
    }

    root.appendChild(title);
    root.appendChild(hint);
    root.appendChild(errBox);
    root.appendChild(grid);
    root.appendChild(datalist);
    root.appendChild(out);

    const tip = el("div", { style: "margin-top:12px;font-size:13px;opacity:.75;" }, [
      el("span", { textContent: "Tips: om sidan fastnar på gammal data, öppna " }),
      el("code", { textContent: "/data.json?v=1" }),
      el("span", { textContent: " och ladda om." })
    ]);
    root.appendChild(tip);
  }

  // --- Start ---
  document.addEventListener("DOMContentLoaded", async () => {
    // Visa en snabb “laddar…”
    const root = document.getElementById("app");
    if (root) root.innerHTML = "Laddar…";

    try {
      // För statisk Pages: data.json ligger bredvid index.html
      const data = await loadJsonNoCache("./data.json");
      buildIndexes(data);
      renderApp();
    } catch (e) {
      if (root) {
        root.innerHTML = "";
        root.appendChild(
          el("div", { style: "padding:12px;border:1px solid #f00;border-radius:12px;" }, [
            el("div", { style: "font-weight:800;margin-bottom:6px;", textContent: "Kunde inte ladda data.json" }),
            el("div", { textContent: String(e?.message || e) }),
            el("div", { style: "margin-top:10px;font-size:13px;opacity:.85;" }, [
              el("span", { textContent: "Testa att öppna " }),
              el("a", { href: "./data.json?v=1", target: "_blank", rel: "noreferrer", textContent: "data.json" })
            ])
          ])
        );
      }
    }
  });
})();



