import { useState } from 'react';
import {
  Bell, Users, Store, ShoppingBag, IndianRupee, AlertTriangle,
  FileText, Settings, Download, CheckCircle, X, ChevronRight,
  LayoutDashboard, UserCircle,
} from 'lucide-react';

// ─── Static Data ──────────────────────────────────────────────
const METRIC_CARDS = [
  { Icon: Users,         val: '1,247',   label: 'Total Users',     sub: '+23 aaj',           subColor: '#1A6B3C', color: '#1A6B3C', bg: '#E8F5EE' },
  { Icon: Store,         val: '34',      label: 'Active Sellers',  sub: '3 pending approval', subColor: '#E65100', color: '#2563EB', bg: '#EAF2FF' },
  { Icon: ShoppingBag,   val: '89',      label: 'Aaj Ke Orders',   sub: '+12% kal se',        subColor: '#1A6B3C', color: '#7C3AED', bg: '#F3EEFF' },
  { Icon: IndianRupee,   val: '₹45,280', label: 'Aaj Ka GMV',      sub: '+18% kal se',        subColor: '#1A6B3C', color: '#E65100', bg: '#FFF3E0' },
  { Icon: AlertTriangle, val: '7',       label: 'Open Disputes',   sub: '2 urgent',           subColor: '#DC3545', color: '#DC3545', bg: '#FFEBEE' },
];

const WEEK_BARS = [
  { day: 'Mon', val: 45 },
  { day: 'Tue', val: 67 },
  { day: 'Wed', val: 89 },
  { day: 'Thu', val: 72 },
  { day: 'Fri', val: 95 },
  { day: 'Sat', val: 110 },
  { day: 'Sun', val: 88 },
];
const MAX_BAR = 110;

const DISTRICTS = [
  { name: 'Deoria',       sellers: 18, pct: 75,  color: '#1A6B3C' },
  { name: 'Gorakhpur',    sellers: 10, pct: 42,  color: '#2563EB' },
  { name: 'Kushinagar',   sellers: 4,  pct: 17,  color: '#E65100' },
  { name: 'Maharajganj',  sellers: 2,  pct: 8,   color: '#888888' },
];

const TOP_MEDS = [
  'Paracetamol — 234 orders',
  'ORS Powder — 187 orders',
  'Azithromycin — 156 orders',
  'BP Machine — 89 orders',
];

const ACTIVITY = [
  { color: '#1A6B3C', text: 'New seller approved: Ram Medical, Deoria',        time: '10 min ago' },
  { color: '#2563EB', text: 'Order #MED-2024-089 delivered',                    time: '15 min ago' },
  { color: '#F59E0B', text: 'Dispute #D-089 opened',                           time: '32 min ago' },
  { color: '#1A6B3C', text: 'New user registered: Sunita Devi',                time: '45 min ago' },
  { color: '#DC3545', text: 'Seller rejected: XYZ Medical (incomplete docs)',  time: '1 ghanta pehle' },
];

const QUICK_ACTIONS = [
  { Icon: Users,         label: 'Users Manage',       color: '#2563EB', bg: '#EAF2FF' },
  { Icon: Store,         label: 'Sellers Manage',     color: '#1A6B3C', bg: '#E8F5EE' },
  { Icon: FileText,      label: 'Reports',            color: '#7C3AED', bg: '#F3EEFF' },
  { Icon: Settings,      label: 'Platform Settings',  color: '#555555', bg: '#F0F0F0' },
  { Icon: Bell,          label: 'Notifications Send', color: '#E65100', bg: '#FFF3E0' },
  { Icon: Download,      label: 'Data Export',        color: '#0D9488', bg: '#CCFBF1' },
];

const NAV_TABS = [
  { id: 'dashboard', Icon: LayoutDashboard, label: 'Dashboard', badge: null },
  { id: 'sellers',   Icon: Store,           label: 'Sellers',   badge: 3   },
  { id: 'orders',    Icon: ShoppingBag,     label: 'Orders',    badge: null },
  { id: 'disputes',  Icon: AlertTriangle,   label: 'Disputes',  badge: 7   },
  { id: 'settings',  Icon: Settings,        label: 'Settings',  badge: null },
];

