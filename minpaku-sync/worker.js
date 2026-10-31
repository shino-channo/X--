// このファイルは自動生成です（npm run build）。Cloudflare の管理画面に貼り付けて使います。編集は src/ で行ってください。
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/ical.js
var DAY_MS = 24 * 60 * 60 * 1e3;
var JST_OFFSET_MS = 9 * 60 * 60 * 1e3;
function addDays(date, days) {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}
__name(addDays, "addDays");
function nightsBetween(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS);
}
__name(nightsBetween, "nightsBetween");
function todayJST(now = Date.now()) {
  return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10);
}
__name(todayJST, "todayJST");
function toDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(value.trim());
  if (!m) return null;
  if (m[7]) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return todayJST(t);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}
__name(toDate, "toDate");
function unescapeText(s) {
  return s.replace(/\\([\;,nN])/g, (_, c) => c === "n" || c === "N" ? "\n" : c);
}
__name(unescapeText, "unescapeText");
function splitProperty(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) {
      return { name: line.slice(0, i).split(";")[0].toUpperCase(), value: line.slice(i + 1) };
    }
  }
  return null;
}
__name(splitProperty, "splitProperty");
function parseICS(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      const ev = cur && normalize(cur);
      if (ev) events.push(ev);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const prop = splitProperty(line);
    if (prop && !(prop.name in cur)) cur[prop.name] = prop.value;
  }
  return events;
}
__name(parseICS, "parseICS");
function normalize(props) {
  if ((props.STATUS || "").toUpperCase() === "CANCELLED") return null;
  const start = props.DTSTART && toDate(props.DTSTART);
  if (!start) return null;
  let end = props.DTEND && toDate(props.DTEND);
  if (!end || end <= start) end = addDays(start, 1);
  return {
    uid: props.UID || `${start}_${end}`,
    start,
    end,
    summary: unescapeText(props.SUMMARY || "")
  };
}
__name(normalize, "normalize");
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
__name(hash, "hash");
var compact = /* @__PURE__ */ __name((d) => d.replaceAll("-", ""), "compact");
function buildICS(ranges, { calName = "minpaku-sync", now = Date.now() } = {}) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//minpaku-sync//JP",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${calName}`
  ];
  for (const r of ranges) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${hash(`${r.start}/${r.end}`)}-${compact(r.start)}@minpaku-sync`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(r.start)}`,
      `DTEND;VALUE=DATE:${compact(r.end)}`,
      "SUMMARY:Not available",
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
__name(buildICS, "buildICS");

// src/sync.js
var CHANNELS = [
  { id: "airbnb", name: "Airbnb", env: "ICAL_AIRBNB" },
  { id: "booking", name: "Booking.com", env: "ICAL_BOOKING" },
  { id: "agoda", name: "Agoda", env: "ICAL_AGODA" }
];
var MANUAL = "manual";
var KEEP_PAST_DAYS = 30;
var FETCH_TIMEOUT_MS = 15e3;
async function loadState(env) {
  return await env.STORE.get("state", "json") || { sources: {}, notified: [] };
}
__name(loadState, "loadState");
async function loadBlocks(env) {
  return await env.STORE.get("blocks", "json") || [];
}
__name(loadBlocks, "loadBlocks");
async function saveBlocks(env, blocks) {
  await env.STORE.put("blocks", JSON.stringify(blocks));
}
__name(saveBlocks, "saveBlocks");
async function fetchChannel(ch, url, prev, fetchImpl, now) {
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "minpaku-sync/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("iCal\u5F62\u5F0F\u3067\u306F\u306A\u3044\u5FDC\u7B54\u3067\u3057\u305F\uFF08URL\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\uFF09");
    const cutoff = addDays(todayJST(now), -KEEP_PAST_DAYS);
    const events = parseICS(text).filter((e) => e.end >= cutoff).map((e) => ({ ...e, source: ch.id }));
    return { configured: true, events, lastSuccessAt: now, error: null };
  } catch (err) {
    return {
      configured: true,
      events: prev?.events || [],
      lastSuccessAt: prev?.lastSuccessAt || null,
      error: String(err?.message || err)
    };
  }
}
__name(fetchChannel, "fetchChannel");
function allEvents(state, blocks) {
  const events = [];
  for (const ch of CHANNELS) events.push(...state.sources?.[ch.id]?.events || []);
  for (const b of blocks) events.push({ uid: b.id, start: b.start, end: b.end, summary: b.note || "\u624B\u52D5\u30D6\u30ED\u30C3\u30AF", source: MANUAL });
  return events.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}
