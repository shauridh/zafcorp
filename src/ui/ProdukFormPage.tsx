import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  catatHargaBaru,
  getProduk,
  listBahan,
  listProduk,
  resepProduk,
  riwayatHargaProduk,
  saveProdukLengkap,
} from '../data/repos'
import { koreksiStokProduk } from '../data/actions'
import { mesinHpp } from '../data/laporan'
import { formatQty, hargaPerDasar, marginPct } from '../domain/laporan'
import { formatRupiah, totalPotongPerEkor } from '../domain/conversions'
import { KATEGORI_PRODUK } from '../domain/master'
import type { Bahan, ItemResep, ProdukMenu } from '../data/db'
import type { HargaEntry } from '../domain/harga'

type Tab = 'info' | 'stok' | 'resep' | 'riwayat'
type Popup = null | 'info' | 'stok' | 'resep' | 'harga'

interface ResepDraft {
  key: number
  jenis: 'bahan' | 'produk'
  refId: number | ''
  qty: string
  tahap: 'produksi' | 'jual'
}

interface InfoF {
  nama: string
  kategori: string
  harga: string
  tipe: 'produksi' | 'langsung'
  aktif: boolean
}

let resepKey = 0

const STEPS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Info dasar' },
  { key: 'stok', label: 'Stok' },
  { key: 'resep', label: 'Resep' },
  { key: 'riwayat', label: 'Riwayat harga' },
]

