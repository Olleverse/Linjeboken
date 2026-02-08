// =========================
// Linjebok + sträcka i hastighets-PDF
// - Autosuggest
// - Admin bakom PIN
// - Förhandsgranska innan spara
// - Backup/Ångra
// - Återställ standarddata
//
// Viktigt: admin-data sparas i localStorage och påverkar bara den som redigerar.
// =========================

const LS_KEY = "lokapp_dataset_v2";
const LS_BACKUP_KEY = "lokapp_dataset_v2_backup";

let DEFAULT_DATA = null;
let ACTIVE_DATA = null;

// ---------- Helpers ----------
function normalize(s) {
  return (s || "").toLowerCase().trim();
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setMsg(elId, msg) {
  const el = document.getElementById(elId);
  if (el) el.innerHTML = msg || "";
}

function ok(msg) { return `<span class="ok">✅ ${escapeHtml(msg)}</span>`; }
function warn(msg) { return `<span class="warn">⚠️ ${escapeHtml(msg)}</span>`; }
function bad(msg) { return `<span class="bad">⛔ ${escapeHtml(msg)}</span>`; }

// ---------- Load data ----------
async function loadDefaultData() {
  if (DEFAULT_DATA) return DEFAULT_DATA;
  const res = await fetch("data.json");
  DEFAULT_DATA = await res.json();
  return DEFAULT_DATA;
}

function loadLocalData() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch { return null; }
}

function saveLocalData(dataset) {
  localStorage.setItem(LS_KEY, JSON.stringify(dataset));
}

function saveBackup(dataset) {
  localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(dataset));
}

function loadBackup() {
  const raw = localStorage.getItem(LS_BACKUP_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch { return null; }
}

async function getActiveData() {
  if (ACTIVE_DATA) return ACTIVE_DATA;

  const def = await loadDefaultData();
  const local = loadLocalData();

  ACTIVE_DATA = local || def;
  buildAutoSuggest(ACTIVE_DATA);

  return ACTIVE_DATA;
}

// ---------- Autosuggest ----------
function buildAutoSuggest(data) {
  const list = document.getElementById("dpList");
  if (!list) return;
  list.innerHTML = "";

  const dps = data?.driftplatser || [];
  for (const dp of dps) {
    const opt = document.createElement("option");
    opt.value = `${dp.name} (${dp.code})`;
    list.appendChild(opt);

    const opt2 = document.createElement("option");
    opt2.value = dp.code;
    list.appendChild(opt2);
  }
}

function parseDriftplats(input, driftsplatser) {
  if (!input) return null;

  // "Namn (CODE)"
  const m = input.match(/\(([^)]+)\)\s*$/);
  if (m) {
    const code = normalize(m[1]);
    const dp = driftsplatser.find(d => normalize(d.code) === code);
    if (dp) return dp;
  }

  const q = normalize(input);

  // Exakt kod
  let dp = driftsplatser.find(d => normalize(d.code) === q);
  if (dp) return dp;

  // Exakt namn
  dp = driftsplatser.find(d => normalize(d.name) === q);
  if (dp) return dp;

  // Contains
  dp = driftsplatser.find(d => normalize(d.name).includes(q));
  if (dp) return dp;

  return null;
}

// ---------- Core matching logic ----------
function getIndexMap(orderedCodes) {
  const idx = new Map();
  orderedCodes.forEach((c, i) => idx.set(c, i));
  return idx;
}

function overlapsInterval(aMin, aMax, bMin, bMax) {
  return !(bMax < aMin || bMin > aMax);
}