__name(allEvents, "allEvents");
function findOverlaps(events, today) {
  const out = [];
  const upcoming = events.filter((e) => e.end > today);
  for (let i = 0; i < upcoming.length; i++) {
    for (let j = i + 1; j < upcoming.length; j++) {
      const a = upcoming[i], b = upcoming[j];
      if (b.start >= a.end) break;
      if (a.source === b.source) continue;
      const sameDates = a.start === b.start && a.end === b.end;
      const echo = sameDates && a.source !== MANUAL && b.source !== MANUAL;
      out.push({
        key: [a, b].map((e) => `${e.source}:${e.start}:${e.end}`).sort().join("|"),
        kind: echo ? "echo" : "conflict",
        a,
        b
      });
    }
  }
  return out;
}
__name(findOverlaps, "findOverlaps");
function blockedRangesFor(channelId, events, today) {
  const ranges = events.filter((e) => e.source !== channelId && e.end > today).map((e) => ({ start: e.start, end: e.end })).sort((a, b) => a.start.localeCompare(b.start));
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}
__name(blockedRangesFor, "blockedRangesFor");
async function notify(env, conflicts, fetchImpl) {
  if (!env.NTFY_TOPIC || conflicts.length === 0) return;
  const name = /* @__PURE__ */ __name((id) => CHANNELS.find((c) => c.id === id)?.name || "\u624B\u52D5\u30D6\u30ED\u30C3\u30AF", "name");
  const body = conflicts.map((c) => `${c.a.start}\u301C${c.a.end} ${name(c.a.source)} \u3068 ${c.b.start}\u301C${c.b.end} ${name(c.b.source)}`).join("\n");
  try {
    await fetchImpl(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, {
      method: "POST",
      headers: { Title: "Double booking warning", Priority: "urgent", Tags: "warning" },
      body: `\u30C0\u30D6\u30EB\u30D6\u30C3\u30AD\u30F3\u30B0\u306E\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059
${body}`
    });
  } catch {
  }
}
__name(notify, "notify");
async function runSync(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const [prev, blocks] = await Promise.all([loadState(env), loadBlocks(env)]);
  const results = await Promise.all(
    CHANNELS.map((ch) => {
      const url = env[ch.env];
      if (!url) return { configured: false, events: [], lastSuccessAt: null, error: null };
      return fetchChannel(ch, url, prev.sources?.[ch.id], fetchImpl, now);
    })
  );
  const state = { sources: {}, lastSyncAt: now, notified: [] };
  CHANNELS.forEach((ch, i) => {
    state.sources[ch.id] = results[i];
  });
  const conflicts = findOverlaps(allEvents(state, blocks), todayJST(now)).filter((o) => o.kind === "conflict");
  const alreadyNotified = new Set(prev.notified || []);
  await notify(env, conflicts.filter((c) => !alreadyNotified.has(c.key)), fetchImpl);
  state.notified = conflicts.map((c) => c.key);
  await env.STORE.put("state", JSON.stringify(state));
  return state;
}
__name(runSync, "runSync");

