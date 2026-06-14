import { supabase } from './supabase'
import { getCurrentSeller } from './auth'

export const searchMasterMedicines = async (query) => {
  if (!query || query.length < 2) return []

  const { data } = await supabase
    .from('master_medicines')
    .select('id, name, generic_name, salt_composition, category, dosage_form, manufacturer, mrp_max, requires_prescription, source')
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
      selling_price: parseFloat(details.sellingPrice),
      stock_quantity: parseInt(details.stock),
      unit: details.unit || 'strips',
      expiry_date: details.expiryDate || null,
      batch_number: details.batchNumber || null,
      is_available: parseInt(details.stock) > 0,
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
      stock_quantity: updates.stock,
      selling_price: updates.selling_price,
      expiry_date: updates.expiry_date || null,
      is_available: updates.stock > 0,
    })
    .eq('id', inventoryId)

  if (error) throw error
}

export const removeFromInventory = async (inventoryId) => {
  const { error } = await supabase
    .from('seller_inventory')
    .delete()
    .eq('id', inventoryId)

  if (error) throw error
}

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
