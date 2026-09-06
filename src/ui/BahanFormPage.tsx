import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../data/db'
import { saveBahan } from '../data/repos'
import { BAGIAN_AYAM_LABEL, KATEGORI_BAHAN, SATUAN_DASAR } from '../domain/master'
import { formatRupiah } from '../domain/conversions'
import type { Bahan, KomposisiAyam } from '../data/db'

type Tab = 'info' | 'satuan' | 'ayam' | 'harga'
type Popup = null | 'info' | 'satuan' | 'ayam' | 'harga'

interface FormState {
  nama: string
  kodePusat: string
  kategori: string
  satuanBeli: string
  isiLabel: string
  jumlahDasarPerBeli: string
  satuanDasar: string
  hargaBeliDefault: string
  ambangMin: string
  aktif: boolean
  isAyam: boolean
  dada: string
  pahaAtas: string
  pahaBawah: string
  sayap: string
}

const kosong: FormState = {
  nama: '',
  kodePusat: '',
  kategori: '',
  satuanBeli: '',
  isiLabel: '',
  jumlahDasarPerBeli: '1',
  satuanDasar: 'pcs',
  hargaBeliDefault: '',
  ambangMin: '',
  aktif: true,
  isAyam: false,
  dada: '3',
  pahaAtas: '2',
  pahaBawah: '2',
  sayap: '2',
}

function dariBahan(b: Bahan): FormState {
  const k = b.komposisiAyam ?? ({} as KomposisiAyam)
  return {
    nama: b.nama,
    kodePusat: b.kodePusat ?? '',
    kategori: b.kategori,
    satuanBeli: b.satuanBeli ?? '',
    isiLabel: b.isiLabel ?? '',
    jumlahDasarPerBeli: b.jumlahDasarPerBeli != null ? String(b.jumlahDasarPerBeli) : '1',
    satuanDasar: b.satuanDasar,
    hargaBeliDefault: b.hargaBeliDefault != null ? String(b.hargaBeliDefault) : '',
    ambangMin: b.ambangMin != null ? String(b.ambangMin) : '',
    aktif: b.aktif,
    isAyam: b.isAyam === true,
    dada: String(k.dada ?? 3),
    pahaAtas: String(k.pahaAtas ?? 2),
    pahaBawah: String(k.pahaBawah ?? 2),
    sayap: String(k.sayap ?? 2),
  }
}

const STEPS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Info dasar' },
  { key: 'satuan', label: 'Stok & satuan' },
  { key: 'ayam', label: 'Komposisi ayam' },
  { key: 'harga', label: 'Harga & ambang' },
]

