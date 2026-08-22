import { useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Locate } from 'lucide-react';

// R6-B2: Leaflet's default marker icon references image paths that break
// under bundlers (webpack/vite rewrite the url() the CSS/JS expects) —
// this is Leaflet's own documented fix, pointing the default icon at the
// unpkg CDN instead of a local bundled asset. Moved here from
// UserProfile.jsx (A3b) along with the map picker itself — this is the
// only place in the app that renders a Leaflet <Marker> now.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Deoria town center — shown until the customer sets a pin (R6-B2).
const DEORIA_CENTER = [26.5024, 83.7791];

// ─── Address map picker (R6-B2) ────────────────────────────────
// Draggable marker + click-to-place, both call onChange(lat, lng).
function MapClickHandler({ onChange }) {
  useMapEvents({
    click(e) { onChange(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

function AddressMapPicker({ latitude, longitude, onChange }) {
  const mapRef = useRef(null);
  const [locError, setLocError] = useState('');
  const hasPin = latitude != null && longitude != null;
  const position = hasPin ? [latitude, longitude] : DEORIA_CENTER;

  const handleUseCurrentLocation = () => {
    setLocError('');
    if (!navigator.geolocation) {
      setLocError('Location nahi mili, pin haath se lagayein');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        onChange(lat, lng);
        mapRef.current?.flyTo([lat, lng], 16);
      },
      () => setLocError('Location nahi mili, pin haath se lagayein'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div>
      <div style={s.mapWrap}>
        <MapContainer
          ref={mapRef}
          center={position}
          zoom={hasPin ? 16 : 13}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          <MapClickHandler onChange={onChange} />
          <Marker
            position={position}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const { lat, lng } = e.target.getLatLng();
                onChange(lat, lng);
              },
            }}
          />
        </MapContainer>
      </div>
      <button type="button" style={s.locBtn} onClick={handleUseCurrentLocation}>
        <Locate size={12} color="#1A6B3C" />
        Meri Location
      </button>
      {locError && <p style={s.locError}>{locError}</p>}
      <p style={s.mapHint}>Pin ko ghar par kheech kar sahi jagah lagayein (optional)</p>
    </div>
  );
}

// ─── Address Form (A3b) ───────────────────────────────────────────
// Extracted out of UserProfile.jsx so Checkout.jsx (A4+) can reuse the
// exact same fields/validation instead of a second copy. Pure controlled
// component: `value`/`onChange` own the form state (shape: label,
// address_line, city, district, state, pincode, latitude, longitude,
// phone), `onSave`/`onCancel` are the caller's own handlers (insert vs
// edit, refresh, close) — this component only renders fields and owns
// its own inline phone-validation error, exactly as UserProfile.jsx's
// inline JSX did before this extraction.
export default function AddressForm({ value, onChange, onSave, onCancel, isEditing, phoneError, setPhoneError }) {
  const setField = (field, val) => onChange((p) => ({ ...p, [field]: val }));

  return (
    <>
      <p style={s.modalTitle}>{isEditing ? 'Address Edit Karo' : 'Naya Address Add Karo'}</p>

      {/* Label */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '2px' }}>
        {['Ghar', 'Office', 'Other'].map((lbl) => (
          <button
            key={lbl}
            style={{
              flex: 1, padding: '6px',
              border: value.label === lbl ? '1.5px solid #1A6B3C' : '1.5px solid #E0E0E0',
              backgroundColor: value.label === lbl ? '#E8F5EE' : '#FFFFFF',
              color: value.label === lbl ? '#1A6B3C' : '#888888',
              borderRadius: '7px', fontSize: '12px', fontWeight: '600',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
            onClick={() => setField('label', lbl)}
          >{lbl}</button>
        ))}
      </div>

      {/* Address Line */}
      <textarea
        style={{ ...s.infoInput, resize: 'none', lineHeight: '1.4', padding: '7px 10px' }}
        rows={2}
        placeholder="Gali, Mohalla, Landmark..."
        value={value.address_line}
        onChange={(e) => setField('address_line', e.target.value)}
      />

      {/* Map picker (R6-B2) — optional, latitude/longitude stay null
          until the customer drags/clicks/uses current location */}
      <AddressMapPicker
        latitude={value.latitude}
        longitude={value.longitude}
        onChange={(lat, lng) => onChange((p) => ({ ...p, latitude: lat, longitude: lng }))}
      />

      {/* Pincode */}
      <input
        style={s.infoInput}
        placeholder="Pincode (6 digits)"
        maxLength={6}
        value={value.pincode}
        onChange={(e) => setField('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
      />

      {/* Mobile Number — mandatory, per-address (delivery contact for
          this specific address, not users.phone) */}
      <input
        style={{ ...s.infoInput, border: phoneError ? '1.5px solid #DC3545' : s.infoInput.border }}
        placeholder="Mobile Number (delivery ke liye)"
        type="tel"
        inputMode="numeric"
        maxLength={10}
        value={value.phone}
        onChange={(e) => {
          setField('phone', e.target.value.replace(/\D/g, '').slice(0, 10));
          setPhoneError('');
        }}
      />
      {phoneError && <p style={s.fieldError}>{phoneError}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <button style={s.modalPrimary} onClick={onSave}>Save Karo</button>
        <button style={s.modalSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────
// Own local copies (not shared with UserProfile.jsx's `s`) — these exact
// values (colors, sizes) are unchanged from before the extraction, just
// no longer reused via a shared object since UserProfile.jsx's own `s`
// still needs infoInput/fieldError/modalTitle/modalPrimary/modalSecondary
// for its Personal Jankari fields and Logout modal.
const s = {
  modalTitle: { fontSize: '15px', fontWeight: '800', color: '#1A1A1A', margin: 0, textAlign: 'center' },
  infoInput: {
    width: '100%', border: '1.5px solid #1A6B3C', borderRadius: '8px',
    padding: '5px 9px', fontSize: '13px', color: '#1A1A1A',
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  },
  fieldError: { fontSize: '10.5px', color: '#DC3545', margin: '2px 0 0', fontWeight: '600' },
  modalPrimary: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '11px', backgroundColor: '#DC3545', color: '#FFFFFF',
    border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  modalSecondary: {
    padding: '11px', backgroundColor: '#F5F5F5', color: '#555555',
    border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  mapWrap: {
    height: '160px', borderRadius: '10px', overflow: 'hidden',
    border: '1.5px solid #E0E0E0', marginBottom: '4px',
  },
  locBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
    width: '100%', padding: '7px', marginBottom: '2px',
    backgroundColor: '#FFFFFF', border: '1.5px solid #1A6B3C', borderRadius: '7px',
    color: '#1A6B3C', fontSize: '11px', fontWeight: '700',
    cursor: 'pointer', fontFamily: 'inherit',
  },
  locError: { fontSize: '10.5px', color: '#DC3545', margin: '0 0 3px', textAlign: 'center' },
  mapHint: { fontSize: '10.5px', color: '#999999', margin: '0 0 4px', textAlign: 'center' },
};
