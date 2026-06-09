import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Phone, CheckCircle, FileText, Clock,
  MapPin, AlertTriangle, X, Search, ZoomIn,
  PhoneCall, PhoneOff, Home, LayoutDashboard,
  User, ChevronRight, Save, Check,
} from 'lucide-react';

// ─── Data ─────────────────────────────────────────────────────
const INITIAL_CALLS = [
  {
    id: 1, name: 'Rahul Kumar', phone: '+91 98765XXXXX',
    wait: '15 min', location: 'Deoria', orderId: 'MED-2024-021',
    items: ['Paracetamol 500mg x2', 'Cough Syrup x1'],
    rxStatus: 'none', urgent: true,
  },
  {
    id: 2, name: 'Priya Singh', phone: '+91 87654XXXXX',
    wait: '8 min', location: 'Deoria', orderId: 'MED-2024-022',
    items: ['Azithromycin 500mg x1'],
    rxStatus: 'uploaded', urgent: false,
  },
  {
    id: 3, name: 'Amit Verma', phone: '+91 76543XXXXX',
    wait: '3 min', location: 'Padrauna', orderId: 'MED-2024-023',
    items: ['BP Machine inquiry'],
    rxStatus: 'not_needed', urgent: false,
  },
];

const INITIAL_RX = [
  {
    id: 'Rx #2024-089', customer: 'Sunita Devi', submitted: '10 min ago',
    medicines: ['Metformin 500mg x30', 'Amlodipine 5mg x30', 'Atorvastatin 10mg x30'],
    doctor: 'Dr. R.K. Singh, MBBS', hospital: 'City Hospital, Deoria',
    date: '15 Jan 2025',
    checks: [
      { ok: true,  text: 'Within 6 months' },
      { ok: true,  text: 'Doctor registered' },
      { ok: null,  text: 'Verify quantity'  },
    ],
  },
  {
    id: 'Rx #2024-088', customer: 'Rahul Kumar', submitted: '25 min ago',
    medicines: ['Azithromycin 500mg x6'],
    doctor: 'Dr. A. Sharma', hospital: 'Primary Health Centre', date: '12 Jan 2025',
    checks: [{ ok: true, text: 'Valid prescription' }],
  },
];

const CALL_HISTORY = [
  { id: 1, name: 'Ramesh Kumar', duration: '4:12', status: 'approved', time: '10:15 AM' },
  { id: 2, name: 'Meena Devi',   duration: '2:45', status: 'approved', time: '10:32 AM' },
  { id: 3, name: 'Unknown',      duration: '0:45', status: 'rejected', time: '10:48 AM' },
  { id: 4, name: 'Suresh Singh', duration: '5:20', status: 'approved', time: '11:05 AM' },
];

const LOOKUP_CHIPS = ['Schedule H', 'Schedule X', 'OTC Medicines', 'Drug Interactions'];

const NAV_TABS = [
  { id: 'dashboard', Icon: LayoutDashboard, label: 'Dashboard', badge: null },
  { id: 'calls',     Icon: PhoneCall,       label: 'Call Queue', badge: 8   },
  { id: 'rx',        Icon: FileText,        label: 'Rx Review',  badge: 12  },
  { id: 'profile',   Icon: User,            label: 'Profile',    badge: null },
];

