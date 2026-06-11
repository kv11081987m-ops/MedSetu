import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { importJanAushadhi } from '../lib/importJanAushadhi'

export default function MedicineImport() {
  const navigate = useNavigate()
  const [file, setFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const handleImport = async () => {
    if (!file) {
      alert('Pehle CSV file select karo')
      return
    }
    setImporting(true)
    setResult(null)
    try {
      const res = await importJanAushadhi(file)
      setResult(res)
    } catch (err) {
      alert('Import failed: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div style={s.wrapper}>
      <div style={s.topBar}>
        <button style={s.backBtn} onClick={() => navigate('/super-admin')}>← Back</button>
        <span style={s.title}>Jan Aushadhi Import</span>
        <div style={{ width: 60 }} />
      </div>

      <div style={s.content}>
        <div style={s.card}>
          <p style={s.cardTitle}>💊 Jan Aushadhi Medicine Import</p>
          <p style={s.cardDesc}>
            CSV file upload karo jisme Jan Aushadhi medicines list ho.
            File mein ye columns hone chahiye: <strong>Generic Name</strong>,{' '}
            <strong>Group Name</strong>, <strong>MRP</strong>, <strong>Unit Size</strong>
          </p>

          <div style={s.fileBox}>
            <input
              type="file"
              accept=".csv"
              id="csv-upload"
              style={{ display: 'none' }}
              onChange={(e) => {
                setFile(e.target.files[0] || null)
                setResult(null)
              }}
            />
            <label htmlFor="csv-upload" style={s.fileLabel}>
              {file ? `📄 ${file.name}` : '📂 CSV File Choose Karo'}
            </label>
          </div>

          {file && !importing && !result && (
            <p style={s.fileInfo}>File ready: {file.name}</p>
          )}

          <button
            style={{ ...s.importBtn, opacity: importing ? 0.7 : 1 }}
            onClick={handleImport}
            disabled={importing}
          >
            {importing ? '⏳ Import ho raha hai...' : '🚀 Import Karo'}
          </button>
        </div>

        {result && (
          <div style={s.resultCard}>
            <p style={s.resultTitle}>Import Result</p>
            <div style={s.resultRow}>
              <span style={s.resultLabel}>Total Medicines</span>
              <span style={s.resultVal}>{result.total}</span>
            </div>
            <div style={s.resultRow}>
              <span style={s.resultLabel}>✅ Successfully Imported</span>
              <span style={{ ...s.resultVal, color: '#16A34A' }}>{result.inserted}</span>
            </div>
            {result.failed > 0 && (
              <div style={s.resultRow}>
                <span style={s.resultLabel}>❌ Failed</span>
                <span style={{ ...s.resultVal, color: '#DC2626' }}>{result.failed}</span>
              </div>
            )}
            {result.inserted > 0 && (
              <p style={s.successMsg}>
                ✅ {result.inserted} medicines master_medicines table mein import ho gayi!
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  wrapper:     { minHeight: '100vh', backgroundColor: '#F5F5F5', display: 'flex', flexDirection: 'column' },
  topBar:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', backgroundColor: '#FFFFFF', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', position: 'sticky', top: 0, zIndex: 50 },
  title:       { fontSize: '15px', fontWeight: '700', color: '#1A1A1A' },
  backBtn:     { background: 'none', border: 'none', fontSize: '14px', color: '#1A6B3C', fontWeight: '600', cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit' },
  content:     { flex: 1, padding: '20px 16px', maxWidth: '520px', width: '100%', margin: '0 auto', boxSizing: 'border-box' },
  card:        { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: '16px' },
  cardTitle:   { fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 8px' },
  cardDesc:    { fontSize: '13px', color: '#666', lineHeight: '1.6', margin: '0 0 20px' },
  fileBox:     { marginBottom: '12px' },
  fileLabel:   { display: 'block', padding: '14px', border: '2px dashed #D1D5DB', borderRadius: '10px', textAlign: 'center', cursor: 'pointer', fontSize: '14px', color: '#555', backgroundColor: '#FAFAFA', fontWeight: '500' },
  fileInfo:    { fontSize: '12px', color: '#888', margin: '0 0 16px', textAlign: 'center' },
  importBtn:   { width: '100%', padding: '14px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit', marginTop: '4px' },
  resultCard:  { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  resultTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 16px' },
  resultRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F0F0F0' },
  resultLabel: { fontSize: '13px', color: '#555' },
  resultVal:   { fontSize: '16px', fontWeight: '700', color: '#1A1A1A' },
  successMsg:  { fontSize: '14px', color: '#16A34A', fontWeight: '600', marginTop: '16px', textAlign: 'center', lineHeight: '1.5' },
}
