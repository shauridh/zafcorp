import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { nomorShiftSesi, rekapShiftAntara, ringkasanSesi, riwayatSesiKas } from '../data/kas'
import { formatRupiah } from '../domain/conversions'

interface BarisShift {
  id: number
  nomor: number
  nama?: string
  bukaWaktu: string
  tutupWaktu?: string
  status: 'buka' | 'tutup'
  saldoAwal: number
  jualTunai: number
  tambah: number
  keluar: number
  batalTunai: number
  uangSeharusnya?: number
  fisik?: number
  selisih?: number
  setoran?: number
  floatTarget: number
}

function durasi(buka: string, tutup?: string): string {
  if (!tutup) return ''
  const t0 = Date.parse(buka.replace(' ', 'T'))
  const t1 = Date.parse(tutup.replace(' ', 'T'))
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 <= t0) return ''
  const menit = Math.round((t1 - t0) / 60_000)
  if (menit < 60) return `${menit} mnt`
  const h = Math.floor(menit / 60)
  const m = menit % 60
  return m ? `${h} j ${m} mnt` : `${h} j`
}

function tglWaktu(iso: string): string {
  const s = (iso ?? '').replace('T', ' ').slice(0, 16)
  return s || '—'
}

export function RiwayatShiftPage() {
  const [baris, setBaris] = useState<BarisShift[]>([])
  const [filter, setFilter] = useState<'semua' | 'aktif' | 'selesai'>('semua')
  const [rekapRingkas, setRekapRingkas] = useState<{ n: number; setoran: number; selisih: number } | null>(null)
  const [memuat, setMemuat] = useState(true)

  useEffect(() => {
    void (async () => {
      setMemuat(true)
      const all = await riwayatSesiKas(120)
      const hasil: BarisShift[] = []
      for (const s of all) {
        const r = await ringkasanSesi(s.id as number)
        const nomor = await nomorShiftSesi(s)
        hasil.push({
          id: s.id as number,
          nomor,
          nama: s.catatan,
          bukaWaktu: s.bukaWaktu,
          tutupWaktu: s.tutupWaktu,
          status: s.status,
          saldoAwal: r?.ledger.saldoAwal ?? s.saldoAwal,
          jualTunai: r?.ledger.jualTunai ?? 0,
          tambah: r?.ledger.tambah ?? 0,
          keluar: r?.ledger.keluar ?? 0,
          batalTunai: r?.ledger.batalTunai ?? 0,
          uangSeharusnya: s.uangSeharusnya,
          fisik: s.fisik,
          selisih: s.selisih,
          setoran: s.setoran,
          floatTarget: s.floatTarget,
        })
      }
      setBaris(hasil)

      // ringkasan semua shift yang sudah selesai (data tutup)
      const hist = await rekapShiftAntara('0000-01-01', '9999-12-31')
      setRekapRingkas({
        n: hist.length,
        setoran: hist.reduce((x, h) => x + (h.sesi.setoran ?? 0), 0),
        selisih: hist.reduce((x, h) => x + (h.sesi.selisih ?? 0), 0),
      })
      setMemuat(false)
    })()
  }, [])

  const tampil = baris.filter((b) => (filter === 'semua' ? true : filter === 'aktif' ? b.status === 'buka' : b.status === 'tutup'))

  return (
    <main>
      <section className="panel" style={{ marginTop: 0 }}>
        <div className="dhead">
          <div>
            <h2 style={{ margin: 0 }}>Riwayat Shift</h2>
            <p className="db-sub">
              Buka–tutup kas per shift: saldo awal, omzet tunai, kas keluar, selisih, dan setoran untuk arsip
              kasir.
            </p>
          </div>
          <Link to="/kasir" style={{ textDecoration: 'none' }}>
            <button className="outline small">Buka Kasir →</button>
          </Link>
        </div>

        <div className="chips" role="radiogroup" aria-label="Status shift" style={{ marginTop: 12 }}>
          {(['semua', 'aktif', 'selesai'] as const).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={filter === f}
              className={`chip ${filter === f ? 'on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'semua' ? `Semua (${baris.length})` : f === 'aktif' ? `Aktif (${baris.filter((b) => b.status === 'buka').length})` : `Selesai (${baris.filter((b) => b.status === 'tutup').length})`}
            </button>
          ))}
        </div>

        {rekapRingkas && (
          <div className="hppbar" style={{ marginTop: 10 }}>
            <div className="cell"><span>Shift selesai</span><b>{rekapRingkas.n}</b></div>
            <div className="cell"><span>Total setoran</span><b>{formatRupiah(rekapRingkas.setoran)}</b></div>
            <div className="cell"><span>Total selisih</span><b style={{ color: rekapRingkas.selisih === 0 ? 'var(--ok)' : rekapRingkas.selisih > 0 ? 'var(--gold)' : 'var(--danger)' }}>{formatRupiah(rekapRingkas.selisih)}</b></div>
          </div>
        )}
      </section>

      {memuat ? (
        <p className="muted">Memuat riwayat shift…</p>
      ) : tampil.length === 0 ? (
        <section className="panel"><p className="empty">Belum ada shift tercatat. Mulai dari halaman Kasir →</p></section>
      ) : (
        tampil.map((b) => {
          const selisih = b.selisih ?? 0
          return (
            <section className="panel" key={b.id} style={{ marginTop: 10 }}>
              <div className="dhead" style={{ marginTop: 0 }}>
                <div>
                  <h2 style={{ margin: 0 }}>
                    Shift #{b.nomor}
                    {b.nama ? <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--muted)', marginLeft: 8 }}>{b.nama}</span> : null}
                  </h2>
                  <p className="db-sub">
                    {b.status === 'buka' ? (
                      <>
                        <span className="pstat on">● Aktif</span> mulai {tglWaktu(b.bukaWaktu)} — sedang berjalan
                      </>
                    ) : (
                      <>
                        <span className="pstat na">● Selesai</span> {tglWaktu(b.bukaWaktu)} → {tglWaktu(b.tutupWaktu ?? '')}
                        {durasi(b.bukaWaktu, b.tutupWaktu) ? ` (${durasi(b.bukaWaktu, b.tutupWaktu)})` : ''}
                      </>
                    )}
                  </p>
                </div>
                <div className="sp2" style={{ flex: 1 }} />
              </div>

              <div className="stat-row" style={{ marginTop: 4 }}>
                <div className="stat"><b>{formatRupiah(b.saldoAwal)}</b><span>Saldo awal</span></div>
                <div className="stat"><b style={{ color: 'var(--ok)' }}>{formatRupiah(b.jualTunai)}</b><span>Penjualan tunai</span></div>
                <div className="stat"><b style={{ color: 'var(--danger)' }}>−{formatRupiah(b.keluar)}</b><span>Kas keluar</span></div>
                <div className="stat"><b>{formatRupiah(b.tambah)}</b><span>Tambah laci</span></div>
              </div>
              {b.status === 'tutup' ? (
                <div className="stat-row" style={{ marginTop: 6 }}>
                  <div className="stat"><b>{formatRupiah(b.fisik ?? 0)}</b><span>Fisik di laci</span></div>
                  <div className="stat"><b style={{ color: selisih === 0 ? 'var(--ok)' : selisih > 0 ? 'var(--gold)' : 'var(--danger)' }}>{selisih === 0 ? 'pas' : `${selisih > 0 ? '+' : ''}${formatRupiah(selisih)}`}</b><span>Selisih</span></div>
                  <div className="stat"><b>{formatRupiah(b.setoran ?? 0)}</b><span>Setoran</span></div>
                  <div className="stat"><b>{formatRupiah(b.floatTarget)}</b><span>Float tersisa</span></div>
                </div>
              ) : (
                <p className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
                  Float {formatRupiah(b.floatTarget)} akan tersisa saat shift ini diakhiri.
                </p>
              )}
            </section>
          )
        })
      )}
    </main>
  )
}