// ─── Seller Approval Card ─────────────────────────────────────
function SellerCard({ seller, onApprove, onReject }) {
  const disabled = !seller.canApprove;
  return (
    <div style={{ ...s.sellerCard, borderLeftColor: '#E65100' }}>
      {/* Top */}
      <div style={s.cardTopRow}>
        <div>
          <p style={s.sellerName}>{seller.name}</p>
          <p style={s.sellerSub}>Submitted: {seller.submitted}</p>
        </div>
        <span style={s.pendingBadge}>PENDING</span>
      </div>

      {/* Info */}
      <div style={s.infoGrid}>
        {seller.info.map(({ label, val }) => (
          <div key={label} style={s.infoRow}>
            <span style={s.infoLabel}>{label}:</span>
            <span style={s.infoVal}>{val}</span>
          </div>
        ))}
      </div>

      {/* Documents */}
      <div style={s.docsBlock}>
        {seller.docs.map(({ text, ok }) => (
          <div key={text} style={s.docRow}>
            {ok
              ? <CheckCircle size={13} color="#1A6B3C" />
              : <X           size={13} color="#DC3545"  />}
            <span style={{ fontSize: '12px', color: ok ? '#1A6B3C' : '#DC3545', fontWeight: '600' }}>
              {text}
            </span>
          </div>
        ))}
        <button style={s.viewDocsBtn}>View Documents →</button>
      </div>

      {/* Warning */}
      {seller.warning && (
        <div style={s.warnRow}>
          <X size={13} color="#DC3545" />
          <span style={s.warnText}>{seller.warning}</span>
        </div>
      )}

      {/* Buttons */}
      <div style={s.sellerBtns}>
        <button
          style={{ ...s.approveBtn, opacity: disabled ? 0.45 : 1 }}
          disabled={disabled}
          onClick={() => !disabled && onApprove(seller.id)}
        >
          <CheckCircle size={14} color="#FFFFFF" />
          Approve Karo
        </button>
        <button style={s.rejectBtn} onClick={() => onReject(seller.id)}>
          <X size={14} color="#DC3545" />
          Reject Karo
        </button>
      </div>
      <button style={s.moreInfoBtn}>
        <AlertTriangle size={13} color="#E65100" />
        More Info Maango
      </button>
    </div>
  );
}

