// iCal (RFC 5545) の最小限のパース・生成。予約サイトのカレンダー同期に必要な部分だけ扱う。

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function addDays(date, days) {
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function nightsBetween(start, end) {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS);
}

export function todayJST(now = Date.now()) {
  return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10);
}

// "20261101" / "20261101T150000Z" / "20261101T150000" → "2026-11-01"
function toDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(value.trim());
  if (!m) return null;
  if (m[7]) {
    // UTC 時刻は日本時間の日付に直す
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return todayJST(t);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function unescapeText(s) {
  return s.replace(/\\([\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

// 引用符内のコロンを無視して "名前;パラメータ:値" を分割する
function splitProperty(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) {
      return { name: line.slice(0, i).split(';')[0].toUpperCase(), value: line.slice(i + 1) };
    }
  }
  return null;
}

export function parseICS(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
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

function normalize(props) {
  if ((props.STATUS || '').toUpperCase() === 'CANCELLED') return null;
  const start = props.DTSTART && toDate(props.DTSTART);
  if (!start) return null;
  let end = props.DTEND && toDate(props.DTEND);
  // DTEND はチェックアウト日（その日は空き）。無い・おかしい場合は1泊とみなす
  if (!end || end <= start) end = addDays(start, 1);
  return {
    uid: props.UID || `${start}_${end}`,
    start,
    end,
    summary: unescapeText(props.SUMMARY || ''),
  };
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const compact = (d) => d.replaceAll('-', '');

// 書き出し用カレンダー。ゲスト情報は出さず「予約不可」だけを伝える
export function buildICS(ranges, { calName = 'minpaku-sync', now = Date.now() } = {}) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//minpaku-sync//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${calName}`,
  ];
  for (const r of ranges) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${hash(`${r.start}/${r.end}`)}-${compact(r.start)}@minpaku-sync`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(r.start)}`,
      `DTEND;VALUE=DATE:${compact(r.end)}`,
      'SUMMARY:Not available',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
