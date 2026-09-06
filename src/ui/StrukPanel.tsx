import { useEffect, useState } from 'react'
import { getPengaturan, type Pengaturan } from '../data/pengaturan'
import type { TransaksiHeader, TransaksiItem } from '../data/db'
import { barisStruk } from '../domain/struk'
import { bagikanFile, cetakBluetooth, dataStrukDari, renderPdf, renderPng, unduhFile } from '../services/struk'

export function StrukPanel({ header, items }: { header: TransaksiHeader; items: TransaksiItem[] }) {
  const [pengaturan, setPengaturan] = useState<Pengaturan | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)

  useEffect(() => {
    void getPengaturan().then(setPengaturan)
  }, [])

  if (!pengaturan) return <p className="muted">Menyiapkan struk…</p>
  const data = dataStrukDari(pengaturan, header, items)
  const nama = `struk-${data.no}.png`

  async function aksi(jenis: 'png' | 'pdf' | 'bagi' | 'cetak') {
    setBusy(jenis)
    setMsg(null)
    try {
      if (jenis === 'png') {
        const blob = await renderPng(barisStruk(data))
        unduhFile(blob, nama)
        setMsg({ text: 'Gambar struk terunduh.', err: false })
      } else if (jenis === 'pdf') {
        const blob = await renderPdf(barisStruk(data))
        unduhFile(blob, `struk-${data.no}.pdf`)
        setMsg({ text: 'PDF struk terunduh.', err: false })
      } else if (jenis === 'bagi') {
        const blob = await renderPng(barisStruk(data))
        const hasil = await bagikanFile(blob, nama, `Struk #${data.no} — ${data.outlet}`)
        if (hasil === 'shared') setMsg({ text: 'Struk dibagikan.', err: false })
        else if (hasil === 'download') setMsg({ text: 'Struk terunduh (bagikan lewat WhatsApp dari galeri/file).', err: false })
        else setMsg({ text: 'Gagal berbagi.', err: true })
      } else {
        const hasil = await cetakBluetooth(barisStruk(data))
        setMsg({ text: hasil, err: false })
      }
    } catch (e) {
      setMsg({
        text: String(e instanceof Error ? e.message : e),
        err: true,
      })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="card" style={{ background: 'var(--card)', marginTop: 10 }}>
      <div className="row-meta" style={{ marginBottom: 6 }}>
        Struk # {data.no} · {data.sumber} · {data.metode}
      </div>
      <pre
        style={{
          fontSize: 10,
          lineHeight: 1.35,
          whiteSpace: 'pre-wrap',
          maxHeight: 220,
          overflowY: 'auto',
          background: '#fff',
          border: '1px solid #f0ded8',
          borderRadius: 8,
          padding: 10,
          margin: '0 0 10px',
        }}
      >
        {barisStruk(data)
          .map((b) => (b.center ? b.text.trim() : b.text))
          .join('\n')}
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
      {msg && <p style={{ color: msg.err ? 'var(--danger)' : 'var(--ok)', fontSize: 13, margin: '8px 0 0' }}>{msg.text}</p>}
      <p className="row-meta" style={{ marginTop: 8 }}>
        * Cetak langsung hanya untuk printer thermal yang mendukung Bluetooth Low Energy.
        Printer Bluetooth klasik (SPP) tidak didukung browser — gunakan Bagikan/Unduh.
      </p>
    </div>
  )
}
