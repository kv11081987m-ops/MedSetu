import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import {
  Bell, Phone, CheckCircle, FileText, Clock,
  MapPin, AlertTriangle, X, Search, ZoomIn,
  PhoneCall, PhoneOff, LayoutDashboard,
  User, Save, Check, LogOut,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────
const getTimeAgo = (dateStr) => {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (diff < 60)   return `${diff} sec pehle`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min pehle`;
  return `${Math.floor(diff / 3600)} ghante pehle`;
};

const mapCallCard = (order) => ({
  _id:     order.id,
  id:      order.id,
  name:    order.users?.name    || order.customer_name  || 'Customer',
  phone:   order.users?.phone   || order.customer_phone || '—',
  wait:    order.created_at ? getTimeAgo(order.created_at) : '—',
  location:order.sellers?.district || order.sellers?.address || 'Deoria',
  orderId: order.order_number   || String(order.id).slice(0, 8).toUpperCase(),
  items:   order.order_items?.map((i) => `${i.medicine_name || 'Item'} x${i.quantity || 1}`) || ['Order items'],
  rxStatus:order.prescription_id ? 'uploaded' : 'none',
  urgent:  false,
  status:  'pending',
});

const mapRxCard = (rx) => ({
  _id:      rx.id,
  id:       `Rx #${String(rx.id).slice(0, 8).toUpperCase()}`,
  customer: rx.users?.name || 'Customer',
  submitted:rx.created_at ? getTimeAgo(rx.created_at) : '—',
  medicines:rx.medicines_list || [`${rx.medicines_count || 1} medicine(s) prescribed`],
  doctor:   rx.doctor_name   || 'Doctor',
  hospital: rx.hospital_name || 'Hospital',
  date:     rx.prescription_date
    ? new Date(rx.prescription_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—',
  checks:   [{ ok: true, text: 'Prescription uploaded' }],
  status:   rx.status || 'pending',
});

const CALL_HISTORY = [
  { id: 1, name: 'Ramesh Kumar', duration: '4:12', status: 'approved', time: '10:15 AM' },
  { id: 2, name: 'Meena Devi',   duration: '2:45', status: 'approved', time: '10:32 AM' },
  { id: 3, name: 'Unknown',      duration: '0:45', status: 'rejected', time: '10:48 AM' },
  { id: 4, name: 'Suresh Singh', duration: '5:20', status: 'approved', time: '11:05 AM' },
];

const LOOKUP_CHIPS = ['Schedule H', 'Schedule X', 'OTC Medicines', 'Drug Interactions'];

const INIT_NOTIFS = [
  { id: 1, dotColor: '#E65100', title: 'Naya call request:', subtitle: 'Rahul Kumar, Deoria',   time: '5 min pehle',    read: false },
  { id: 2, dotColor: '#2563EB', title: 'Rx submitted:',      subtitle: 'Sunita Devi (Rx #089)', time: '18 min pehle',   read: false },
  { id: 3, dotColor: '#888888', title: 'Call completed:',    subtitle: 'Meena Devi',            time: '45 min pehle',   read: true  },
  { id: 4, dotColor: '#888888', title: 'Rx approved:',       subtitle: 'Rahul Kumar',           time: '1 ghanta pehle', read: true  },
];

const NAV_TABS = [
  { id: 'dashboard', Icon: LayoutDashboard, label: 'Dashboard'  },
  { id: 'callqueue', Icon: PhoneCall,       label: 'Call Queue' },
  { id: 'rxreview',  Icon: FileText,        label: 'Rx Review'  },
  { id: 'profile',   Icon: User,            label: 'Profile'    },
];

// ─── Filter Chips ─────────────────────────────────────────────
function FilterChips({ options, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' }}>
      {options.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          style={{
            padding: '6px 14px', borderRadius: '20px', flexShrink: 0,
            border: active === value ? '1.5px solid #1A6B3C' : '1.5px solid #E0E0E0',
            backgroundColor: active === value ? '#E8F5EE' : '#FFFFFF',
            color: active === value ? '#1A6B3C' : '#888888',
            fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Call Card ────────────────────────────────────────────────
function CallCard({ call, onCall, onReject }) {
  const isCompleted = call.status === 'completed';
  return (
    <div style={{ ...s.callCard, borderLeftColor: call.urgent ? '#DC3545' : '#E65100' }}>
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

      <div style={s.callItems}>
        {call.items.map((it) => <p key={it} style={s.callItem}>• {it}</p>)}
      </div>

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

      {isCompleted ? (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <span style={{ fontSize: '12px', color: '#1A6B3C', fontWeight: '700', backgroundColor: '#E8F5EE', padding: '6px 20px', borderRadius: '20px' }}>
            ✓ Completed
          </span>
        </div>
      ) : (
        <div style={s.callBtns}>
          <button style={s.callBtn} onClick={() => onCall(call)}>
            <Phone size={14} color="#FFFFFF" /> Call Karo
          </button>
          <button style={s.rejectBtn} onClick={() => onReject(call.id)}>
            <X size={14} color="#DC3545" /> Reject
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Rx Card ──────────────────────────────────────────────────
function RxCard({ rx, onApprove, onReject, onMoreInfo }) {
  const isPending  = rx.status === 'pending';
  const isApproved = rx.status === 'approved';
  return (
    <div style={s.rxCard}>
      <div style={s.rxTop}>
        <div>
          <p style={s.rxId}>{rx.id}</p>
          <p style={s.rxSub}>Submitted: {rx.submitted} · {rx.customer}</p>
        </div>
        {isApproved && <span style={{ fontSize: '10px', fontWeight: '800', color: '#1A6B3C', backgroundColor: '#E8F5EE', padding: '3px 9px', borderRadius: '20px' }}>APPROVED</span>}
        {rx.status === 'rejected' && <span style={{ fontSize: '10px', fontWeight: '800', color: '#DC3545', backgroundColor: '#FFEBEE', padding: '3px 9px', borderRadius: '20px' }}>REJECTED</span>}
      </div>

      <div style={s.rxImageBox}>
        <span style={s.rxImageIcon}>📋</span>
        <span style={s.rxImageLabel}>Prescription Image</span>
        <button style={s.zoomBtn}>
          <ZoomIn size={13} color="#1A6B3C" /> Zoom Karo
        </button>
      </div>

      <div style={s.rxMeds}>
        {rx.medicines.map((m) => <p key={m} style={s.rxMed}>• {m}</p>)}
      </div>

      <div style={s.doctorRow}>
        <div style={s.doctorTag}>
          <span style={s.doctorName}>{rx.doctor}</span>
          <span style={s.doctorHosp}>{rx.hospital}</span>
        </div>
        <span style={s.rxDate}>{rx.date}</span>
      </div>

      <div style={s.checksRow}>
        {rx.checks.map(({ ok, text }) => (
          <div key={text} style={s.checkItem}>
            {ok === true  && <CheckCircle size={12} color="#1A6B3C" />}
            {ok === null  && <AlertTriangle size={12} color="#E65100" />}
            {ok === false && <X size={12} color="#DC3545" />}
            <span style={{ fontSize: '11px', fontWeight: '600', color: ok === true ? '#1A6B3C' : ok === null ? '#E65100' : '#DC3545' }}>
              {text}
            </span>
          </div>
        ))}
      </div>

      {isPending && (
        <>
          <div style={s.rxBtns}>
            <button style={s.approveBtn} onClick={() => onApprove(rx._id)}>
              <Check size={14} color="#FFFFFF" /> Approve Karo
            </button>
            <button style={s.rejectRxBtn} onClick={() => onReject(rx._id)}>
              <X size={14} color="#DC3545" /> Reject Karo
            </button>
          </div>
          <button style={s.moreInfoBtn} onClick={() => onMoreInfo(rx.id)}>
            <AlertTriangle size={13} color="#E65100" /> More Info Chahiye
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function PharmacistPanel() {
  const navigate = useNavigate();
  const { handleLogout: authLogout } = useAuth();

  // ── DB-driven state ──────────────────────────────────────────
  const [callQueue,       setCallQueue]       = useState([]);
  const [prescriptions,   setPrescriptions]   = useState([]);
  const [completedCallIds,setCompletedCallIds]= useState(new Set());
  const [loading,         setLoading]         = useState(true);

  // ── UI state (unchanged) ─────────────────────────────────────
  const [available, setAvailable]           = useState(true);
  const [history]                           = useState(CALL_HISTORY);
  const [lookup,  setLookup]                = useState('');
  const [notes,   setNotes]                 = useState('');
  const [notesSaved, setNotesSaved]         = useState(false);
  const [activeTab, setActiveTab]           = useState('dashboard');
  const [callFilter, setCallFilter]         = useState('sab');
  const [rxFilter,  setRxFilter]            = useState('pending');
  const [notifications, setNotifications]   = useState(INIT_NOTIFS);
  const [notifOpen, setNotifOpen]           = useState(false);

  // ── Load availability ────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem('pharmacist_available');
    if (saved !== null) setAvailable(saved === 'true');
  }, []);

  // ── Fetch data ───────────────────────────────────────────────
  const fetchPrescriptions = async () => {
    const { data } = await supabase
      .from('prescriptions')
      .select('*, users(phone, name)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (data) setPrescriptions(data);
  };

  const fetchCallQueue = async () => {
    const { data } = await supabase
      .from('orders')
      .select('*, users(phone, name), order_items(*), sellers(store_name, district, address)')
      .eq('pharmacist_verified', false)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (data) setCallQueue(data);
  };

  useEffect(() => {
    Promise.all([fetchPrescriptions(), fetchCallQueue()])
      .finally(() => setLoading(false));
  }, []);

  // ── Derived state ────────────────────────────────────────────
  const allCalls = callQueue.map((order) => ({
    ...mapCallCard(order),
    status: completedCallIds.has(order.id) ? 'completed' : 'pending',
  }));
  const allRx       = prescriptions.map(mapRxCard);
  const pendingCalls = allCalls.filter((c) => c.status === 'pending');
  const pendingRx    = allRx.filter((r) => r.status === 'pending');

  // ── Handlers ─────────────────────────────────────────────────
  const handleCallAction = (id) =>
    setCompletedCallIds((prev) => new Set([...prev, id]));

  const handleRxApprove = async (dbId) => {
    const { error } = await supabase
      .from('prescriptions')
      .update({ status: 'approved', verified_at: new Date().toISOString() })
      .eq('id', dbId);
    if (!error) setPrescriptions((prev) => prev.filter((rx) => rx.id !== dbId));
  };

  const handleRxReject = async (dbId) => {
    const { error } = await supabase
      .from('prescriptions')
      .update({ status: 'rejected' })
      .eq('id', dbId);
    if (!error) setPrescriptions((prev) => prev.filter((rx) => rx.id !== dbId));
  };

  const handleMoreInfo = (displayId) => {
    const rx  = prescriptions.find(
      (p) => `Rx #${String(p.id).slice(0, 8).toUpperCase()}` === displayId
    );
    const phone = rx?.users?.phone || 'Phone available nahi';
    const name  = rx?.users?.name  || 'Customer';
    alert(`Customer Info\nNaam: ${name}\nPhone: +91 ${phone}`);
  };

  const toggleAvailability = () => {
    const newStatus = !available;
    setAvailable(newStatus);
    localStorage.setItem('pharmacist_available', newStatus.toString());
  };

  const saveNotes = () => { setNotesSaved(true); setTimeout(() => setNotesSaved(false), 2000); };
  const handleLogout = async () => { await authLogout(); navigate('/login'); };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const markAllRead = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  const handleBellClick = () => setNotifOpen((prev) => !prev);

  const getFilteredCalls = () => {
    switch (callFilter) {
      case 'urgent':    return allCalls.filter((c) => c.status === 'pending' && c.urgent);
      case 'normal':    return allCalls.filter((c) => c.status === 'pending' && !c.urgent);
      case 'completed': return allCalls.filter((c) => c.status === 'completed');
      default:          return allCalls;
    }
  };

  // ─── Tab renderers ────────────────────────────────────────
  const renderDashboard = () => (
    <>
      <div style={s.grid2x2}>
        {[
          { Icon: Phone,       val: callQueue.length,    label: 'Call Pending',   color: '#E65100', bg: '#FFF3E0', pulse: true  },
          { Icon: CheckCircle, val: completedCallIds.size,label: 'Aaj Verified',  color: '#1A6B3C', bg: '#E8F5EE', pulse: false },
          { Icon: FileText,    val: prescriptions.length, label: 'Rx Pending',    color: '#2563EB', bg: '#EAF2FF', pulse: false },
          { Icon: Clock,       val: '3.5 min',            label: 'Avg Call Time', color: '#7C3AED', bg: '#F3EEFF', pulse: false },
        ].map(({ Icon, val, label, color, bg, pulse }) => (
          <div key={label} style={{ ...s.metricCard, backgroundColor: bg }}>
            <div style={s.metricIconRow}>
              <Icon size={18} color={color} />
              {pulse && pendingCalls.length > 0 && <span style={{ ...s.pulseDot, backgroundColor: color }} />}
            </div>
            <p style={{ ...s.metricVal, color }}>{val}</p>
            <p style={s.metricLabel}>{label}</p>
          </div>
        ))}
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <div style={s.sectionTitleRow}>
            <span style={s.urgentDot} />
            <span style={s.sectionTitle}>Call Queue</span>
          </div>
          <span style={s.sectionSub}>{pendingCalls.length} calls waiting</span>
        </div>
        {pendingCalls.length === 0 ? (
          <div style={s.emptyCard}><PhoneCall size={28} color="#1A6B3C" /><p style={s.emptyText}>Koi call pending nahi!</p></div>
        ) : (
          <div style={s.cardList}>
            {pendingCalls.map((call) => (
              <CallCard key={call.id} call={call} onCall={(c) => handleCallAction(c.id)} onReject={handleCallAction} />
            ))}
          </div>
        )}
      </div>

      <div style={s.section}>
        <div style={s.sectionHead}>
          <span style={s.sectionTitle}>Rx Review Karo</span>
          <span style={s.sectionSub}>{pendingRx.length} prescriptions pending</span>
        </div>
        {pendingRx.length === 0 ? (
          <div style={s.emptyCard}><FileText size={28} color="#1A6B3C" /><p style={s.emptyText}>Sab Rx reviewed!</p></div>
        ) : (
          <div style={s.cardList}>
            {pendingRx.map((rx) => (
              <RxCard key={rx.id} rx={rx} onApprove={handleRxApprove} onReject={handleRxReject} onMoreInfo={handleMoreInfo} />
            ))}
          </div>
        )}
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Aaj Ki Calls</p>
        <div style={s.historyList}>
          {history.map((h) => (
            <div key={h.id} style={s.historyRow}>
              <div style={{ ...s.histIconCircle, backgroundColor: h.status === 'approved' ? '#E8F5EE' : '#FFEBEE' }}>
                {h.status === 'approved' ? <PhoneCall size={14} color="#1A6B3C" /> : <PhoneOff size={14} color="#DC3545" />}
              </div>
              <div style={{ flex: 1 }}>
                <p style={s.histName}>{h.name}</p>
                <p style={s.histDur}>{h.duration}</p>
              </div>
              <div style={s.histRight}>
                <span style={{ ...s.histStatus, color: h.status === 'approved' ? '#1A6B3C' : '#DC3545', backgroundColor: h.status === 'approved' ? '#E8F5EE' : '#FFEBEE' }}>
                  {h.status === 'approved' ? 'Approved' : 'Rejected'}
                </span>
                <span style={s.histTime}>{h.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Medicine Check Karo</p>
        <div style={s.lookupBox}>
          <Search size={15} color="#AAAAAA" />
          <input style={s.lookupInput} placeholder="Medicine ya salt name..." value={lookup} onChange={(e) => setLookup(e.target.value)} />
        </div>
        <div style={s.chipRow}>
          {LOOKUP_CHIPS.map((chip) => (
            <button key={chip} style={s.lookupChip} onClick={() => setLookup(chip)}>{chip}</button>
          ))}
        </div>
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Aaj Ke Notes</p>
        <textarea style={s.notesArea} rows={4} placeholder="Pharmacist notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button style={s.saveNotesBtn} onClick={saveNotes}>
          {notesSaved ? <><CheckCircle size={15} color="#FFFFFF" /> Saved!</> : <><Save size={15} color="#FFFFFF" /> Save Karo</>}
        </button>
      </div>
    </>
  );

  const renderCallQueue = () => {
    const displayed = getFilteredCalls();
    return (
      <>
        <p style={s.tabTitle}>Call Queue</p>
        <p style={{ fontSize: '13px', color: '#E65100', fontWeight: '700', margin: 0 }}>
          {pendingCalls.length} calls waiting
        </p>
        <FilterChips
          options={[
            { value: 'sab',       label: 'Sab'       },
            { value: 'urgent',    label: 'Urgent'    },
            { value: 'normal',    label: 'Normal'    },
            { value: 'completed', label: 'Completed' },
          ]}
          active={callFilter}
          onChange={setCallFilter}
        />
        {displayed.length === 0 ? (
          <div style={s.emptyCard}>
            <Phone size={28} color="#AAAAAA" />
            <p style={{ ...s.emptyText, color: '#888888' }}>Koi call pending nahi</p>
            <p style={s.emptyText}>Sab calls complete! ✓</p>
          </div>
        ) : (
          <div style={s.cardList}>
            {displayed.map((call) => (
              <CallCard key={call.id} call={call} onCall={(c) => handleCallAction(c.id)} onReject={handleCallAction} />
            ))}
          </div>
        )}
      </>
    );
  };

  const renderRxReview = () => {
    const displayed = allRx.filter((r) => r.status === rxFilter);
    return (
      <>
        <p style={s.tabTitle}>Prescription Review</p>
        <p style={{ fontSize: '13px', color: '#2563EB', fontWeight: '700', margin: 0 }}>
          {pendingRx.length} prescriptions pending
        </p>
        <FilterChips
          options={[
            { value: 'pending',  label: 'Pending'  },
            { value: 'approved', label: 'Approved' },
            { value: 'rejected', label: 'Rejected' },
          ]}
          active={rxFilter}
          onChange={setRxFilter}
        />
        {displayed.length === 0 ? (
          <div style={s.emptyCard}>
            <FileText size={28} color="#AAAAAA" />
            <p style={{ ...s.emptyText, color: '#888888' }}>Koi prescription nahi is category mein</p>
          </div>
        ) : (
          <div style={s.cardList}>
            {displayed.map((rx) => (
              <RxCard key={rx.id} rx={rx} onApprove={handleRxApprove} onReject={handleRxReject} onMoreInfo={handleMoreInfo} />
            ))}
          </div>
        )}
      </>
    );
  };

  const renderProfile = () => (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px 0 8px' }}>
        <div style={{ width: '72px', height: '72px', borderRadius: '36px', backgroundColor: '#1A6B3C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '32px', fontWeight: '800', color: '#FFFFFF' }}>A</span>
        </div>
        <p style={{ fontSize: '20px', fontWeight: '800', color: '#1A1A1A', margin: 0 }}>Dr. Anjali Sharma</p>
        <p style={{ fontSize: '13px', color: '#888888', margin: 0 }}>Licensed Pharmacist</p>
        <p style={{ fontSize: '12px', color: '#1A6B3C', fontWeight: '600', margin: 0 }}>B.Pharm — Reg: UP-PH-2024-001</p>
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Availability Status</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '14px', color: available ? '#1A6B3C' : '#DC3545', fontWeight: '700' }}>
            {available ? 'Available ✓' : 'Busy'}
          </span>
          <div
            style={{ width: '52px', height: '28px', borderRadius: '14px', backgroundColor: available ? '#1A6B3C' : '#DC3545', position: 'relative', cursor: 'pointer', transition: 'background 0.3s', flexShrink: 0 }}
            onClick={toggleAvailability}
          >
            <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#FFFFFF', position: 'absolute', top: '3px', left: available ? '27px' : '3px', transition: 'left 0.3s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '6px', fontWeight: '800', color: available ? '#1A6B3C' : '#DC3545', userSelect: 'none', lineHeight: 1 }}>{available ? 'ON' : 'OFF'}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={s.whiteCard}>
        <p style={s.sectionTitle}>Info</p>
        {[
          ['Email',          'pharma@medsetu.in'],
          ['Phone',          '+91 98765XXXXX'   ],
          ['Joined',         'Jan 2025'          ],
          ['Today Calls',    '24'                ],
          ['Today Verified', '18'                ],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F5F5F5' }}>
            <span style={{ fontSize: '13px', color: '#888888' }}>{label}</span>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#1A1A1A' }}>{val}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        {[
          { val: '156', label: 'Total Calls', color: '#2563EB', bg: '#EAF2FF' },
          { val: '142', label: 'Approved',    color: '#1A6B3C', bg: '#E8F5EE' },
          { val: '14',  label: 'Rejected',    color: '#DC3545', bg: '#FFEBEE' },
        ].map(({ val, label, color, bg }) => (
          <div key={label} style={{ flex: 1, backgroundColor: bg, borderRadius: '12px', padding: '12px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <p style={{ fontSize: '22px', fontWeight: '800', color, margin: 0 }}>{val}</p>
            <p style={{ fontSize: '10px', color: '#555555', fontWeight: '600', margin: 0, textAlign: 'center' }}>{label}</p>
          </div>
        ))}
      </div>

      <button style={s.logoutBtn} onClick={handleLogout}>
        <LogOut size={16} color="#FFFFFF" /> Logout
      </button>
    </>
  );

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
            <button style={s.iconBtn} onClick={handleBellClick}>
              <div style={{ position: 'relative' }}>
                <Bell size={22} color="#1A1A1A" />
                {unreadCount > 0 && <span style={s.notifBadge}>{unreadCount}</span>}
              </div>
            </button>
            <div
              style={{ width: '52px', height: '28px', borderRadius: '14px', backgroundColor: available ? '#1A6B3C' : '#DC3545', position: 'relative', cursor: 'pointer', transition: 'background 0.3s', flexShrink: 0 }}
              onClick={toggleAvailability}
            >
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#FFFFFF', position: 'absolute', top: '3px', left: available ? '27px' : '3px', transition: 'left 0.3s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '6px', fontWeight: '800', color: available ? '#1A6B3C' : '#DC3545', userSelect: 'none', lineHeight: 1 }}>{available ? 'ON' : 'OFF'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Notification Panel ── */}
        {notifOpen && (
          <>
            <div
              style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 100 }}
              onClick={() => setNotifOpen(false)}
            />
            <div style={s.notifPanel}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <p style={{ fontSize: '16px', fontWeight: '800', color: '#1A1A1A', margin: 0 }}>Notifications</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    style={{ background: 'none', border: 'none', color: '#1A6B3C', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' }}
                    onClick={markAllRead}
                  >
                    Sab padhein
                  </button>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }} onClick={() => setNotifOpen(false)}>
                    <X size={18} color="#888888" />
                  </button>
                </div>
              </div>

              {notifications.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '10px 8px', borderBottom: '1px solid #F5F5F5',
                    borderRadius: '8px', marginBottom: '2px',
                    backgroundColor: n.read ? '#FFFFFF' : '#F0FAF5',
                  }}
                >
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: n.dotColor, flexShrink: 0, marginTop: '5px' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: '#1A1A1A', margin: 0 }}>
                      {n.title} <span style={{ color: '#1A6B3C' }}>{n.subtitle}</span>
                    </p>
                    <p style={{ fontSize: '11px', color: '#AAAAAA', margin: '2px 0 0' }}>{n.time}</p>
                  </div>
                </div>
              ))}

              <button style={{ display: 'block', width: '100%', textAlign: 'center', marginTop: '12px', background: 'none', border: 'none', color: '#1A6B3C', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' }}>
                Aur dekho →
              </button>
            </div>
          </>
        )}

        {/* ── Body ── */}
        <div style={s.body}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
              <p style={{ color: '#888888', fontSize: '14px' }}>Panel load ho raha hai...</p>
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && renderDashboard()}
              {activeTab === 'callqueue' && renderCallQueue()}
              {activeTab === 'rxreview'  && renderRxReview()}
              {activeTab === 'profile'   && renderProfile()}
            </>
          )}
          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label }) => {
            const isActive = activeTab === id;
            const badge = id === 'callqueue' ? pendingCalls.length
                        : id === 'rxreview'  ? pendingRx.length
                        : 0;
            return (
              <button key={id} style={s.navTab} onClick={() => setActiveTab(id)}>
                <div style={{ position: 'relative' }}>
                  <Icon size={22} color={isActive ? '#1A6B3C' : '#AAAAAA'} strokeWidth={isActive ? 2.5 : 1.8} />
                  {badge > 0 && <span style={s.navBadge}>{badge}</span>}
                </div>
                <span style={{ ...s.navLabel, color: isActive ? '#1A6B3C' : '#AAAAAA', fontWeight: isActive ? '600' : '400' }}>
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
  wrapper: { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', justifyContent: 'center' },
  screen:  { width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#F5F5F5' },

  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', backgroundColor: '#FFFFFF', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10 },
  headerTitle: { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  headerSub:   { fontSize: '12px', color: '#888888', margin: 0 },
  headerRight: { display: 'flex', alignItems: 'center', gap: '10px' },
  iconBtn:     { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex', alignItems: 'center' },
  notifBadge:  { position: 'absolute', top: '-5px', right: '-6px', minWidth: '16px', height: '16px', borderRadius: '8px', backgroundColor: '#DC3545', color: '#FFFFFF', fontSize: '9px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' },
  notifPanel:  { position: 'fixed', top: '64px', left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '480px', backgroundColor: '#FFFFFF', borderRadius: '0 0 20px 20px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', zIndex: 101, padding: '16px', maxHeight: '65vh', overflowY: 'auto' },
  statusToggle: { width: '82px', height: '30px', borderRadius: '15px', border: 'none', cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', padding: '0 6px', transition: 'background-color 0.3s ease', flexShrink: 0 },
  toggleThumb:  { position: 'absolute', left: '4px', width: '22px', height: '22px', borderRadius: '11px', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'transform 0.3s ease' },
  toggleText:   { fontSize: '9px', fontWeight: '800', color: '#FFFFFF', marginLeft: 'auto', userSelect: 'none', letterSpacing: '0.3px' },

  body:     { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px' },
  tabTitle: { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0 },

  grid2x2:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  metricCard:   { borderRadius: '14px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '4px' },
  metricIconRow:{ display: 'flex', alignItems: 'center', gap: '6px' },
  pulseDot:     { width: '8px', height: '8px', borderRadius: '50%', animation: 'pulse 1.4s ease-in-out infinite' },
  metricVal:    { fontSize: '26px', fontWeight: '800', margin: '4px 0 0', lineHeight: 1 },
  metricLabel:  { fontSize: '11px', color: '#555555', fontWeight: '500', margin: 0 },

  section:        { display: 'flex', flexDirection: 'column', gap: '10px' },
  sectionHead:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleRow:{ display: 'flex', alignItems: 'center', gap: '8px' },
  urgentDot:      { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#DC3545', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 },
  sectionTitle:   { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  sectionSub:     { fontSize: '12px', color: '#888888' },
  cardList:       { display: 'flex', flexDirection: 'column', gap: '10px' },
  emptyCard:      { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', boxShadow: '0 1px 5px rgba(0,0,0,0.04)' },
  emptyText:      { fontSize: '14px', color: '#1A6B3C', fontWeight: '600', margin: 0 },

  callCard:     { backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  callTop:      { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  callName:     { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 4px' },
  callInfoRow:  { display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' },
  callPhone:    { fontSize: '12px', color: '#666666' },
  callDot:      { color: '#CCCCCC', fontSize: '12px' },
  callTopRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px' },
  waitBadge:    { fontSize: '11px', fontWeight: '700', padding: '3px 9px', borderRadius: '20px' },
  urgentTag:    { fontSize: '9px', fontWeight: '800', color: '#FFFFFF', backgroundColor: '#DC3545', padding: '2px 8px', borderRadius: '4px', letterSpacing: '0.5px' },
  callItems:    { display: 'flex', flexDirection: 'column', gap: '3px' },
  callItem:     { fontSize: '13px', color: '#333333', margin: 0 },
  rxWarnRow:    { display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#FFF3E0', padding: '7px 10px', borderRadius: '8px' },
  rxWarnText:   { fontSize: '12px', color: '#E65100', fontWeight: '600' },
  rxOkRow:      { display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#E8F5EE', padding: '7px 10px', borderRadius: '8px' },
  rxOkText:     { fontSize: '12px', color: '#1A6B3C', fontWeight: '600' },
  callBtns:     { display: 'flex', gap: '8px' },
  callBtn:      { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  rejectBtn:    { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#FFFFFF', color: '#DC3545', border: '1.5px solid #DC3545', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  rxCard:      { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px' },
  rxTop:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  rxId:        { fontSize: '14px', fontWeight: '800', color: '#1A6B3C', margin: 0, fontFamily: 'monospace' },
  rxSub:       { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  rxImageBox:  { backgroundColor: '#F5F5F5', borderRadius: '10px', padding: '14px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px dashed #DDDDDD' },
  rxImageIcon: { fontSize: '24px' },
  rxImageLabel:{ flex: 1, fontSize: '13px', color: '#555555', fontWeight: '500' },
  zoomBtn:     { display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: '#1A6B3C', fontSize: '12px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  rxMeds:      { display: 'flex', flexDirection: 'column', gap: '3px' },
  rxMed:       { fontSize: '13px', color: '#333333', margin: 0 },
  doctorRow:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' },
  doctorTag:   { display: 'flex', flexDirection: 'column', gap: '2px' },
  doctorName:  { fontSize: '13px', fontWeight: '700', color: '#1A1A1A' },
  doctorHosp:  { fontSize: '11px', color: '#888888' },
  rxDate:      { fontSize: '11px', color: '#888888', flexShrink: 0 },
  checksRow:   { display: 'flex', flexDirection: 'column', gap: '6px' },
  checkItem:   { display: 'flex', alignItems: 'center', gap: '6px' },
  rxBtns:      { display: 'flex', gap: '8px' },
  approveBtn:  { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  rejectRxBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '11px', backgroundColor: '#FFFFFF', color: '#DC3545', border: '1.5px solid #DC3545', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  moreInfoBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px', backgroundColor: '#FFFFFF', color: '#E65100', border: '1.5px solid #E65100', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  whiteCard: { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 5px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '12px' },

  historyList:    { display: 'flex', flexDirection: 'column', gap: '0' },
  historyRow:     { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #F5F5F5' },
  histIconCircle: { width: '34px', height: '34px', borderRadius: '17px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  histName:       { fontSize: '13px', fontWeight: '600', color: '#1A1A1A', margin: 0 },
  histDur:        { fontSize: '11px', color: '#888888', margin: 0 },
  histRight:      { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' },
  histStatus:     { fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px' },
  histTime:       { fontSize: '10px', color: '#AAAAAA' },

  lookupBox:   { display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#F5F5F5', border: '1.5px solid #E8E8E8', borderRadius: '10px', padding: '10px 12px' },
  lookupInput: { flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#1A1A1A', fontFamily: 'inherit' },
  chipRow:     { display: 'flex', gap: '7px', flexWrap: 'wrap' },
  lookupChip:  { padding: '5px 12px', backgroundColor: '#F0F0F0', border: 'none', borderRadius: '20px', fontSize: '12px', fontWeight: '500', color: '#444444', cursor: 'pointer', fontFamily: 'inherit' },

  notesArea:    { width: '100%', padding: '11px 14px', border: '1.5px solid #E0E0E0', borderRadius: '10px', fontSize: '14px', color: '#1A1A1A', outline: 'none', fontFamily: 'inherit', resize: 'none', lineHeight: '1.5', boxSizing: 'border-box' },
  saveNotesBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', padding: '12px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  logoutBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '14px', backgroundColor: '#DC3545', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },

  bottomNav: { position: 'sticky', bottom: 0, backgroundColor: '#FFFFFF', borderTop: '1px solid #F0F0F0', display: 'flex', padding: '8px 0 12px', boxShadow: '0 -4px 16px rgba(0,0,0,0.06)' },
  navTab:    { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', position: 'relative', fontFamily: 'inherit' },
  navBadge:  { position: 'absolute', top: '-4px', right: '-4px', minWidth: '16px', height: '16px', borderRadius: '8px', backgroundColor: '#DC3545', color: '#FFFFFF', fontSize: '9px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' },
  navLabel:  { fontSize: '10px' },
  navDot:    { position: 'absolute', top: '-8px', width: '20px', height: '3px', backgroundColor: '#1A6B3C', borderRadius: '2px' },
};