// Start/slut -> vilka tabell-sträckor som överlappar resan
function matchHastighetsStrackor(orderedCodes, hastighetsStrackor, startCode, endCode) {
  const idx = getIndexMap(orderedCodes);
  const a = idx.get(startCode);
  const b = idx.get(endCode);
  if (a === undefined || b === undefined) return [];

  const tripMin = Math.min(a, b);
  const tripMax = Math.max(a, b);

  const used = [];
  for (const hs of (hastighetsStrackor || [])) {
    const s = idx.get(hs.start);
    const t = idx.get(hs.end);
    if (s === undefined || t === undefined) continue;

    const secMin = Math.min(s, t);
    const secMax = Math.max(s, t);

    if (overlapsInterval(tripMin, tripMax, secMin, secMax)) used.push(hs);
  }

  // sortera i ordning längs banan
  used.sort((x, y) => {
    const xi = Math.min(idx.get(x.start), idx.get(x.end));
    const yi = Math.min(idx.get(y.start), idx.get(y.end));
    return xi - yi;
  });

  // dedupe
  const seen = new Set();
  return used.filter(u => (seen.has(u.id) ? false : (seen.add(u.id), true)));
}

function renderOutput({ start, end, linjebok, usedStrackor }) {
  const out = document.getElementById("output");

  const strackorHtml = usedStrackor.length
    ? usedStrackor.map(s => `<div class="line"><strong>${escapeHtml(s.name)}</strong></div>`).join("")
    : `<div class="line">${warn("Ingen träff på sträckor i hastighets-PDF.")}<div class="muted">Kontrollera att sträckorna är inlagda och att start/slut finns i driftplatsordningen.</div></div>`;

  out.innerHTML = `
    <div class="line">
      <div><strong>${escapeHtml(start.name)} (${escapeHtml(start.code)})</strong> → <strong>${escapeHtml(end.name)} (${escapeHtml(end.code)})</strong></div>
    </div>

    <div class="line">
      <div><strong>1) Linjebok</strong></div>
      <div>${escapeHtml(linjebok.id)}: ${escapeHtml(linjebok.name)}</div>
    </div>

    <div>
      <div><strong>2) Sträcka i hastighets-PDF</strong></div>
      ${strackorHtml}
    </div>
  `;
}

async function searchRoute() {
  const data = await getActiveData();

  const startInput = document.getElementById("start").value;
  const endInput = document.getElementById("slut").value;

  const dps = data.driftplatser || [];
  const start = parseDriftplats(startInput, dps);
  const end = parseDriftplats(endInput, dps);

  if (!start || !end) {
    setMsg("output", `${bad("Kunde inte hitta start/slut.")}<div class="muted">Välj från listan eller skriv driftplatskod.</div>`);
    return;
  }

  const orderedCodes = (data.ordning || []).slice();
  const idx = getIndexMap(orderedCodes);

  if (!idx.has(start.code) || !idx.has(end.code)) {
    setMsg("output", `${bad("Start/slut finns inte i driftplatsordningen.")}<div class="muted">Öppna Admin och kontrollera att båda finns med.</div>`);
    return;
  }

  const used = matchHastighetsStrackor(
    orderedCodes,
    data.hastighetsStrackor || [],
    start.code,
    end.code
  );

  renderOutput({
    start,
    end,
    linjebok: data.linjebok,
    usedStrackor: used
  });
}

// ---------- Admin UI + Safety ----------
function showAdmin() {
  const el = document.getElementById("admin");
  if (!el) return;
  el.style.display = "block";
  hydrateAdminFromData();
  hidePreview();
  setMsg("adminMsg", "");
}

function hideAdmin() {
  const el = document.getElementById("admin");
  if (!el) return;
  el.style.display = "none";
  hidePreview();
  setMsg("adminMsg", "");
}

function hidePreview() {
  const box = document.getElementById("previewBox");
  if (box) box.style.display = "none";
}

function showPreview(html) {
  const box = document.getElementById("previewBox");
  const content = document.getElementById("previewContent");
  if (content) content.innerHTML = html;
  if (box) box.style.display = "block";
}

