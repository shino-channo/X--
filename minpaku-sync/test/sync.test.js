import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSync, findOverlaps, blockedRangesFor, allEvents } from '../src/sync.js';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const TODAY = '2026-11-01';

function memoryKV(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(k, type) { const v = data[k]; return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { data[k] = v; },
  };
}

const cal = (...events) =>
  ['BEGIN:VCALENDAR', ...events.flatMap(([s, e]) => ['BEGIN:VEVENT', `DTSTART;VALUE=DATE:${s}`, `DTEND;VALUE=DATE:${e}`, 'SUMMARY:Reserved', 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

function fakeFetch(responses, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const r = responses[url];
    if (r instanceof Error) throw r;
    if (r === undefined) return new Response('', { status: 200 });
    return new Response(r.body ?? r, { status: r.status ?? 200 });
  };
}

const env = (store, extra = {}) => ({
  STORE: store, ICAL_AIRBNB: 'https://a', ICAL_BOOKING: 'https://b', ICAL_AGODA: 'https://c', ...extra,
});

test('export to each channel excludes its own bookings and merges overlaps', async () => {
  const store = memoryKV();
  const state = await runSync(env(store), {
    now: NOW,
    fetchImpl: fakeFetch({ 'https://a': cal(['20261102', '20261105']), 'https://b': cal(['20261105', '20261107']), 'https://c': cal() }),
  });
  const events = allEvents(state, [{ id: 'm', start: '2026-11-20', end: '2026-11-22' }]);
  assert.deepEqual(blockedRangesFor('agoda', events, TODAY), [
    { start: '2026-11-02', end: '2026-11-07' },
    { start: '2026-11-20', end: '2026-11-22' },
  ]);
  assert.deepEqual(blockedRangesFor('airbnb', events, TODAY), [
    { start: '2026-11-05', end: '2026-11-07' },
    { start: '2026-11-20', end: '2026-11-22' },
  ]);
});

test('keeps previous bookings when a calendar fails to load', async () => {
  const store = memoryKV();
  await runSync(env(store), { now: NOW, fetchImpl: fakeFetch({ 'https://a': cal(['20261102', '20261105']) }) });
  const state = await runSync(env(store), { now: NOW + 600000, fetchImpl: fakeFetch({ 'https://a': { status: 503, body: 'down' } }) });
  assert.equal(state.sources.airbnb.events.length, 1);
  assert.equal(state.sources.airbnb.error, 'HTTP 503');
  assert.equal(state.sources.airbnb.lastSuccessAt, NOW);

  const html = await runSync(env(store), { now: NOW, fetchImpl: fakeFetch({ 'https://a': '<html>login</html>' }) });
  assert.equal(html.sources.airbnb.events.length, 1);
  assert.match(html.sources.airbnb.error, /iCal/);
});

test('checkout day = next check-in is not a conflict; real overlap is; identical dates are an echo', () => {
  const ev = (source, start, end) => ({ source, start, end });
  const overlaps = findOverlaps(allEvents({ sources: {
    airbnb: { events: [ev('airbnb', '2026-11-02', '2026-11-05'), ev('airbnb', '2026-11-10', '2026-11-12')] },
    booking: { events: [ev('booking', '2026-11-05', '2026-11-07'), ev('booking', '2026-11-11', '2026-11-13')] },
    agoda: { events: [ev('agoda', '2026-11-05', '2026-11-07')] },
  } }, []), TODAY);
  assert.deepEqual(overlaps.map((o) => [o.kind, o.a.start, o.b.start]), [
    ['echo', '2026-11-05', '2026-11-05'],
    ['conflict', '2026-11-10', '2026-11-11'],
  ]);
});

test('notifies new conflicts once via ntfy', async () => {
  const store = memoryKV();
  const responses = { 'https://a': cal(['20261102', '20261105']), 'https://b': cal(['20261104', '20261106']) };
  const calls = [];
  const e = env(store, { NTFY_TOPIC: 'my-topic' });
  await runSync(e, { now: NOW, fetchImpl: fakeFetch(responses, calls) });
  await runSync(e, { now: NOW, fetchImpl: fakeFetch(responses, calls) });
  const posts = calls.filter((c) => c.url.startsWith('https://ntfy.sh/'));
  assert.equal(posts.length, 1);
  assert.match(posts[0].init.body, /2026-11-02〜2026-11-05 Airbnb と 2026-11-04〜2026-11-06 Booking.com/);
});
