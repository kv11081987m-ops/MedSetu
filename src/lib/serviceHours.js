import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// 083 (v2) — per-seller weekly hours live in the DB; the customer side only
// ever sees two safe RPCs: is_any_seller_open() (boolean) and
// next_service_open_time() (timestamptz). Before the migration is applied the
// RPCs error out: anySellerOpen stays null (= unknown → no banner, no
// schedule button), so shipping this ahead of the SQL is safe.

const TZ = 'Asia/Kolkata';
const WEEKDAYS = ['Ravivar', 'Somvar', 'Mangalvar', 'Budhvar', 'Guruvar', 'Shukravar', 'Shanivar'];

const istParts = (d) => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(new Date(d)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) % 24, minute: parseInt(p.minute, 10), dow };
};

// 9 -> 'subah 9 baje', 18:30 -> 'shaam 6:30 baje'
function timeWord(hour, minute) {
  const period = hour < 12 ? 'subah' : hour < 16 ? 'dopahar' : hour < 19 ? 'shaam' : 'raat';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${h12}${minute ? ':' + String(minute).padStart(2, '0') : ''} baje`;
}

// ISO timestamp -> 'aaj shaam 6 baje' / 'kal subah 9 baje' / 'Somvar subah 9 baje' (IST)
export function formatNextOpen(iso) {
  if (!iso) return '';
  const t = istParts(iso);
  const now = istParts(Date.now());
  const tomorrow = istParts(Date.now() + 24 * 3600 * 1000);
  const day = t.dateKey === now.dateKey ? 'aaj' : t.dateKey === tomorrow.dateKey ? 'kal' : WEEKDAYS[t.dow];
  return `${day} ${timeWord(t.hour, t.minute)}`;
}

export function useStoreAvailability() {
  const [state, setState] = useState({ anySellerOpen: null, nextOpen: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [openRes, nextRes] = await Promise.all([
        supabase.rpc('is_any_seller_open'),
        supabase.rpc('next_service_open_time'),
      ]);
      if (cancelled) return;
      setState({
        anySellerOpen: openRes.error ? null : openRes.data === true,
        nextOpen: nextRes.error ? null : (nextRes.data || null),
      });
    })();
    return () => { cancelled = true; };
  }, []);

  return { ...state, nextOpenLabel: formatNextOpen(state.nextOpen) };
}

// ── Seller side: weekly_hours helpers (SellerDashboard "Dukaan ke samay") ──
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABELS = { mon: 'Somvar', tue: 'Mangalvar', wed: 'Budhvar', thu: 'Guruvar', fri: 'Shukravar', sat: 'Shanivar', sun: 'Ravivar' };

// Same default as migration 083 (Mon-Sat 09:00-21:00, Sunday band).
export const DEFAULT_WEEKLY_HOURS = {
  mon: { open: '09:00', close: '21:00' }, tue: { open: '09:00', close: '21:00' },
  wed: { open: '09:00', close: '21:00' }, thu: { open: '09:00', close: '21:00' },
  fri: { open: '09:00', close: '21:00' }, sat: { open: '09:00', close: '21:00' },
  sun: null,
};

// <input type="time"> can yield 'HH:MM:SS'; DB CHECK wants strict 'HH:MM'.
export const normalizeHM = (v) => String(v || '').slice(0, 5);
