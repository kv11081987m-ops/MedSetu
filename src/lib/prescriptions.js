import { supabase } from './supabase';

// Prescription upload + signed-URL read helpers (Rx-Security Tukda 1).
// Bucket is still public today — signed URLs work identically on a public
// bucket, so this just gets the code ready ahead of the private-bucket
// switch (Tukda 3) without changing any behaviour now. New uploads store a
// bare storage PATH (not a public URL) in prescriptions.image_url /
// orders.prescription_url; getSignedRxUrl() is the one place that turns a
// path back into an openable URL, generated fresh on every read instead of
// once and stored forever (a stored signed URL would just go dead at its
// own TTL instead of staying valid).

const RX_URL_TTL_SECONDS = 60 * 10; // 10 minutes — long enough to open/view once

// ── Upload — returns the storage PATH only, never a URL ──────────
export async function uploadPrescription(file, userId) {
  const fileExt = file.name.split('.').pop();
  const path = `${userId || 'anonymous'}/rx_${Date.now()}.${fileExt}`;
  const { error } = await supabase.storage
    .from('prescriptions')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) return { path: null, error };
  return { path, error: null };
}

// ── Read — turns a stored path into a fresh, short-lived signed URL ──
// Old rows (pre-Tukda-1) still hold a full public URL — passed through
// unchanged so they keep working until Tukda 3 backfills them.
export async function getSignedRxUrl(path) {
  console.log('[RX-SIGN] input path=', path);
  if (!path) {
    console.log('[RX-SIGN] returning=', null);
    return null;
  }
  if (path.startsWith('https://') || path.startsWith('http://')) {
    console.log('[RX-SIGN] old full-URL branch, returning as-is');
    console.log('[RX-SIGN] returning=', path);
    return path;
  }

  const { data, error } = await supabase.storage
    .from('prescriptions')
    .createSignedUrl(path, RX_URL_TTL_SECONDS);
  console.log('[RX-SIGN] createSignedUrl → data=', data, 'error=', error);
  if (error) {
    console.error('[getSignedRxUrl]', error);
    console.log('[RX-SIGN] returning=', null);
    return null;
  }
  console.log('[RX-SIGN] returning=', data?.signedUrl || null);
  return data?.signedUrl || null;
}
