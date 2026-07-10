import { supabase } from './supabase'
import { getCurrentSeller } from './auth'

export const searchMasterMedicines = async (query) => {
  if (!query || query.length < 2) return []

  const { data } = await supabase
    .from('master_medicines')
    .select('id, name, generic_name, salt_composition, category, dosage_form, manufacturer, mrp_max, requires_prescription, source, commission_band')
    .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%,salt_composition.ilike.%${query}%`)
    .eq('is_active', true)
    .gt('mrp_max', 0)
    .order('name')
    .limit(10)

  return data || []
}

export const fetchSellerInventory = async () => {
  const seller = await getCurrentSeller()
  if (!seller) return []

  const { data } = await supabase
    .from('seller_inventory')
    .select(`
      *,
      master_medicines (
        id, name, generic_name, salt_composition,
        category, dosage_form, manufacturer, mrp_max,
        requires_prescription, source
      )
    `)
    .eq('seller_id', seller.id)
    .order('created_at', { ascending: false })

  return data || []
}

export const addToSellerInventory = async (medicineId, details) => {
  const seller = await getCurrentSeller()
  if (!seller) throw new Error('Seller nahi mila')

  const { data, error } = await supabase
    .from('seller_inventory')
    .upsert({
      seller_id: seller.id,
      medicine_id: medicineId,
      selling_price:      parseFloat(details.sellingPrice),
      stock_quantity:     parseInt(details.stock),
      unit:               details.unit || 'strips',
      expiry_date:        details.expiryDate || null,
      batch_number:       details.batchNumber || null,
      is_available:       parseInt(details.stock) > 0,
      min_order_quantity: parseInt(details.minOrderQuantity) || 1,
    }, {
      onConflict: 'seller_id,medicine_id',
    })
    .select()

  if (error) throw error
  return data
}

export const updateInventoryItem = async (inventoryId, updates) => {
  const { error } = await supabase
    .from('seller_inventory')
    .update({
      stock_quantity:     updates.stock,
      selling_price:      updates.selling_price,
      expiry_date:        updates.expiry_date || null,
      // Only live if there's real stock AND a real rate — a pending
      // (selling_price null) item must not become visible to customers
      // just because stock was updated; it needs its rate set too.
      is_available:       updates.stock > 0 && updates.selling_price > 0,
      ...(updates.min_order_quantity != null ? { min_order_quantity: updates.min_order_quantity } : {}),
    })
    .eq('id', inventoryId)

  if (error) throw error
}

export const fetchWholesalerInventory = async (sellerId) => {
  if (!sellerId) return [];
  const { data } = await supabase
    .from('seller_inventory')
    .select(`
      *,
      master_medicines (
        id, name, generic_name, salt_composition,
        category, dosage_form, manufacturer, mrp_max,
        requires_prescription, source
      )
    `)
    .eq('seller_id', sellerId)
    .eq('is_available', true)
    .order('created_at', { ascending: false });
  return data || [];
};

// Same query as fetchWholesalerInventory (nothing in the join is actually
// B2B-specific — that lives entirely in the caller's UI/framing), kept as
// its own named export so the customer-facing screen doesn't read as
// "borrowing" a wholesaler function.
export const fetchStoreInventory = fetchWholesalerInventory;

export const removeFromInventory = async (inventoryId) => {
  const { error } = await supabase
    .from('seller_inventory')
    .delete()
    .eq('id', inventoryId)

  if (error) throw error
}

// ── Release reserve on confirmed-order CANCEL — also used internally
// to roll back partial reservations (see reserveStock below).
export const releaseStock = async (sellerId, items) => {
  const failures = [];
  for (const item of items) {
    const medId = item.medicine_id || item.id;
    const qty   = item.quantity ?? item.qty ?? 0;
    if (!medId || qty <= 0) continue;

    const { data, error } = await supabase.rpc('release_stock', {
      p_seller_id: sellerId, p_medicine_id: medId, p_qty: qty,
    });
    if (error || !data) {
      console.error('release_stock RPC error:', error);
      failures.push(item.name || item.medicine_name || 'Medicine');
    }
  }
  return { success: failures.length === 0, failures };
};

// ── Reserve stock on order ACCEPT (2-stage buffer) ────────────
// Atomic per item via the reserve_stock DB function — a concurrent
// accept on the last unit can't oversell, since the function's UPDATE
// only matches while enough stock is actually still available. If any
// item in a multi-item order fails, everything already reserved for
// earlier items in this same call is released back before returning,
// so a partial accept never leaves half an order reserved.
export const reserveStock = async (sellerId, items) => {
  const reservedSoFar = [];
  for (const item of items) {
    const medId = item.medicine_id || item.id;
    const qty   = item.quantity ?? item.qty ?? 0;
    if (!medId || qty <= 0) continue;

    const { data, error } = await supabase.rpc('reserve_stock', {
      p_seller_id: sellerId, p_medicine_id: medId, p_qty: qty,
    });
    const result = data?.[0];

    if (error || !result?.success) {
      if (error) console.error('reserve_stock RPC error:', error);
      if (reservedSoFar.length) await releaseStock(sellerId, reservedSoFar);
      const name = item.name || item.medicine_name || 'Medicine';
      const available = result?.available ?? 0;
      return {
        success: false,
        message: error
          ? 'Stock check fail hui — dobara try karo'
          : `Stock kam hai — ${name} ke sirf ${available} unit bache hain`,
      };
    }
    reservedSoFar.push({ medicine_id: medId, quantity: qty, name: item.name || item.medicine_name });
  }
  return { success: true };
};

// ── B2B Lot Auto-Add: retailer confirms receipt of a delivered order ──
// Unlike addToSellerInventory (resolves seller via getCurrentSeller, and
// overwrites stock_quantity), this takes an explicit retailerId — the
// caller here is the buying retailer's own session, adding stock to
// THEIR inventory based on an order fulfilled by a wholesaler — and adds
// stock additively (existing + received), since this represents a new
// lot arriving on top of whatever the retailer already has.
// Returns per-item results so the caller can prompt for a selling price
// on newly-created rows (is_available stays false until the retailer sets one).
export const addLotToRetailerInventory = async (retailerId, order) => {
  const items = order?.order_items || [];
  const results = [];

  for (const item of items) {
    const medId = item.medicine_id;
    const qty   = item.quantity || 0;
    if (!medId || qty <= 0) continue;

    const { data: existing, error: selErr } = await supabase
      .from('seller_inventory')
      .select('id, stock_quantity, selling_price')
      .eq('seller_id', retailerId)
      .eq('medicine_id', medId)
      .maybeSingle();
    if (selErr) { console.error('addLotToRetailerInventory SELECT error:', selErr); continue; }

    if (existing) {
      const newStock = (existing.stock_quantity || 0) + qty;
      const { error: updErr } = await supabase
        .from('seller_inventory')
        .update({
          stock_quantity: newStock,
          cost_price:     item.unit_price,
          // selling_price / is_available left untouched here — an already-
          // listed item stays live at its current price through a restock;
          // the rate-confirm UI offers to update selling_price separately.
        })
        .eq('id', existing.id);
      if (updErr) { console.error('addLotToRetailerInventory UPDATE error:', updErr); continue; }
      results.push({ inventoryId: existing.id, medicineId: medId, name: item.name, quantity: qty, costPrice: item.unit_price, existingSellingPrice: existing.selling_price, isNew: false });
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('seller_inventory')
        .insert({
          seller_id:          retailerId,
          medicine_id:        medId,
          stock_quantity:     qty,
          cost_price:         item.unit_price,
          selling_price:      null,
          unit:               'strips',
          min_order_quantity: 1,
          is_available:       false, // pending — hidden from customers until retailer sets a rate
        })
        .select()
        .maybeSingle();
      if (insErr) { console.error('addLotToRetailerInventory INSERT error:', insErr); continue; }
      results.push({ inventoryId: inserted?.id, medicineId: medId, name: item.name, quantity: qty, costPrice: item.unit_price, isNew: true });
    }
  }

  return results;
};

export const requestNewMedicine = async (medicineData) => {
  const seller = await getCurrentSeller()
  if (!seller) return

  const { data, error } = await supabase
    .from('medicine_requests')
    .insert({
      seller_id: seller.id,
      name: medicineData.name,
      generic_name: medicineData.genericName || null,
      brand: medicineData.brand || null,
      salt_composition: medicineData.salt || null,
      category: medicineData.category || null,
      manufacturer: medicineData.manufacturer || null,
      requires_prescription: medicineData.requiresRx || false,
      status: 'pending',
    })
    .select()

  if (error) throw error
  return data
}
