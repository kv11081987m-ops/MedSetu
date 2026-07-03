import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { searchMasterMedicines } from '../lib/inventory';

// Shared by SuperAdminPanel.jsx and AdminPanel.jsx (the latter only when
// commission approval delegation is on) — self-contained, fetches its own
// data, styled to match SuperAdminPanel's tokens since that's its primary home.

const BAND_OPTIONS = [
  { value: 'high',     label: 'High' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'low',      label: 'Low' },
];
const BAND_LABEL = { high: 'High', moderate: 'Moderate', low: 'Low' };
const BAND_COLOR = { high: '#DC2626', moderate: '#D97706', low: '#059669' };

export default function MedicineBandsTab() {
  const [categoryStats, setCategoryStats] = useState([]);
  const [loadingStats,  setLoadingStats]  = useState(true);
  const [categoryBandPick, setCategoryBandPick] = useState({}); // { [category]: 'high'|'moderate'|'low' }
  const [applying, setApplying] = useState(null); // category currently being applied

  const [query,         setQuery]         = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching,     setSearching]     = useState(false);

  const loadStats = async () => {
    setLoadingStats(true);
    const { data, error } = await supabase.rpc('get_category_band_stats');
    if (error) { console.error('get_category_band_stats error:', error); setLoadingStats(false); return; }
    setCategoryStats(data || []);
    setLoadingStats(false);
  };

  useEffect(() => { loadStats(); }, []);

  // Search debounce — same 300ms pattern as InventoryManagement.jsx's SearchModal.
  useEffect(() => {
    if (query.trim().length < 2) { setSearchResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchMasterMedicines(query.trim());
      if (!cancelled) { setSearchResults(results); setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const totals = categoryStats.reduce((acc, c) => ({
    total:      acc.total      + Number(c.total_count      || 0),
    classified: acc.classified + Number(c.classified_count || 0),
    high:       acc.high       + Number(c.high_count       || 0),
    moderate:   acc.moderate   + Number(c.moderate_count   || 0),
    low:        acc.low        + Number(c.low_count        || 0),
  }), { total: 0, classified: 0, high: 0, moderate: 0, low: 0 });

  const applyCategoryBand = async (row) => {
    const band = categoryBandPick[row.category];
    if (!band) { alert('Pehle band select karo'); return; }
    const confirmed = window.confirm(
      `"${row.category}" ki ${Number(row.total_count).toLocaleString('en-IN')} medicines ko ${BAND_LABEL[band]} band milega — pakka?`
    );
    if (!confirmed) return;

    setApplying(row.category);
    try {
      // Single UPDATE for the whole category — no row-by-row loop, safe at
      // 2.5 lakh+ rows since Postgres does the matching server-side.
      let q = supabase.from('master_medicines').update({ commission_band: band });
      q = row.category === 'Uncategorized' ? q.is('category', null) : q.eq('category', row.category);
      const { error } = await q;
      if (error) throw error;
      await loadStats();
    } catch (err) {
      alert('Apply nahi hua: ' + err.message);
    } finally {
      setApplying(null);
    }
  };

  const updateMedicineBand = async (medId, band) => {
    const { error } = await supabase.from('master_medicines').update({ commission_band: band || null }).eq('id', medId);
    if (error) { alert('Update nahi hua: ' + error.message); return; }
    setSearchResults((prev) => prev.map((m) => m.id === medId ? { ...m, commission_band: band || null } : m));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <p style={s.sectionTitle}>Medicine Commission Bands</p>

      {/* ── Progress counter ── */}
      <div style={s.formCard}>
        <p style={{ fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 8px' }}>
          {totals.classified.toLocaleString('en-IN')} / {totals.total.toLocaleString('en-IN')} classified
        </p>
        <div style={{ height: '8px', borderRadius: '4px', backgroundColor: '#F0F0F0', overflow: 'hidden', marginBottom: '12px' }}>
          <div style={{ height: '100%', width: `${totals.total ? (totals.classified / totals.total) * 100 : 0}%`, backgroundColor: '#1A6B3C', transition: 'width 0.3s ease' }} />
        </div>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', fontWeight: '700', color: BAND_COLOR.high }}>🔴 High: {totals.high.toLocaleString('en-IN')}</span>
          <span style={{ fontSize: '12px', fontWeight: '700', color: BAND_COLOR.moderate }}>🟡 Moderate: {totals.moderate.toLocaleString('en-IN')}</span>
          <span style={{ fontSize: '12px', fontWeight: '700', color: BAND_COLOR.low }}>🟢 Low: {totals.low.toLocaleString('en-IN')}</span>
        </div>
      </div>

      {/* ── Category-wise bulk assign ── */}
      <div>
        <p style={{ fontSize: '13px', fontWeight: '700', color: '#444', margin: '0 0 8px' }}>Category-wise Bulk Assign</p>
        {loadingStats ? (
          <p style={s.emptyText}>Load ho raha hai...</p>
        ) : categoryStats.length === 0 ? (
          <p style={s.emptyText}>Koi category nahi mili</p>
        ) : (
          categoryStats.map((row) => (
            <div key={row.category} style={{ ...s.regCard, marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
                <p style={{ fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0 }}>{row.category}</p>
                <p style={{ fontSize: '12px', color: '#888', margin: 0, flexShrink: 0 }}>
                  {Number(row.classified_count).toLocaleString('en-IN')} / {Number(row.total_count).toLocaleString('en-IN')} classified
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  style={{ ...s.inputSm, flex: 1 }}
                  value={categoryBandPick[row.category] || ''}
                  onChange={(e) => setCategoryBandPick((p) => ({ ...p, [row.category]: e.target.value }))}
                >
                  <option value="">— Band Chuno —</option>
                  {BAND_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
                <button
                  style={{ ...s.approveBtn, opacity: applying === row.category ? 0.7 : 1, flexShrink: 0 }}
                  onClick={() => applyCategoryBand(row)}
                  disabled={applying === row.category}
                >
                  {applying === row.category ? '...' : 'Apply'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Individual override ── */}
      <div>
        <p style={{ fontSize: '13px', fontWeight: '700', color: '#444', margin: '0 0 8px' }}>Individual Medicine Override</p>
        <input
          style={s.inputSm}
          placeholder="Medicine naam se dhundho..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <p style={s.emptyText}>Dhundh raha hai...</p>}
        {!searching && query.trim().length >= 2 && searchResults.length === 0 && (
          <p style={s.emptyText}>"{query}" nahi mili</p>
        )}
        {searchResults.map((med) => (
          <div key={med.id} style={{ ...s.regCard, marginTop: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '14px', fontWeight: '700', color: '#1A1A1A', margin: 0 }}>{med.name}</p>
                <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>{med.category || 'Uncategorized'}</p>
              </div>
              <span style={{ fontSize: '11px', fontWeight: '700', color: med.commission_band ? BAND_COLOR[med.commission_band] : '#888', flexShrink: 0 }}>
                {med.commission_band ? BAND_LABEL[med.commission_band] : 'Unclassified'}
              </span>
            </div>
            <select
              style={s.inputSm}
              value={med.commission_band || ''}
              onChange={(e) => updateMedicineBand(med.id, e.target.value)}
            >
              <option value="">— Unclassified —</option>
              {BAND_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Styles — copied from SuperAdminPanel.jsx's tokens for visual consistency ──
const s = {
  sectionTitle: { fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' },
  emptyText:    { fontSize: '14px', color: '#888', textAlign: 'center', padding: '16px 0' },
  regCard:      { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', borderLeft: '4px solid #E0E0E0' },
  formCard:     { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  approveBtn:   { padding: '10px 16px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' },
  inputSm:      { width: '100%', padding: '10px 12px', border: '1.5px solid #E0E0E0', borderRadius: '8px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', backgroundColor: '#FAFAFA', boxSizing: 'border-box' },
};