// src/ui.js
var SOURCE_LABEL = Object.fromEntries([...CHANNELS.map((c) => [c.id, c.name]), [MANUAL, "\u624B\u52D5"]]);
var WEEKDAYS = ["\u65E5", "\u6708", "\u706B", "\u6C34", "\u6728", "\u91D1", "\u571F"];
var esc = /* @__PURE__ */ __name((s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]), "esc");
function fmtDate(d) {
  const [, m, day] = d.split("-");
  const w = WEEKDAYS[(/* @__PURE__ */ new Date(d + "T00:00:00Z")).getUTCDay()];
  return `${+m}/${+day}(${w})`;
}
__name(fmtDate, "fmtDate");
function fmtTime(ms) {
  if (!ms) return "\u2014";
  const d = new Date(ms + 9 * 3600 * 1e3).toISOString();
  return `${+d.slice(5, 7)}/${+d.slice(8, 10)} ${d.slice(11, 16)}`;
}
__name(fmtTime, "fmtTime");
var chip = /* @__PURE__ */ __name((source) => `<span class="chip s-${source}">${esc(SOURCE_LABEL[source] || source)}</span>`, "chip");
function renderMonth(year, month, events, today) {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (/* @__PURE__ */ new Date(first + "T00:00:00Z")).getUTCDay();
  let cells = '<div class="cell empty"></div>'.repeat(lead);
  for (let i = 0; i < days; i++) {
    const d = addDays(first, i);
    const stays = events.filter((e) => e.start <= d && d < e.end);
    const sources = [...new Set(stays.map((e) => e.source))];
    const cls = ["cell", d < today ? "past" : "", d === today ? "today" : "", sources.length > 1 ? "multi" : ""].join(" ");
    const bars = sources.map((s) => `<i class="bar s-${s}"></i>`).join("");
    const title = stays.map((e) => SOURCE_LABEL[e.source]).join(" / ");
    cells += `<div class="${cls}" title="${esc(title)}"><span>${i + 1}</span>${bars}</div>`;
  }
  return `<section class="month"><h3>${year}\u5E74${month}\u6708</h3>
    <div class="grid">${WEEKDAYS.map((w) => `<div class="wd">${w}</div>`).join("")}${cells}</div></section>`;
}
__name(renderMonth, "renderMonth");
function renderPage({ state, blocks, origin, token, now = Date.now(), flash = "" }) {
  const today = todayJST(now);
  const events = allEvents(state, blocks);
  const overlaps = findOverlaps(events, today);
  const conflicts = overlaps.filter((o) => o.kind === "conflict");
  const echoes = overlaps.filter((o) => o.kind === "echo");
  const upcoming = events.filter((e) => e.end > today);
  const conflictHtml = conflicts.length ? `<section class="alert"><h2>\u26A0 \u30C0\u30D6\u30EB\u30D6\u30C3\u30AD\u30F3\u30B0\u306E\u53EF\u80FD\u6027</h2><ul>${conflicts.map((c) => `<li>${chip(c.a.source)} ${fmtDate(c.a.start)}\u301C${fmtDate(c.a.end)}<br>${chip(c.b.source)} ${fmtDate(c.b.start)}\u301C${fmtDate(c.b.end)}</li>`).join("")}</ul><p>\u3069\u3061\u3089\u304B\u306E\u4E88\u7D04\u30B5\u30A4\u30C8\u3067\u4E88\u7D04\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3001\u30B2\u30B9\u30C8\u3078\u306E\u9023\u7D61\u3084\u30AD\u30E3\u30F3\u30BB\u30EB\u5BFE\u5FDC\u3092\u3057\u3066\u304F\u3060\u3055\u3044\u3002</p></section>` : `<section class="ok">\u2713 \u91CD\u8907\u3057\u3066\u3044\u308B\u4E88\u7D04\u306F\u3042\u308A\u307E\u305B\u3093</section>`;
  const syncRows = CHANNELS.map((ch) => {
    const s = state.sources?.[ch.id];
    let status;
    if (!s || !s.configured) status = '<span class="muted">\u672A\u8A2D\u5B9A</span>';
    else if (s.error) status = `<span class="err">\u53D6\u5F97\u5931\u6557: ${esc(s.error)}</span><br><span class="muted">\u524D\u56DE\u6210\u529F ${fmtTime(s.lastSuccessAt)}\uFF08\u524D\u56DE\u306E\u4E88\u7D04\u3092\u4FDD\u6301\u4E2D\uFF09</span>`;
    else status = `<span class="good">OK</span> <span class="muted">${fmtTime(s.lastSuccessAt)} \u30FB ${s.events.length}\u4EF6</span>`;
    return `<li>${chip(ch.id)} ${status}</li>`;
  }).join("");
  const list = upcoming.length ? upcoming.map((e) => {
    const isEcho = echoes.some((o) => o.a === e || o.b === e);
    const del = e.source === MANUAL ? `<form method="post" action="/blocks/delete"><input type="hidden" name="id" value="${esc(e.uid)}"><button class="link">\u524A\u9664</button></form>` : "";
    return `<li class="${isEcho ? "echo" : ""}"><div>${chip(e.source)} <b>${fmtDate(e.start)} \u2192 ${fmtDate(e.end)}</b> <span class="muted">${nightsBetween(e.start, e.end)}\u6CCA</span></div>
          <div class="sub">${esc(e.summary)}${isEcho ? ' <span class="muted">\uFF08\u4ED6\u30B5\u30A4\u30C8\u306E\u4E88\u7D04\u304C\u540C\u671F\u3067\u53CD\u6620\u3055\u308C\u305F\u3082\u306E\uFF09</span>' : ""}</div>${del}</li>`;
  }).join("") : '<li class="muted">\u4ECA\u5F8C\u306E\u4E88\u7D04\u306F\u307E\u3060\u3042\u308A\u307E\u305B\u3093</li>';
  const [y, m] = today.split("-").map(Number);
  const months = [0, 1, 2].map((k) => {
    const mm = (m - 1 + k) % 12 + 1;
    return renderMonth(y + Math.floor((m - 1 + k) / 12), mm, events, today);
  }).join("");
  const exportRows = CHANNELS.map((ch) => {
    const url = `${origin}/ical/${token}/${ch.id}.ics`;
    return `<li><div>${chip(ch.id)} \u306B\u53D6\u308A\u8FBC\u3080URL</div><div class="copy"><input readonly value="${esc(url)}"><button type="button" onclick="cp(this)">\u30B3\u30D4\u30FC</button></div></li>`;
  }).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f766e"><title>\u6C11\u6CCA\u4E88\u7D04\u30AB\u30EC\u30F3\u30C0\u30FC</title><style>${CSS}</style></head><body>
<header><h1>\u6C11\u6CCA\u4E88\u7D04\u30AB\u30EC\u30F3\u30C0\u30FC</h1><form method="post" action="/sync"><button>\u4ECA\u3059\u3050\u540C\u671F</button></form></header>
<main>
${flash ? `<p class="flash">${esc(flash)}</p>` : ""}
${conflictHtml}
<section><h2>\u540C\u671F\u306E\u72B6\u614B</h2><ul class="plain">${syncRows}</ul><p class="muted small">\u6700\u7D42\u540C\u671F ${fmtTime(state.lastSyncAt)}\uFF0810\u5206\u3054\u3068\u306B\u81EA\u52D5\u540C\u671F\uFF09</p></section>
<section><h2>\u30AB\u30EC\u30F3\u30C0\u30FC</h2><div class="legend">${[...CHANNELS.map((c) => c.id), MANUAL].map(chip).join(" ")}</div>${months}</section>
<section><h2>\u4ECA\u5F8C\u306E\u4E88\u7D04\u30FB\u30D6\u30ED\u30C3\u30AF</h2><ul class="list">${list}</ul></section>
<section><h2>\u65E5\u4ED8\u3092\u624B\u52D5\u3067\u30D6\u30ED\u30C3\u30AF</h2><p class="muted small">\u81EA\u5206\u3067\u4F7F\u3046\u65E5\u3084\u5DE5\u4E8B\u306E\u65E5\u306A\u3069\u3002\u5168\u30B5\u30A4\u30C8\u3067\u4E88\u7D04\u4E0D\u53EF\u306B\u306A\u308A\u307E\u3059\u3002</p>
<form method="post" action="/blocks" class="block-form">
<label>\u958B\u59CB\u65E5<input type="date" name="start" required min="${today}"></label>
<label>\u7D42\u4E86\u65E5\uFF08\u3053\u306E\u65E5\u306F\u7A7A\u304D\uFF09<input type="date" name="end" required min="${today}"></label>
<label>\u30E1\u30E2<input name="note" maxlength="50" placeholder="\u4F8B: \u6E05\u6383\u30FB\u70B9\u691C"></label>
<button>\u30D6\u30ED\u30C3\u30AF\u3059\u308B</button></form></section>
<section><h2>\u4E88\u7D04\u30B5\u30A4\u30C8\u306E\u8A2D\u5B9A</h2><p class="muted small">\u5404\u30B5\u30A4\u30C8\u306E\u300C\u30AB\u30EC\u30F3\u30C0\u30FC\u3092\u30A4\u30F3\u30DD\u30FC\u30C8\u300D\u306B\u3053\u306EURL\u3092\u767B\u9332\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u5404\u30B5\u30A4\u30C8\u306B\u306F<b>\u4ED6\u306E2\u30B5\u30A4\u30C8\u306E\u4E88\u7D04\u3068\u624B\u52D5\u30D6\u30ED\u30C3\u30AF</b>\u304C\u300C\u4E88\u7D04\u4E0D\u53EF\u300D\u3068\u3057\u3066\u5C4A\u304D\u307E\u3059\uFF08\u30B2\u30B9\u30C8\u60C5\u5831\u306F\u9001\u308A\u307E\u305B\u3093\uFF09\u3002</p>
<ul class="plain">${exportRows}</ul></section>
</main>
<script>function cp(b){const i=b.previousElementSibling;i.select();navigator.clipboard?.writeText(i.value);b.textContent='\u30B3\u30D4\u30FC\u6E08\u307F';setTimeout(()=>b.textContent='\u30B3\u30D4\u30FC',1500)}<\/script>
</body></html>`;
}
__name(renderPage, "renderPage");
var CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1f2937;--muted:#6b7280;--line:#e5e7eb;--accent:#0f766e;
--airbnb:#e0484e;--booking:#1d4ed8;--agoda:#7c3aed;--manual:#6b7280;--err:#b91c1c;--good:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--text:#e5e7eb;--muted:#9ca3af;--line:#2a2f37;
--airbnb:#f87171;--booking:#60a5fa;--agoda:#a78bfa;--manual:#9ca3af;--err:#f87171;--good:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}
header{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--accent);color:#fff}
header h1{font-size:17px;margin:0}header button{background:#fff;color:var(--accent)}
main{max-width:640px;margin:0 auto;padding:12px 16px 40px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:12px 0}
h2{font-size:16px;margin:0 0 8px}h3{font-size:14px;margin:12px 0 6px}
button{font:inherit;border:0;border-radius:8px;padding:8px 14px;background:var(--accent);color:#fff;font-weight:600}
button.link{background:none;color:var(--err);padding:4px 0;font-weight:400}
.alert{border:2px solid var(--err)}.alert h2{color:var(--err)}.alert li{margin:6px 0}
.ok{color:var(--good);font-weight:600}.flash{background:var(--card);border-left:4px solid var(--accent);padding:8px 12px;border-radius:6px}
.muted{color:var(--muted)}.small{font-size:13px}.err{color:var(--err)}.good{color:var(--good);font-weight:600}
ul{padding-left:18px;margin:0}.plain,.list{list-style:none;padding:0}.plain li{padding:8px 0;border-bottom:1px solid var(--line)}
.list li{padding:10px 0;border-bottom:1px solid var(--line)}.list li:last-child,.plain li:last-child{border-bottom:0}
.list li.echo{opacity:.6}.sub{font-size:13px;color:var(--muted);margin-top:2px}
.chip{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;color:#fff;vertical-align:1px}
.s-airbnb{background:var(--airbnb)}.s-booking{background:var(--booking)}.s-agoda{background:var(--agoda)}.s-manual{background:var(--manual)}
.legend{display:flex;gap:6px;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.wd{text-align:center;font-size:12px;color:var(--muted)}
.cell{position:relative;min-height:42px;border-radius:6px;background:var(--bg);padding:3px;font-size:12px;display:flex;flex-direction:column;gap:2px}
.cell.empty{background:none}.cell.past{opacity:.45}.cell.today{outline:2px solid var(--accent)}
.cell.multi{outline:2px solid var(--err)}.bar{display:block;height:6px;border-radius:3px}
.block-form{display:grid;gap:10px}.block-form label{display:grid;gap:4px;font-size:13px;color:var(--muted)}
input{font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);width:100%}
.copy{display:flex;gap:6px;margin-top:4px}.copy input{font-size:12px;min-width:0}.copy button{white-space:nowrap}
`;

// src/index.js
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(safeEqual, "safeEqual");
function authorized(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice(6));
    return safeEqual(decoded.slice(decoded.indexOf(":") + 1), env.ADMIN_PASSWORD);
  } catch {
    return false;
  }
}
__name(authorized, "authorized");
var redirect = /* @__PURE__ */ __name((msg) => new Response(null, { status: 303, headers: { Location: msg ? `/?msg=${encodeURIComponent(msg)}` : "/" } }), "redirect");
var isDate = /* @__PURE__ */ __name((s) => /^\d{4}-\d{2}-\d{2}$/.test(s || ""), "isDate");
async function handleExport(env, channel, token) {
  if (!safeEqual(token, env.EXPORT_TOKEN) || !CHANNELS.some((c) => c.id === channel)) {
    return new Response("Not found", { status: 404 });
  }
  const [state, blocks] = await Promise.all([loadState(env), loadBlocks(env)]);
  const ranges = blockedRangesFor(channel, allEvents(state, blocks), todayJST());
  return new Response(buildICS(ranges, { calName: `minpaku-sync for ${channel}` }), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" }
  });
}
__name(handleExport, "handleExport");
async function handleAdmin(request, env, url) {
  if (request.method === "POST") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/sync") {
      await runSync(env);
      return redirect("\u540C\u671F\u3057\u307E\u3057\u305F");
    }
    if (url.pathname === "/blocks") {
      const form = await request.formData();
      const start = form.get("start"), end = form.get("end");
      if (!isDate(start) || !isDate(end) || end <= start) return redirect("\u7D42\u4E86\u65E5\u306F\u958B\u59CB\u65E5\u3088\u308A\u5F8C\u306B\u3057\u3066\u304F\u3060\u3055\u3044");
      const blocks2 = await loadBlocks(env);
      blocks2.push({ id: crypto.randomUUID(), start, end, note: String(form.get("note") || "").slice(0, 50) });
      await saveBlocks(env, blocks2);
      return redirect("\u30D6\u30ED\u30C3\u30AF\u3057\u307E\u3057\u305F\uFF08\u5404\u30B5\u30A4\u30C8\u3078\u306E\u53CD\u6620\u306B\u306F\u6570\u6642\u9593\u304B\u304B\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\uFF09");
    }
    if (url.pathname === "/blocks/delete") {
      const form = await request.formData();
      const blocks2 = await loadBlocks(env);
      await saveBlocks(env, blocks2.filter((b) => b.id !== form.get("id")));
      return redirect("\u30D6\u30ED\u30C3\u30AF\u3092\u524A\u9664\u3057\u307E\u3057\u305F");
    }
    return new Response("Not found", { status: 404 });
  }
  if (url.pathname !== "/") return new Response("Not found", { status: 404 });
  const [state, blocks] = await Promise.all([loadState(env), loadBlocks(env)]);
  const html = renderPage({ state, blocks, origin: url.origin, token: env.EXPORT_TOKEN, flash: url.searchParams.get("msg") || "" });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
__name(handleAdmin, "handleAdmin");
var index_default = {
  async fetch(request, env) {
    if (!env.ADMIN_PASSWORD || !env.EXPORT_TOKEN) {
      return new Response("ADMIN_PASSWORD \u3068 EXPORT_TOKEN \u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\uFF08README\u53C2\u7167\uFF09", { status: 500 });
    }
    const url = new URL(request.url);
    const m = /^\/ical\/([^/]+)\/([a-z]+)\.ics$/.exec(url.pathname);
    if (m && request.method === "GET") return handleExport(env, m[2], m[1]);
    if (!authorized(request, env)) {
      return new Response("\u30ED\u30B0\u30A4\u30F3\u304C\u5FC5\u8981\u3067\u3059", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="minpaku-sync", charset="UTF-8"' }
      });
    }
    return handleAdmin(request, env, url);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runSync(env));
  }
};
export {
  index_default as default
};