export function ProdukFormPage() {
  const { id } = useParams()
  const editing = id != null
  const produkId = editing ? Number(id) : null
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const tabAwal: Tab =
    params.get('tab') === 'resep' ? 'resep' : params.get('tab') === 'harga' ? 'riwayat' : 'info'

  // ringkasan (draft) — diubah lewat pop-up
  const [nama, setNama] = useState('')
  const [kategori, setKategori] = useState('')
  const [tipe, setTipe] = useState<'produksi' | 'langsung'>('produksi')
  const [harga, setHarga] = useState('')
  const [aktif, setAktif] = useState(true)
  const [stok, setStok] = useState(0)
  const [resep, setResep] = useState<ResepDraft[]>([])
  const [riwayat, setRiwayat] = useState<HargaEntry[]>([])
  const [pesan, setPesan] = useState('')
  const [sibuk, setSibuk] = useState(false)

  const [tab, setTab] = useState<Tab>(tabAwal)
  const [popup, setPopup] = useState<Popup>(null)

  // data pendukung
  const [bahans, setBahans] = useState<Bahan[]>([])
  const [produks, setProduks] = useState<{ id: number; nama: string }[]>([])
  const [hppAda, setHppAda] = useState<{ biaya: Map<number, number>; ada: Map<number, boolean> } | null>(null)

  // form pop-up
  const [infoF, setInfoF] = useState<InfoF>({ nama: '', kategori: '', harga: '', tipe: 'produksi', aktif: true })
  const [err, setErr] = useState<{ field: 'nama' | 'harga'; msg: string } | null>(null)
  const [stokF, setStokF] = useState({ fisik: '', catatan: '' })
  const [resepF, setResepF] = useState<{ key: number | null; jenis: 'bahan' | 'produk'; refId: number | ''; qty: string; tahap: 'produksi' | 'jual' }>({
    key: null,
    jenis: 'bahan',
    refId: '',
    qty: '1',
    tahap: 'produksi',
  })
  const [hargaF, setHargaF] = useState({ harga: '', catatan: '' })

  useEffect(() => {
    void (async () => {
      const [b, p, hpp] = await Promise.all([listBahan(), listProduk(), mesinHpp()])
      setBahans(b)
      setProduks(p.map((x) => ({ id: x.id as number, nama: x.nama })))
      setHppAda(hpp)
    })()
  }, [])

  useEffect(() => {
    if (!editing) return
    void (async () => {
      const p = await getProduk(produkId as number)
      if (!p) {
        navigate('/produk')
        return
      }
      setNama(p.nama)
      setKategori(p.kategori)
      setTipe(p.tipeStok)
      setHarga(String(p.hargaJual))
      setAktif(p.aktif)
      setStok(p.stok ?? 0)
      const rows = await resepProduk(produkId as number)
      setResep(
        rows.map((r) => ({
          key: resepKey++,
          jenis: r.bahanId != null ? 'bahan' : 'produk',
          refId: (r.bahanId ?? r.produkKomponenId) as number,
          qty: String(r.qty),
          tahap: r.tahap,
        })),
      )
      setRiwayat(await riwayatHargaProduk(produkId as number))
    })()
  }, [id, editing, produkId, navigate])

  // Esc menutup pop-up
  useEffect(() => {
    if (!popup) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(null)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [popup])

  function qtyNum(s: string): number {
    const n = Number(String(s).replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }

  /** Harga per satuan dasar bahan (ayam utuh dihitung per potong). */
  function hargaDasar(b: Bahan): number {
    if (b.isAyam && b.komposisiAyam) return (b.hargaBeliDefault ?? 0) / totalPotongPerEkor(b.komposisiAyam)
    return hargaPerDasar(b.hargaBeliDefault ?? 0, b.jumlahDasarPerBeli)
  }

  function biayaBaris(r: ResepDraft): number {
    if (r.refId === '') return 0
    const qty = qtyNum(r.qty)
    if (r.jenis === 'bahan') {
      const b = bahans.find((x) => x.id === r.refId)
      return b ? qty * hargaDasar(b) : 0
    }
    return qty * (hppAda?.biaya.get(r.refId as number) ?? 0)
  }

  function satuanBaris(r: ResepDraft): string {
    if (r.refId === '') return ''
    if (r.jenis === 'bahan') return bahans.find((x) => x.id === r.refId)?.satuanDasar ?? ''
    return 'pcs'
  }

  const hppTotal = useMemo(
    () => resep.reduce((s, r) => s + biayaBaris(r), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resep, bahans, hppAda],
  )
  const hargaNum = qtyNum(harga)
  const margin = marginPct(hargaNum - hppTotal, hargaNum)
  const nProduksi = resep.filter((r) => r.tahap === 'produksi').length
  const nJual = resep.length - nProduksi

  const stokFisikN = qtyNum(stokF.fisik)
  const selisih = stokF.fisik !== '' ? stokFisikN - stok : null

  const resepBiayaPreview =
    resepF.refId === ''
      ? 0
      : resepF.jenis === 'bahan'
        ? (() => {
            const b = bahans.find((x) => x.id === resepF.refId)
            return b ? qtyNum(resepF.qty) * hargaDasar(b) : 0
          })()
        : qtyNum(resepF.qty) * (hppAda?.biaya.get(resepF.refId as number) ?? 0)

  const satuanPreview =
    resepF.refId === ''
      ? '—'
      : resepF.jenis === 'bahan'
        ? (bahans.find((x) => x.id === resepF.refId)?.satuanDasar ?? '—')
        : 'pcs'

  // ---------- pop-up: info dasar ----------
  function bukaInfo() {
    setInfoF({ nama, kategori, harga, tipe, aktif })
    setErr(null)
    setPopup('info')
  }
  function simpanInfo() {
    if (!infoF.nama.trim()) {
      setErr({ field: 'nama', msg: 'Nama produk wajib diisi.' })
      return
    }
    if (qtyNum(infoF.harga) <= 0) {
      setErr({ field: 'harga', msg: 'Harga jual harus angka lebih dari 0.' })
      return
    }
    setNama(infoF.nama.trim())
    setKategori(infoF.kategori.trim() || 'Lainnya')
    setHarga(infoF.harga)
    setTipe(infoF.tipe)
    setAktif(infoF.aktif)
    setPopup(null)
  }

  // ---------- pop-up: opname / koreksi stok ----------
  function bukaStok() {
    setStokF({ fisik: String(stok), catatan: '' })
    setPopup('stok')
  }
  async function simpanStok() {
    if (produkId == null || stokF.fisik === '') return
    setSibuk(true)
    setPesan('')
    try {
      await koreksiStokProduk(produkId, stokFisikN, stokF.catatan.trim() || 'opname')
      setStok(stokFisikN)
      setPesan(`✓ Opname tersimpan — stok jadi ${formatQty(stokFisikN)}. Selisih tercatat di riwayat mutasi.`)
      setPopup(null)
    } catch (e) {
      setPesan(`Gagal: ${String(e)}`)
    } finally {
      setSibuk(false)
    }
  }

  // ---------- pop-up: baris resep ----------
  function bukaResep(key: number | null, jenis: 'bahan' | 'produk') {
    if (key == null) {
      setResepF({ key: null, jenis, refId: '', qty: '1', tahap: 'produksi' })
    } else {
      const r = resep.find((x) => x.key === key)
      if (!r) return
      setResepF({ key, jenis: r.jenis, refId: r.refId, qty: r.qty, tahap: r.tahap })
    }
    setPopup('resep')
  }
  function simpanResep() {
    if (resepF.refId === '' || qtyNum(resepF.qty) <= 0) return
    if (resepF.key == null) {
      setResep((prev) => [
        ...prev,
        { key: resepKey++, jenis: resepF.jenis, refId: resepF.refId, qty: resepF.qty, tahap: resepF.tahap },
      ])
    } else {
      setResep((prev) =>
        prev.map((r) =>
          r.key === resepF.key ? { ...r, jenis: resepF.jenis, refId: resepF.refId, qty: resepF.qty, tahap: resepF.tahap } : r,
        ),
      )
    }
    setPopup(null)
  }

  // ---------- pop-up: catat harga ----------
  function bukaHarga() {
    setHargaF({ harga: harga, catatan: '' })
    setPopup('harga')
  }
  async function simpanHarga() {
    if (produkId == null) return
    const h = qtyNum(hargaF.harga)
    if (h <= 0) return
    setSibuk(true)
    setPesan('')
    try {
      await catatHargaBaru(produkId, h, hargaF.catatan)
      setHargaF({ harga: '', catatan: '' })
      setRiwayat(await riwayatHargaProduk(produkId))
      setPesan(`✓ Harga ${formatRupiah(h)} dicatat mulai hari ini.`)
      setPopup(null)
    } catch (e) {
      setPesan(`Gagal: ${String(e)}`)
    } finally {
      setSibuk(false)
    }
  }

  // ---------- simpan akhir ----------
  async function simpan() {
    if (!nama.trim()) {
      setErr({ field: 'nama', msg: 'Nama produk wajib diisi.' })
      setTab('info')
      bukaInfo()
      return
    }
    if (hargaNum <= 0) {
      setErr({ field: 'harga', msg: 'Harga jual harus angka lebih dari 0.' })
      setTab('info')
      bukaInfo()
      return
    }
    const p: ProdukMenu = {
      id: editing ? produkId as number : undefined,
      nama: nama.trim(),
      kategori: kategori.trim() || 'Lainnya',
      aktif,
      hargaJual: hargaNum,
      tipeStok: tipe,
    }
    const itemResep: ItemResep[] = resep
      .filter((r) => r.refId !== '' && qtyNum(r.qty) > 0)
      .map((r) => ({
        produkId: editing ? (produkId as number) : -1,
        bahanId: r.jenis === 'bahan' ? (r.refId as number) : undefined,
        produkKomponenId: r.jenis === 'produk' ? (r.refId as number) : undefined,
        qty: qtyNum(r.qty),
        tahap: r.tahap,
      }))
    await saveProdukLengkap(p, itemResep, true)
    navigate('/produk')
  }

  return (
    <main>
      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>{editing ? `Edit produk: ${nama || '…'}` : 'Tambah produk baru'}</h2>
            <p className="db-sub">
              {editing ? `Terakhir diubah 2 Sep 2026 · resep ${resep.length} baris` : 'Isi ringkasan lewat pop-up, lalu Simpan.'}
            </p>
          </div>
          <div className="sp2" style={{ flex: 1 }} />
          {editing && <span className={`pstat ${aktif ? 'on' : 'na'}`}>{aktif ? '● Aktif' : '● Nonaktif'}</span>}
        </div>

        <div className="stepper">
          {STEPS.map((s, i) => {
            const on = tab === s.key
            const idx = STEPS.findIndex((x) => x.key === tab)
            const done = !on && i < idx
            return (
              <button key={s.key} type="button" className={`stp ${on ? 'on' : ''} ${done ? 'done' : ''}`} onClick={() => setTab(s.key)}>
                <span className="n">{done ? '✓' : i + 1}</span>
                {s.label}
              </button>
            )
          })}
        </div>

        {/* ============ tab 1 · info dasar ============ */}
        {tab === 'info' && (
          <div className="sum-card">
            <div className="sum-head">
              <span className="t">Info dasar</span>
              <div className="sp2" style={{ flex: 1 }} />
              <button className="sum-edit" onClick={bukaInfo} type="button">
                Ubah info →
              </button>
            </div>
            <div className="sum-row">
              <span className="k">Nama menu</span>
              <span className="v">{nama || '—'}</span>
            </div>
            <div className="sum-row">
              <span className="k">Kategori</span>
              <span className="v">{kategori || 'Lainnya'}</span>
            </div>
            <div className="sum-row">
              <span className="k">Harga jual</span>
              <span className="v">{hargaNum > 0 ? formatRupiah(hargaNum) : '—'}</span>
            </div>
            <div className="sum-row">
              <span className="k">Tipe stok</span>
              <span className="v">{tipe === 'produksi' ? 'Produksi (digoreng/dibuat dulu)' : 'Langsung jual'}</span>
            </div>
            <div className="sum-row">
              <span className="k">Aktif di kasir</span>
              <span className="v">
                <span className={`pstat ${aktif ? 'on' : 'na'}`}>{aktif ? '● Aktif' : '● Nonaktif'}</span>
              </span>
            </div>
          </div>
        )}

        {/* ============ tab 2 · stok ============ */}
        {tab === 'stok' && (
          <>
            <div className="stok-grid">
              <div className="stok-card">
                <div className="sc-l">Stok jadi saat ini</div>
                <div className="sc-v">
                  {formatQty(stok)} <small>pcs</small>
                </div>
                {editing ? (
                  <Link className="go" to={`/mutasi?tipe=produk&id=${produkId}`}>
                    Riwayat mutasi →
                  </Link>
                ) : (
                  <span className="go" style={{ opacity: 0.5 }}>
                    Riwayat mutasi →
                  </span>
                )}
              </div>
              <div className="stok-card">
                <div className="sc-l">Koreksi / opname ringkas</div>
                <p className="hint2" style={{ margin: '6px 0 0' }}>
                  Catat stok fisik bila beda dengan catatan (tumpah, salah catat, opname). Selisih tercatat di
                  riwayat mutasi jenis <b>koreksi</b>.
                </p>
                <button
                  className="outline small"
                  style={{ marginTop: 8 }}
                  onClick={bukaStok}
                  disabled={!editing}
                  type="button"
                  title={editing ? '' : 'Simpan produk dulu, lalu bisa opname'}
                >
                  Opname / koreksi
                </button>
                {!editing && <p className="hint2" style={{ margin: '6px 0 0' }}>Simpan produk dulu untuk meng-opname stoknya.</p>}
              </div>
            </div>
            <p className="hint2">
              Untuk opname banyak bahan/produk sekaligus, gunakan halaman <b>Koreksi/Opname</b>.
            </p>
          </>
        )}

        {/* ============ tab 3 · resep ============ */}
        {tab === 'resep' && (
          <>
            <div className="hppbar">
              <div className="cell">
                <span>Total biaya langsung (HPP)</span>
                <b>{formatRupiah(hppTotal)}</b>
              </div>
              <div className="cell">
                <span>Laba / unit</span>
                <b>{hargaNum > 0 ? formatRupiah(hargaNum - hppTotal) : '—'}</b>
              </div>
              <div className="cell">
                <span>Margin</span>
                <b className={hargaNum > 0 ? (margin >= 35 ? 'ok' : margin >= 15 ? 'warn' : 'bad') : ''}>
                  {hargaNum > 0 ? `${Math.round(margin)}%` : '—'}
                </b>
              </div>
              <div className="cell">
                <span>Baris</span>
                <b>
                  {resep.length}
                  {resep.length > 0 && (
                    <small style={{ fontSize: 10, color: 'var(--muted)' }}>
                      {' '}
                      ({nProduksi} produksi · {nJual} jual)
                    </small>
                  )}
                </b>
              </div>
            </div>

            {resep.length === 0 && (
              <p className="empty" style={{ padding: '18px 0' }}>
                Belum ada baris resep. Tambahkan bahan baku atau komponen produk jadi.
              </p>
            )}

            <div className="rlist">
              {resep.map((r) => (
                <div className="rrow" key={r.key} onClick={() => bukaResep(r.key, r.jenis)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bukaResep(r.key, r.jenis) } }}>
                  <span className="nm">{r.refId === '' ? '(kosong)' : r.jenis === 'bahan' ? (bahans.find((b) => b.id === r.refId)?.nama ?? '?') : (produks.find((p) => p.id === r.refId)?.nama ?? '?')}</span>
                  <span className="dt">
                    {satuanBaris(r)} × {r.qty}
                  </span>
                  <span className={`tahap2 ${r.tahap === 'produksi' ? 'prod' : 'jual'}`}>{r.tahap}</span>
                  <span className="bi">{formatRupiah(biayaBaris(r))}</span>
                  <button
                    className="del"
                    type="button"
                    title="Hapus baris"
                    onClick={(e) => {
                      e.stopPropagation()
                      setResep((prev) => prev.filter((x) => x.key !== r.key))
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="outline small" onClick={() => bukaResep(null, 'bahan')} type="button">
                + Bahan baku
              </button>
              <button className="outline small" onClick={() => bukaResep(null, 'produk')} type="button">
                + Komponen produk jadi
              </button>
            </div>

            <p className="hint2">
              Klik baris untuk mengedit lewat pop-up (pilih entitas bahan/produk jadi → satuan dasar otomatis → qty →
              tahap). HPP = qty × harga beli terakhir per satuan dasar (aturan rata-rata); ayam utuh dihitung per
              potong. Perubahan langsung memperbarui HPP &amp; margin di daftar dan laporan laba.
            </p>
          </>
        )}

        {/* ============ tab 4 · riwayat harga ============ */}
        {tab === 'riwayat' && (
          <>
            {riwayat.length === 0 ? (
              <p className="empty" style={{ padding: '18px 0' }}>
                Belum ada riwayat harga. Harga pertama dicatat saat produk disimpan.
              </p>
            ) : (
              <table className="rpt">
                <thead>
                  <tr>
                    <th className="l">Berlaku sejak</th>
                    <th className="l">Harga</th>
                    <th className="l">Sumber perubahan</th>
                  </tr>
                </thead>
                <tbody>
                  {riwayat.map((r) => (
                    <tr key={`${r.tanggal}-${r.harga}`}>
                      <td className="l">{r.tanggal}</td>
                      <td className="l">{formatRupiah(r.harga)}</td>
                      <td className="l dim">{r.catatan ?? 'diubah manual'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="outline small" style={{ marginTop: 10 }} onClick={bukaHarga} disabled={!editing} type="button">
              + Catat perubahan harga
            </button>
            <p className="hint2">
              Harga baru muncul sebagai baris teratas dan langsung berlaku di kasir; transaksi yang sudah selesai{' '}
              <b>tetap memakai harga saat itu</b> (tidak berubah).
            </p>
          </>
        )}

        {pesan && <div className={`form-note ${pesan.startsWith('✓') ? 'ok' : 'err'}`}>{pesan}</div>}

        <div className="form-actions">
          <button className="primary" onClick={() => void simpan()} disabled={sibuk}>
            Simpan
          </button>
          <Link to="/produk">
            <button className="outline">Batal</button>
          </Link>
        </div>
      </section>

      {/* ============ pop-up: ubah info dasar ============ */}
      {popup === 'info' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Ubah info dasar">
            <h3>Ubah info dasar</h3>
            <p className="sub">Perubahan harga dicatat otomatis di riwayat saat disimpan.</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="pf-nama">Nama menu *</label>
                <input
                  id="pf-nama"
                  autoFocus
                  autoComplete="off"
                  aria-invalid={err?.field === 'nama'}
                  value={infoF.nama}
                  onChange={(e) => setInfoF((f) => ({ ...f, nama: e.target.value }))}
                  placeholder="mis. Paket Nasi + Dada"
                />
                {err?.field === 'nama' && <span className="err-inline">{err.msg}</span>}
              </div>
              <div className="field">
                <label htmlFor="pf-kat">Kategori</label>
                <input id="pf-kat" autoComplete="off" list="kat-produk" value={infoF.kategori} onChange={(e) => setInfoF((f) => ({ ...f, kategori: e.target.value }))} />
                <datalist id="kat-produk">
                  {KATEGORI_PRODUK.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="pf-harga">Harga jual (Rp) *</label>
                <input
                  id="pf-harga"
                  autoComplete="off"
                  inputMode="numeric"
                  aria-invalid={err?.field === 'harga'}
                  value={infoF.harga}
                  onChange={(e) => setInfoF((f) => ({ ...f, harga: e.target.value }))}
                  placeholder="mis. 11000"
                />
                {err?.field === 'harga' && <span className="err-inline">{err.msg}</span>}
                <span className="hint">Perubahan dicatat di riwayat; transaksi lama tetap memakai harga saat itu.</span>
              </div>
              <div className="field">
                <label htmlFor="pf-tipe">Tipe stok</label>
                <select id="pf-tipe" value={infoF.tipe} onChange={(e) => setInfoF((f) => ({ ...f, tipe: e.target.value as 'produksi' | 'langsung' }))}>
                  <option value="produksi">Produksi (digoreng/dibuat dulu)</option>
                  <option value="langsung">Langsung jual (minuman &amp; sejenisnya)</option>
                </select>
              </div>
              <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <label className="switch">
                  <input type="checkbox" checked={infoF.aktif} onChange={(e) => setInfoF((f) => ({ ...f, aktif: e.target.checked }))} />
                  <span className="slider" />
                </label>
                <b style={{ fontSize: 14 }}>Aktif di kasir</b>
              </div>
            </div>
            <div className="km-buttons">
              <button className="ghost" onClick={() => setPopup(null)} type="button">
                Batal
              </button>
              <button className="primary" onClick={simpanInfo} type="button">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ pop-up: opname / koreksi stok ============ */}
      {popup === 'stok' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Opname stok">
            <h3>Opname / koreksi stok</h3>
            <p className="sub">
              {nama} · stok catatan {formatQty(stok)} pcs
            </p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label htmlFor="pf-fisik">Stok fisik (pcs) *</label>
                <input
                  id="pf-fisik"
                  autoFocus
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  autoComplete="off"
                  value={stokF.fisik}
                  onChange={(e) => setStokF((f) => ({ ...f, fisik: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Selisih</label>
                <input
                  value={selisih == null ? '' : `${selisih > 0 ? '+' : ''}${formatQty(selisih)}`}
                  disabled
                  style={{ color: selisih === 0 ? 'var(--ok)' : selisih == null ? undefined : 'var(--danger)', fontWeight: 800 }}
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="pf-catatan">Catatan (opsional)</label>
              <input id="pf-catatan" autoComplete="off" value={stokF.catatan} onChange={(e) => setStokF((f) => ({ ...f, catatan: e.target.value }))} placeholder="mis. tumpah / opname sore" />
            </div>
            <p className="sub" style={{ marginTop: 8 }}>
              Menyimpan mencatat mutasi jenis <b>koreksi</b>; stok fisik menjadi stok baru yang dipakai kasir.
            </p>
            <div className="km-buttons">
              <button className="ghost" onClick={() => setPopup(null)} disabled={sibuk} type="button">
                Batal
              </button>
              <button className="primary" onClick={() => void simpanStok()} disabled={sibuk || stokF.fisik === ''} type="button">
                {sibuk ? 'Menyimpan…' : 'Simpan koreksi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ pop-up: baris resep ============ */}
      {popup === 'resep' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Tambah / edit baris resep">
            <h3>{resepF.key == null ? 'Tambah baris resep' : 'Edit baris resep'}</h3>
            <p className="sub">Pola “roti isian”: entitas → satuan dasar otomatis → qty → tahap.</p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label htmlFor="pf-jenis">Entitas</label>
                <select
                  id="pf-jenis"
                  value={resepF.jenis}
                  onChange={(e) => {
                    const jenis = e.target.value as 'bahan' | 'produk'
                    setResepF((f) => ({ ...f, jenis, refId: '' }))
                  }}
                >
                  <option value="bahan">Bahan baku (gudang)</option>
                  <option value="produk">Komponen produk jadi</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="pf-item">Item *</label>
                <select
                  id="pf-item"
                  value={resepF.refId === '' ? '' : resepF.refId}
                  onChange={(e) => setResepF((f) => ({ ...f, refId: e.target.value === '' ? '' : Number(e.target.value) }))}
                >
                  <option value="">— pilih —</option>
                  {(resepF.jenis === 'bahan' ? bahans : produks).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nama}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pf-satuan">Satuan dasar</label>
                <input id="pf-satuan" value={satuanPreview} disabled style={{ background: 'var(--soft)', color: 'var(--muted)' }} />
              </div>
              <div className="field">
                <label htmlFor="pf-qty">Qty *</label>
                <input
                  id="pf-qty"
                  inputMode="decimal"
                  autoComplete="off"
                  value={resepF.qty}
                  onChange={(e) => setResepF((f) => ({ ...f, qty: e.target.value }))}
                  placeholder="1"
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Tahap</label>
              <span className="tahap-seg" role="group" aria-label="Tahap konsumsi">
                <button type="button" className={resepF.tahap === 'produksi' ? 'on' : ''} onClick={() => setResepF((f) => ({ ...f, tahap: 'produksi' }))}>
                  produksi
                </button>
                <button type="button" className={resepF.tahap === 'jual' ? 'on' : ''} onClick={() => setResepF((f) => ({ ...f, tahap: 'jual' }))}>
                  jual
                </button>
              </span>
              <span className="hint">produksi = dipakai saat menggoreng/membuat; jual = kemasan/saus saat penjualan.</span>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Biaya estimasi</label>
              <input value={formatRupiah(resepBiayaPreview)} disabled style={{ background: 'var(--soft)', color: 'var(--ink-soft)', fontWeight: 800 }} />
            </div>
            <div className="km-buttons">
              <button className="ghost" onClick={() => setPopup(null)} type="button">
                Batal
              </button>
              <button className="primary" onClick={simpanResep} disabled={resepF.refId === '' || qtyNum(resepF.qty) <= 0} type="button">
                {resepF.key == null ? 'Tambah baris' : 'Simpan baris'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ pop-up: catat perubahan harga ============ */}
      {popup === 'harga' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Catat perubahan harga">
            <h3>Catat perubahan harga</h3>
            <p className="sub">
              {nama} · harga saat ini {hargaNum > 0 ? formatRupiah(hargaNum) : '—'}
            </p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label htmlFor="pf-harga-baru">Harga baru (Rp) *</label>
                <input
                  id="pf-harga-baru"
                  autoFocus
                  type="number"
                  min="0"
                  inputMode="numeric"
                  autoComplete="off"
                  value={hargaF.harga}
                  onChange={(e) => setHargaF((f) => ({ ...f, harga: e.target.value }))}
                  placeholder="mis. 11500"
                />
              </div>
              <div className="field">
                <label htmlFor="pf-catatan-harga">Catatan</label>
                <input id="pf-catatan-harga" autoComplete="off" value={hargaF.catatan} onChange={(e) => setHargaF((f) => ({ ...f, catatan: e.target.value }))} placeholder="mis. naik harga bahan" />
              </div>
            </div>
            <p className="sub" style={{ marginTop: 8 }}>
              Berlaku segera di kasir. Transaksi yang sudah selesai <b>tetap memakai harga lama</b>.
            </p>
            <div className="km-buttons">
              <button className="ghost" onClick={() => setPopup(null)} disabled={sibuk} type="button">
                Batal
              </button>
              <button className="primary" onClick={() => void simpanHarga()} disabled={sibuk || qtyNum(hargaF.harga) <= 0} type="button">
                {sibuk ? 'Menyimpan…' : 'Catat'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}