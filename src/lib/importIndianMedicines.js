import Papa from 'papaparse'
import { supabase } from './supabase'

export const importIndianMedicines = async (csvFile, onProgress) => {
  return new Promise((resolve, reject) => {
    Papa.parse(csvFile, {
      header: true,
      skipEmptyLines: true,
      chunk: async (results, parser) => {
        parser.pause()

        try {
          const medicines = results.data
            .filter(row =>
              row.Is_discontinued === 'FALSE' ||
              row.Is_discontinued === 'false'
            )
            .map(row => ({
              name: (row.name || '').trim().substring(0, 200),
              generic_name: (
                row.salt_composition ||
                row.short_composition1 ||
                ''
              ).trim().substring(0, 200),
              brand_names: row.name?.trim() || '',
              salt_composition: (row.salt_composition || '').trim(),
              category: mapCategory(row.type, row.salt_composition),
              dosage_form: getDosageForm(row.name, row.pack_size_label),
              manufacturer: (row.manufacturer_name || '').trim().substring(0, 200),
              mrp_max: parseFloat(row.price) || 0,
              unit: getUnit(row.pack_size_label),
              requires_prescription: requiresPrescription(row.salt_composition),
              is_generic: false,
              source: 'indian_dataset',
              is_verified: true,
              is_active: true,
              search_tags: [
                row.name,
                row.salt_composition,
                row.short_composition1,
                row.manufacturer_name,
              ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .substring(0, 500),
            }))
            .filter(m => m.name)

          if (medicines.length > 0) {
            for (let i = 0; i < medicines.length; i += 50) {
              const batch = medicines.slice(i, i + 50)
              await supabase.from('master_medicines').insert(batch)
            }
          }

          if (onProgress) onProgress(medicines.length)
        } catch (err) {
          console.error('Chunk error:', err)
        }

        parser.resume()
      },
      complete: () => resolve(true),
      error: reject,
      chunkSize: 1024 * 10,
    })
  })
}

const mapCategory = (type, salt) => {
  if (!salt && !type) return 'Other'
  const s = (salt || '').toLowerCase()
  const t = (type || '').toLowerCase()

  if (s.includes('paracetamol') || s.includes('ibuprofen') ||
      s.includes('diclofenac') || s.includes('aspirin'))
    return 'Pain Relief'
  if (s.includes('amoxicillin') || s.includes('azithromycin') ||
      s.includes('ciprofloxacin') || s.includes('antibiotic'))
    return 'Antibiotics'
  if (s.includes('metformin') || s.includes('glipizide') || s.includes('insulin'))
    return 'Diabetes'
  if (s.includes('amlodipine') || s.includes('atenolol') || s.includes('losartan'))
    return 'Cardiac'
  if (s.includes('omeprazole') || s.includes('pantoprazole') || s.includes('ranitidine'))
    return 'Gastro'
  if (s.includes('salbutamol') || s.includes('montelukast') || s.includes('ambroxol'))
    return 'Respiratory'
  if (s.includes('cetirizine') || s.includes('loratadine') || s.includes('fexofenadine'))
    return 'Allergy'
  if (s.includes('vitamin') || s.includes('calcium') || s.includes('iron'))
    return 'Vitamins'
  if (t.includes('ayurvedic') || t.includes('herbal'))
    return 'Ayurvedic'
  if (t.includes('surgical'))
    return 'Surgical'

  return 'Other'
}

const getDosageForm = (name, pack) => {
  const text = ((name || '') + ' ' + (pack || '')).toLowerCase()

  if (text.includes('tablet') || text.includes(' tab')) return 'Tablet'
  if (text.includes('capsule') || text.includes(' cap')) return 'Capsule'
  if (text.includes('syrup') || text.includes('suspension') || text.includes('liquid')) return 'Syrup'
  if (text.includes('injection') || text.includes(' inj')) return 'Injection'
  if (text.includes('cream') || text.includes('ointment') || text.includes('gel')) return 'Topical'
  if (text.includes('drop')) return 'Drops'
  if (text.includes('inhaler')) return 'Inhaler'
  if (text.includes('powder')) return 'Powder'
  if (text.includes('solution')) return 'Solution'

  return 'Tablet'
}

const getUnit = (packLabel) => {
  if (!packLabel) return 'units'
  const p = packLabel.toLowerCase()

  if (p.includes('strip of')) {
    const match = p.match(/strip of (\d+)/)
    return match ? match[1] + ' tablets/strip' : 'strip'
  }
  if (p.includes('bottle of')) return 'bottle'
  if (p.includes('tube of')) return 'tube'
  if (p.includes('vial')) return 'vial'

  return packLabel.substring(0, 20) || 'units'
}

const requiresPrescription = (salt) => {
  if (!salt) return false
  const s = salt.toLowerCase()
  const rxDrugs = [
    'amoxicillin', 'azithromycin', 'ciprofloxacin', 'metformin',
    'amlodipine', 'atenolol', 'losartan', 'warfarin',
    'insulin', 'tramadol', 'codeine', 'morphine',
    'alprazolam', 'diazepam', 'lithium', 'clonazepam',
  ]
  return rxDrugs.some(drug => s.includes(drug))
}