// ─── Call Card ────────────────────────────────────────────────
function CallCard({ call, onCall, onReject }) {
  const border = call.urgent ? '#DC3545' : '#E65100';
  return (
    <div style={{ ...s.callCard, borderLeftColor: border }}>
      {/* Top */}
      <div style={s.callTop}>
        <div>
          <p style={s.callName}>{call.name}</p>
          <div style={s.callInfoRow}>
            <Phone size={12} color="#888" />
            <span style={s.callPhone}>{call.phone}</span>
          </div>
          <div style={s.callInfoRow}>
            <MapPin size={12} color="#888" />
            <span style={s.callPhone}>{call.location}</span>
            <span style={s.callDot}>·</span>
            <span style={s.callPhone}>#{call.orderId}</span>
          </div>
        </div>
        <div style={s.callTopRight}>
          <span style={{
            ...s.waitBadge,
            color: call.urgent ? '#DC3545' : '#E65100',
            backgroundColor: call.urgent ? '#FFEBEE' : '#FFF3E0',
          }}>
            {call.wait} wait
          </span>
          {call.urgent && <span style={s.urgentTag}>URGENT</span>}
        </div>
      </div>

      {/* Items */}
      <div style={s.callItems}>
        {call.items.map((it) => <p key={it} style={s.callItem}>• {it}</p>)}
      </div>

      {/* Rx status */}
      {call.rxStatus === 'none' && (
        <div style={s.rxWarnRow}>
          <AlertTriangle size={13} color="#E65100" />
          <span style={s.rxWarnText}>No prescription uploaded</span>
        </div>
      )}
      {call.rxStatus === 'uploaded' && (
        <div style={s.rxOkRow}>
          <CheckCircle size={13} color="#1A6B3C" />
          <span style={s.rxOkText}>Prescription uploaded ✓</span>
        </div>
      )}
      {call.rxStatus === 'not_needed' && (
        <div style={s.rxOkRow}>
          <CheckCircle size={13} color="#1A6B3C" />
          <span style={s.rxOkText}>No Rx needed</span>
        </div>
      )}

      {/* Buttons */}
      <div style={s.callBtns}>
        <button style={s.callBtn} onClick={() => onCall(call)}>
          <Phone size={14} color="#FFFFFF" />
          Call Karo
        </button>
        <button style={s.rejectBtn} onClick={() => onReject(call.id)}>
          <X size={14} color="#DC3545" />
          Reject
        </button>
      </div>
    </div>
  );
}