// ─── Dispute Card ─────────────────────────────────────────────
function DisputeCard({ d, onResolve }) {
  return (
    <div style={{ ...s.disputeCard, borderLeftColor: d.urgent ? '#DC3545' : '#E65100' }}>
      <div style={s.cardTopRow}>
        <div>
          <p style={s.disputeId}>{d.id}</p>
          <p style={s.disputeSub}>Customer: {d.customer} · Seller: {d.seller}</p>
        </div>
        {d.urgent && <span style={s.urgentBadge}>URGENT</span>}
      </div>
      <p style={s.disputeIssue}>"{d.issue}"</p>
      <div style={s.disputeMeta}>
        <span style={s.amtPill}>₹{d.amount}</span>
        <span style={{ fontSize: '12px', color: d.urgent ? '#DC3545' : '#E65100', fontWeight: '600' }}>
          {d.since}
        </span>
      </div>
      <div style={s.disputeBtns}>
        <button style={s.resolveBtn} onClick={() => onResolve(d.id)}>
          <CheckCircle size={14} color="#FFFFFF" />
          Resolve Karo
        </button>
        <button style={s.detailsBtn}>
          Details Dekho <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function AdminPanel() {
  const [sellers, setSellers] = useState([
    {
      id: 1, name: 'Shyam Medical Store', submitted: '2 din pehle', canApprove: true,
      info: [
        { label: 'Owner',       val: 'Shyam Lal Gupta' },
        { label: 'Location',    val: 'Padrauna, Kushinagar' },
        { label: 'Phone',       val: '+91 97XXX XXXXX' },
        { label: 'Drug License',val: 'UP-DL-2024-XXXX' },
        { label: 'Pharmacist',  val: 'Ravi Sharma (B.Pharm)' },
      ],
      docs: [
        { text: 'Drug License ✓',              ok: true },
        { text: 'Pharmacist Certificate ✓',    ok: true },
        { text: 'Shop Registration ✓',         ok: true },
        { text: 'Aadhar Card ✓',              ok: true },
      ],
      warning: null,
    },
    {
      id: 2, name: 'Durga Medical Agency', submitted: '1 din pehle', canApprove: false,
      info: [
        { label: 'Location',    val: 'Deoria Sadar' },
        { label: 'Drug License',val: 'Pending' },
      ],
      docs: [
        { text: 'Drug License — MISSING', ok: false },
        { text: 'Shop Registration ✓',    ok: true  },
      ],
      warning: 'License Missing — Approval blocked',
    },
  ]);

  const [disputes, setDisputes] = useState([
    { id: 'Dispute #D-089', customer: 'Ramesh Kumar',  seller: 'Arogya Medical Hall', issue: 'Wrong medicine delivered', amount: '450', since: '2 din se open hai', urgent: true  },
    { id: 'Dispute #D-088', customer: 'Priya Singh',   seller: 'City Medical Store',  issue: 'Delivery nahi hua',        amount: '892', since: '1 din se open',    urgent: false },
  ]);

  const [settings, setSettings] = useState({
    registrations: true,
    delivery: true,
    pharmCall: true,
    maintenance: false,
  });

  const [activeTab, setActiveTab] = useState('dashboard');

  const handleApproveSeller = (id) => setSellers((s) => s.filter((x) => x.id !== id));
  const handleRejectSeller  = (id) => setSellers((s) => s.filter((x) => x.id !== id));
  const handleResolve       = (id) => setDisputes((d) => d.filter((x) => x.id !== id));

  const toggleSetting = (key) => setSettings((prev) => ({ ...prev, [key]: !prev[key] }));

  const totalWeek = WEEK_BARS.reduce((a, b) => a + b.val, 0);

  return (
    <div style={s.wrapper}>
      <div style={s.screen}>

        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <p style={s.headerTitle}>MedSetu Admin</p>
            <p style={s.headerSub}>Super Admin</p>
          </div>
          <div style={s.headerRight}>
            <button style={s.iconBtn}>
              <div style={{ position: 'relative' }}>
                <Bell size={22} color="#1A1A1A" />
                <span style={s.notifBadge}>5</span>
              </div>
            </button>
            <div style={s.avatar}><span style={s.avatarLetter}>A</span></div>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={s.body}>

          {/* Platform Summary — horizontal scroll */}
          <div style={s.hScroll}>
            {METRIC_CARDS.map(({ Icon, val, label, sub, subColor, color, bg }) => (
              <div key={label} style={{ ...s.metricCard, backgroundColor: bg }}>
                <Icon size={20} color={color} />
                <p style={{ ...s.metricVal, color }}>{val}</p>
                <p style={s.metricLabel}>{label}</p>
                <p style={{ ...s.metricSub, color: subColor }}>{sub}</p>
              </div>
            ))}
          </div>

          {/* Seller Approval */}
          <div style={s.section}>
            <div style={s.sectionHead}>
              <div style={s.titleRow}>
                <span style={s.orangeDot} />
                <span style={s.sectionTitle}>Seller Approval Pending</span>
              </div>
              <span style={s.sectionSub}>{sellers.length} pending</span>
            </div>

            {sellers.length === 0 ? (
              <div style={s.emptyCard}>
                <CheckCircle size={28} color="#1A6B3C" />
                <p style={s.emptyText}>Sab sellers approved!</p>
              </div>
            ) : (
              sellers.map((seller) => (
                <SellerCard
                  key={seller.id}
                  seller={seller}
                  onApprove={handleApproveSeller}
                  onReject={handleRejectSeller}
                />
              ))
            )}
          </div>

          {/* Platform Analytics */}
          <div style={s.whiteCard}>
            <p style={s.sectionTitle}>Platform Overview</p>

            {/* Bar chart */}
            <div>
              <div style={s.chartRow}>
                {WEEK_BARS.map(({ day, val }) => (
                  <div key={day} style={s.barCol}>
                    <span style={s.barVal}>{val}</span>
                    <div style={s.barTrack}>
                      <div style={{
                        ...s.barFill,
                        height: `${Math.round((val / MAX_BAR) * 80)}px`,
                      }} />
                    </div>
                    <span style={s.barDay}>{day}</span>
                  </div>
                ))}
              </div>
              <p style={s.chartTotal}>This Week: <strong>{totalWeek} orders</strong></p>
            </div>

            {/* District coverage */}
            <div>
              <p style={s.subTitle}>District Coverage</p>
              {DISTRICTS.map(({ name, sellers: cnt, pct, color }) => (
                <div key={name} style={s.distRow}>
                  <div style={s.distMeta}>
                    <span style={s.distName}>{name}</span>
                    <span style={s.distCount}>{cnt} sellers</span>
                  </div>
                  <div style={s.progressTrack}>
                    <div style={{ ...s.progressFill, width: `${pct}%`, backgroundColor: color }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Top medicines */}
            <div>
              <p style={s.subTitle}>Top Medicines</p>
              <div style={s.pillRow}>
                {TOP_MEDS.map((m) => (
                  <span key={m} style={s.medPill}>{m}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Disputes */}
          <div style={s.section}>
            <div style={s.sectionHead}>
              <div style={s.titleRow}>
                <span style={s.redDot} />
                <span style={s.sectionTitle}>Open Disputes</span>
              </div>
              <span style={s.sectionSub}>{disputes.length} open</span>
            </div>

            {disputes.length === 0 ? (
              <div style={s.emptyCard}>
                <CheckCircle size={28} color="#1A6B3C" />
                <p style={s.emptyText}>Koi dispute nahi!</p>
              </div>
            ) : (
              disputes.map((d) => (
                <DisputeCard key={d.id} d={d} onResolve={handleResolve} />
              ))
            )}
          </div>

          {/* Activity Log */}
          <div style={s.whiteCard}>
            <p style={s.sectionTitle}>Recent Activity</p>
            <div style={s.timeline}>
              {ACTIVITY.map(({ color, text, time }, i) => (
                <div key={i} style={s.timelineRow}>
                  <div style={{ ...s.timelineDot, backgroundColor: color }} />
                  <div style={s.timelineContent}>
                    <p style={s.timelineText}>{text}</p>
                    <p style={s.timelineTime}>{time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div style={s.whiteCard}>
            <p style={s.sectionTitle}>Quick Actions</p>
            <div style={s.actionGrid}>
              {QUICK_ACTIONS.map(({ Icon, label, color, bg }) => (
                <button key={label} style={{ ...s.actionBtn, backgroundColor: bg }}>
                  <Icon size={22} color={color} />
                  <span style={{ ...s.actionLabel, color }}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Platform Settings */}
          <div style={s.whiteCard}>
            <p style={s.sectionTitle}>Quick Settings</p>
            {[
              { key: 'registrations', label: 'Naye Registrations' },
              { key: 'delivery',      label: 'Home Delivery'       },
              { key: 'pharmCall',     label: 'Pharmacist Call'     },
              { key: 'maintenance',   label: 'Maintenance Mode'    },
            ].map(({ key, label }) => {
              const on = settings[key];
              return (
                <div key={key} style={s.toggleRow}>
                  <span style={s.toggleLabel}>{label}</span>
                  <button
                    style={{ ...s.toggleTrack, backgroundColor: on ? '#1A6B3C' : '#CCCCCC' }}
                    onClick={() => toggleSetting(key)}
                  >
                    <span style={{ ...s.toggleThumb, transform: on ? 'translateX(20px)' : 'translateX(0)' }} />
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ height: '80px' }} />
        </div>

        {/* ── Bottom Nav ── */}
        <nav style={s.bottomNav}>
          {NAV_TABS.map(({ id, Icon, label, badge }) => {
            const active = activeTab === id;
            return (
              <button key={id} style={s.navTab} onClick={() => setActiveTab(id)}>
                <div style={{ position: 'relative' }}>
                  <Icon size={22} color={active ? '#1A6B3C' : '#AAAAAA'}
                    strokeWidth={active ? 2.5 : 1.8} />
                  {badge > 0 && (
                    <span style={s.navBadge}>{badge}</span>
                  )}
                </div>
                <span style={{ ...s.navLabel, color: active ? '#1A6B3C' : '#AAAAAA',
                  fontWeight: active ? '600' : '400' }}>
                  {label}
                </span>
                {active && <span style={s.navActiveLine} />}
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

  // Header
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px 12px', backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 10,
  },
  headerTitle: { fontSize: '18px', fontWeight: '800', color: '#1A1A1A', margin: 0 },
  headerSub:   { fontSize: '12px', color: '#888888', margin: 0 },
  headerRight: { display: 'flex', alignItems: 'center', gap: '10px' },
  iconBtn: { background: 'none', border: 'none', padding: '6px', cursor: 'pointer', borderRadius: '8px', display: 'flex' },
  notifBadge: {
    position: 'absolute', top: '-5px', right: '-6px',
    minWidth: '16px', height: '16px', borderRadius: '8px',
    backgroundColor: '#DC3545', color: '#FFFFFF',
    fontSize: '9px', fontWeight: '800',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px',
  },
  avatar: {
    width: '36px', height: '36px', borderRadius: '18px',
    backgroundColor: '#1A6B3C', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  avatarLetter: { color: '#FFFFFF', fontWeight: '800', fontSize: '16px' },

  // Body
  body: { flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' },

  // Horizontal scroll metric cards
  hScroll: { display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' },
  metricCard: {
    borderRadius: '14px', padding: '14px 16px', flexShrink: 0, width: '140px',
    display: 'flex', flexDirection: 'column', gap: '4px',
  },
  metricVal:   { fontSize: '28px', fontWeight: '800', margin: '4px 0 0', lineHeight: 1 },
  metricLabel: { fontSize: '12px', color: '#444444', fontWeight: '600', margin: 0 },
  metricSub:   { fontSize: '11px', fontWeight: '700', margin: 0 },

  // Section
  section: { display: 'flex', flexDirection: 'column', gap: '10px' },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  sectionTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  sectionSub:   { fontSize: '12px', color: '#888888' },
  orangeDot: { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#E65100', display: 'inline-block', animation: 'pulse 1.3s ease-in-out infinite', flexShrink: 0 },
  redDot:    { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#DC3545', display: 'inline-block', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', boxShadow: '0 1px 5px rgba(0,0,0,0.04)' },
  emptyText: { fontSize: '14px', color: '#1A6B3C', fontWeight: '600', margin: 0 },

  // Seller Card
  sellerCard: {
    backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid',
    padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '10px',
  },
  cardTopRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  sellerName: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: 0 },
  sellerSub:  { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  pendingBadge: {
    fontSize: '10px', fontWeight: '800', color: '#E65100',
    backgroundColor: '#FFF3E0', padding: '3px 9px', borderRadius: '20px', flexShrink: 0,
  },
  infoGrid:  { display: 'flex', flexDirection: 'column', gap: '5px' },
  infoRow:   { display: 'flex', gap: '6px' },
  infoLabel: { fontSize: '12px', color: '#888888', fontWeight: '600', minWidth: '90px' },
  infoVal:   { fontSize: '12px', color: '#1A1A1A', fontWeight: '500' },
  docsBlock: { display: 'flex', flexDirection: 'column', gap: '6px' },
  docRow:    { display: 'flex', alignItems: 'center', gap: '6px' },
  viewDocsBtn: {
    background: 'none', border: 'none', color: '#2563EB',
    fontSize: '12px', fontWeight: '700', cursor: 'pointer',
    padding: '4px 0', fontFamily: 'inherit', textAlign: 'left',
  },
  warnRow: {
    display: 'flex', alignItems: 'center', gap: '6px',
    backgroundColor: '#FFEBEE', padding: '8px 10px', borderRadius: '8px',
  },
  warnText: { fontSize: '12px', color: '#DC3545', fontWeight: '600' },
  sellerBtns: { display: 'flex', gap: '8px' },
  approveBtn: {
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
  moreInfoBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '10px', backgroundColor: '#FFFFFF', color: '#E65100',
    border: '1.5px solid #E65100', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // White card
  whiteCard: {
    backgroundColor: '#FFFFFF', borderRadius: '14px', padding: '16px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '14px',
  },
  subTitle: { fontSize: '13px', fontWeight: '700', color: '#444444', margin: 0 },

  // Bar chart
  chartRow: { display: 'flex', alignItems: 'flex-end', gap: '6px', justifyContent: 'space-between', paddingBottom: '4px' },
  barCol: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flex: 1 },
  barVal: { fontSize: '9px', fontWeight: '700', color: '#555555' },
  barTrack: { width: '100%', height: '80px', backgroundColor: '#F0F0F0', borderRadius: '4px', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: '#1A6B3C', borderRadius: '4px 4px 0 0', transition: 'height 0.6s ease' },
  barDay: { fontSize: '10px', color: '#888888', fontWeight: '600' },
  chartTotal: { fontSize: '13px', color: '#555555', margin: '6px 0 0', textAlign: 'center' },

  // District
  distRow: { display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '8px' },
  distMeta: { display: 'flex', justifyContent: 'space-between' },
  distName:  { fontSize: '12px', fontWeight: '600', color: '#1A1A1A' },
  distCount: { fontSize: '12px', color: '#888888' },
  progressTrack: { height: '7px', backgroundColor: '#F0F0F0', borderRadius: '4px', overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: '4px', transition: 'width 0.6s ease' },

  // Med pills
  pillRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  medPill: {
    padding: '5px 12px', backgroundColor: '#E8F5EE',
    borderRadius: '20px', fontSize: '11px', fontWeight: '600', color: '#1A6B3C',
  },

  // Dispute card
  disputeCard: {
    backgroundColor: '#FFFFFF', borderRadius: '14px', borderLeft: '4px solid',
    padding: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '8px',
  },
  disputeId:    { fontSize: '14px', fontWeight: '800', color: '#1A1A1A', margin: 0, fontFamily: 'monospace' },
  disputeSub:   { fontSize: '12px', color: '#888888', margin: '2px 0 0' },
  urgentBadge:  { fontSize: '10px', fontWeight: '800', color: '#FFFFFF', backgroundColor: '#DC3545', padding: '3px 9px', borderRadius: '4px', flexShrink: 0, letterSpacing: '0.5px' },
  disputeIssue: { fontSize: '13px', color: '#333333', fontStyle: 'italic', margin: 0 },
  disputeMeta:  { display: 'flex', alignItems: 'center', gap: '10px' },
  amtPill: {
    fontSize: '13px', fontWeight: '800', color: '#1A6B3C',
    backgroundColor: '#E8F5EE', padding: '3px 10px', borderRadius: '20px',
  },
  disputeBtns: { display: 'flex', gap: '8px', alignItems: 'center' },
  resolveBtn: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '11px', backgroundColor: '#1A6B3C', color: '#FFFFFF',
    border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  detailsBtn: {
    display: 'flex', alignItems: 'center', gap: '2px',
    background: 'none', border: 'none', color: '#2563EB',
    fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0',
  },

  // Activity
  timeline: { display: 'flex', flexDirection: 'column', gap: '0' },
  timelineRow: { display: 'flex', gap: '12px', padding: '10px 0', borderBottom: '1px solid #F5F5F5', alignItems: 'flex-start' },
  timelineDot: { width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0, marginTop: '4px' },
  timelineContent: { flex: 1 },
  timelineText: { fontSize: '13px', color: '#1A1A1A', margin: 0, lineHeight: '1.4' },
  timelineTime: { fontSize: '11px', color: '#AAAAAA', margin: '2px 0 0' },

  // Quick actions grid
  actionGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  actionBtn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
    padding: '16px 8px', borderRadius: '12px', border: 'none',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  actionLabel: { fontSize: '12px', fontWeight: '700', textAlign: 'center' },

  // Settings toggles
  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #F5F5F5' },
  toggleLabel: { fontSize: '14px', fontWeight: '500', color: '#1A1A1A' },
  toggleTrack: {
    width: '44px', height: '26px', borderRadius: '13px',
    border: 'none', cursor: 'pointer', position: 'relative',
    transition: 'background-color 0.3s ease', flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute', top: '3px', left: '3px',
    width: '20px', height: '20px', borderRadius: '10px',
    backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.3s ease',
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
  navLabel:      { fontSize: '10px' },
  navActiveLine: { position: 'absolute', top: '-8px', width: '20px', height: '3px', backgroundColor: '#1A6B3C', borderRadius: '2px' },
};
