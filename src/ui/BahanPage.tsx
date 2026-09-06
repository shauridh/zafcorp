import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { hapusBahan, listBahan, setAktifBahan } from '../data/repos'
import { formatRupiah } from '../domain/conversions'
import type { Bahan } from '../data/db'
import { ConfirmDialog } from './ConfirmDialog'

/** Jumlah potongan ayam utuh (semua bagian). */
function stokTotalAyam(b: Bahan): number {
  return (b.stokDada ?? 0) + (b.stokPahaAtas ?? 0) + (b.stokPahaBawah ?? 0) + (b.stokSayap ?? 0)
}

function stokBahan(b: Bahan): number {
  return b.isAyam ? stokTotalAyam(b) : (b.stok ?? 0)
}

function statusPill(b: Bahan): { label: string; cls: string } {
  if (!b.aktif) return { label: 'Nonaktif', cls: 'na' }
  const stok = stokBahan(b)
  if (stok <= 0) return { label: 'Habis', cls: 'hab' }
  if (b.ambangMin != null && stok <= b.ambangMin) return { label: 'Menipis', cls: 'low' }
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

export function BahanPage() {
  const [items, setItems] = useState<Bahan[]>([])
  const [term, setTerm] = useState('')
  const [kat, setKat] = useState('Semua')
  const [reload, setReload] = useState(0)
  const [nonaktifTarget, setNonaktifTarget] = useState<Bahan | null>(null)
  const [hapusTarget, setHapusTarget] = useState<Bahan | null>(null)

  useEffect(() => {
    void listBahan(term).then(setItems)
  }, [term, reload])

  const kategori = useMemo(() => {
    const s = new Set(items.map((b) => b.kategori))
    return ['Semua', ...[...s].sort()]
  }, [items])

  const countKat = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of items) m.set(b.kategori, (m.get(b.kategori) ?? 0) + 1)
    return m
  }, [items])

  const shown = useMemo(
    () => (kat === 'Semua' ? items : items.filter((b) => b.kategori === kat)),
    [items, kat],
  )

  const ringkas = useMemo(() => {
    const aktif = items.filter((b) => b.aktif).length
    const habis = items.filter((b) => b.aktif && stokBahan(b) <= 0).length
    return { total: items.length, aktif, habis, nonaktif: items.length - aktif }
  }, [items])

  async function konfirmasiNonaktif() {
    if (!nonaktifTarget?.id) return
    await setAktifBahan(nonaktifTarget.id, false)
    setNonaktifTarget(null)
    setReload((r) => r + 1)
  }

  async function aktifkan(b: Bahan) {
    if (!b.id) return
    await setAktifBahan(b.id, true)
    setReload((r) => r + 1)
  }

  async function konfirmasiHapus() {
    if (!hapusTarget?.id) return
    await hapusBahan(hapusTarget.id)
    setHapusTarget(null)
    setReload((r) => r + 1)
  }

  return (
    <main>
      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Bahan &amp; Stok</h2>
            <p className="db-sub">
              {ringkas.total} bahan · {ringkas.aktif} aktif · {ringkas.habis} habis · {ringkas.nonaktif} nonaktif ·
              peringatan stok rendah memakai ambang tiap bahan
            </p>
          </div>
          <div className="sp2" style={{ flex: 1 }} />
          <Link to="/bahan/baru">
            <button className="primary">+ Tambah bahan</button>
          </Link>
        </div>

        <div className="toolbar">
          <input
            className="search"
            type="search"
            aria-label="Cari bahan"
            autoComplete="off"
            placeholder="Cari nama / kode / kategori…"
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

      {shown.length === 0 && <p className="empty">Belum ada bahan. Tambahkan bahan baku pertama Anda.</p>}

      <div className="prod-grid">
        {shown.map((b) => {
          const st = statusPill(b)
          const stok = stokBahan(b)
          const stokCls = stok <= 0 ? 'zero' : b.ambangMin != null && stok <= b.ambangMin ? 'low' : ''
          const id = b.id as number
          return (
            <div className="prod-card" key={b.id}>
              <div className="pc-top">
                <span className="pc-name" title={b.nama}>
                  {b.nama}
                </span>
                <span className={`pstat ${st.cls}`}>● {st.label}</span>
              </div>
              <div className="pc-badges">
                <span className="pc-kat">{b.kategori}</span>
                {b.kodePusat && <span className="badge unit">{b.kodePusat}</span>}
                {b.isAyam && <span className="badge">ayam utuh</span>}
                {!b.aktif && <span className="badge off">nonaktif</span>}
              </div>
              <div className="pc-price">{b.hargaBeliDefault ? formatRupiah(b.hargaBeliDefault) : '—'}</div>
              <div className="pc-meta">
                <span className="mchip">
                  Stok <b className={stokCls}>{b.isAyam ? stok : `${stok} ${b.satuanDasar}`}</b>
                </span>
                {b.satuanBeli && (
                  <span className="mchip">
                    Beli <b>{b.satuanBeli}</b>
                  </span>
                )}
                {b.ambangMin != null && (
                  <span className="mchip">
                    Ambang <b>{b.ambangMin}</b>
                  </span>
                )}
              </div>
              {b.isAyam && (
                <div className="pc-sub">
                  bagian: {b.stokDada ?? 0} dada · {b.stokPahaAtas ?? 0} PA · {b.stokPahaBawah ?? 0} PB ·{' '}
                  {b.stokSayap ?? 0} sayap
                </div>
              )}
              <div className="pc-acts">
                <Link to={`/beli?bahan=${id}`} style={{ textDecoration: 'none' }}>
                  <button className="pab">+ Beli</button>
                </Link>
                <Link to={`/koreksi?tipe=bahan&id=${id}`} style={{ textDecoration: 'none' }}>
                  <button className="pab">Opname</button>
                </Link>
                <Link to={`/mutasi?tipe=bahan&id=${id}`} style={{ textDecoration: 'none' }}>
                  <button className="pab">Riwayat</button>
                </Link>
                <Link to={`/bahan/${id}`} style={{ textDecoration: 'none' }}>
                  <button className="pab ink">Edit</button>
                </Link>
                <button
                  className={`pab icon ${b.aktif ? 'danger' : ''}`}
                  title={b.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                  onClick={() => (b.aktif ? setNonaktifTarget(b) : void aktifkan(b))}
                >
                  <PowerIcon />
                </button>
                <button className="pab icon dots" title="Hapus" onClick={() => setHapusTarget(b)}>
                  <DotsIcon />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        buka={nonaktifTarget != null}
        judul={`Nonaktifkan bahan "${nonaktifTarget?.nama ?? ''}"?`}
        pesan="Bahan langsung tidak dipakai di pembelian/produksi baru, tapi stok & riwayat tetap tersimpan. Untuk memakai lagi, aktifkan dari halaman ini."
        labelKonfirmasi="Nonaktifkan"
        onKonfirmasi={() => void konfirmasiNonaktif()}
        onBatal={() => setNonaktifTarget(null)}
      />

      <ConfirmDialog
        buka={hapusTarget != null}
        judul={`Hapus bahan "${hapusTarget?.nama ?? ''}"?`}
        pesan="Bahan beserta resep yang memakainya akan ikut terhapus. Aksi ini tidak bisa dibatalkan."
        labelKonfirmasi="Hapus bahan"
        onKonfirmasi={() => void konfirmasiHapus()}
        onBatal={() => setHapusTarget(null)}
      />
    </main>
  )
}