export function BahanFormPage() {
  const { id } = useParams()
  const editing = id != null
  const navigate = useNavigate()
  const [f, setF] = useState<FormState>(kosong)
  const [stokInfo, setStokInfo] = useState<Bahan | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('info')
  const [popup, setPopup] = useState<Popup>(null)

  // form pop-up
  const [infoF, setInfoF] = useState({ nama: '', kodePusat: '', kategori: '', aktif: true })
  const [satuanF, setSatuanF] = useState({ satuanDasar: 'pcs', satuanBeli: '', isiLabel: '', jumlahDasarPerBeli: '1' })
  const [ayamF, setAyamF] = useState({ isAyam: false, dada: '3', pahaAtas: '2', pahaBawah: '2', sayap: '2' })
  const [hargaF, setHargaF] = useState({ hargaBeliDefault: '', ambangMin: '' })

  useEffect(() => {
    if (!editing) return
    void db.bahan.get(Number(id)).then((b) => {
      if (b) {
        setF(dariBahan(b))
        setStokInfo(b)
      } else {
        navigate('/bahan')
      }
    })
  }, [id, editing, navigate])

  // Esc menutup pop-up
  useEffect(() => {
    if (!popup) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(null)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [popup])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setF((prev) => ({ ...prev, [key]: value }))
  }

  function num(s: string): number | undefined {
    if (s === '') return undefined
    const n = Number(s.replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : undefined
  }

  // ---------- pop-up: info dasar ----------
  function bukaInfo() {
    setInfoF({ nama: f.nama, kodePusat: f.kodePusat, kategori: f.kategori, aktif: f.aktif })
    setErr('')
    setPopup('info')
  }
  function simpanInfo() {
    if (!infoF.nama.trim()) {
      setErr('Nama bahan wajib diisi.')
      return
    }
    set('nama', infoF.nama.trim())
    set('kodePusat', infoF.kodePusat.trim())
    set('kategori', infoF.kategori.trim() || 'Lainnya')
    set('aktif', infoF.aktif)
    setPopup(null)
  }

  // ---------- pop-up: stok & satuan ----------
  function bukaSatuan() {
    setSatuanF({
      satuanDasar: f.satuanDasar,
      satuanBeli: f.satuanBeli,
      isiLabel: f.isiLabel,
      jumlahDasarPerBeli: f.jumlahDasarPerBeli,
    })
    setPopup('satuan')
  }
  function simpanSatuan() {
    set('satuanDasar', satuanF.satuanDasar)
    set('satuanBeli', satuanF.satuanBeli.trim())
    set('isiLabel', satuanF.isiLabel.trim())
    set('jumlahDasarPerBeli', satuanF.jumlahDasarPerBeli)
    setPopup(null)
  }

  // ---------- pop-up: komposisi ayam ----------
  function bukaAyam() {
    setAyamF({ isAyam: f.isAyam, dada: f.dada, pahaAtas: f.pahaAtas, pahaBawah: f.pahaBawah, sayap: f.sayap })
    setPopup('ayam')
  }
  function simpanAyam() {
    set('isAyam', ayamF.isAyam)
    set('dada', ayamF.dada)
    set('pahaAtas', ayamF.pahaAtas)
    set('pahaBawah', ayamF.pahaBawah)
    set('sayap', ayamF.sayap)
    setPopup(null)
  }

  // ---------- pop-up: harga & ambang ----------
  function bukaHarga() {
    setHargaF({ hargaBeliDefault: f.hargaBeliDefault, ambangMin: f.ambangMin })
    setPopup('harga')
  }
  function simpanHarga() {
    set('hargaBeliDefault', hargaF.hargaBeliDefault)
    set('ambangMin', hargaF.ambangMin)
    setPopup(null)
  }

  // ---------- simpan akhir ----------
  async function simpan() {
    if (!f.nama.trim()) {
      setErr('Nama bahan wajib diisi.')
      setTab('info')
      bukaInfo()
      return
    }
    const komposisi = f.isAyam
      ? {
          dada: num(f.dada) ?? 0,
          pahaAtas: num(f.pahaAtas) ?? 0,
          pahaBawah: num(f.pahaBawah) ?? 0,
          sayap: num(f.sayap) ?? 0,
        }
      : null
    const bahan: Bahan = {
      id: editing ? Number(id) : undefined,
      kodePusat: f.kodePusat.trim() || undefined,
      nama: f.nama.trim(),
      kategori: f.kategori.trim() || 'Lainnya',
      aktif: f.aktif,
      satuanBeli: f.satuanBeli.trim() || undefined,
      isiLabel: f.isiLabel.trim() || undefined,
      jumlahDasarPerBeli: f.isAyam ? undefined : (num(f.jumlahDasarPerBeli) ?? 1),
      satuanDasar: f.satuanDasar,
      hargaBeliDefault: num(f.hargaBeliDefault),
      ambangMin: num(f.ambangMin),
      stok: stokInfo?.stok ?? 0,
      isAyam: f.isAyam || undefined,
      komposisiAyam: komposisi,
      stokDada: stokInfo?.stokDada,
      stokPahaAtas: stokInfo?.stokPahaAtas,
      stokPahaBawah: stokInfo?.stokPahaBawah,
      stokSayap: stokInfo?.stokSayap,
    }
    await saveBahan(bahan)
    navigate('/bahan')
  }

  const stokSekarang = stokInfo
    ? stokInfo.isAyam
      ? `${stokInfo.stokDada ?? 0} dada · ${stokInfo.stokPahaAtas ?? 0} PA · ${stokInfo.stokPahaBawah ?? 0} PB · ${stokInfo.stokSayap ?? 0} sayap`
      : `${stokInfo.stok} ${stokInfo.satuanDasar}`
    : null

  return (
    <main>
      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>{editing ? `Edit bahan: ${f.nama || '…'}` : 'Tambah bahan baru'}</h2>
            <p className="db-sub">Ringkasan diubah lewat pop-up; stok berubah lewat Beli/Produksi/Koreksi.</p>
          </div>
          <div className="sp2" style={{ flex: 1 }} />
          {editing && <span className={`pstat ${f.aktif ? 'on' : 'na'}`}>{f.aktif ? '● Aktif' : '● Nonaktif'}</span>}
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
              <span className="k">Nama bahan</span>
              <span className="v">{f.nama || '—'}</span>
            </div>
            <div className="sum-row">
              <span className="k">Kode pusat</span>
              <span className="v">{f.kodePusat || '—'}</span>
            </div>
            <div className="sum-row">
              <span className="k">Kategori</span>
              <span className="v">{f.kategori || 'Lainnya'}</span>
            </div>
            <div className="sum-row">
              <span className="k">Aktif</span>
              <span className="v">
                <span className={`pstat ${f.aktif ? 'on' : 'na'}`}>{f.aktif ? '● Aktif' : '● Nonaktif'}</span>
              </span>
            </div>
          </div>
        )}

        {/* ============ tab 2 · stok & satuan ============ */}
        {tab === 'satuan' && (
          <>
            <div className="stok-grid">
              <div className="stok-card">
                <div className="sc-l">Stok saat ini</div>
                <div className="sc-v" style={{ fontSize: 17 }}>
                  {stokSekarang ?? '0'}
                </div>
                <p className="hint2" style={{ margin: '4px 0 0' }}>
                  Stok berubah lewat <b>Beli</b> / <b>Produksi</b> / <b>Koreksi</b> — bukan di form ini.
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Link className="go" to={`/beli?bahan=${editing ? id : ''}`}>
                    + Beli
                  </Link>
                  <Link className="go" to={`/koreksi?tipe=bahan&id=${editing ? id : ''}`}>
                    Opname
                  </Link>
                  <Link className="go" to={`/mutasi?tipe=bahan&id=${editing ? id : ''}`}>
                    Riwayat mutasi
                  </Link>
                </div>
              </div>
              <div className="stok-card">
                <div className="sc-l">Satuan &amp; konversi</div>
                <p className="hint2" style={{ margin: '6px 0 8px' }}>
                  Satuan dasar dipakai stok; satuan beli untuk nota Beli; jumlah dasar = 1 satuan beli berapa
                  satuan dasar.
                </p>
                <div className="sum-row">
                  <span className="k">Satuan dasar</span>
                  <span className="v">{f.satuanDasar}</span>
                </div>
                <div className="sum-row">
                  <span className="k">Satuan beli</span>
                  <span className="v">{f.satuanBeli || '—'}</span>
                </div>
                <div className="sum-row">
                  <span className="k">Isi per beli</span>
                  <span className="v">{f.isiLabel || '—'}</span>
                </div>
                <div className="sum-row">
                  <span className="k">Jumlah dasar / beli</span>
                  <span className="v">{f.isAyam ? 'komposisi ayam' : (f.jumlahDasarPerBeli || '1')}</span>
                </div>
                <button className="sum-edit" style={{ marginTop: 8 }} onClick={bukaSatuan} type="button">
                  Ubah satuan →
                </button>
              </div>
            </div>
          </>
        )}

        {/* ============ tab 3 · komposisi ayam ============ */}
        {tab === 'ayam' && (
          <div className="sum-card">
            <div className="sum-head">
              <span className="t">Komposisi ayam</span>
              <div className="sp2" style={{ flex: 1 }} />
              <button className="sum-edit" onClick={bukaAyam} type="button">
                Ubah →
              </button>
            </div>
            {!f.isAyam ? (
              <p className="hint2" style={{ margin: '6px 0 0' }}>
                Bahan ini <b>bukan ayam utuh</b>. Nyalakan agar pembelian ayam otomatis terpecah per bagian
                potongan (dada / paha atas / paha bawah / sayap).
              </p>
            ) : (
              <>
                <p className="hint2" style={{ margin: '6px 0 4px' }}>
                  Pembelian ayam otomatis terpecah per bagian sesuai komposisi ini.
                </p>
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                  {BAGIAN_AYAM_LABEL.map(({ key, label }) => (
                    <div className="sum-row" key={key} style={{ borderBottom: '1px dashed var(--line)', padding: '8px 0' }}>
                      <span className="k">{label}</span>
                      <span className="v">{f[key]}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ============ tab 4 · harga & ambang ============ */}
        {tab === 'harga' && (
          <div className="sum-card">
            <div className="sum-head">
              <span className="t">Harga &amp; ambang</span>
              <div className="sp2" style={{ flex: 1 }} />
              <button className="sum-edit" onClick={bukaHarga} type="button">
                Ubah →
              </button>
            </div>
            <div className="sum-row">
              <span className="k">Harga beli default</span>
              <span className="v">{f.hargaBeliDefault ? formatRupiah(num(f.hargaBeliDefault) ?? 0) : '—'}</span>
            </div>
            <div className="sum-row">
              <span className="k">Ambang stok rendah</span>
              <span className="v">{f.ambangMin || '—'}</span>
            </div>
            <p className="hint2" style={{ margin: '8px 0 0' }}>
              Harga beli default dipakai menghitung HPP produk &amp; list belanja. Ambang memicu peringatan stok
              rendah di kartu daftar dan list belanja.
            </p>
          </div>
        )}

        <div className="form-actions">
          <button className="primary" onClick={() => void simpan()}>
            Simpan
          </button>
          <Link to="/bahan">
            <button className="outline">Batal</button>
          </Link>
        </div>
      </section>

      {/* ============ pop-up: info dasar ============ */}
      {popup === 'info' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Ubah info bahan">
            <h3>Ubah info dasar</h3>
            <p className="sub">Nama dipakai di nota Beli, daftar resep, dan kasir.</p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label htmlFor="bf-nama">Nama bahan *</label>
                <input id="bf-nama" autoFocus autoComplete="off" aria-invalid={!!err} value={infoF.nama} onChange={(e) => setInfoF((x) => ({ ...x, nama: e.target.value }))} placeholder="mis. Tepung Fried Chicken" />
                {err && <span className="err-inline">{err}</span>}
              </div>
              <div className="field">
                <label htmlFor="bf-kode">Kode pusat (opsional)</label>
                <input id="bf-kode" autoComplete="off" value={infoF.kodePusat} onChange={(e) => setInfoF((x) => ({ ...x, kodePusat: e.target.value }))} placeholder="mis. 200001" />
              </div>
              <div className="field">
                <label htmlFor="bf-kat">Kategori</label>
                <input id="bf-kat" autoComplete="off" list="kat-bahan" value={infoF.kategori} onChange={(e) => setInfoF((x) => ({ ...x, kategori: e.target.value }))} />
                <datalist id="kat-bahan">
                  {KATEGORI_BAHAN.map((k) => (
                    <option key={k} value={k} />
                  ))}
                </datalist>
              </div>
              <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-end', paddingBottom: 8 }}>
                <label className="switch">
                  <input type="checkbox" checked={infoF.aktif} onChange={(e) => setInfoF((x) => ({ ...x, aktif: e.target.checked }))} />
                  <span className="slider" />
                </label>
                <b style={{ fontSize: 14 }}>Aktif</b>
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

      {/* ============ pop-up: stok & satuan ============ */}
      {popup === 'satuan' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Ubah stok & satuan">
            <h3>Ubah stok &amp; satuan</h3>
            <p className="sub">Satuan dasar = satuan stok; satuan beli = satuan di nota Beli.</p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label htmlFor="bf-sd">Satuan dasar stok</label>
                <select id="bf-sd" value={satuanF.satuanDasar} onChange={(e) => setSatuanF((x) => ({ ...x, satuanDasar: e.target.value }))}>
                  {SATUAN_DASAR.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="bf-sb">Satuan beli</label>
                <input id="bf-sb" autoComplete="off" value={satuanF.satuanBeli} onChange={(e) => setSatuanF((x) => ({ ...x, satuanBeli: e.target.value }))} placeholder="mis. 1 Pack" />
              </div>
              <div className="field">
                <label htmlFor="bf-isi">Isi per satuan beli</label>
                <input id="bf-isi" autoComplete="off" value={satuanF.isiLabel} onChange={(e) => setSatuanF((x) => ({ ...x, isiLabel: e.target.value }))} placeholder="mis. 100 Lembar" />
              </div>
              <div className="field">
                <label htmlFor="bf-faktor">Jumlah dasar / beli</label>
                <input id="bf-faktor" inputMode="decimal" autoComplete="off" value={satuanF.jumlahDasarPerBeli} onChange={(e) => setSatuanF((x) => ({ ...x, jumlahDasarPerBeli: e.target.value }))} placeholder="mis. 100" disabled={f.isAyam} />
                <span className="hint">{f.isAyam ? 'Ayam utuh memakai komposisi per bagian.' : `1 satuan beli = ${satuanF.jumlahDasarPerBeli || '?'} ${satuanF.satuanDasar}.`}</span>
              </div>
            </div>
            <div className="km-buttons">
              <button className="ghost" onClick={() => setPopup(null)} type="button">
                Batal
              </button>
              <button className="primary" onClick={simpanSatuan} type="button">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ pop-up: komposisi ayam ============ */}
      {popup === 'ayam' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Komposisi ayam">
            <h3>Komposisi ayam utuh</h3>
            <p className="sub">Pembelian ayam otomatis terpecah per bagian potongan.</p>
            <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <label className="switch">
                <input type="checkbox" checked={ayamF.isAyam} onChange={(e) => setAyamF((x) => ({ ...x, isAyam: e.target.checked }))} />
                <span className="slider" />
              </label>
              <b style={{ fontSize: 14 }}>Ayam utuh (potong 9)</b>
            </div>
            {ayamF.isAyam && (
              <div className="form-grid" style={{ marginTop: 12 }}>
                {BAGIAN_AYAM_LABEL.map(({ key, label }) => (
                  <div className="field" key={key}>
                    <label htmlFor={`bf-komp-${key}`}>Jumlah {label} per ekor</label>
                    <input id={`bf-komp-${key}`} inputMode="numeric" autoComplete="off" value={ayamF[key]} onChange={(e) => setAyamF((x) => ({ ...x, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            )}
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

      {/* ============ pop-up: harga & ambang ============ */}
      {popup === 'harga' && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPopup(null) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Harga & ambang">
            <h3>Harga beli &amp; ambang</h3>
            <p className="sub">Dasar HPP produk dan peringatan stok rendah.</p>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="field">
                <label htmlFor="bf-hb">Harga beli default (Rp)</label>
                <input id="bf-hb" inputMode="numeric" autoComplete="off" value={hargaF.hargaBeliDefault} onChange={(e) => setHargaF((x) => ({ ...x, hargaBeliDefault: e.target.value }))} placeholder="mis. 23500" />
                <span className="hint">Harga riil tiap beli tetap dicatat di nota Beli.</span>
              </div>
              <div className="field">
                <label htmlFor="bf-ambang">Ambang stok rendah</label>
                <input id="bf-ambang" inputMode="numeric" autoComplete="off" value={hargaF.ambangMin} onChange={(e) => setHargaF((x) => ({ ...x, ambangMin: e.target.value }))} placeholder="mis. 10" />
                <span className="hint">Peringatan di daftar &amp; list belanja.</span>
              </div>
            </div>
            <div className="km-buttons">
              <button className="ghost" onClick={() => setPopup(null)} type="button">
                Batal
              </button>
              <button className="primary" onClick={simpanHarga} type="button">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}