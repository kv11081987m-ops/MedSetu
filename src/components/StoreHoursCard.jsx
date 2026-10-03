import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DAY_KEYS, DAY_LABELS, DEFAULT_WEEKLY_HOURS, normalizeHM } from '../lib/serviceHours';

// SellerDashboard "Dukaan ke samay" — 7 days, per-day khula/band toggle and
// open/close time. Saves sellers.weekly_hours (083); times are always IST.
// sellers_update_owner_or_staff RLS already lets the owner write this column.
const cardStyle = {
  backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, margin: '0 0 14px',
  border: '1px solid rgba(12,68,124,0.12)',
};

const toForm = (hours) => {
  const src = hours && typeof hours === 'object' ? hours : DEFAULT_WEEKLY_HOURS;
  return DAY_KEYS.reduce((acc, k) => {
    const d = src[k];
    acc[k] = d && d.open && d.close
      ? { on: true, open: normalizeHM(d.open), close: normalizeHM(d.close) }
      : { on: false, open: '09:00', close: '21:00' };
    return acc;
  }, {});
};

// Compare key for dirty-state: a closed day's leftover open/close times are
// irrelevant (not saved), and toForm() already normalizes HH:MM:SS -> HH:MM.
const signature = (f) => JSON.stringify(
  DAY_KEYS.map((k) => (f[k].on ? [true, f[k].open, f[k].close] : [false])),
);

export default function StoreHoursCard({ seller, onSaved }) {
  const [form, setForm]             = useState(() => toForm(seller?.weekly_hours));
  const [savedHours, setSavedHours] = useState(() => toForm(seller?.weekly_hours));
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState('');

  // DB (via seller prop) se hours aaye to form aur savedHours dono reset
  useEffect(() => {
    const fromDb = toForm(seller?.weekly_hours);
    setForm(fromDb);
    setSavedHours(fromDb);
  }, [seller?.weekly_hours]);

  const dirty = signature(form) !== signature(savedHours);

  const setDay = (k, patch) => { setMsg(''); setForm((f) => ({ ...f, [k]: { ...f[k], ...patch } })); };

  const save = async () => {
    if (!seller?.id) return;
    for (const k of DAY_KEYS) {
      if (form[k].on && !(form[k].open < form[k].close)) {
        setMsg(`${DAY_LABELS[k]}: khulne ka samay band hone se pehle hona chahiye`);
        return;
      }
    }
    const weekly_hours = DAY_KEYS.reduce((acc, k) => {
      acc[k] = form[k].on ? { open: form[k].open, close: form[k].close } : null;
      return acc;
    }, {});
    const submitted = form; // snapshot — save ke dauran hue edits dirty hi rahenge
    setSaving(true);
    // .select() zaroori — RLS row filter kare to update 0 rows karta hai, error null.
    const { data, error } = await supabase
      .from('sellers').update({ weekly_hours }).eq('id', seller.id).select('id');
    setSaving(false);
    if (error || !data || data.length === 0) {
      setMsg('Save nahi hua, dobara try karein');
      return;
    }
    setSavedHours(submitted);
    setMsg('Samay save ho gaya ✓');
    onSaved?.(weekly_hours);
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Clock size={18} color="#1A6B3C" />
        <span style={{ fontSize: 15, fontWeight: 700, color: '#1A1A1A' }}>Dukaan ke samay</span>
      </div>
      <p style={{ fontSize: 12, color: '#888888', margin: '0 0 10px' }}>
        In samay ke bahar naye orders aapko nahi aayenge (India time). "Khuli Hai" switch alag se kaam karta hai.
      </p>

      {DAY_KEYS.map((k) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid #F0F0F0' }}>
          <span style={{ width: 82, fontSize: 13, fontWeight: 600, color: form[k].on ? '#1A1A1A' : '#999999' }}>{DAY_LABELS[k]}</span>
          <button
            type="button"
            onClick={() => setDay(k, { on: !form[k].on })}
            aria-label={`${DAY_LABELS[k]} ${form[k].on ? 'band karo' : 'khulo'}`}
            style={{
              border: 'none', borderRadius: 12, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              backgroundColor: form[k].on ? '#E8F5EE' : '#FFEBEE', color: form[k].on ? '#1A6B3C' : '#DC3545',
            }}
          >
            {form[k].on ? 'Khula' : 'Band'}
          </button>
          {form[k].on && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <input type="time" value={form[k].open} onChange={(e) => setDay(k, { open: normalizeHM(e.target.value) })}
                style={{ fontSize: 13, padding: 3, border: '1px solid #DDD', borderRadius: 6 }} />
              <span style={{ fontSize: 12, color: '#888' }}>–</span>
              <input type="time" value={form[k].close} onChange={(e) => setDay(k, { close: normalizeHM(e.target.value) })}
                style={{ fontSize: 13, padding: 3, border: '1px solid #DDD', borderRadius: 6 }} />
            </div>
          )}
        </div>
      ))}

      {msg && (
        <p style={{ fontSize: 12, margin: '8px 0 0', color: msg.includes('✓') ? '#1A6B3C' : '#C62828' }}>{msg}</p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        style={{
          marginTop: 10, width: '100%', border: 'none', borderRadius: 10, padding: '10px 0',
          backgroundColor: dirty ? '#1A6B3C' : '#E0E0E0',
          color: dirty ? '#FFFFFF' : '#888888',
          fontSize: 14, fontWeight: 700,
          cursor: saving || !dirty ? 'default' : 'pointer',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? 'Save ho raha hai...' : dirty ? 'Samay Save Karo' : 'Save ho chuka'}
      </button>
    </div>
  );
}
