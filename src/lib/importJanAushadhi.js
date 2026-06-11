import { supabase } from './supabase'
import Papa from 'papaparse'

export const importJanAushadhi = async (csvFile) => {
  return new Promise((resolve, reject) => {
    Papa.parse(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const medicines = results.data
            .map(row => ({
              name:                   row['Generic Name']?.trim() || '',
              generic_name:           row['Generic Name']?.trim() || '',
              category:               mapCategory(row['Group Name']),
              sub_category:           row['Group Name']?.trim() || '',
              dosage_form:            getDosageForm(row['Generic Name']),
              strength:               getStrength(row['Generic Name']),
              mrp_max:                parseFloat(row['MRP']) || 0,
              unit:                   row['Unit Size']?.trim() || '',
              requires_prescription:  requiresPrescription(row['Group Name']),
              source:                 'janaushadhi',
              is_verified:            true,
              is_active:              true,
              search_tags:            row['Generic Name']?.toLowerCase() || '',
            }))
            .filter(m => m.name)

          const batchSize = 50
          let inserted = 0
          let failed = 0

          for (let i = 0; i < medicines.length; i += batchSize) {
            const batch = medicines.slice(i, i + batchSize)
            const { error } = await supabase
              .from('master_medicines')
              .insert(batch)

            if (error) {
              console.error('Batch error:', error)
              failed += batch.length
            } else {
              inserted += batch.length
            }
          }

          resolve({ inserted, failed, total: medicines.length })
        } catch (err) {
          reject(err)
        }
      },
      error: reject,
    })
  })
}

const mapCategory = (groupName) => {
  if (!groupName) return 'Other'
  const g = groupName.toLowerCase()

  if (g.includes('analgesic') || g.includes('antipyretic') || g.includes('anti-inflammatory'))
    return 'Pain Relief'
  if (g.includes('antibiotic') || g.includes('anti-infective') || g.includes('antimicrobial'))
    return 'Antibiotics'
  if (g.includes('cardiac') || g.includes('cardiovascular') || g.includes('antihypertensive'))
    return 'Cardiac'
  if (g.includes('diabetes') || g.includes('antidiabetic'))
    return 'Diabetes'
  if (g.includes('gastrointestinal') || g.includes('gastro'))
    return 'Gastro'
  if (g.includes('respiratory') || g.includes('pulmonary') || g.includes('antiasthmatic'))
    return 'Respiratory'
  if (g.includes('dermatology') || g.includes('topical') || g.includes('skin'))
    return 'Skin'
  if (g.includes('central nervous') || g.includes('cns') || g.includes('neurological'))
    return 'Neurology'
  if (g.includes('vitamin') || g.includes('mineral') || g.includes('supplement'))
    return 'Vitamins'
  if (g.includes('eye') || g.includes('ophthalmic'))
    return 'Eye Care'
  if (g.includes('gynaecology') || g.includes('obstetric'))
    return 'Gynaecology'
  if (g.includes('surgical'))
    return 'Surgical'
  if (g.includes('ayurvedic') || g.includes('herbal'))
    return 'Ayurvedic'

  return 'Other'
}

const getDosageForm = (name) => {
  if (!name) return 'Tablet'
  const n = name.toLowerCase()

  if (n.includes('tablet') || n.includes('tab'))      return 'Tablet'
  if (n.includes('capsule') || n.includes('cap'))     return 'Capsule'
  if (n.includes('syrup') || n.includes('suspension') || n.includes('oral liquid')) return 'Syrup'
  if (n.includes('injection') || n.includes('inj'))   return 'Injection'
  if (n.includes('cream') || n.includes('ointment') || n.includes('gel')) return 'Topical'
  if (n.includes('drop'))                             return 'Drops'
  if (n.includes('inhaler') || n.includes('inhalation')) return 'Inhaler'
  if (n.includes('powder'))                           return 'Powder'
  if (n.includes('solution'))                         return 'Solution'

  return 'Tablet'
}

const getStrength = (name) => {
  if (!name) return ''
  const match = name.match(/\d+\.?\d*\s*(mg|mcg|g|ml|%|iu|units?)/gi)
  return match ? match.join(', ') : ''
}

const requiresPrescription = (groupName) => {
  if (!groupName) return false
  const g = groupName.toLowerCase()
  const rxGroups = [
    'antibiotic', 'antidiabetic', 'cardiac', 'antihypertensive',
    'central nervous', 'psychiatric', 'antiepileptic',
    'narcotic', 'oncology', 'immunosuppressant',
  ]
  return rxGroups.some(r => g.includes(r))
}