function parseDpLines(text) {
  const lines = (text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const driftplatser = [];
  const ordning = [];

  for (const line of lines) {
    const parts = line.split(";");
    if (parts.length < 2) continue;

    const code = parts[0].trim();
    const name = parts.slice(1).join(";").trim();
    if (!code || !name) continue;

    driftplatser.push({ code, name });
    ordning.push(code);
  }
  return { driftplatser, ordning };
}

function parseHsLines(text) {
  const lines = (text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const hastighetsStrackor = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split("|").map(x => x.trim());
    if (parts.length < 3) continue;

    const name = parts[0];
    const start = parts[1];
    const end = parts[2];
    if (!name || !start || !end) continue;

    hastighetsStrackor.push({
      id: `HS_${i + 1}_${start}_${end}`,
      name,
      start,
      end
    });
  }
  return hastighetsStrackor;
}

function validateDataset(dataset) {
  const issues = [];

  if (!dataset.linjebok?.id || !dataset.linjebok?.name) {
    issues.push("Linjebok ID och namn måste vara ifyllda.");
  }

  if (!Array.isArray(dataset.driftplatser) || dataset.driftplatser.length < 2) {
    issues.push("Du behöver minst 2 driftplatser.");
  }

  if (!Array.isArray(dataset.ordning) || dataset.ordning.length < 2) {
    issues.push("Driftplatsordningen saknas eller är för kort.");
  }

  // Dubletter i ordning
  const seen = new Set();
  const dups = [];
  for (const c of (dataset.ordning || [])) {
    if (seen.has(c)) dups.push(c);
    seen.add(c);
  }
  if (dups.length) issues.push(`Dubletter i driftplatsordningen: ${[...new Set(dups)].join(", ")}`);

  // driftplatser: kodunik
  const codes = dataset.driftplatser.map(d => d.code);
  const codeSeen = new Set();
  const codeDups = [];
  for (const c of codes) {
    if (codeSeen.has(c)) codeDups.push(c);
    codeSeen.add(c);
  }
  if (codeDups.length) issues.push(`Dubletter i driftplatslistan: ${[...new Set(codeDups)].join(", ")}`);

  // HS-koder finns i ordning
  const ordSet = new Set(dataset.ordning || []);
  const hsBad = (dataset.hastighetsStrackor || []).filter(h => !ordSet.has(h.start) || !ordSet.has(h.end));
  if (hsBad.length) issues.push("Några hastighetssträckor använder koder som inte finns i driftplatsordningen.");

  // HS intervall rimliga (start!=end)
  const hsWeird = (dataset.hastighetsStrackor || []).filter(h => h.start === h.end);
  if (hsWeird.length) issues.push("Några hastighetssträckor har samma START och SLUT.");

  return issues;
}

async function hydrateAdminFromData() {
  const data = await getActiveData();

  document.getElementById("lbId").value = data.linjebok?.id || "";
  document.getElementById("lbName").value = data.linjebok?.name || "";

  // driftplatser i ordning
  const codeToName = new Map((data.driftplatser || []).map(d => [d.code, d.name]));
  const dpLines = (data.ordning || []).map(code => `${code};${codeToName.get(code) || ""}`).join("\n");
  document.getElementById("dpText").value = dpLines;

  // hastighetssträckor
  const hsLines = (data.hastighetsStrackor || []).map(h => `${h.name}|${h.start}|${h.end}`).join("\n");
  document.getElementById("hsText").value = hsLines;

  setMsg("adminMsg", "");
}

async function requestAdmin() {
  const def = await loadDefaultData();
  const pinExpected = (def.adminPin || "").toString().trim();

  const pin = prompt("Adminkod:");
  if (!pin) return;

  if (pinExpected && pin.trim() !== pinExpected) {
    alert("Fel kod.");
    return;
  }

  showAdmin();
}

function buildDatasetFromAdminFields() {
  const lbId = document.getElementById("lbId").value.trim();
  const lbName = document.getElementById("lbName").value.trim();
  const dpText = document.getElementById("dpText").value;
  const hsText = document.getElementById("hsText").value;

  const { driftplatser, ordning } = parseDpLines(dpText);
  const hastighetsStrackor = parseHsLines(hsText);

  return {
    // adminPin ligger bara i default data.json (inte i localStorage)
    linjebok: { id: lbId, name: lbName },
    driftplatser,
    ordning,
    hastighetsStrackor
  };
}

function previewAdmin() {
  const dataset = buildDatasetFromAdminFields();
  const issues = validateDataset(dataset);

  const dpCount = dataset.driftplatser?.length || 0;
  const hsCount = dataset.hastighetsStrackor?.length || 0;

  const head = `
    <div>${issues.length ? warn("Det finns varningar innan du sparar.") : ok("Ser bra ut.")}</div>
    <div class="muted" style="margin-top:6px;">
      Driftplatser: <strong>${dpCount}</strong><br>
      Sträckor (hastighets-PDF): <strong>${hsCount}</strong>
    </div>
  `;

  const issueHtml = issues.length
    ? `<div style="margin-top:8px;">${issues.map(i => `<div>• ${escapeHtml(i)}</div>`).join("")}</div>`
    : "";

  // Visa första 10 DP + första 10 sträckor som snabb sanity check
  const dpPreview = (dataset.driftplatser || []).slice(0, 10)
    .map(d => `${escapeHtml(d.code)} – ${escapeHtml(d.name)}`).join("<br>");

  const hsPreview = (dataset.hastighetsStrackor || []).slice(0, 10)
    .map(h => `${escapeHtml(h.name)} (${escapeHtml(h.start)}→${escapeHtml(h.end)})`).join("<br>");

  const body = `
    ${head}
    ${issueHtml}
    <div class="divider"></div>
    <div><strong>Första driftplatserna</strong></div>
    <div class="muted" style="margin-top:6px;">${dpPreview || "—"}</div>
    <div class="divider"></div>
    <div><strong>Första sträckorna</strong></div>
    <div class="muted" style="margin-top:6px;">${hsPreview || "—"}</div>
  `;

  showPreview(body);

  // Om det finns hårda fel? Vi stoppar inte spar, men varnar tydligt.
  setMsg("adminMsg", issues.length ? warn("Förhandsgranskning visar varningar. Du kan ändå spara, men dubbelkolla.") : ok("Förhandsgranskning OK."));
}

async function saveAdmin() {
  const dataset = buildDatasetFromAdminFields();
  const issues = validateDataset(dataset);

  // Spara backup av nuvarande local (om finns), annars av default
  const currentLocal = loadLocalData();
  if (currentLocal) saveBackup(currentLocal);
  else saveBackup(await loadDefaultData());

  // Spara ny local
  saveLocalData(dataset);
  ACTIVE_DATA = dataset;
  buildAutoSuggest(ACTIVE_DATA);

  if (issues.length) {
    setMsg("adminMsg", warn("Sparat, men med varningar. Förhandsgranska och rätta om något blev fel."));
  } else {
    setMsg("adminMsg", ok("Sparat! Du kan stänga och söka direkt."));
  }

  setMsg("output", ok("Dataset sparat lokalt. Gör en sökning ovan för att testa."));
}

async function undoLastSave() {
  const backup = loadBackup();
  if (!backup) {
    setMsg("output", warn("Ingen backup hittades att ångra till."));
    return;
  }

  // Lägg nuvarande local som ny backup (så man kan ångra ångra)
  const currentLocal = loadLocalData();
  if (currentLocal) saveBackup(currentLocal);

  saveLocalData(backup);
  ACTIVE_DATA = backup;
  buildAutoSuggest(ACTIVE_DATA);
  setMsg("output", ok("Ångrat till föregående dataset (lokalt). Testa en sökning."));
}

async function resetToDefault() {
  localStorage.removeItem(LS_KEY);
  // behåll backup (så du kan ångra reset om du vill)
  ACTIVE_DATA = await loadDefaultData();
  buildAutoSuggest(ACTIVE_DATA);
  hideAdmin();
  setMsg("output", ok("Återställt till standarddata (från data.json)."));
}

// Exponera funktioner till HTML
window.searchRoute = searchRoute;
window.requestAdmin = requestAdmin;
window.hideAdmin = hideAdmin;
window.previewAdmin = previewAdmin;
window.saveAdmin = saveAdmin;
window.undoLastSave = undoLastSave;
window.resetToDefault = resetToDefault;

// Init
getActiveData();


