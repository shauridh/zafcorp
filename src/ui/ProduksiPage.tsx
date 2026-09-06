import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  catatProduksiAyam,
  catatProduksiProduk,
  rekomendasiBahanAyam,
  riwayatProduksi,
  type Kekurangan,
} from '../data/actions'
import { db } from '../data/db'
import type { Bahan, Fryer, ProdukMenu } from '../data/db'
import { daftarFryer, statusFryer } from '../data/fryer'
import type { JadwalFryer } from '../domain/fryer'
import { formatQty } from '../domain/laporan'

interface ProdukRow {
  key: number
  produkId: number | ''
  qty: string
}
let rowKey = 0
const rowBaru = (): ProdukRow => ({ key: rowKey++, produkId: '', qty: '1' })

interface HistProd {
  id: number
  waktu: string
  ringkasan?: string
  catatan?: string
}

type Tab = 'ayam' | 'produk'
type Popup = null | 'ayam' | 'baris'

interface SuksesProd {
  judul: string
  masuk: string
  keluar: string
}

const STEPS: { key: Tab; label: string }[] = [
  { key: 'ayam', label: 'Ayam utuh (per ekor)' },
  { key: 'produk', label: 'Produk lain' },
]

export function ProduksiPage() {
  const [tab, setTab] = useState<Tab>('ayam')
  const [popup, setPopup] = useState<Popup>(null)
  const [err, setErr] = useState('')

  // draft ayam (ringkasan diubah lewat pop-up)
  const [ekor, setEkor] = useState('2')
  const [ayamId, setAyamId] = useState<number | ''>('')
  const [tepungId, setTepungId] = useState<number | ''>('')
  const [minyakId, setMinyakId] = useState<number | ''>('')
  const [fryerId, setFryerId] = useState<number | ''>('')
  const [ayamF, setAyamF] = useState({
    ekor: '2',
    ayamId: '' as number | '',
    tepungId: '' as number | '',
    minyakId: '' as number | '',
    fryerId: '' as number | '',
  })

  // produk umum
  const [produkList, setProdukList] = useState<ProdukMenu[]>([])
  const [rows, setRows] = useState<ProdukRow[]>([rowBaru()])
  const [barisF, setBarisF] = useState<ProdukRow | null>(null)

  // data pendukung
  const [fryers, setFryers] = useState<Fryer[]>([])
  const [fryerViews, setFryerViews] = useState<{ fryer: Fryer; status: JadwalFryer }[]>([])
  const [riwayat, setRiwayat] = useState<HistProd[]>([])
  const [pesan, setPesan] = useState('')
  const [kekurangan, setKekurangan] = useState<Kekurangan[]>([])
  const [sibuk, setSibuk] = useState(false)
  const [sukses, setSukses] = useState<SuksesProd | null>(null)

  async function refreshRiwayat() {
    setRiwayat(await riwayatProduksi(15))
  }
  async function refreshFryer() {
    const fs = (await daftarFryer()).filter((x) => x.aktif)
    setFryers(fs)
    const views: { fryer: Fryer; status: JadwalFryer }[] = []
    for (const f of fs) views.push({ fryer: f, status: await statusFryer(f) })
    setFryerViews(views)
  }

  useEffect(() => {
    void (async () => {
      const all = await db.bahan.toArray()
      setBahanAyam(all.filter((b) => b.aktif && b.isAyam && b.komposisiAyam))
      setBahanTepung(all.filter((b) => b.aktif && b.kategori === 'Tepung & Bumbu'))
      setBahanMinyak(all.filter((b) => b.aktif && b.kategori === 'Minyak'))
      const p = await db.produk.toArray()
      setProdukList(p.filter((x) => x.aktif && x.tipeStok === 'produksi'))
      await refreshFryer()
      try {
        const def = await rekomendasiBahanAyam()
        setAyamId(def.ayamId)
        setTepungId(def.tepungId)
        setMinyakId(def.minyakId)
      } catch {
        /* dibiarkan kosong — dropdown manual */
      }
      await refreshRiwayat()
    })()
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

  const [bahanAyam, setBahanAyam] = useState<Bahan[]>([])
  const [bahanTepung, setBahanTepung] = useState<Bahan[]>([])
  const [bahanMinyak, setBahanMinyak] = useState<Bahan[]>([])

  const ayamSel = bahanAyam.find((b) => b.id === ayamId)
  const tepungSel = bahanTepung.find((b) => b.id === tepungId)
  const minyakSel = bahanMinyak.find((b) => b.id === minyakId)
  const fryerSel = fryers.find((f) => f.id === fryerId)
  const fryerView = fryerViews.find((v) => v.fryer.id === fryerId)
  // fryer yang sedang wajib top-up/ganti — tampil mencolok sebelum form produksi
  const dueFryers = fryerViews.filter((v) => v.status.dueGanti || v.status.dueTopUp)

  const nEkor = Number(ekor) || 0
  const lewatTopUp = !!(fryerSel && fryerView && nEkor > fryerView.status.sisaTopUp)

  const jumlahBagian = (ekorN: number) => {
    if (!ayamSel?.komposisiAyam || ekorN <= 0) return ''
    const k = ayamSel.komposisiAyam
    return `${ekorN * k.dada} dada, ${ekorN * k.pahaAtas} PA, ${ekorN * k.pahaBawah} PB, ${ekorN * k.sayap} sayap`
  }

  // ---------- pop-up: ayam ----------
  function bukaAyam() {
    setAyamF({ ekor, ayamId, tepungId, minyakId, fryerId })
    setErr('')
    setPopup('ayam')
  }
  function simpanAyam() {
    if (!(Number(ayamF.ekor) > 0)) {
      setErr('Jumlah ekor harus lebih dari 0.')
      return
    }
    if (ayamF.ayamId === '' || ayamF.tepungId === '' || ayamF.minyakId === '') {
      setErr('Lengkapi ayam mentah, tepung, dan minyak.')
      return
    }
    setEkor(ayamF.ekor)
    setAyamId(ayamF.ayamId)
    setTepungId(ayamF.tepungId)
    setMinyakId(ayamF.minyakId)
    setFryerId(ayamF.fryerId)
    setPopup(null)
  }

  async function catatAyam() {
    const n = Number(ekor)
    if (!(n > 0) || ayamId === '' || tepungId === '' || minyakId === '') {
      setPesan('Lengkapi jumlah ekor & pilihan bahan (ayam, tepung, minyak).')
      setTab('ayam')
      bukaAyam()
      return
    }
    setSibuk(true)
    setKekurangan([])
    setSukses(null)
    try {
      const hasil = await catatProduksiAyam(n, { ayamId, tepungId, minyakId }, '', fryerId === '' ? undefined : fryerId)
      if (!hasil.ok) {
        setKekurangan(hasil.kekurangan)
        setPesan('Stok gudang tidak cukup — lihat daftar kekurangan di bawah.')
        return
      }
      const masuk = jumlahBagian(n)
      const keluar = `ayam ${n} ekor (semua bagian) · tepung ${((n / 3) * (tepungSel?.jumlahDasarPerBeli ?? 1)).toFixed(2)} pak · minyak ${(n * 0.2).toFixed(2)} L`
      let judul = `Produksi #${hasil.id} tersimpan — ${hasil.ringkasan}`
      if (fryerId !== '' && fryerSel) {
        const st = fryerView?.status
        if (st?.dueTopUp) judul += ` · ⚠ ${fryerSel.nama}: top-up minyak (sudah ${st.ekorSejakTopUp} ekor)`
        else if (st?.dueGanti) judul += ` · ⚠ ${fryerSel.nama}: ganti minyak (sudah ${st.hariSejakGanti} hari)`
      }
      setSukses({ judul, masuk: `Masuk stok jadi: ${masuk}`, keluar: `Keluar gudang: ${keluar}` })
      setPesan('')
      setEkor('')
      await Promise.all([refreshRiwayat(), refreshFryer()])
    } catch (e) {
      setPesan(`Gagal: ${String(e)}`)
    } finally {
      setSibuk(false)
    }
  }

  // ---------- pop-up: baris produk ----------
  function bukaBaris(key: number | null) {
    if (key == null) {
      setBarisF({ key: -1, produkId: '', qty: '1' })
    } else {
      const r = rows.find((x) => x.key === key)
      if (!r) return
      setBarisF({ ...r })
    }
    setErr('')
    setPopup('baris')
  }
  function simpanBaris() {
    if (!barisF) return
    if (barisF.produkId === '') {
      setErr('Pilih produk dulu.')
      return
    }
    if (!(Number(barisF.qty) > 0)) {
      setErr('Qty harus lebih dari 0.')
      return
    }
    if (barisF.key === -1) {
      setRows((prev) => [...prev, { key: rowKey++, produkId: barisF.produkId, qty: barisF.qty }])
    } else {
      setRows((prev) => prev.map((r) => (r.key === barisF.key ? { key: r.key, produkId: barisF.produkId, qty: barisF.qty } : r)))
    }
    setPopup(null)
  }

  async function catatProduk() {
    const outputs = rows
      .map((r) => ({ produkId: r.produkId, qty: Number(r.qty) }))
      .filter((x) => x.produkId !== '' && x.qty > 0) as { produkId: number; qty: number }[]
    if (outputs.length === 0) {
      setPesan('Pilih produk & qty yang akan dicatat produksinya.')
      return
    }
    setSibuk(true)
    setKekurangan([])
    setSukses(null)
    try {
      const hasil = await catatProduksiProduk(outputs)
      if (!hasil.ok) {
        setKekurangan(hasil.kekurangan)
        setPesan('Bahan/resep produksi tidak cukup — lihat daftar kekurangan di bawah.')
        return
      }
      const masuk = outputs
        .map((o) => `${produkList.find((p) => p?.id === o.produkId)?.nama ?? '?'} ${formatQty(o.qty)} pcs`)
        .join(', ')
      setSukses({
        judul: `Produksi #${hasil.id} tersimpan — ${hasil.ringkasan}`,
        masuk: `Masuk stok jadi: ${masuk}`,
        keluar: 'Keluar gudang: sesuai resep produksi (bahan & komponen)',
      })
      setPesan('')
      setRows([rowBaru()])
      await Promise.all([refreshRiwayat(), refreshFryer()])
    } catch (e) {
      setPesan(`Gagal: ${String(e)}`)
    } finally {
      setSibuk(false)
    }
  }

  const rowsValid = rows.filter((r) => r.produkId !== '')
  const totalQty = rowsValid.reduce((s, r) => s + (Number(r.qty) || 0), 0)

  return (
    <main>
      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Catat Produksi</h2>
            <p className="db-sub">
              Ayam utuh per ekor (potongan + tepung + minyak) atau produk lain via resep produksi — stok
              keluar/masuk &amp; meter fryer dihitung otomatis.
            </p>
          </div>
        </div>

        {dueFryers.length > 0 && (
          <div className="fryer-urgent">
            <div className="db-ct" style={{ marginBottom: 2 }}><span>Sebelum produksi — deep fryer butuh tindakan</span></div>
            {dueFryers.map(({ fryer: f, status: st }) => (
              <div className="warn-banner" key={f.id} style={{ marginTop: 6 }}>
                ⚠ <b>{f.nama}:</b>{' '}
                {st.dueGanti && st.dueTopUp
                  ? `ganti minyak (${st.hariSejakGanti} hari) & top-up (${st.ekorSejakTopUp}/${f.topUpPak} ekor)`
                  : st.dueGanti
                    ? `ganti minyak — sudah ${st.hariSejakGanti} hari`
                    : `top-up minyak — sudah ${st.ekorSejakTopUp}/${f.topUpPak} ekor`}{' '}
                <Link to="/fryer" style={{ color: 'var(--brand-deep)', fontWeight: 800, whiteSpace: 'nowrap' }}>
                  Atasi di Deep Fryer →
                </Link>
              </div>
            ))}
          </div>
        )}

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

        {/* ============ tab 1 · ayam utuh ============ */}
        {tab === 'ayam' && (
          <>
            <div className="sum-card">
              <div className="sum-head">
                <span className="t">Ayam utuh (per ekor)</span>
                <div className="sp2" style={{ flex: 1 }} />
                <button className="sum-edit" onClick={bukaAyam} type="button">
                  Ubah →
                </button>
              </div>
              <div className="sum-row">
                <span className="k">Jumlah ekor</span>
                <span className="v">{ekor || '—'}</span>
              </div>
              <div className="sum-row">
                <span className="k">Ayam mentah</span>
                <span className="v">{ayamSel ? `${ayamSel.nama} (${ayamSel.stokDada ?? 0}d / ${ayamSel.stokPahaAtas ?? 0}PA / ${ayamSel.stokPahaBawah ?? 0}PB / ${ayamSel.stokSayap ?? 0}s)` : '—'}</span>
              </div>
              <div className="sum-row">
                <span className="k">Tepung</span>
                <span className="v">{tepungSel ? `${tepungSel.nama} (stok ${formatQty(tepungSel.stok ?? 0)} ${tepungSel.satuanDasar})` : '—'}</span>
              </div>
              <div className="sum-row">
                <span className="k">Minyak</span>
                <span className="v">{minyakSel ? `${minyakSel.nama} (stok ${formatQty(minyakSel.stok ?? 0)} ${minyakSel.satuanDasar})` : '—'}</span>
              </div>
              <div className="sum-row">
                <span className="k">Deep fryer</span>
                <span className="v">
                  {fryerSel && fryerView ? (
                    <>
                      {fryerSel.nama} — {fryerView.status.ekorSejakTopUp}/{fryerSel.topUpPak} ekor sejak top-up
                    </>
                  ) : (
                    '— tanpa fryer —'
                  )}
                </span>
              </div>
            </div>

            <div className="row-meta" style={{ margin: '10px 0 0' }}>
              {ayamSel && nEkor > 0 && (
                <>
                  Hasil: <b>{jumlahBagian(nEkor)}</b> masuk stok jadi · Konsumsi:{' '}
                  {tepungSel && <span>tepung {((nEkor / 3) * (tepungSel.jumlahDasarPerBeli ?? 1)).toFixed(2)} pak</span>}
                  {minyakSel && <span> · minyak {(nEkor * 0.2).toFixed(2)} L</span>}
                  {fryerSel && <span> · meter fryer +{nEkor} ekor</span>}
                </>
              )}
            </div>

            {lewatTopUp && fryerSel && fryerView && (
              <div className="warn-banner">
                ⚠ <b>{fryerSel.nama}:</b> {nEkor} ekor ini melewati ambang top-up (sisa {fryerView.status.sisaTopUp}{' '}
                ekor) — siapkan top-up minyak setelah produksi.
              </div>
            )}
            {!lewatTopUp && fryerSel && fryerView && fryerView.status.dueGanti && (
              <div className="warn-banner">
                ⚠ <b>{fryerSel.nama}:</b> ganti minyak sekarang — sudah {fryerView.status.hariSejakGanti} hari.
              </div>
            )}

            {sukses && (
              <div className="card" style={{ background: 'var(--ok-bg)', marginTop: 12 }}>
                <b style={{ color: 'var(--ok)' }}>{sukses.judul}</b>
                <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>
                  {sukses.keluar}
                  <br />
                  {sukses.masuk}
                </p>
                <button className="outline small" style={{ marginTop: 8 }} onClick={() => setSukses(null)} type="button">
                  Produksi lagi
                </button>
              </div>
            )}

            <button className="primary" disabled={sibuk} onClick={() => void catatAyam()} style={{ marginTop: 12 }}>
              {sibuk ? 'Menyimpan…' : 'Catat produksi ayam'}
            </button>
          </>
        )}

        {/* ============ tab 2 · produk lain ============ */}
        {tab === 'produk' && (
          <>
            <p className="muted">
              Pilih produk &amp; jumlah — bahan otomatis terpotong dari gudang sesuai resep produksinya.
            </p>

            <div className="hppbar">
              <div className="cell">
                <span>Baris output</span>
                <b>{rowsValid.length}</b>
              </div>
              <div className="cell">
                <span>Total qty</span>
                <b>{formatQty(totalQty)} pcs</b>
              </div>
              <div className="cell">
                <span>Sumber</span>
                <b>Resep produksi</b>
              </div>
            </div>

            {rows.length === 0 && (
              <p className="empty" style={{ padding: '18px 0' }}>
                Belum ada baris — tambahkan produk yang dicatat produksinya.
              </p>
            )}

            <div className="rlist">
              {rows.map((r) => {
                const p = r.produkId === '' ? undefined : produkList.find((x) => x.id === r.produkId)
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
                    <span className="nm">{p?.nama ?? '(pilih produk)'}</span>
                    <span className="dt">pcs × {r.qty || '0'}</span>
                    <span className="bi">+{formatQty(Number(r.qty) || 0)} pcs</span>
                    <button
                      className="del"
                      type="button"
                      title="Hapus baris"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRows((prev) => prev.filter((x) => x.key !== r.key))
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
                + Tambah produk
              </button>
              <button className="primary" disabled={sibuk} onClick={() => void catatProduk()}>
                {sibuk ? 'Menyimpan…' : 'Catat produksi'}
              </button>
            </div>
          </>
        )}

        {kekurangan.length > 0 && (
          <div className="card" style={{ background: 'var(--soft)', marginTop: 12 }}>
            <b>Stok tidak cukup — beli dulu:</b>
            <ul style={{ margin: '8px 0 0' }}>
              {kekurangan.map((k) => (
                <li key={k.nama}>
                  {k.nama}: kurang {formatQty(k.kurang)}
                </li>
              ))}
            </ul>
            <Link style={{ color: 'var(--brand-ink)' }} to="/beli">
              Ke layar Beli Bahan →
            </Link>
          </div>
        )}
        {pesan && !(kekurangan.length > 0) && <div className={`form-note ${pesan.startsWith('Gagal') ? 'err' : 'ok'}`}>{pesan}</div>}
      </section>

      {/* ============ panel "Hari ini" — meter minyak deep fryer ============ */}
      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Hari ini</h2>
            <p className="db-sub">Meter minyak deep fryer — cek sebelum produksi (ekor &amp; hari sejak top-up/ganti).</p>
          </div>
          <div className="sp2" style={{ flex: 1 }} />
          <Link to="/fryer" style={{ textDecoration: 'none' }}>
            <button className="outline small">Kelola fryer →</button>
          </Link>
        </div>
        {fryerViews.length === 0 && (
          <p className="empty">
            Belum ada fryer aktif.{' '}
            <Link to="/fryer" style={{ color: 'var(--brand-ink)' }}>
              Daftarkan di halaman Deep Fryer →
            </Link>
          </p>
        )}
        {fryerViews.length > 0 && (
          <div className="prod-grid">
            {fryerViews.map(({ fryer: f, status: st }) => {
              const pct = Math.min(100, Math.round((st.ekorSejakTopUp / f.topUpPak) * 100))
              const meterCls = st.dueGanti || st.dueTopUp ? 'bad' : pct >= 80 ? 'warn' : ''
              return (
                <div className="prod-card" key={f.id}>
                  <div className="pc-top">
                    <span className="pc-name">{f.nama}</span>
                    <span className={`pstat ${st.dueGanti ? 'hab' : st.dueTopUp ? 'low' : 'on'}`}>
                      {st.dueGanti ? '● Ganti sekarang' : st.dueTopUp ? '● Top-up' : '● Sehat'}
                    </span>
                  </div>
                  <div className="pc-badges">
                    <span className="badge unit">isi {f.isiAwalL} L</span>
                    <span className="badge">top-up tiap {f.topUpPak} ekor</span>
                  </div>
                  <div className="pc-sub">
                    Ekor sejak top-up: <b>{st.ekorSejakTopUp}</b>/{f.topUpPak} · sejak ganti:{' '}
                    <b>{st.hariSejakGanti}</b>/{f.gantiHari} hari
                  </div>
                  <div className="meter">
                    <i className={meterCls} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="pc-sub">
                    {st.dueGanti
                      ? `⚠ wajib ganti minyak`
                      : st.dueTopUp
                        ? `⚠ wajib top-up sekarang`
                        : `sisa ${st.sisaTopUp} ekor s/d top-up · ganti dalam ${st.sisaHariGanti} hari`}
                  </div>
                  <div className="pc-acts">
                    <Link to="/fryer" style={{ textDecoration: 'none' }}>
                      <button className="pab">Kelola</button>
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ============ riwayat produksi ============ */}
      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Riwayat produksi</h2>
            <p className="db-sub">15 produksi terakhir.</p>
          </div>
        </div>
        {riwayat.length === 0 && <p className="empty">Belum ada produksi tercatat.</p>}
        {riwayat.length > 0 && (
          <div className="prod-grid">
            {riwayat.map((r) => (
              <div className="prod-card" key={r.id}>
                <div className="pc-top">
                  <span className="pc-name">Produksi #{r.id}</span>
                  <span className="badge stock">tersimpan</span>
                </div>
                <div className="pc-sub">{r.waktu}</div>
                <div className="pc-sub clamp2">{r.ringkasan || '—'}</div>
                {r.catatan && <div className="pc-sub">{r.catatan}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ============ pop-up: ayam utuh ============ */}
      {popup === 'ayam' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Ubah produksi ayam">
            <h3>Catat produksi ayam</h3>
            <p className="sub">1 ekor = potongan mentah terpotong dari gudang, hasil potong masuk stok jadi.</p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="pf-ekor">Jumlah ekor *</label>
                <input
                  id="pf-ekor"
                  name="produksi-ekor"
                  autoFocus
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  autoComplete="off"
                  value={ayamF.ekor}
                  onChange={(e) => setAyamF((f) => ({ ...f, ekor: e.target.value }))}
                />
                {err && <span className="err-inline">{err}</span>}
              </div>
              <div className="field">
                <label htmlFor="pf-ayam">Ayam mentah (stok gudang)</label>
                <select
                  id="pf-ayam"
                  value={ayamF.ayamId}
                  onChange={(e) => setAyamF((f) => ({ ...f, ayamId: e.target.value === '' ? '' : Number(e.target.value) }))}
                >
                  <option value="">— pilih —</option>
                  {bahanAyam.map((b) => (
                    <option key={b.id} value={b.id as number}>
                      {b.nama} — {b.stokDada ?? 0}d/{b.stokPahaAtas ?? 0}PA/{b.stokPahaBawah ?? 0}PB/{b.stokSayap ?? 0}s
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pf-tepung">Tepung (1 pak : 3 ekor)</label>
                <select
                  id="pf-tepung"
                  value={ayamF.tepungId}
                  onChange={(e) => setAyamF((f) => ({ ...f, tepungId: e.target.value === '' ? '' : Number(e.target.value) }))}
                >
                  <option value="">— pilih —</option>
                  {bahanTepung.map((b) => (
                    <option key={b.id} value={b.id as number}>
                      {b.nama} — stok {b.stok} {b.satuanDasar}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pf-minyak">Minyak goreng (±0,2 L/ekor)</label>
                <select
                  id="pf-minyak"
                  value={ayamF.minyakId}
                  onChange={(e) => setAyamF((f) => ({ ...f, minyakId: e.target.value === '' ? '' : Number(e.target.value) }))}
                >
                  <option value="">— pilih —</option>
                  {bahanMinyak.map((b) => (
                    <option key={b.id} value={b.id as number}>
                      {b.nama} — stok {b.stok} {b.satuanDasar}
                    </option>
                  ))}
                </select>
              </div>
              {fryers.length > 0 && (
                <div className="field">
                  <label htmlFor="pf-fryer">Deep fryer (meter siklus minyak)</label>
                  <select
                    id="pf-fryer"
                    value={ayamF.fryerId}
                    onChange={(e) => setAyamF((f) => ({ ...f, fryerId: e.target.value === '' ? '' : Number(e.target.value) }))}
                  >
                    <option value="">— tanpa fryer —</option>
                    {fryers.map((f) => (
                      <option key={f.id} value={f.id as number}>
                        {f.nama} — {f.ekorSejakTopUp}/{f.topUpPak} ekor sejak top-up
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="km-buttons">
              <button className="ghost" onClick={() => setPopup(null)} type="button">
                Batal
              </button>
              <button className="primary" onClick={simpanAyam} type="button">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ pop-up: baris produk ============ */}
      {popup === 'baris' && barisF && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Tambah / edit output produksi">
            <h3>{barisF.key === -1 ? 'Tambah output produksi' : 'Edit output produksi'}</h3>
            <p className="sub">Bahan terpotong dari gudang sesuai resep tahap produksi; hasil masuk stok jadi.</p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="pf-produk">Produk *</label>
                <select
                  id="pf-produk"
                  value={barisF.produkId === '' ? '' : barisF.produkId}
                  onChange={(e) => setBarisF((f) => (f ? { ...f, produkId: e.target.value === '' ? '' : Number(e.target.value) } : f))}
                >
                  <option value="">— pilih produk —</option>
                  {produkList.map((p) => (
                    <option key={p.id} value={p.id as number}>
                      {p.nama} (stok jadi {p.stok ?? 0})
                    </option>
                  ))}
                </select>
                {err && <span className="err-inline">{err}</span>}
              </div>
              <div className="field">
                <label htmlFor="pf-qty">Qty (pcs) *</label>
                <input
                  id="pf-qty"
                  name={`produksi-qty-${barisF.key}`}
                  type="number"
                  min="1"
                  step="any"
                  inputMode="decimal"
                  autoComplete="off"
                  value={barisF.qty}
                  onChange={(e) => setBarisF((f) => (f ? { ...f, qty: e.target.value } : f))}
                />
              </div>
            </div>
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