import { useEffect, useState } from 'react'
import { batalkanTransaksi, daftarTransaksi, LABEL_METODE, labelSumber, type BarisTransaksi } from '../data/sales'
import { formatRupiah } from '../domain/conversions'
import { StrukPanel } from './StrukPanel'
import { ConfirmDialog } from './ConfirmDialog'

export function TransaksiPage() {
  const [rows, setRows] = useState<BarisTransaksi[]>([])
  const [reload, setReload] = useState(0)
  const [pesan, setPesan] = useState('')
  const [bukaStruk, setBukaStruk] = useState<number | null>(null)
  const [batalTarget, setBatalTarget] = useState<BarisTransaksi['header'] | null>(null)
  const [alasan, setAlasan] = useState('')

  useEffect(() => {
    void daftarTransaksi(100).then(setRows)
  }, [reload])

  function batal(h: BarisTransaksi['header']) {
    setAlasan('')
    setBatalTarget(h)
  }

  async function konfirmasiBatal() {
    if (!batalTarget) return
    const hasil = await batalkanTransaksi(batalTarget.id as number, alasan)
    const kasNote = hasil.kasDibalik ? ' kas tunai dikembalikan ke laci.' : hasil.catatanKas ? ` ${hasil.catatanKas}` : ''
    setPesan(`Transaksi #${batalTarget.id} dibatalkan — semua stok dikembalikan, tercatat di jejak audit.${kasNote}`)
    setBatalTarget(null)
    setAlasan('')
    setReload((r) => r + 1)
  }

  return (
    <main>
      <section className="panel">
        <h2>Penjualan</h2>
        <p className="muted">Riwayat transaksi kasir. Pembatalan mengembalikan stok otomatis dan tetap tercatat di jejak.</p>
        {pesan && <div className="form-note ok">{pesan}</div>}
        {rows.length === 0 && <p className="empty">Belum ada transaksi.</p>}
        {rows.map(({ header: h, items }) => (
          <div key={h.id}>
            <div className="row-card">
              <div className="row-main">
                <div className="row-title">
                  #{h.id} <span className="badge unit">{labelSumber(h.sumber)}</span>
                  <span className="badge unit">{LABEL_METODE[h.metode]}</span>
                  {h.status === 'batal' && <span className="badge off">batal</span>}
                </div>
                <div className="row-meta">
                  {h.waktu.replace('T', ' ')} ·{' '}
                  {items.map((i) => `${i.nama} ×${i.qty} @${formatRupiah(i.hargaSatuan)}`).join('; ')}
                  {h.metode === 'tunai' && ` · dibayar ${formatRupiah(h.dibayar)}`}
                  {h.status === 'batal' && h.alasanBatal && <span style={{ color: 'var(--danger)', fontWeight: 600 }}> · alasan: {h.alasanBatal}</span>}
                </div>
              </div>
              <div className="row-actions" style={{ alignItems: 'center' }}>
                <b>{formatRupiah(h.total)}</b>
                <button className="outline small" onClick={() => setBukaStruk(bukaStruk === h.id ? null : (h.id as number))}>
                  Struk
                </button>
                {h.status === 'selesai' && (
                  <button className="danger small" onClick={() => void batal(h)}>
                    Batalkan
                  </button>
                )}
              </div>
            </div>
            {bukaStruk === h.id && (
              <div style={{ maxWidth: 520 }}>
                <StrukPanel header={h} items={items} />
              </div>
            )}
          </div>
        ))}
      </section>

      <ConfirmDialog
        buka={batalTarget != null}
        judul={`Batalkan transaksi #${batalTarget?.id ?? ''}?`}
        pesan={
          batalTarget ? (
            <div>
              <p style={{ margin: '0 0 10px' }}>
                Transaksi senilai <b>{formatRupiah(batalTarget.total)}</b> ({LABEL_METODE[batalTarget.metode]}) akan dibatalkan:
                semua stok dikembalikan,{' '}
                {batalTarget.metode === 'tunai' ? 'uang tunai dikembalikan ke buku kas laci (bila shift masih buka)' : 'refund QRIS/Transfer dilakukan lewat penyedia pembayaran'}
                , dan pembatalan tercatat di jejak audit. Aksi tidak bisa dibatalkan.
              </p>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, marginBottom: 4 }} htmlFor="alasan-batal">
                Alasan pembatalan (opsional)
              </label>
              <input
                id="alasan-batal"
                autoComplete="off"
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
                placeholder="mis. pesanan dibatalkan pembeli / barang salah"
                style={{ width: '100%' }}
              />
            </div>
          ) : null
        }
        labelKonfirmasi="Batalkan transaksi"
        onKonfirmasi={() => void konfirmasiBatal()}
        onBatal={() => {
          setBatalTarget(null)
          setAlasan('')
        }}
      />
    </main>
  )
}
