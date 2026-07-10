// Shared IST formatter — every timestamp in the DB is UTC (correct storage
// practice), but display must always be Asia/Kolkata regardless of the
// viewing device's own system timezone (a device with UTC/other system time
// was showing a 5:30-hour offset without this — the underlying data was
// always right, only display was wrong).
export const formatIST = (dateStr, opts = {}) =>
  dateStr
    ? new Date(dateStr).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...opts })
    : '—';
