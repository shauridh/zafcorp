import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { detailProduk, hapusProduk, setAktifProduk, type DetailProduk } from '../data/repos'
import { formatRupiah } from '../domain/conversions'
import { ConfirmDialog } from './ConfirmDialog'

/** Ambang stok jadi untuk label "Menipis" di kartu (sama di semua produk). */
const AMBANG_MENIPIS = 5

/** Angka tanpa prefix Rp, dibulatkan (untuk chip HPP ±). */
function formatAngka(n: number): string {
  return Math.round(n).toLocaleString('id-ID')
}

function marginPct(harga: number, hpp: number): number {
  return harga > 0 ? ((harga - hpp) / harga) * 100 : 0
}

function statusPill(p: DetailProduk): { label: string; cls: string } {
  if (!p.aktif) return { label: 'Nonaktif', cls: 'na' }
  const stok = p.stok ?? 0
  if (stok <= 0) return { label: 'Habis', cls: 'hab' }
  if (stok <= AMBANG_MENIPIS) return { label: 'Menipis', cls: 'low' }
  return { label: 'Aktif', cls: 'on' }
}

function PowerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 2v9" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

export function ProdukPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<DetailProduk[]>([])
  const [term, setTerm] = useState('')
  const [kat, setKat] = useState('Semua')
  const [reload, setReload] = useState(0)
  const [nonaktifTarget, setNonaktifTarget] = useState<DetailProduk | null>(null)
  const [hapusTarget, setHapusTarget] = useState<DetailProduk | null>(null)

  useEffect(() => {
    void detailProduk().then(setItems)
  }, [reload])

  const kategori = useMemo(() => {
    const s = new Set(items.map((p) => p.kategori))
    return ['Semua', ...[...s].sort()]
  }, [items])

  const countKat = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of items) m.set(p.kategori, (m.get(p.kategori) ?? 0) + 1)
    return m
  }, [items])

  const shown = useMemo(() => {
    const q = term.trim().toLowerCase()
    return items.filter(
      (p) =>
        (kat === 'Semua' || p.kategori === kat) &&
        (!q || p.nama.toLowerCase().includes(q) || p.kategori.toLowerCase().includes(q)),
    )
  }, [items, kat, term])

  const ringkas = useMemo(() => {
    const aktif = items.filter((p) => p.aktif).length
    const habis = items.filter((p) => p.aktif && (p.stok ?? 0) <= 0).length
    const nonaktif = items.length - aktif
    return { total: items.length, aktif, habis, nonaktif }
  }, [items])

  async function konfirmasiNonaktif() {
    if (!nonaktifTarget?.id) return
    await setAktifProduk(nonaktifTarget.id, false)
    setNonaktifTarget(null)
    setReload((r) => r + 1)
  }

  async function aktifkan(p: DetailProduk) {
    if (!p.id) return
    await setAktifProduk(p.id, true)
    setReload((r) => r + 1)
  }

  async function konfirmasiHapus() {
    if (!hapusTarget?.id) return
    await hapusProduk(hapusTarget.id)
    setHapusTarget(null)
    setReload((r) => r + 1)
  }

  return (
    <main>
      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Produk &amp; Menu</h2>
            <p className="db-sub">
              {ringkas.total} menu · {ringkas.aktif} aktif · {ringkas.habis} habis · {ringkas.nonaktif} nonaktif ·
              HPP dihitung dari resep × harga beli terakhir
            </p>
          </div>
          <div className="sp2" style={{ flex: 1 }} />
          <Link to="/produk/baru">
            <button className="primary">+ Menu baru</button>
          </Link>
        </div>

        <div className="toolbar">
          <input
            className="search"
            type="search"
            aria-label="Cari menu"
            autoComplete="off"
            placeholder="Cari nama menu…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <div className="chips">
            {kategori.map((k) => (
              <button
                key={k}
                className={`chip ${kat === k ? 'on' : ''}`}
                onClick={() => setKat(k)}
              >
                {k}
                <span className="chip-cnt"> {k === 'Semua' ? items.length : (countKat.get(k) ?? 0)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {shown.length === 0 && <p className="empty">Belum ada produk. Tambahkan menu pertama Anda.</p>}

      <div className="prod-grid">
        {shown.map((p) => {
          const st = statusPill(p)
          const stok = p.stok ?? 0
          const mgn = marginPct(p.hargaJual, p.hpp)
          const mgnCls = !p.adaHpp ? '' : mgn >= 35 ? 'ok' : mgn >= 15 ? 'warn' : 'bad'
          return (
            <div className="prod-card" key={p.id} data-kat={p.kategori}>
              <div className="pc-top">
                <span className="pc-name" title={p.nama}>
                  {p.nama}
                </span>
                <span className={`pstat ${st.cls}`}>● {st.label}</span>
              </div>
              <div className="pc-badges">
                <span className={`badge ${p.tipeStok === 'produksi' ? 'prod' : 'unit'}`}>
                  {p.tipeStok === 'produksi' ? 'produksi' : 'langsung jual'}
                </span>
                <span className="pc-kat">{p.kategori}</span>
                {!p.aktif && <span className="badge off">nonaktif</span>}
                <span className="pc-resep">resep {p.resepCount}</span>
              </div>
              <div className="pc-price">{formatRupiah(p.hargaJual)}</div>
              <div className="pc-meta">
                <span className="mchip">
                  Stok <b className={stok <= 0 ? 'zero' : stok <= AMBANG_MENIPIS ? 'low' : ''}>{stok}</b>
                </span>
                <span className="mchip">
                  HPP <b>{p.adaHpp ? `±${formatAngka(p.hpp)}` : '—'}</b>
                </span>
                <span className="mchip">
                  Margin <b className={`mgn ${mgnCls}`}>{p.adaHpp ? `${Math.round(mgn)}%` : '—'}</b>
                </span>
              </div>
              <div className="pc-acts">
                <button className="pab" onClick={() => navigate(`/produk/${p.id}?tab=resep`)}>
                  Resep
                </button>
                <button className="pab" onClick={() => navigate(`/produk/${p.id}?tab=harga`)}>
                  Harga
                </button>
                <Link to={`/produk/${p.id}`} style={{ textDecoration: 'none' }}>
                  <button className="pab ink">Edit</button>
                </Link>
                <button
                  className={`pab icon ${p.aktif ? 'danger' : ''}`}
                  title={p.aktif ? 'Nonaktifkan dari kasir' : 'Aktifkan di kasir'}
                  onClick={() => (p.aktif ? setNonaktifTarget(p) : void aktifkan(p))}
                >
                  <PowerIcon />
                </button>
                <button
                  className="pab icon dots"
                  title="Hapus"
                  onClick={() => setHapusTarget(p)}
                >
                  <DotsIcon />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        buka={nonaktifTarget != null}
        judul={`Nonaktifkan "${nonaktifTarget?.nama ?? ''}" dari kasir?`}
        pesan={
          <>
            Menu ini <b>langsung hilang dari layar Kasir</b> dan tidak bisa dipesan. Resep, riwayat harga, dan
            transaksi lama tetap tersimpan. Untuk menampilkan kembali, aktifkan dari halaman ini.
          </>
        }
        labelKonfirmasi="Nonaktifkan"
        onKonfirmasi={() => void konfirmasiNonaktif()}
        onBatal={() => setNonaktifTarget(null)}
      />

      <ConfirmDialog
        buka={hapusTarget != null}
        judul={`Hapus menu "${hapusTarget?.nama ?? ''}"?`}
        pesan="Menu beserta resepnya akan ikut terhapus. Transaksi lama tidak terpengaruh. Aksi ini tidak bisa dibatalkan."
        labelKonfirmasi="Hapus menu"
        onKonfirmasi={() => void konfirmasiHapus()}
        onBatal={() => setHapusTarget(null)}
      />
    </main>
  )
}