import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BATAS_GAGAL, bukaZonaPemilik, catatAudit, catatGagalPin, cekPin, gagalPinBeruntun, resetGagalPin } from '../data/keamanan'
import { Icon } from './Icons'

/**
 * Layar kunci zona pemilik — tampil menggantikan halaman saat PIN aktif dan
 * sesi pemilik belum dibuka. Setelah benar, sesi terbuka 30 menit.
 */
export function PemilikGate({ tujuan }: { tujuan?: string }) {
  const [pin, setPin] = useState('')
  const [salah, setSalah] = useState(false)
  const [sibuk, setSibuk] = useState(false)
  const [gagal, setGagal] = useState(0)
  useEffect(() => { void gagalPinBeruntun().then(setGagal) }, [])

  async function buka() {
    if (pin.length < 4 || sibuk) return
    setSibuk(true)
    const ok = await cekPin(pin)
    if (ok) {
      setSibuk(false)
      setSalah(false)
      await resetGagalPin()
      bukaZonaPemilik()
      void catatAudit('zona-buka', tujuan ?? '')
      return
    }
    setSibuk(false)
    setSalah(true)
    setPin('')
    const n = (await gagalPinBeruntun()) + 1
    await catatGagalPin()
    setGagal(n)
  }

  const tekan = (k: string) => {
    if (k === '⌫') setPin((p) => p.slice(0, -1))
    else if (pin.length < 6) setPin((p) => p + k)
    setSalah(false)
  }

  return (
    <div className="gate">
      <div className="gate-card">
        <span className="gate-ico" aria-hidden="true">
          <Icon name="pengaturan" size={24} />
        </span>
        <h2 style={{ margin: '10px 0 2px' }}>Zona pemilik terkunci</h2>
        <p className="muted" style={{ margin: '4px 0 14px', textAlign: 'center' }}>
          Pengaturan, keuangan &amp; master hanya bisa dibuka pemilik — masukkan PIN untuk melanjutkan.
        </p>
        <input
          className="gate-pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={6}
          value={pin}
          aria-label="PIN pemilik"
          placeholder="••••"
          autoFocus
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
            setSalah(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void buka()
          }}
        />
        <div className="gate-pad" role="group" aria-label="Keypad PIN">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k) =>
            k === '' ? (
              <span key="sp" />
            ) : (
              <button key={k} type="button" className={k === '⌫' ? 'ghost' : ''} onClick={() => tekan(k)}>
                {k}
              </button>
            ),
          )}
        </div>
        {gagal >= BATAS_GAGAL && (
          <p className="err-inline" role="alert">
            Terlalu banyak percobaan — terkunci 10 menit.
          </p>
        )}
        {salah && gagal < BATAS_GAGAL && (
          <p className="err-inline" role="alert">
            PIN salah — coba lagi. ({BATAS_GAGAL - gagal} kesempatan tersisa)
          </p>
        )}
        <button className="primary" style={{ width: '100%', marginTop: 10 }} disabled={sibuk || pin.length < 4 || gagal >= BATAS_GAGAL} onClick={() => void buka()}>
          {sibuk ? 'Memeriksa…' : 'Buka zona pemilik'}
        </button>
        <Link to="/" className="gate-back">
          ← Kembali ke Dashboard
        </Link>
      </div>
    </div>
  )
}