// ─── Rx Card ──────────────────────────────────────────────────
function RxCard({ rx, onApprove, onReject, onMoreInfo }) {
  return (
    <div style={s.rxCard}>
      {/* Top */}
      <div style={s.rxTop}>
        <div>
          <p style={s.rxId}>{rx.id}</p>
          <p style={s.rxSub}>Submitted: {rx.submitted} · {rx.customer}</p>
        </div>
        <ChevronRight size={16} color="#AAAAAA" />
      </div>

      {/* Image preview */}
      <div style={s.rxImageBox}>
        <span style={s.rxImageIcon}>📋</span>
        <span style={s.rxImageLabel}>Prescription Image</span>
        <button style={s.zoomBtn}>
          <ZoomIn size={13} color="#1A6B3C" />
          Zoom Karo
        </button>
      </div>

      {/* Medicines */}
      <div style={s.rxMeds}>
        {rx.medicines.map((m) => <p key={m} style={s.rxMed}>• {m}</p>)}
      </div>

      {/* Doctor info */}
      <div style={s.doctorRow}>
        <div style={s.doctorTag}>
          <span style={s.doctorName}>{rx.doctor}</span>
          <span style={s.doctorHosp}>{rx.hospital}</span>
        </div>
        <span style={s.rxDate}>{rx.date}</span>
      </div>

      {/* Validity checks */}
      <div style={s.checksRow}>
        {rx.checks.map(({ ok, text }) => (
          <div key={text} style={s.checkItem}>
            {ok === true  && <CheckCircle size={12} color="#1A6B3C" />}
            {ok === null  && <AlertTriangle size={12} color="#E65100" />}
            {ok === false && <X size={12} color="#DC3545" />}
            <span style={{
              fontSize: '11px', fontWeight: '600',
              color: ok === true ? '#1A6B3C' : ok === null ? '#E65100' : '#DC3545',
            }}>{text}</span>
          </div>
        ))}
      </div>

      {/* Buttons */}
      <div style={s.rxBtns}>
        <button style={s.approveBtn} onClick={() => onApprove(rx.id)}>
          <Check size={14} color="#FFFFFF" />
          Approve Karo
        </button>
        <button style={s.rejectRxBtn} onClick={() => onReject(rx.id)}>
          <X size={14} color="#DC3545" />
          Reject Karo
        </button>
      </div>
      <button style={s.moreInfoBtn} onClick={() => onMoreInfo(rx.id)}>
        <AlertTriangle size={13} color="#E65100" />
        More Info Chahiye
      </button>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function PharmacistPanel() {
  const navigate = useNavigate();
  const [available, setAvailable]   = useState(true);
  const [calls, setCalls]           = useState(INITIAL_CALLS);
  const [rxList, setRxList]         = useState(INITIAL_RX);
  const [history]                   = useState(CALL_HISTORY);
  const [lookup, setLookup]         = useState('');
  const [notes, setNotes]           = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const [activeTab, setActiveTab]   = useState('dashboard');

  const handleRejectCall  = (id) => setCalls((c) => c.filter((x) => x.id !== id));
  const handleApproveRx   = (id) => setRxList((r) => r.filter((x) => x.id !== id));
  const handleRejectRx    = (id) => setRxList((r) => r.filter((x) => x.id !== id));
  const handleMoreInfo    = (_id) => {};

  const saveNotes = () => {
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <p style={s.headerTitle}>Pharmacist Panel</p>
            <p style={s.headerSub}>Dr. Anjali Sharma</p>
          </div>
          <div style={s.headerRight}>
            <button style={s.iconBtn}>
              <div style={{ position: 'relative' }}>
                <Bell size={22} color="#1A1A1A" />
                <span style={s.notifDot} />
              </div>
            </button>
            <button
              style={{
                ...s.statusToggle,
                backgroundColor: available ? '#1A6B3C' : '#E65100',
              }}
              onClick={() => setAvailable((v) => !v)}
            >
              <div style={{ ...s.toggleThumb, transform: available ? 'translateX(22px)' : 'translateX(0)' }} />
              <span style={s.toggleText}>{available ? 'Available' : 'Busy'}</span>
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* Summary Grid */}
          <div style={s.grid2x2}>
            {[
              { Icon: Phone,       val: calls.length, label: 'Call Pending',   color: '#E65100', bg: '#FFF3E0', pulse: true  },
              { Icon: CheckCircle, val: '24',          label: 'Aaj Verified',  color: '#1A6B3C', bg: '#E8F5EE', pulse: false },
              { Icon: FileText,    val: rxList.length, label: 'Rx Pending',    color: '#2563EB', bg: '#EAF2FF', pulse: false },
              { Icon: Clock,       val: '3.5 min',     label: 'Avg Call Time', color: '#7C3AED', bg: '#F3EEFF', pulse: false },
            ].map(({ Icon, val, label, color, bg, pulse }) => (
              <div key={label} style={{ ...s.metricCard, backgroundColor: bg }}>
                <div style={s.metricIconRow}>
                  <Icon size={18} color={color} />
                  {pulse && calls.length > 0 && (
                    <span style={{ ...s.pulseDot, backgroundColor: color }} />
                  )}
                </div>
                <p style={{ ...s.metricVal, color }}>{val}</p>
                <p style={s.metricLabel}>{label}</p>
              </div>
            ))}
          </div>

          {/* Call Queue */}
          <div style={s.section}>
            <div style={s.sectionHead}>
              <div style={s.sectionTitleRow}>
                <span style={s.urgentDot} />
                <span style={s.sectionTitle}>Call Queue</span>
              </div>
              <span style={s.sectionSub}>{calls.length} calls waiting</span>
            </div>

            {calls.length === 0 ? (
              <div style={s.emptyCard}>
                <PhoneCall size={28} color="#1A6B3C" />
                <p style={s.emptyText}>Koi call pending nahi!</p>
              </div>
            ) : (
              <div style={s.cardList}>
                {calls.map((call) => (
                  <CallCard
                    key={call.id}
                    call={call}
                    onCall={() => {}}
                    onReject={handleRejectCall}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Rx Review */}
          <div style={s.section}>
            <div style={s.sectionHead}>
              <span style={s.sectionTitle}>Rx Review Karo</span>
              <span style={s.sectionSub}>{rxList.length} prescriptions pending</span>
            </div>

            {rxList.length === 0 ? (
              <div style={s.emptyCard}>
                <FileText size={28} color="#1A6B3C" />
                <p style={s.emptyText}>Sab Rx reviewed!</p>
              </div>
            ) : (
              <div style={s.cardList}>
                {rxList.map((rx) => (
                  <RxCard
                    key={rx.id}
                    rx={rx}
                    onApprove={handleApproveRx}
                    onReject={handleRejectRx}
                    onMoreInfo={handleMoreInfo}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Call History */}
          <div style={s.whiteCard}>
            <p style={s.sectionTitle}>Aaj Ki Calls</p>
            <div style={s.historyList}>
              {history.map((h) => (
                <div key={h.id} style={s.historyRow}>
                  <div style={{
                    ...s.histIconCircle,
                    backgroundColor: h.status === 'approved' ? '#E8F5EE' : '#FFEBEE',
                  }}>
                    {h.status === 'approved'
                      ? <PhoneCall size={14} color="#1A6B3C" />
                      : <PhoneOff  size={14} color="#DC3545" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={s.histName}>{h.name}</p>
                    <p style={s.histDur}>{h.duration}</p>
                  </div>
                  <div style={s.histRight}>
                    <span style={{
                      ...s.histStatus,
                      color: h.status === 'approved' ? '#1A6B3C' : '#DC3545',
                      backgroundColor: h.status === 'approved' ? '#E8F5EE' : '#FFEBEE',
                    }}>
                      {h.status === 'approved' ? 'Approved' : 'Rejected'}
                    </span>
                    <span style={s.histTime}>{h.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Medicine Lookup */}
          <div style={s.whiteCard}>
            <p style={s.sectionTitle}>Medicine Check Karo</p>
            <div style={s.lookupBox}>
              <Search size={15} color="#AAAAAA" />
              <input
                style={s.lookupInput}
                placeholder="Medicine ya salt name..."
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
              />
            </div>
            <div style={s.chipRow}>
              {LOOKUP_CHIPS.map((chip) => (
                <button key={chip} style={s.lookupChip} onClick={() => setLookup(chip)}>
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div style={s.whiteCard}>
            <p style={s.sectionTitle}>Aaj Ke Notes</p>
            <textarea
              style={s.notesArea}
              rows={4}
              placeholder="Pharmacist notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <button style={s.saveNotesBtn} onClick={saveNotes}>
              {notesSaved
                ? <><CheckCircle size={15} color="#FFFFFF" /> Saved!</>
                : <><Save size={15} color="#FFFFFF" /> Save Karo</>}
            </button>
          </div>

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label, badge }) => {
            const isActive = activeTab === id;
            return (
              <button key={id} style={s.navTab} onClick={() => setActiveTab(id)}>
                <div style={{ position: 'relative' }}>
                  <Icon size={22} color={isActive ? '#1A6B3C' : '#AAAAAA'}
                    strokeWidth={isActive ? 2.5 : 1.8} />
                  {badge > 0 && <span style={s.navBadge}>{badge}</span>}
                </div>
                <span style={{ ...s.navLabel, color: isActive ? '#1A6B3C' : '#AAAAAA',
                  fontWeight: isActive ? '600' : '400' }}>
                  {label}
                </span>
                {isActive && <span style={s.navDot} />}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const s = {
  wrapper: {
    minHeight: '100vh', backgroundColor: '#F5F5F5',
    display: 'flex', justifyContent: 'center',
  },
  screen: {
    width: '100%', maxWidth: '480px',
    display: 'flex', flexDirection: 'column',
    minHeight: '100vh', backgroundColor: '#F5F5F5',
  },

  // Header
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px 12px', backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10,
  },
  headerTitle: { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  headerSub:   { fontSize: '12px', color: '#888888', margin: 0 },
  headerRight: { display: 'flex', alignItems: 'center', gap: '10px' },
  iconBtn: {
    background: 'none', border: 'none', padding: '6px',
    cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center',
  },
  notifDot: {
    position: 'absolute', top: '-2px', right: '-2px',
    width: '8px', height: '8px', borderRadius: '50%',
    backgroundColor: '#EF4444', border: '1.5px solid #FFFFFF',
  },
  statusToggle: {
    width: '82px', height: '30px', borderRadius: '15px',
    border: 'none', cursor: 'pointer', position: 'relative',
    display: 'flex', alignItems: 'center', padding: '0 6px',
    transition: 'background-color 0.3s ease', flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute', left: '4px', width: '22px', height: '22px',
    borderRadius: '11px', backgroundColor: '#FFFFFF',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.3s ease',
  },
  toggleText: {
    fontSize: '9px', fontWeight: '800', color: '#FFFFFF',
    marginLeft: 'auto', userSelect: 'none', letterSpacing: '0.3px',
  },

  // Body
  body: {
    flex: 1, overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px',
  },

  // 2x2 Grid
  grid2x2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  metricCard: { borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '4px' },
  metricIconRow: { display: 'flex', alignItems: 'center', gap: '6px' },
  pulseDot: { width: '8px', height: '8px', borderRadius: '50%', animation: 'pulse 1.4s ease-in-out infinite' },
  metricVal: { fontSize: '26px', fontWeight: '800', margin: '4px 0 0', lineHeight: 1 },
  metricLabel: { fontSize: '11px', color: '#555555', fontWeight: '500', margin: 0 },

  // Section
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  urgentDot: {
    width: '10px', height: '10px', borderRadius: '50%',
    backgroundColor: '#DC3545', display: 'inline-block',
    animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0,
  },
  sectionTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  sectionSub:   { fontSize: '12px', color: '#888888' },
  cardList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  emptyCard: {
    backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '28px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.04)',
  },
  emptyText: { fontSize: '14px', color: '#1A6B3C', fontWeight: '600', margin: 0 },

  // Call card
  callCard: {
    backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid',
    padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
    display: 'flex', flexDirection: 'column', gap: '10px',
  },
  callTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  callName: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' },
  callInfoRow: { display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' },
  callPhone: { fontSize: '12px', color: '#666666' },
  callDot: { color: '#CCCCCC', fontSize: '12px' },
  callTopRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' },
  waitBadge: { fontSize: '11px', fontWeight: '700', padding: '3px 9px', borderRadius: '20px' },
  urgentTag: {
    fontSize: '9px', fontWeight: '800', color: '#FFFFFF',
    backgroundColor: '#DC3545', padding: '2px 8px', borderRadius: '4px', letterSpacing: '0.5px',
  },
  callItems: { display: 'flex', flexDirection: 'column', gap: '3px' },
  callItem: { fontSize: '13px', color: '#333333', margin: 0 },
  rxWarnRow: {
    display: 'flex', alignItems: 'center', gap: '6px',
    backgroundColor: '#FFF3E0', padding: '7px 10px', borderRadius: '8px',
  },
  rxWarnText: { fontSize: '12px', color: '#E65100', fontWeight: '600' },
  rxOkRow: {
    display: 'flex', alignItems: 'center', gap: '6px',
    backgroundColor: '#E8F5EE', padding: '7px 10px', borderRadius: '8px',
  },
  rxOkText: { fontSize: '12px', color: '#1A6B3C', fontWeight: '600' },
  callBtns: { display: 'flex', gap: '8px' },
  callBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  rejectBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '11px', backgroundColor: '#FFFFFF', color: '#DC3545',
    border: '1.5px solid #DC3545', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Rx card
  rxCard: {
    backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '14px',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px',
  },
  rxTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  rxId:  { fontSize: '14px', fontWeight: '800', color: '#1A6B3C', margin: 0, fontFamily: 'monospace' },
  rxSub: { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  rxImageBox: {
    backgroundColor: '#F5F5F5', borderRadius: '10px', padding: '14px',
    display: 'flex', alignItems: 'center', gap: '10px', border: '1px dashed #DDDDDD',
  },
  rxImageIcon: { fontSize: '24px' },
  rxImageLabel: { flex: 1, fontSize: '13px', color: '#555555', fontWeight: '500' },
  zoomBtn: {
    display: 'flex', alignItems: 'center', gap: '4px',
    background: 'none', border: 'none', color: '#1A6B3C',
    fontSize: '12px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit',
  },
  rxMeds: { display: 'flex', flexDirection: 'column', gap: '3px' },
  rxMed:  { fontSize: '13px', color: '#333333', margin: 0 },
  doctorRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' },
  doctorTag: { display: 'flex', flexDirection: 'column', gap: '2px' },
  doctorName: { fontSize: '13px', fontWeight: '700', color: '#1A1A1A' },
  doctorHosp: { fontSize: '11px', color: '#888888' },
  rxDate: { fontSize: '11px', color: '#888888', flexShrink: 0 },
  checksRow: { display: 'flex', flexDirection: 'column', gap: '6px' },
  checkItem: { display: 'flex', alignItems: 'center', gap: '6px' },
  rxBtns: { display: 'flex', gap: '8px' },
  approveBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  rejectRxBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '11px', backgroundColor: '#FFFFFF', color: '#DC3545',
    border: '1.5px solid #DC3545', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  moreInfoBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '10px', backgroundColor: '#FFFFFF', color: '#E65100',
    border: '1.5px solid #E65100', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // White card (generic)
  whiteCard: {
    backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '12px',
  },

  // Call history
  historyList: { display: 'flex', flexDirection: 'column', gap: '0' },
  historyRow: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px 0', borderBottom: '1px solid #F5F5F5',
  },
  histIconCircle: {
    width: '34px', height: '34px', borderRadius: '17px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  histName: { fontSize: '13px', fontWeight: '600', color: '#1A1A1A', margin: 0 },
  histDur:  { fontSize: '11px', color: '#888888', margin: 0 },
  histRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' },
  histStatus: { fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' },
  histTime:   { fontSize: '10px', color: '#AAAAAA' },

  // Lookup
  lookupBox: {
    display: 'flex', alignItems: 'center', gap: '8px',
    backgroundColor: '#F5F5F5', border: '1.5px solid #E8E8E8',
    borderRadius: '10px', padding: '10px 12px',
  },
  lookupInput: {
    flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent',
    fontSize: '14px', color: '#1A1A1A', fontFamily: 'inherit',
  },
  chipRow: { display: 'flex', gap: '7px', flexWrap: 'wrap' },
  lookupChip: {
    padding: '5px 12px', backgroundColor: '#F0F0F0', border: 'none',
    borderRadius: '20px', fontSize: '12px', fontWeight: '500',
    color: '#444444', cursor: 'pointer', fontFamily: 'inherit',
  },

  // Notes
  notesArea: {
    width: '100%', padding: '11px 14px', border: '1.5px solid #E0E0E0',
    borderRadius: '10px', fontSize: '14px', color: '#1A1A1A', outline: 'none',
    fontFamily: 'inherit', resize: 'none', lineHeight: '1.5', boxSizing: 'border-box',
  },
  saveNotesBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
    padding: '12px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // Bottom nav
  bottomNav: {
    position: 'sticky', bottom: 0, backgroundColor: '#FFFFFF',
    borderTop: '1px solid #F0F0F0', display: 'flex',
    padding: '8px 0 12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)',
  },
  navTab: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '4px 0', position: 'relative', fontFamily: 'inherit',
  },
  navBadge: {
    position: 'absolute', top: '-4px', right: '-4px',
    minWidth: '16px', height: '16px', borderRadius: '8px',
    backgroundColor: '#DC3545', color: '#FFFFFF',
    fontSize: '9px', fontWeight: '800',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
  },
  navLabel: { fontSize: '10px' },
  navDot: {
    position: 'absolute', top: '-8px', width: '20px', height: '3px',
    backgroundColor: '#1A6B3C', borderRadius: '2px',
  },
};
