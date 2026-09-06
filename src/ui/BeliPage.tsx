import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { beliBahan, riwayatBeli, type ItemBeliInput } from '../data/actions'
import { db } from '../data/db'
import { hitungBelanja } from '../data/belanja'
import { formatRupiah } from '../domain/conversions'
import { formatQty } from '../domain/laporan'
import type { Bahan } from '../data/db'

interface Baris {
  key: number
  bahanId: number | ''
  qty: string
  harga: string
}

let barisKey = 0
const barisBaru = (bahanId: number | '' = '', qty = '1', harga = ''): Baris => ({
  key: barisKey++,
  bahanId,
  qty,
  harga,
})

interface HistBeli {
  id: number
  waktu: string
  sumber: string
  total: number
  itemText: string
}

type Popup = null | 'header' | 'baris'

/** Tampilkan tanggal yyyy-mm-dd ala Indonesia (mis. 5 September 2026). */
function tglIndo(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

function hariIniISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function BeliPage() {
  const [params] = useSearchParams()
  const [bahans, setBahans] = useState<Bahan[]>([])
  const [baris, setBaris] = useState<Baris[]>([])
  const [sumber, setSumber] = useState('Pusat')
  const [tanggal, setTanggal] = useState(hariIniISO())
  const [catatan, setCatatan] = useState('')
  const [riwayat, setRiwayat] = useState<HistBeli[]>([])
  const [pesan, setPesan] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [popup, setPopup] = useState<Popup>(null)
  const [err, setErr] = useState('')

  // draft pop-up: nota
  const [headerF, setHeaderF] = useState({ sumber: 'Pusat', tanggal: hariIniISO(), catatan: '' })
  // draft pop-up: baris (key -1 = baris baru)
  const [barisF, setBarisF] = useState<Baris | null>(null)

  async function refreshBahan() {
    const all = await db.bahan.toArray()
    setBahans(all.filter((b) => b.aktif).sort((a, b) => a.kategori.localeCompare(b.kategori) || a.nama.localeCompare(b.nama)))
  }
  async function refreshRiwayat() {
    const rows = await riwayatBeli(10)
    setRiwayat(
      rows.map((r) => ({
        id: r.header.id,
        waktu: r.header.waktu,
        sumber: r.header.sumber,
        total: r.header.total,
        itemText: r.items.map((i) => `${i.nama} ${i.qtyBeli} × ${formatRupiah(i.hargaSatuan)}`).join('; '),
      })),
    )
  }

  useEffect(() => {
    void refreshBahan()
    void refreshRiwayat()
    const preselect = params.get('bahan')
    setBaris(preselect && Number(preselect) > 0 ? [barisBaru(Number(preselect))] : [barisBaru()])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc menutup pop-up
  useEffect(() => {
    if (!popup) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(null)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [popup])

  const byId = new Map(bahans.map((b) => [b.id as number, b]))

  /** Satuan beli yang dipakai di nota (fallback: isi per beli). */
  function satuanBeli(b?: Bahan): string {
    if (!b) return '—'
    if (b.satuanBeli) return b.satuanBeli
    return `${b.jumlahDasarPerBeli ?? 1} ${b.satuanDasar}`
  }

  function stokSekarang(b: Bahan): string {
    if (b.isAyam && b.komposisiAyam) {
      return `${b.stokDada ?? 0} dada · ${b.stokPahaAtas ?? 0} PA · ${b.stokPahaBawah ?? 0} PB · ${b.stokSayap ?? 0} sayap`
    }
    return `${formatQty(b.stok ?? 0)} ${b.satuanDasar}`
  }

  function preview(b: Bahan, qtyN: number): string {
    if (qtyN <= 0) return ''
    if (b.isAyam && b.komposisiAyam) {
      const k = b.komposisiAyam
      return `+ ${qtyN * k.dada} dada, ${qtyN * k.pahaAtas} PA, ${qtyN * k.pahaBawah} PB, ${qtyN * k.sayap} sayap`
    }
    return `+ ${qtyN * (b.jumlahDasarPerBeli ?? 1)} ${b.satuanDasar}`
  }

  function total(): number {
    return baris.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0)
  }

  // ---------- pop-up: nota ----------
  function bukaNota() {
    setHeaderF({ sumber, tanggal, catatan })
    setPopup('header')
  }
  function simpanNota() {
    setSumber(headerF.sumber.trim() || 'Pusat')
    setTanggal(headerF.tanggal || hariIniISO())
    setCatatan(headerF.catatan.trim())
    setPopup(null)
  }

  // ---------- pop-up: baris ----------
  function bukaBaris(key: number | null) {
    if (key == null) {
      // key -1 = baris baru; saat disimpan diganti key asli lewat barisBaru()
      setBarisF({ key: -1, bahanId: '', qty: '1', harga: '' })
    } else {
      const r = baris.find((x) => x.key === key)
      if (!r) return
      setBarisF({ ...r })
    }
    setErr('')
    setPopup('baris')
  }
  function pilihBahanF(id: number | '') {
    setBarisF((prev) =>
      prev ? { ...prev, bahanId: id, harga: id === '' ? '' : String(byId.get(id)?.hargaBeliDefault ?? '') } : prev,
    )
  }
  function simpanBaris() {
    if (!barisF) return
    if (barisF.bahanId === '') {
      setErr('Pilih bahan dulu.')
      return
    }
    if (!(Number(barisF.qty) > 0)) {
      setErr('Qty beli harus lebih dari 0.')
      return
    }
    if (!(Number(barisF.harga) > 0)) {
      setErr('Harga per satuan beli wajib diisi (dasar HPP).')
      return
    }
    if (barisF.key === -1) {
      setBaris((prev) => [...prev, barisBaru(barisF.bahanId, barisF.qty, barisF.harga)])
    } else {
      setBaris((prev) =>
        prev.map((r) => (r.key === barisF.key ? { key: r.key, bahanId: barisF.bahanId, qty: barisF.qty, harga: barisF.harga } : r)),
      )
    }
    setPopup(null)
  }

  // ---------- + dari List Belanja ----------
  async function dariListBelanja() {
    setSibuk(true)
    setPesan('')
    try {
      const hasil = await hitungBelanja({ targetHari: 5, riwayatHari: 14 })
      const butuh = hasil.baris.filter((b) => b.beli > 0)
      if (butuh.length === 0) {
        setPesan('Semua bahan masih cukup — List Belanja kosong.')
        return
      }
      setBaris(
        butuh.map((b) => {
          const bahan = byId.get(b.bahanId)
          return barisBaru(b.bahanId, String(b.beli), bahan?.hargaBeliDefault != null ? String(bahan.hargaBeliDefault) : '')
        }),
      )
      setPesan(`✓ ${butuh.length} bahan dimasukkan dari List Belanja (±${hasil.targetHari} hari) — periksa qty & harga riil sebelum simpan.`)
    } catch (e) {
      setPesan(`Gagal: ${String(e)}`)
    } finally {
      setSibuk(false)
    }
  }

  async function simpan() {
    const items: ItemBeliInput[] = baris
      .map((r) => ({ bahanId: r.bahanId, qtyBeli: Number(r.qty), hargaSatuan: Number(r.harga) }))
      .filter((i): i is ItemBeliInput => i.bahanId !== '' && i.qtyBeli > 0 && i.hargaSatuan > 0)
    if (items.length === 0) {
      setPesan('Isi minimal satu baris belanja (bahan, qty, harga).')
      return
    }
    setSibuk(true)
    try {
      const jam = new Date()
      const waktu = `${tanggal}T${String(jam.getHours()).padStart(2, '0')}:${String(jam.getMinutes()).padStart(2, '0')}:${String(jam.getSeconds()).padStart(2, '0')}`
      const hasil = await beliBahan(items, { sumber, catatan, waktu })
      setPesan(`Beli #${hasil.id} tersimpan — total ${formatRupiah(hasil.total)}. Stok gudang bertambah.`)
      setBaris([barisBaru()])
      setCatatan('')
      await refreshRiwayat()
    } catch (e) {
      setPesan(`Gagal: ${String(e)}`)
    } finally {
      setSibuk(false)
    }
  }

  const barisSel = barisF && barisF.bahanId !== '' ? byId.get(barisF.bahanId) : undefined

  return (
    <main>
      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Beli Bahan</h2>
            <p className="db-sub">
              Nota multi-baris: harga riil per satuan beli dicatat di sini — dasar perhitungan HPP. Ayam utuh
              otomatis terpecah per bagian (dada/paha atas/paha bawah/sayap).
            </p>
          </div>
          <div className="sp2" style={{ flex: 1 }} />
          <span className="badge stock">Total nota {formatRupiah(total())}</span>
        </div>

        {/* ---------- header nota (ringkasan, edit lewat pop-up) ---------- */}
        <div className="sum-card">
          <div className="sum-head">
            <span className="t">Nota</span>
            <div className="sp2" style={{ flex: 1 }} />
            <button className="sum-edit" onClick={bukaNota} type="button">
              Ubah nota →
            </button>
          </div>
          <div className="sum-row">
            <span className="k">Sumber / supplier</span>
            <span className="v">{sumber || '—'}</span>
          </div>
          <div className="sum-row">
            <span className="k">Tanggal</span>
            <span className="v">{tglIndo(tanggal)}</span>
          </div>
          <div className="sum-row">
            <span className="k">Catatan</span>
            <span className="v">{catatan || '—'}</span>
          </div>
        </div>

        {/* ---------- baris nota ---------- */}
        <div className="sum-head" style={{ marginTop: 16 }}>
          <span className="t">Baris belanja ({baris.length})</span>
          <div className="sp2" style={{ flex: 1 }} />
          <button className="outline small" onClick={() => void dariListBelanja()} disabled={sibuk}>
            + dari List Belanja
          </button>
        </div>

        {baris.length === 0 && (
          <p className="empty" style={{ padding: '18px 0' }}>
            Belum ada baris — tambahkan bahan yang dibeli, atau isi otomatis dari List Belanja.
          </p>
        )}

        <div className="rlist">
          {baris.map((r) => {
            const b = r.bahanId === '' ? undefined : byId.get(r.bahanId)
            const qty = Number(r.qty) || 0
            const harga = Number(r.harga) || 0
            return (
              <div
                className="rrow"
                key={r.key}
                onClick={() => bukaBaris(r.key)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    bukaBaris(r.key)
                  }
                }}
              >
                <span className="nm">{b?.nama ?? '(pilih bahan)'}</span>
                <span className="dt">
                  {satuanBeli(b)} × {formatQty(qty)} · @{formatRupiah(harga)}
                </span>
                <span className="bi">{formatRupiah(qty * harga)}</span>
                <button
                  className="del"
                  type="button"
                  title="Hapus baris"
                  onClick={(e) => {
                    e.stopPropagation()
                    setBaris((prev) => prev.filter((x) => x.key !== r.key))
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="outline small" onClick={() => bukaBaris(null)} type="button">
            + Tambah baris
          </button>
        </div>

        {/* ---------- total & simpan ---------- */}
        <div className="hppbar">
          <div className="cell">
            <span>Baris lengkap</span>
            <b>{baris.filter((r) => r.bahanId !== '' && Number(r.qty) > 0 && Number(r.harga) > 0).length}</b>
          </div>
          <div className="cell">
            <span>Sumber</span>
            <b>{sumber}</b>
          </div>
          <div className="cell">
            <span>Total nota</span>
            <b>{formatRupiah(total())}</b>
          </div>
        </div>

        <div className="form-actions">
          <button className="primary" disabled={sibuk} onClick={() => void simpan()}>
            {sibuk ? 'Menyimpan…' : 'Simpan Beli'}
          </button>
          <Link to="/bahan">
            <button className="outline">Batal</button>
          </Link>
          <p className="hint2" style={{ margin: 0 }}>
            Simpan mencatat mutasi <b>beli</b> (+stok) dan memperbarui harga beli default tiap bahan.
          </p>
        </div>
        {pesan && <div className={`form-note ${pesan.startsWith('Gagal') ? 'err' : 'ok'}`}>{pesan}</div>}
      </section>

      {/* ---------- riwayat belanja (grid kartu) ---------- */}
      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Riwayat belanja</h2>
            <p className="db-sub">10 pembelian terakhir — riwayat lengkap tercatat di laporan stok.</p>
          </div>
          <div className="sp2" style={{ flex: 1 }} />
          <Link to="/mutasi" style={{ textDecoration: 'none' }}>
            <button className="outline small">Semua mutasi →</button>
          </Link>
        </div>
        {riwayat.length === 0 && <p className="empty">Belum ada pembelian.</p>}
        {riwayat.length > 0 && (
          <div className="prod-grid">
            {riwayat.map((r) => (
              <div className="prod-card" key={r.id}>
                <div className="pc-top">
                  <span className="pc-name">Beli #{r.id}</span>
                  <span className="badge">{r.sumber}</span>
                </div>
                <div className="pc-sub">{r.waktu}</div>
                <div className="pc-sub clamp2">{r.itemText}</div>
                <div className="pc-price">{formatRupiah(r.total)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ pop-up: ubah nota ============ */}
      {popup === 'header' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Ubah nota beli">
            <h3>Ubah nota</h3>
            <p className="sub">Sumber bebas teks (supplier), tanggal, dan catatan nota.</p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label htmlFor="bl-sumber">Sumber / supplier</label>
                <input
                  id="bl-sumber"
                  autoFocus
                  autoComplete="off"
                  list="sumber-list"
                  value={headerF.sumber}
                  onChange={(e) => setHeaderF((f) => ({ ...f, sumber: e.target.value }))}
                  placeholder="mis. Pusat (selling point)"
                />
                <datalist id="sumber-list">
                  <option value="Pusat" />
                  <option value="Lokal" />
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="bl-tanggal">Tanggal</label>
                <input
                  id="bl-tanggal"
                  type="date"
                  value={headerF.tanggal}
                  max={hariIniISO()}
                  onChange={(e) => setHeaderF((f) => ({ ...f, tanggal: e.target.value }))}
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="bl-catatan">Catatan (opsional)</label>
              <input
                id="bl-catatan"
                autoComplete="off"
                value={headerF.catatan}
                onChange={(e) => setHeaderF((f) => ({ ...f, catatan: e.target.value }))}
                placeholder="mis. belanja mingguan pusat"
              />
            </div>
            <div className="km-buttons">
              <button className="ghost" onClick={() => setPopup(null)} type="button">
                Batal
              </button>
              <button className="primary" onClick={simpanNota} type="button">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ pop-up: baris beli ============ */}
      {popup === 'baris' && barisF && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Tambah / edit baris beli">
            <h3>{barisF.key === -1 ? 'Tambah baris beli' : 'Edit baris beli'}</h3>
            <p className="sub">Bahan otomatis membawa satuan beli &amp; isi; qty &amp; harga riil diisi di sini.</p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="bl-bahan">Bahan *</label>
                <select
                  id="bl-bahan"
                  value={barisF.bahanId === '' ? '' : barisF.bahanId}
                  onChange={(e) => pilihBahanF(e.target.value === '' ? '' : Number(e.target.value))}
                >
                  <option value="">— pilih bahan —</option>
                  {bahans.map((x) => (
                    <option key={x.id} value={x.id as number}>
                      {x.nama} — {x.kategori}
                    </option>
                  ))}
                </select>
                {err && <span className="err-inline">{err}</span>}
              </div>
              <div className="field">
                <label htmlFor="bl-satuan">Satuan beli</label>
                <input
                  id="bl-satuan"
                  value={barisSel ? satuanBeli(barisSel) : '—'}
                  disabled
                  style={{ background: 'var(--soft)', color: 'var(--muted)' }}
                />
              </div>
              <div className="field">
                <label htmlFor="bl-qty">Qty beli *</label>
                <input
                  id="bl-qty"
                  name={`beli-qty-${barisF.key}`}
                  type="number"
                  min="0"
                  step="any"
                  autoComplete="off"
                  value={barisF.qty}
                  onChange={(e) => setBarisF((f) => (f ? { ...f, qty: e.target.value } : f))}
                />
              </div>
              <div className="field">
                <label htmlFor="bl-harga">Harga / satuan beli (Rp) *</label>
                <input
                  id="bl-harga"
                  name={`beli-harga-${barisF.key}`}
                  type="number"
                  min="0"
                  step="any"
                  autoComplete="off"
                  value={barisF.harga}
                  onChange={(e) => setBarisF((f) => (f ? { ...f, harga: e.target.value } : f))}
                  placeholder="mis. 23500"
                />
                <span className="hint">Harga riil ini menjadi dasar HPP (aturan rata-rata).</span>
              </div>
              <div className="field">
                <label>Subtotal</label>
                <input
                  value={formatRupiah((Number(barisF.qty) || 0) * (Number(barisF.harga) || 0))}
                  disabled
                  style={{ background: 'var(--soft)', color: 'var(--ink-soft)', fontWeight: 800 }}
                />
              </div>
            </div>
            {barisSel && (
              <p className="sub" style={{ marginTop: 10 }}>
                Stok sekarang: <b>{stokSekarang(barisSel)}</b> · {preview(barisSel, Number(barisF.qty) || 0)}
              </p>
            )}
            <div className="km-buttons">
              <button className="ghost" onClick={() => setPopup(null)} type="button">
                Batal
              </button>
              <button className="primary" onClick={simpanBaris} type="button">
                {barisF.key === -1 ? 'Tambah baris' : 'Simpan baris'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}