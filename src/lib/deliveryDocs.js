import { supabase } from './supabase';

// Delivery-partner aadhar-image upload + signed-URL read helpers —
// same shape as lib/prescriptions.js (getSignedRxUrl): store a bare
// storage PATH, never a public URL, and mint a fresh signed URL on every
// read instead of a stored one that would just go dead at its own TTL.
// Bucket is private (delivery-documents, public=false) from day one,
// unlike prescriptions' still-public bucket.

const DOC_URL_TTL_SECONDS = 60 * 10; // 10 minutes — long enough to open/view once

// ── Upload — returns the storage PATH only, never a URL ──────────
// Path's first segment must be the submitter's mobile number — enforced
// by 055_deliveryPartnerRegistration.sql's storage RLS policy (shape
// check only, see that file's caveat on what "scoped" means here).
export async function uploadAadharImage(file, mobile) {
  const fileExt = file.name.split('.').pop();
  const path = `${mobile}/aadhar_${Date.now()}.${fileExt}`;
  const { error } = await supabase.storage
    .from('delivery-documents')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) return { path: null, error };
  return { path, error: null };
}

// ── Read — turns a stored path into a fresh, short-lived signed URL ──
export async function getSignedDeliveryDocUrl(path) {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from('delivery-documents')
    .createSignedUrl(path, DOC_URL_TTL_SECONDS);
  if (error) {
    console.error('[getSignedDeliveryDocUrl]', error);
    return null;
  }
  return data?.signedUrl || null;
}
