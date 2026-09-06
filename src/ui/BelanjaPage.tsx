import { useEffect, useState } from 'react'
import { hitungBelanja, type HasilBelanja } from '../data/belanja'
import { formatRupiah } from '../domain/conversions'
import { formatQty } from '../domain/laporan'
import { Icon } from './Icons'

export function BelanjaPage() {
  const [target, setTarget] = useState(7)
  const [hasil, setHasil] = useState<HasilBelanja | null>(null)
  const [pesan, setPesan] = useState('')

  useEffect(() => {
    void (async () => {
      setHasil(await hitungBelanja({ targetHari: target, riwayatHari: 7 }))
    })()
  }, [target])

  async function bagikan() {
    if (!hasil) return
    if (navigator.share) {
      try {
        await navigator.share({ title: 'List Belanja', text: hasil.pesan })
        return
      } catch {
        /* dibatalkan pengguna — lanjut fallback */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(hasil.pesan)}`, '_blank')
  }

  async function salin() {
    if (!hasil) return
    try {
      await navigator.clipboard.writeText(hasil.pesan)
      setPesan('✓ Teks list belanja disalin — tempel di WhatsApp.')
    } catch {
      setPesan('Gagal menyalin — gunakan Bagikan/Unduh.')
    }
  }

  function unduh() {
    if (!hasil) return
    const blob = new Blob([hasil.pesan], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `list-belanja-${hasil.dibuat}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main>
      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0 }}>List Belanja — estimasi pemakaian nyata</h2>
        </div>
        <p className="muted">
          Dihitung dari pemakaian <b>7 hari terakhir</b> (produksi & penjualan) — bahan yang hampir/sudah habis
          beserta jumlah beli yang disarankan, dibulatkan ke satuan beli.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Kebutuhan untuk:</span>
          <div className="chips">
            {[3, 4, 5, 6, 7].map((n) => (
              <button key={n} className={`chip ${target === n ? 'on' : ''}`} onClick={() => setTarget(n)}>
                {n} hari
              </button>
            ))}
          </div>
        </div>

        {hasil?.kurangData && (
          <div className="warn-banner">
            Data pemakaian baru <b>{hasil.hariData} hari</b> — estimasi masih kasar, makin lama dipakai makin akurat.
          </div>
        )}
        {hasil && hasil.hariData >= 2 && (
          <p className="muted" style={{ marginTop: 8 }}>
            Berbasis <b>{hasil.hariData} hari</b> data pemakaian.
          </p>
        )}
      </section>

      {hasil && hasil.baris.length === 0 && (
        <section className="panel">
          <p className="empty">
            Belum ada pemakaian bahan tercatat di periode ini — catat Beli Bahan, Produksi, dan Penjualan dulu,
            lalu kembali ke sini.
          </p>
        </section>
      )}

      {hasil && hasil.baris.length > 0 && (
        <>
          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <h2 style={{ margin: 0 }}>
                {hasil.beliCount} item perlu dibeli
              </h2>
              <span className="badge stock" style={{ fontSize: 14, padding: '6px 12px' }}>
                estimasi biaya {formatRupiah(hasil.estimasiTotal)} (harga beli terakhir)
              </span>
            </div>
            <div className="stat-row">
              <div className="stat"><b>{hasil.baris.filter((b) => b.beli > 0).length}</b><span>Perlu beli</span></div>
              <div className="stat"><b>{hasil.baris.filter((b) => b.beli === 0).length}</b><span>Stok cukup</span></div>
              <div className="stat"><b>{hasil.baris.filter((b) => (b.estHari ?? 999) <= 0.01).length}</b><span>Sudah habis</span></div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="rpt">
                <thead>
                  <tr>
                    <th className="l">Bahan (kategori)</th>
                    <th>Rincian stok</th>
                    <th>Beli</th>
                    <th>Estimasi</th>
                  </tr>
                </thead>
                <tbody>
                  {hasil.baris.map((b) => (
                    <tr key={b.bahanId} className={b.cukup ? 'cukup' : ''}>
                      <td className="l">
                        <b>{b.nama}</b>
                        {b.estHari != null && b.estHari <= 0.01 && <span className="badge" style={{ marginLeft: 6 }}>habis</span>}
                        <div className="row-meta">{b.kategori}</div>
                      </td>
                      <td style={{ textAlign: 'left', whiteSpace: 'normal', minWidth: 200 }}>{b.rincian}</td>
                      <td>
                        {b.beli > 0 ? (
                          <b style={{ color: 'var(--ok)', fontSize: 15 }}>{formatQty(b.beli)} {b.satuan}</b>
                        ) : (
                          <span style={{ color: 'var(--muted-light)' }}>cukup</span>
                        )}
                      </td>
                      <td>{b.beli > 0 ? formatRupiah(b.estimasiRp) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="primary" onClick={() => void bagikan()}>
                <Icon name="bagikan" size={18} /> Bagikan ke WhatsApp
              </button>
              <button className="outline" onClick={() => void salin()}>
                <Icon name="salin" size={18} /> Salin teks
              </button>
              <button className="outline" onClick={unduh}>
                <Icon name="unduh" size={18} /> Unduh .txt
              </button>
              {pesan && <span style={{ color: 'var(--ok)', fontSize: 13 }}>{pesan}</span>}
            </div>
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Di HP: tombol Bagikan membuka daftar aplikasi (WhatsApp). Bila tidak muncul, otomatis dibuka
              WhatsApp dengan teks siap kirim.
            </p>
          </section>
        </>
      )}
    </main>
  )
}
