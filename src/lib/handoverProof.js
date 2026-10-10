import { supabase } from './supabase';

// Handover-photo helpers for "OTP nahi mila" COD deliveries (088). Same
// shape as deliveryDocs.js: store a bare storage PATH, mint short-lived
// signed URLs on read. Bucket 'delivery-handover' is private; the path's
// first segment is the order id (enforced by the storage RLS policy).

const MAX_BYTES = 10 * 1024 * 1024;
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function uploadHandoverPhoto(orderId, file) {
  if (!file) return { path: null, error: new Error('Photo chuniye') };
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) return { path: null, error: new Error('Sirf JPG/PNG/WebP photo chalegi') };
  if (file.size > MAX_BYTES) return { path: null, error: new Error('Photo 10 MB se chhoti honi chahiye') };
  const path = `${orderId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('delivery-handover')
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
  if (error) return { path: null, error };
  return { path, error: null };
}

export async function getSignedHandoverUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('delivery-handover')
    .createSignedUrl(path, 60 * 10);
  if (error) {
    console.error('[getSignedHandoverUrl]', error);
    return null;
  }
  return data?.signedUrl || null;
}

export const NO_OTP_REASONS = [
  ['customer_unaware', 'Grahak ko OTP nahi pata'],
  ['elderly_no_phone', 'Bujurg / phone nahi hai'],
  ['network_issue',    'Network issue'],
  ['other',            'Other'],
];
export const noOtpReasonLabel = (code) => NO_OTP_REASONS.find(([c]) => c === code)?.[1] || code || '';
