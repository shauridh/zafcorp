import { useEffect, useRef, useState } from 'react'
import { getPengaturan, type Pengaturan } from '../data/pengaturan'
import { rekapShiftOtomatisAktif } from '../data/rekapShare'
import { barisRekapShift, type DataRekapShift } from '../domain/strukShift'
import { bagikanFile, cetakBluetooth, renderPdf, renderPng, unduhFile } from '../services/struk'

/** Data shift tanpa identitas outlet — outlet diambil dari pengaturan saat cetak. */
export type InputRekapShift = Omit<DataRekapShift, 'outlet' | 'alamat' | 'noHp' | 'sambutan' | 'penutup'>

export function ShiftRekapPanel({ data }: { data: InputRekapShift }) {
  const [pengaturan, setPengaturan] = useState<Pengaturan | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)

  const sudahCobaAuto = useRef(false)

  useEffect(() => {
    void getPengaturan().then(setPengaturan)
  }, [])

  // Kirim otomatis (bila diaktifkan di Pengaturan): begitu rekap siap & outlet
  // termuat, coba bagikan ke WhatsApp. Tanpa izin berbagi → unduh otomatis.
  useEffect(() => {
    if (!pengaturan || sudahCobaAuto.current || !rekapShiftOtomatisAktif()) return
    sudahCobaAuto.current = true
    void aksi('bagi')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pengaturan])

  if (!pengaturan) return <p className="muted">Menyiapkan struk rangkuman…</p>

  const penuh: DataRekapShift = {
    ...data,
    outlet: pengaturan.namaOutlet || 'SABANA FRIED CHICKEN',
    alamat: pengaturan.alamat || undefined,
    noHp: pengaturan.noHp || undefined,
    sambutan: pengaturan.strukSambutan || undefined,
    penutup: pengaturan.strukPenutup || undefined,
  }
  const baris = barisRekapShift(penuh)
  const nama = `rekap-shift-${data.nomor}.png`

  async function aksi(jenis: 'png' | 'pdf' | 'bagi' | 'cetak') {
    setBusy(jenis)
    setMsg(null)
    try {
      if (jenis === 'png') {
        unduhFile(await renderPng(baris), nama)
        setMsg({ text: 'Gambar rekap shift terunduh.', err: false })
      } else if (jenis === 'pdf') {
        unduhFile(await renderPdf(baris), `rekap-shift-${data.nomor}.pdf`)
        setMsg({ text: 'PDF rekap shift terunduh.', err: false })
      } else if (jenis === 'bagi') {
        const hasil = await bagikanFile(await renderPng(baris), nama, `Rekap Shift #${data.nomor} — ${penuh.outlet}`)
        if (hasil === 'shared') setMsg({ text: 'Rekap shift dibagikan.', err: false })
        else if (hasil === 'download') setMsg({ text: 'Rekap shift terunduh (bagikan lewat WhatsApp dari galeri/file).', err: false })
        else setMsg({ text: 'Gagal berbagi.', err: true })
      } else {
        setMsg({ text: await cetakBluetooth(baris), err: false })
      }
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), err: true })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="km-sec" style={{ marginTop: 12 }}>
      <p className="km-lbl">Arsip kasir — struk rangkuman shift</p>
      <pre
        style={{
          fontSize: 10,
          lineHeight: 1.35,
          whiteSpace: 'pre-wrap',
          maxHeight: 190,
          overflowY: 'auto',
          background: '#fff',
          border: '1px solid #f0ded8',
          borderRadius: 8,
          padding: 10,
          margin: '0 0 8px',
        }}
      >
        {baris.map((b) => (b.center ? b.text.trim() : b.text)).join('\n')}
      </pre>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="outline small" disabled={busy !== ''} onClick={() => void aksi('bagi')}>
          {busy === 'bagi' ? '…' : 'Bagikan (WhatsApp)'}
        </button>
        <button className="outline small" disabled={busy !== ''} onClick={() => void aksi('png')}>
          {busy === 'png' ? '…' : 'Unduh PNG'}
        </button>
        <button className="outline small" disabled={busy !== ''} onClick={() => void aksi('pdf')}>
          {busy === 'pdf' ? '…' : 'Unduh PDF'}
        </button>
        <button className="outline small" disabled={busy !== ''} onClick={() => void aksi('cetak')}>
          {busy === 'cetak' ? '…' : 'Cetak Bluetooth*'}
        </button>
      </div>
      {msg && <p style={{ color: msg.err ? 'var(--danger)' : 'var(--ok)', fontSize: 12.5, margin: '8px 0 0' }}>{msg.text}</p>}
      {rekapShiftOtomatisAktif() && !msg && (
        <p className="muted" style={{ fontSize: 11.5, margin: '8px 0 0' }}>
          ⚙ Kirim otomatis aktif — berbagi dicoba begitu shift diakhiri; bila browser menolak, gambar terunduh
          dan bisa Anda bagikan manual.
        </p>
      )}
    </div>
  )
}
