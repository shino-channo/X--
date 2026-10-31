import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseICS, buildICS, addDays } from '../src/ical.js';

const AIRBNB = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN',
  'BEGIN:VEVENT', 'DTEND;VALUE=DATE:20261105', 'DTSTART;VALUE=DATE:20261102', 'UID:abc@airbnb.com',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HM\\n', ' XXXX',
  'SUMMARY:Reserved', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART:20261110T060000Z', 'DTEND:20261111T010000Z', 'UID:x', 'SUMMARY:Airbnb (Not available)', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261120', 'UID:noend', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261125', 'DTEND;VALUE=DATE:20261127', 'STATUS:CANCELLED', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parses all-day, UTC datetime, missing DTEND and skips cancelled', () => {
  const events = parseICS(AIRBNB);
  assert.deepEqual(events.map((e) => [e.start, e.end, e.summary]), [
    ['2026-11-02', '2026-11-05', 'Reserved'],
    ['2026-11-10', '2026-11-11', 'Airbnb (Not available)'], // UTC 06:00 → 日本時間 15:00
    ['2026-11-20', '2026-11-21', ''],
  ]);
});

test('UTC time converts to the JST date', () => {
  const [e] = parseICS('BEGIN:VEVENT\nDTSTART:20261231T160000Z\nDTEND:20270101T160000Z\nEND:VEVENT');
  assert.equal(e.start, '2027-01-01');
  assert.equal(e.end, '2027-01-02');
});

test('handles TZID with quoted colon', () => {
  const [e] = parseICS('BEGIN:VEVENT\nDTSTART;TZID="Asia/Tokyo:x":20261201T150000\nEND:VEVENT');
  assert.equal(e.start, '2026-12-01');
});

test('addDays crosses month and year', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('buildICS round-trips through parseICS', () => {
  const ics = buildICS([{ start: '2026-11-02', end: '2026-11-05' }], { now: 0 });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261102\r\n/);
  assert.deepEqual(parseICS(ics).map((e) => [e.start, e.end]), [['2026-11-02', '2026-11-05']]);
});
