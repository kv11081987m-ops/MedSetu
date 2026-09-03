// Every TIMESTAMP column in the schema is UTC (correct storage practice),
// but Postgres `timestamp without time zone` comes back from Supabase/
// PostgREST with NO 'Z'/offset suffix (e.g. "2026-08-10T14:23:00"). Per the
// JS Date Time String spec, `new Date()` treats a date-TIME string with no
// zone as LOCAL time, not UTC — so on a device whose own clock is already
// IST, the string gets misparsed as "14:23 IST" (wrong instant), and
// re-displaying that in Asia/Kolkata below just shows "14:23" again: the
// raw UTC digits, exactly 5:30 behind the true IST time. (A UTC-clock
// device happens to parse it correctly by coincidence — that's the case
// this file's IST-forcing was originally written for — but it doesn't
// help the IST-clock case, which is the normal one for real users.)
// Fix: force the correct UTC parse by appending 'Z' whenever the string
// has a time component but no zone of its own. Already-zoned strings and
// date-only strings (DATE columns, always parsed as UTC per spec) pass
// through untouched.
const HAS_TIME    = /[T ]\d{2}:\d{2}/;
const HAS_ZONE    = /[zZ]|[+-]\d{2}:?\d{2}$/;
// Exported so relative-time helpers (e.g. PharmacistPanel's getTimeAgo)
// can parse the SAME correct instant before doing a Date.now() diff —
// otherwise a no-zone timestamp is misparsed as local time and the
// elapsed-time comes out 5:30h wrong on an IST-clock device.
export const asUtcDate = (dateStr) =>
  new Date(HAS_TIME.test(dateStr) && !HAS_ZONE.test(dateStr) ? `${dateStr}Z` : dateStr);

export const formatIST = (dateStr, opts = {}) =>
  dateStr
    ? asUtcDate(dateStr).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...opts })
    : '—';
