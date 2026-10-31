import { parseICS, todayJST, addDays } from './ical.js';

export const CHANNELS = [
  { id: 'airbnb', name: 'Airbnb', env: 'ICAL_AIRBNB' },
  { id: 'booking', name: 'Booking.com', env: 'ICAL_BOOKING' },
  { id: 'agoda', name: 'Agoda', env: 'ICAL_AGODA' },
];
export const MANUAL = 'manual';

// 過去の予約は30日分だけ残す（画面表示用）
const KEEP_PAST_DAYS = 30;
const FETCH_TIMEOUT_MS = 15000;

export async function loadState(env) {
  return (await env.STORE.get('state', 'json')) || { sources: {}, notified: [] };
}

export async function loadBlocks(env) {
  return (await env.STORE.get('blocks', 'json')) || [];
}

export async function saveBlocks(env, blocks) {
  await env.STORE.put('blocks', JSON.stringify(blocks));
}

async function fetchChannel(ch, url, prev, fetchImpl, now) {
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'minpaku-sync/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('iCal形式ではない応答でした（URLを確認してください）');
    const cutoff = addDays(todayJST(now), -KEEP_PAST_DAYS);
    const events = parseICS(text)
      .filter((e) => e.end >= cutoff)
      .map((e) => ({ ...e, source: ch.id }));
    return { configured: true, events, lastSuccessAt: now, error: null };
  } catch (err) {
    // 取得失敗時は前回の予約を残す。消すと日付が空いてしまい、ダブルブッキングの原因になる
    return {
      configured: true,
      events: prev?.events || [],
      lastSuccessAt: prev?.lastSuccessAt || null,
      error: String(err?.message || err),
    };
  }
}

export function allEvents(state, blocks) {
  const events = [];
  for (const ch of CHANNELS) events.push(...(state.sources?.[ch.id]?.events || []));
  for (const b of blocks) events.push({ uid: b.id, start: b.start, end: b.end, summary: b.note || '手動ブロック', source: MANUAL });
  return events.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

// 違うサイト同士で日程が重なっている予約を探す。
// 予約サイト同士でまったく同じ日程のものは、同期で反映されたブロックの可能性が高いので echo として区別する
export function findOverlaps(events, today) {
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
        key: [a, b].map((e) => `${e.source}:${e.start}:${e.end}`).sort().join('|'),
        kind: echo ? 'echo' : 'conflict',
        a,
        b,
      });
    }
  }
  return out;
}

// 指定サイトに書き出す「埋まっている期間」。そのサイト自身の予約は除き、重なりはまとめる
export function blockedRangesFor(channelId, events, today) {
  const ranges = events
    .filter((e) => e.source !== channelId && e.end > today)
    .map((e) => ({ start: e.start, end: e.end }))
    .sort((a, b) => a.start.localeCompare(b.start));
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

async function notify(env, conflicts, fetchImpl) {
  if (!env.NTFY_TOPIC || conflicts.length === 0) return;
  const name = (id) => CHANNELS.find((c) => c.id === id)?.name || '手動ブロック';
  const body = conflicts
    .map((c) => `${c.a.start}〜${c.a.end} ${name(c.a.source)} と ${c.b.start}〜${c.b.end} ${name(c.b.source)}`)
    .join('\n');
  try {
    await fetchImpl(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, {
      method: 'POST',
      headers: { Title: 'Double booking warning', Priority: 'urgent', Tags: 'warning' },
      body: `ダブルブッキングの可能性があります\n${body}`,
    });
  } catch {
    // 通知の失敗で同期自体は止めない
  }
}

export async function runSync(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const [prev, blocks] = await Promise.all([loadState(env), loadBlocks(env)]);
  const results = await Promise.all(
    CHANNELS.map((ch) => {
      const url = env[ch.env];
      if (!url) return { configured: false, events: [], lastSuccessAt: null, error: null };
      return fetchChannel(ch, url, prev.sources?.[ch.id], fetchImpl, now);
    }),
  );
  const state = { sources: {}, lastSyncAt: now, notified: [] };
  CHANNELS.forEach((ch, i) => { state.sources[ch.id] = results[i]; });

  const conflicts = findOverlaps(allEvents(state, blocks), todayJST(now)).filter((o) => o.kind === 'conflict');
  const alreadyNotified = new Set(prev.notified || []);
  await notify(env, conflicts.filter((c) => !alreadyNotified.has(c.key)), fetchImpl);
  // 解消した重複は外す（再発したらまた通知する）
  state.notified = conflicts.map((c) => c.key);

  await env.STORE.put('state', JSON.stringify(state));
  return state;
}
