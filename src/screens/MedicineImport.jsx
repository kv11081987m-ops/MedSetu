import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { importJanAushadhi } from '../lib/importJanAushadhi'
import { importIndianMedicines } from '../lib/importIndianMedicines'

export default function MedicineImport() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('janaushadhi')

  // Jan Aushadhi state
  const [file, setFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  // Indian Medicines state
  const [indianFile, setIndianFile] = useState(null)
  const [indianImporting, setIndianImporting] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleImport = async () => {
    if (!file) { alert('Pehle CSV file select karo'); return }
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

  const handleIndianImport = async () => {
    if (!indianFile) { alert('File select karo'); return }
    setIndianImporting(true)
    setProgress(0)
    try {
      await importIndianMedicines(indianFile, (count) =>
        setProgress(prev => prev + count)
      )
      alert('Import complete! ' + progress + ' medicines imported')
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      setIndianImporting(false)
    }
  }

  return (
    <div style={s.wrapper}>
      <div style={s.topBar}>
        <button style={s.backBtn} onClick={() => navigate('/super-admin')}>← Back</button>
        <span style={s.title}>Medicine Import</span>
        <div style={{ width: 60 }} />
      </div>

      {/* Tabs */}
      <div style={s.tabRow}>
        <button
          style={{ ...s.tab, ...(activeTab === 'janaushadhi' ? s.tabActive : {}) }}
          onClick={() => setActiveTab('janaushadhi')}
        >
          Jan Aushadhi
        </button>
        <button
          style={{ ...s.tab, ...(activeTab === 'indian' ? s.tabActive : {}) }}
          onClick={() => setActiveTab('indian')}
        >
          Indian Medicines (250K)
        </button>
      </div>

      <div style={s.content}>

        {/* ── Tab 1: Jan Aushadhi ── */}
        {activeTab === 'janaushadhi' && (
          <>
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
                  onChange={(e) => { setFile(e.target.files[0] || null); setResult(null) }}
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
          </>
        )}

        {/* ── Tab 2: Indian Medicines 250K ── */}
        {activeTab === 'indian' && (
          <div style={s.card}>
            <p style={s.cardTitle}>🇮🇳 Indian Medicines Dataset (250K)</p>
            <p style={s.cardDesc}>
              250,000+ Indian branded medicines ka CSV upload karo.
              Required columns: <strong>id, name, price, Is_discontinued, manufacturer_name,
              type, pack_size_label, salt_composition</strong>
            </p>

            <div style={s.warningBox}>
              ⚠️ Yeh import <strong>10–15 minute</strong> le sakta hai.
              Browser band mat karna import ke dauran.
            </div>

            <div style={s.fileBox}>
              <input
                type="file"
                accept=".csv"
                id="indian-csv-upload"
                style={{ display: 'none' }}
                onChange={(e) => { setIndianFile(e.target.files[0] || null); setProgress(0) }}
                disabled={indianImporting}
              />
              <label htmlFor="indian-csv-upload" style={{
                ...s.fileLabel,
                opacity: indianImporting ? 0.5 : 1,
                cursor: indianImporting ? 'not-allowed' : 'pointer',
              }}>
                {indianFile ? `📄 ${indianFile.name}` : '📂 CSV File Choose Karo'}
              </label>
            </div>

            {indianFile && !indianImporting && progress === 0 && (
              <p style={s.fileInfo}>File ready: {indianFile.name}</p>
            )}

            {indianImporting && (
              <div style={s.progressBox}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>⏳</div>
                <p style={{ fontWeight: 'bold', margin: '0 0 4px' }}>Import ho raha hai...</p>
                <p style={{ color: '#1A6B3C', fontSize: '28px', fontWeight: '700', margin: '4px 0' }}>
                  {progress.toLocaleString()}
                </p>
                <p style={{ color: '#666', margin: '0 0 8px' }}>medicines imported</p>
                <p style={{ color: '#999', fontSize: '12px', margin: 0 }}>
                  Browser band mat karo — 10–15 min lagenge
                </p>
              </div>
            )}

            {!indianImporting && progress > 0 && (
              <div style={s.successBox}>
                ✅ Import complete! <strong>{progress.toLocaleString()}</strong> medicines imported.
              </div>
            )}

            <button
              style={{ ...s.importBtn, opacity: indianImporting ? 0.7 : 1, marginTop: '8px' }}
              onClick={handleIndianImport}
              disabled={indianImporting}
            >
              {indianImporting ? '⏳ Importing...' : '🚀 Import Karo'}
            </button>
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
  tabRow:      { display: 'flex', backgroundColor: '#FFFFFF', borderBottom: '1px solid #E5E7EB', padding: '0 16px' },
  tab:         { flex: 1, padding: '12px 8px', background: 'none', border: 'none', borderBottom: '3px solid transparent', fontSize: '13px', fontWeight: '600', color: '#888', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  tabActive:   { color: '#1A6B3C', borderBottomColor: '#1A6B3C' },
  content:     { flex: 1, padding: '20px 16px', maxWidth: '520px', width: '100%', margin: '0 auto', boxSizing: 'border-box' },
  card:        { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: '16px' },
  cardTitle:   { fontSize: '16px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 8px' },
  cardDesc:    { fontSize: '13px', color: '#666', lineHeight: '1.6', margin: '0 0 16px' },
  warningBox:  { backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '10px', padding: '12px 14px', fontSize: '13px', color: '#92400E', marginBottom: '16px', lineHeight: '1.5' },
  fileBox:     { marginBottom: '12px' },
  fileLabel:   { display: 'block', padding: '14px', border: '2px dashed #D1D5DB', borderRadius: '10px', textAlign: 'center', cursor: 'pointer', fontSize: '14px', color: '#555', backgroundColor: '#FAFAFA', fontWeight: '500' },
  fileInfo:    { fontSize: '12px', color: '#888', margin: '0 0 16px', textAlign: 'center' },
  importBtn:   { width: '100%', padding: '14px', backgroundColor: '#1A6B3C', color: '#FFFFFF', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit' },
  progressBox: { textAlign: 'center', padding: '20px', backgroundColor: '#F0FDF4', borderRadius: '12px', margin: '0 0 16px' },
  successBox:  { textAlign: 'center', padding: '14px', backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '10px', fontSize: '14px', color: '#166534', margin: '0 0 16px' },
  resultCard:  { backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' },
  resultTitle: { fontSize: '15px', fontWeight: '700', color: '#1A1A1A', margin: '0 0 16px' },
  resultRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F0F0F0' },
  resultLabel: { fontSize: '13px', color: '#555' },
  resultVal:   { fontSize: '16px', fontWeight: '700', color: '#1A1A1A' },
  successMsg:  { fontSize: '14px', color: '#16A34A', fontWeight: '600', marginTop: '16px', textAlign: 'center', lineHeight: '1.5' },
}
