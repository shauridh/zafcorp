import { useEffect, useRef, useState } from 'react'
import { getPengaturan, savePengaturan, PENGATURAN_DEFAULT, type Pengaturan } from '../data/pengaturan'
import { LABEL_TEMA, terapkanTema, type PilihanTema } from '../data/tema'
import { loadSeed } from '../data/seed'
import { notifFryerDiaktifkan, setNotifFryerDiaktifkan } from '../data/notifikasi'
import { rekapShiftOtomatisAktif, setRekapShiftOtomatis } from '../data/rekapShare'
import { kumpulkanCadangan, namaFileCadangan, pulihkanCadangan, ringkasanBaris, tandaiCadangan, terakhirCadangan } from '../data/cadangan'
import { notifCadanganDiaktifkan, setNotifCadanganDiaktifkan } from '../data/cadanganNotif'
import { aturPin, catatAudit, kunciZona, labelAudit, nonaktifkanPin, pinDiatur, riwayatAudit, ubahPin, zonaPemilikTerbuka } from '../data/keamanan'
import { getKonfigSinkron, identitasPerangkat, saveKonfigSinkron, setNamaPerangkat, sinkronkanSekarang, terakhirSinkron } from '../data/sinkron'
import { bagikanFile, unduhFile } from '../services/struk'
import type { JejakAudit } from '../data/db'
import { ConfirmDialog } from './ConfirmDialog'

type KategoriId = 'toko' | 'kasir' | 'struk' | 'fryer' | 'tampilan' | 'data' | 'keamanan'

const KATEGORI: { id: KategoriId; label: string; keterangan: string }[] = [
  { id: 'toko', label: 'Toko & bisnis', keterangan: 'Identitas outlet — dipakai di header struk, layar & berbagi.' },
  { id: 'kasir', label: 'Kasir & kas', keterangan: 'Float laci & perilaku layar kasir.' },
  { id: 'struk', label: 'Struk & cetakan', keterangan: 'Pesan tambahan pada struk 58mm.' },
  { id: 'fryer', label: 'Deep fryer', keterangan: 'SOP minyak untuk fryer baru.' },
  { id: 'tampilan', label: 'Tampilan', keterangan: 'Tema antarmuka aplikasi.' },
  { id: 'data', label: 'Data', keterangan: 'Cadangan & pulihkan, sinkronisasi multi-perangkat, muat ulang data awal.' },
  { id: 'keamanan', label: 'Keamanan', keterangan: 'PIN pemilik & jejak aktivitas perangkat.' },
]

function labelRela(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function bacaKolom(): number {
  try {
    const v = Number(localStorage.getItem('kasir.kolom'))
    return v === 3 || v === 4 || v === 5 || v === 6 ? v : 4
  } catch {
    return 4
  }
}

export function PengaturanPage() {
  const [konfirmasiReset, setKonfirmasiReset] = useState(false)
  const [aktif, setAktif] = useState<KategoriId>('toko')

  // Toko & bisnis
  const [nama, setNama] = useState(PENGATURAN_DEFAULT.namaOutlet)
  const [alamat, setAlamat] = useState(PENGATURAN_DEFAULT.alamat)
  const [noHp, setNoHp] = useState(PENGATURAN_DEFAULT.noHp)
  // Kasir & kas
  const [floatKas, setFloatKas] = useState(String(PENGATURAN_DEFAULT.floatKas))
  const [kolom, setKolom] = useState(bacaKolom)
  const [ambangStok, setAmbangStok] = useState(String(PENGATURAN_DEFAULT.ambangStokKasir))
  // Struk
  const [strukSambutan, setStrukSambutan] = useState(PENGATURAN_DEFAULT.strukSambutan)
  const [strukPenutup, setStrukPenutup] = useState(PENGATURAN_DEFAULT.strukPenutup)
  // Deep fryer
  const [isiAwal, setIsiAwal] = useState(String(PENGATURAN_DEFAULT.minyakIsiAwalL))
  const [topUpPak, setTopUpPak] = useState(String(PENGATURAN_DEFAULT.minyakTopUpPak))
  const [gantiHari, setGantiHari] = useState(String(PENGATURAN_DEFAULT.minyakGantiHari))
  // Tampilan
  const [tema, setTema] = useState<PilihanTema>(PENGATURAN_DEFAULT.tema)
  // Pengingat deep fryer (notifikasi browser)
  const [notifStatus, setNotifStatus] = useState<'on' | 'off' | 'denied' | 'tidakDidukung'>('off')
  // Kirim rekap shift otomatis ke WhatsApp
  const [rekapAuto, setRekapAuto] = useState(false)

  // Keamanan
  const [pinAktif, setPinAktif] = useState(false)
  const [pinBaru, setPinBaru] = useState('')
  const [pinLama, setPinLama] = useState('')
  const [pinNonaktif, setPinNonaktif] = useState('')
  const [pinErr, setPinErr] = useState('')
  const [audit, setAudit] = useState<JejakAudit[]>([])
  // Cadangan
  const [busyCad, setBusyCad] = useState(false)
  const [cadangTerakhir, setCadangTerakhir] = useState<string | null>(null)
  const [cadanganImport, setCadanganImport] = useState<unknown>(null)
  const [infoImport, setInfoImport] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  // Pengingat cadangan (notifikasi browser)
  const [notifCad, setNotifCad] = useState<'on' | 'off' | 'denied' | 'tidakDidukung'>('off')
  // Sinkronisasi
  const [synUrl, setSynUrl] = useState('')
  const [synAktif, setSynAktif] = useState(false)
  const [synNama, setSynNama] = useState('')
  const [synHasil, setSynHasil] = useState('')
  const [synTerakhir, setSynTerakhir] = useState<string | null>(null)
  const [synBusy, setSynBusy] = useState(false)

  const [pesan, setPesan] = useState('')

  useEffect(() => {
    void getPengaturan().then((p) => {
      setNama(p.namaOutlet)
      setAlamat(p.alamat)
      setNoHp(p.noHp)
      setFloatKas(String(p.floatKas))
      setKolom(bacaKolom())
      setAmbangStok(String(p.ambangStokKasir ?? PENGATURAN_DEFAULT.ambangStokKasir))
      setStrukSambutan(p.strukSambutan ?? PENGATURAN_DEFAULT.strukSambutan)
      setStrukPenutup(p.strukPenutup ?? PENGATURAN_DEFAULT.strukPenutup)
      setIsiAwal(String(p.minyakIsiAwalL))
      setTopUpPak(String(p.minyakTopUpPak))
      setGantiHari(String(p.minyakGantiHari))
      setTema(p.tema ?? 'auto')
    })
  }, [])

  function refreshNotifStatus() {
    if (typeof Notification === 'undefined') return setNotifStatus('tidakDidukung')
    if (Notification.permission === 'denied') return setNotifStatus('denied')
    if (notifFryerDiaktifkan() && Notification.permission === 'granted') return setNotifStatus('on')
    setNotifStatus('off')
  }

  function refreshNotifCad() {
    if (typeof Notification === 'undefined') return setNotifCad('tidakDidukung')
    if (Notification.permission === 'denied') return setNotifCad('denied')
    if (notifCadanganDiaktifkan() && Notification.permission === 'granted') return setNotifCad('on')
    setNotifCad('off')
  }

  async function klikNotifCad() {
    setPesan('')
    if (notifCad === 'on') {
      setNotifCadanganDiaktifkan(false)
      refreshNotifCad()
      setPesan('✓ Pengingat cadangan dinonaktifkan.')
      return
    }
    if (typeof Notification === 'undefined' || !('requestPermission' in Notification)) {
      setNotifCad('tidakDidukung')
      setPesan('Browser ini tidak mendukung notifikasi.')
      return
    }
    const izin = await Notification.requestPermission()
    if (izin === 'granted') {
      setNotifCadanganDiaktifkan(true)
      refreshNotifCad()
      setPesan('✓ Pengingat aktif — Anda diberi tahu bila sudah 7 hari tanpa cadangan; ketuk notifikasi untuk mengunduh cadangan.')
    } else if (izin === 'denied') {
      setNotifCad('denied')
      setPesan('Notifikasi diblokir browser. Izinkan lewat pengaturan situs, lalu aktifkan kembali di sini.')
    } else {
      refreshNotifCad()
      setPesan('Izin notifikasi belum diberikan — aktifkan kembali saat siap.')
    }
  }

  useEffect(() => {
    refreshNotifStatus()
    refreshNotifCad()
    setRekapAuto(rekapShiftOtomatisAktif())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void (async () => {
      setPinAktif(await pinDiatur())
      setCadangTerakhir(await terakhirCadangan())
      setAudit(await riwayatAudit(20))
      const k = await getKonfigSinkron()
      setSynUrl(k.url)
      setSynAktif(k.aktif)
      const dev = await identitasPerangkat()
      setSynNama(dev.nama)
      setSynTerakhir(await terakhirSinkron())
    })()
  }, [])

  function klikRekapAuto() {
    const tujuan = !rekapShiftOtomatisAktif()
    setRekapShiftOtomatis(tujuan)
    setRekapAuto(tujuan)
    setPesan(tujuan ? '✓ Kirim otomatis diaktifkan — rekap shift langsung dibagikan/unduh saat shift diakhiri.' : '✓ Kirim otomatis dimatikan — rekap shift tetap bisa dibagikan manual dari layar “Shift selesai”.')
  }

  async function klikNotif() {
    setPesan('')
    if (notifStatus === 'on') {
      setNotifFryerDiaktifkan(false)
      refreshNotifStatus()
      setPesan('✓ Pengingat deep fryer dinonaktifkan.')
      return
    }
    if (typeof Notification === 'undefined' || !('requestPermission' in Notification)) {
      setNotifStatus('tidakDidukung')
      setPesan('Browser ini tidak mendukung notifikasi.')
      return
    }
    const izin = await Notification.requestPermission()
    if (izin === 'granted') {
      setNotifFryerDiaktifkan(true)
      refreshNotifStatus()
      setPesan('✓ Pengingat aktif — Anda akan diberi tahu saat ada fryer yang wajib top-up/ganti minyak.')
    } else if (izin === 'denied') {
      setNotifStatus('denied')
      setPesan('Notifikasi diblokir browser. Izinkan lewat pengaturan situs, lalu aktifkan kembali di sini.')
    } else {
      refreshNotifStatus()
      setPesan('Izin notifikasi belum diberikan — aktifkan kembali saat siap.')
    }
  }

  async function simpan() {
    if (!nama.trim()) return setPesan('Nama outlet wajib diisi.')
    const floatN = Math.floor(Number(floatKas) || 0)
    if (floatN <= 0) return setPesan('Float kas harus lebih dari 0.')
    const ambangN = Math.floor(Number(ambangStok) || 0)
    if (!(ambangN >= 1 && ambangN <= 999)) return setPesan('Ambang stok menipis harus 1–999 item.')
    const isiN = Math.floor(Number(isiAwal) || 0)
    const topN = Math.floor(Number(topUpPak) || 0)
    const hariN = Math.floor(Number(gantiHari) || 0)
    if (!(isiN > 0) || !(topN > 0) || !(hariN > 0)) return setPesan('Parameter deep fryer harus lebih dari 0.')

    const p: Pengaturan = {
      namaOutlet: nama.trim(),
      alamat: alamat.trim(),
      noHp: noHp.trim(),
      floatKas: floatN,
      ambangStokKasir: ambangN,
      strukSambutan: strukSambutan.trim(),
      strukPenutup: strukPenutup.replace(/\s+\n/g, '\n').trim(),
      minyakIsiAwalL: isiN,
      minyakTopUpPak: topN,
      minyakGantiHari: hariN,
      tema,
    }
    await savePengaturan(p)
    try {
      localStorage.setItem('kasir.kolom', String(kolom))
    } catch {
      /* abaikan */
    }
    terapkanTema(tema)
    await catatAudit('pengaturan-simpan', nama.trim())
    setPesan('✓ Pengaturan tersimpan — dipakai di struk, kasir, shift kas, deep fryer & tema tampilan.')
  }

  /* ---- Keamanan ---- */
  async function aktifkanPin() {
    const r = await aturPin(pinBaru)
    if (!r.ok) return setPinErr(r.alasan)
    setPinBaru('')
    setPinErr('')
    setPinAktif(true)
    setAudit(await riwayatAudit(20))
    setPesan('✓ PIN pemilik aktif — Pengaturan, Finansial, Riwayat Shift & master kini terkunci dari kasir.')
  }

  async function gantiPin() {
    const r = await ubahPin(pinLama, pinBaru)
    if (!r.ok) return setPinErr(r.alasan)
    setPinLama('')
    setPinBaru('')
    setPinErr('')
    setAudit(await riwayatAudit(20))
    setPesan('✓ PIN pemilik diganti.')
  }

  async function matikanPin() {
    const r = await nonaktifkanPin(pinNonaktif)
    if (!r.ok) return setPinErr(r.alasan)
    setPinNonaktif('')
    setPinErr('')
    setPinAktif(false)
    setAudit(await riwayatAudit(20))
    setPesan('✓ PIN pemilik dinonaktifkan — seluruh halaman kembali terbuka.')
  }

  /* ---- Cadangan ---- */
  async function unduhCadangan() {
    setBusyCad(true)
    setPesan('')
    try {
      const d = await kumpulkanCadangan()
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
      unduhFile(blob, namaFileCadangan(d))
      await tandaiCadangan()
      setCadangTerakhir(new Date().toISOString())
      const n = Object.values(d.data).reduce((s, a) => s + a.length, 0)
      await catatAudit('cadangan-unduh', `${namaFileCadangan(d)} · ${n} baris`)
      setPesan('✓ Cadangan diunduh — simpan file di tempat aman (Google Drive, WhatsApp, flashdisk).')
    } catch (e) {
      setPesan(String(e instanceof Error ? e.message : e))
    } finally {
      setBusyCad(false)
    }
  }

  async function bagikanCadangan() {
    setBusyCad(true)
    setPesan('')
    try {
      const d = await kumpulkanCadangan()
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
      const hasil = await bagikanFile(blob, namaFileCadangan(d), 'Cadangan data Kasir SABANA')
      await tandaiCadangan()
      setCadangTerakhir(new Date().toISOString())
      setPesan(
        hasil === 'shared'
          ? '✓ Cadangan dibagikan.'
          : hasil === 'download'
            ? '✓ Cadangan terunduh (bagikan dari galeri/file).'
            : 'Gagal berbagi cadangan.',
      )
    } catch (e) {
      setPesan(String(e instanceof Error ? e.message : e))
    } finally {
      setBusyCad(false)
    }
  }

  function pilihFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    void (async () => {
      setPesan('')
      try {
        const data = JSON.parse(await f.text()) as unknown
        const ringkas = await ringkasanBaris(data)
        if (!ringkas) {
          setPesan('File bukan cadangan Kasir SABANA yang valid.')
          return
        }
        setInfoImport(`${f.name} — ${ringkas.baris} baris di ${ringkas.tabel.length} tabel`)
        setCadanganImport(data)
      } catch {
        setPesan('File tidak bisa dibaca sebagai JSON.')
      }
    })()
  }

  async function konfirmasiPulihkan() {
    if (cadanganImport == null) return
    setBusyCad(true)
    const r = await pulihkanCadangan(cadanganImport)
    setBusyCad(false)
    if (!r.ok) {
      setPesan(r.alasan)
      setCadanganImport(null)
      return
    }
    await catatAudit('cadangan-pulih', `${r.baris} baris di ${r.tabel.length} tabel`)
    setCadanganImport(null)
    setPesan('✓ Data dipulihkan — memuat ulang aplikasi…')
    setTimeout(() => location.reload(), 900)
  }

  /* ---- Sinkronisasi ---- */
  async function ujiSinkron() {
    if (!synUrl.trim()) return setSynHasil('Alamat server kosong.')
    setSynBusy(true)
    try {
      const res = await fetch(`${synUrl.trim().replace(/\/+$/, '')}/api/health`)
      const j = (await res.json().catch(() => null)) as { ok?: boolean; nama?: string; versi?: number; tabel?: number } | null
      setSynHasil(res.ok && j?.ok ? `✓ Server ${j.nama} versi ${j.versi} — ${j.tabel} tabel siap.` : `Gagal — HTTP ${res.status}.`)
    } catch (e) {
      setSynHasil(`Tidak terhubung: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSynBusy(false)
    }
  }

  async function simpanKonfigSinkron() {
    await saveKonfigSinkron({ url: synUrl, aktif: synAktif })
    await setNamaPerangkat(synNama)
    setSynHasil('✓ Konfigurasi sinkronisasi tersimpan.')
  }

  async function jalankanSinkron() {
    setSynBusy(true)
    const r = await sinkronkanSekarang()
    setSynBusy(false)
    setSynHasil(r.pesan)
    setSynTerakhir(await terakhirSinkron())
  }

  const pilihKat = (id: KategoriId) => {
    setAktif(id)
    setPesan('')
  }

  return (
    <main>
      <section className="panel" style={{ maxWidth: 680 }}>
        <h2 style={{ margin: 0 }}>Pengaturan</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Semua pengaturan aplikasi & bisnis dikelompokkan per kategori. Simpan sekali di akhir — perubahan di
          kategori lain ikut tersimpan.
        </p>

        <div className="set-tabs" role="tablist" aria-label="Kategori pengaturan">
          {KATEGORI.map((k) => (
            <button
              key={k.id}
              role="tab"
              aria-selected={aktif === k.id}
              className={`chip ${aktif === k.id ? 'on' : ''}`}
              onClick={() => pilihKat(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" style={{ marginTop: 16 }}>
          {aktif === 'toko' && (
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: 15.5 }}>Toko & bisnis</h3>
              <p className="muted" style={{ fontSize: 12.5 }}>
                {KATEGORI[0].keterangan} Alamat & nomor HP otomatis ikut tercetak di struk bila diisi.
              </p>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="nama">Nama outlet *</label>
                  <input id="nama" name="outlet-nama" autoComplete="organization" value={nama} onChange={(e) => setNama(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="alamat">Alamat</label>
                  <input id="alamat" name="outlet-alamat" autoComplete="street-address" value={alamat} onChange={(e) => setAlamat(e.target.value)} placeholder="mis. Jl. Sudirman No. 12" />
                </div>
                <div className="field">
                  <label htmlFor="hp">No. HP / WhatsApp</label>
                  <input id="hp" name="outlet-telepon" type="tel" inputMode="tel" autoComplete="tel-national" value={noHp} onChange={(e) => setNoHp(e.target.value)} placeholder="mis. 0812-3456-7890" />
                </div>
              </div>
            </div>
          )}

          {aktif === 'kasir' && (
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: 15.5 }}>Kasir & kas</h3>
              <p className="muted" style={{ fontSize: 12.5 }}>{KATEGORI[1].keterangan}</p>
              <div className="card" style={{ background: 'var(--soft)', border: '1px solid var(--line)', boxShadow: 'none', padding: 14, margin: '12px 0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <b>Kirim rekap akhir shift ke WhatsApp</b>
                    <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
                      Saat sebuah shift diakhiri, aplikasi langsung membagikan struk rangkuman shift (PNG) ke
                      WhatsApp — tanpa izin berbagi, gambar otomatis terunduh. Untuk kirim rekap harian, gunakan
                      tombol “Kirim rekap hari ini” di halaman Finansial.
                    </p>
                  </div>
                  <span className={`pstat ${rekapAuto ? 'on' : 'na'}`}>{rekapAuto ? '● Aktif' : '● Nonaktif'}</span>
                  <button type="button" className={rekapAuto ? 'outline small' : 'primary'} onClick={klikRekapAuto}>
                    {rekapAuto ? 'Nonaktifkan' : 'Aktifkan kirim otomatis'}
                  </button>
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="float">Float laci kasir (Rp) — default 350.000</label>
                  <input id="float" name="kas-float" autoComplete="off" inputMode="numeric" value={floatKas} onChange={(e) => setFloatKas(e.target.value)} />
                  <span className="hint">Saat shift diakhiri (tutup kas), uang senilai ini otomatis tersisa di laci; sisanya jadi setoran.</span>
                </div>
                <div className="field">
                  <label htmlFor="ambang">Stok “menipis” di kasir (sisa item)</label>
                  <input id="ambang" name="kas-ambang-stok" autoComplete="off" type="number" inputMode="numeric" min={1} max={999} value={ambangStok} onChange={(e) => setAmbangStok(e.target.value)} />
                  <span className="hint">Badge kuning muncul di menu kasir bila sisa stok ≤ ambang (default 3).</span>
                </div>
                <div className="field">
                  <label>Kolom grid menu kasir</label>
                  <div className="seg" role="radiogroup" aria-label="Jumlah kolom menu kasir" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 2 }}>
                    {[3, 4, 5, 6].map((n) => (
                      <button
                        key={n}
                        role="radio"
                        aria-checked={kolom === n}
                        className={kolom === n ? 'on' : ''}
                        onClick={() => setKolom(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <span className="hint">Banyak kolom produk yang tampil bersamaan di layar kasir.</span>
                </div>
              </div>
            </div>
          )}

          {aktif === 'struk' && (
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: 15.5 }}>Struk & cetakan</h3>
              <p className="muted" style={{ fontSize: 12.5 }}>{KATEGORI[2].keterangan}</p>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="sambutan">Sambutan di bawah nama outlet (opsional)</label>
                  <input
                    id="sambutan"
                    name="struk-sambutan"
                    autoComplete="off"
                    value={strukSambutan}
                    onChange={(e) => setStrukSambutan(e.target.value)}
                    placeholder="mis. ★ Ayam Crispy Sedap ★"
                  />
                  <span className="hint">Slogan/promo yang dicetak tepat di bawah nama outlet.</span>
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="penutup">Pesan penutup struk</label>
                  <textarea
                    id="penutup"
                    name="struk-penutup"
                    rows={2}
                    value={strukPenutup}
                    onChange={(e) => setStrukPenutup(e.target.value)}
                    placeholder={PENGATURAN_DEFAULT.strukPenutup}
                  />
                  <span className="hint">Tiap baris dicetak di tengah struk — kosongkan agar struk tanpa ucapan penutup.</span>
                </div>
              </div>
            </div>
          )}

          {aktif === 'fryer' && (
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: 15.5 }}>Deep fryer — SOP minyak</h3>
              <p className="muted" style={{ fontSize: 12.5 }}>{KATEGORI[3].keterangan}</p>
              <div className="card" style={{ background: 'var(--soft)', border: '1px solid var(--line)', boxShadow: 'none', padding: 14, margin: '12px 0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <b>Pengingat deep fryer (notifikasi browser)</b>
                    <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
                      Muncul walau Anda sedang di layar lain atau aplikasi berjalan di background — saat ada
                      fryer yang wajib top-up atau ganti minyak.
                    </p>
                  </div>
                  <span className={`pstat ${notifStatus === 'on' ? 'on' : notifStatus === 'denied' ? 'hab' : 'na'}`}>
                    {notifStatus === 'on' ? '● Aktif' : notifStatus === 'denied' ? '● Diblokir' : notifStatus === 'tidakDidukung' ? '● Tak didukung' : '● Nonaktif'}
                  </span>
                  <button
                    type="button"
                    className={notifStatus === 'on' ? 'outline small' : 'primary'}
                    onClick={() => void klikNotif()}
                    disabled={notifStatus === 'denied' || notifStatus === 'tidakDidukung'}
                  >
                    {notifStatus === 'on' ? 'Nonaktifkan' : 'Aktifkan pengingat'}
                  </button>
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="isiAwal">Isi awal minyak (liter)</label>
                  <input id="isiAwal" name="fryer-isi-awal" autoComplete="off" type="number" inputMode="numeric" value={isiAwal} onChange={(e) => setIsiAwal(e.target.value)} />
                  <span className="hint">Standar pusat 16 liter.</span>
                </div>
                <div className="field">
                  <label htmlFor="topup">Top-up setelah (ekor ayam)</label>
                  <input id="topup" name="fryer-ambang-topup" autoComplete="off" type="number" inputMode="numeric" value={topUpPak} onChange={(e) => setTopUpPak(e.target.value)} />
                  <span className="hint">Standar pusat 10 ekor.</span>
                </div>
                <div className="field">
                  <label htmlFor="ganti">Ganti maksimal setelah (hari)</label>
                  <input id="ganti" name="fryer-batas-ganti" autoComplete="off" type="number" inputMode="numeric" value={gantiHari} onChange={(e) => setGantiHari(e.target.value)} />
                  <span className="hint">Standar pusat 30 hari — bisa lebih cepat bila kualitas turun.</span>
                </div>
              </div>
            </div>
          )}

          {aktif === 'tampilan' && (
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: 15.5 }}>Tampilan</h3>
              <p className="muted" style={{ fontSize: 12.5 }}>{KATEGORI[4].keterangan}</p>
              <div className="chips" style={{ marginTop: 8 }} role="radiogroup" aria-label="Tema tampilan">
                {(Object.keys(LABEL_TEMA) as PilihanTema[]).map((t) => (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={tema === t}
                    className={`chip ${tema === t ? 'on' : ''}`}
                    onClick={() => setTema(t)}
                  >
                    {LABEL_TEMA[t]}
                  </button>
                ))}
              </div>
              <span className="hint" style={{ display: 'block', marginTop: 8, fontSize: 12.5, color: 'var(--muted)' }}>
                “Ikuti sistem” memakai mode HP/komputer Anda (tombol di menu samping juga bisa mengganti cepat).
              </span>
            </div>
          )}

          {aktif === 'data' && (
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: 15.5 }}>Data</h3>
              <p className="muted" style={{ fontSize: 12.5 }}>{KATEGORI[5].keterangan}</p>

              <div className="card" style={{ padding: 14, background: 'var(--soft)', border: '1px solid var(--line)', boxShadow: 'none', marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <b style={{ flex: 1, minWidth: 200 }}>Cadangan & pulihkan data</b>
                  <span className={`pstat ${cadangTerakhir ? 'on' : 'na'}`}>
                    {cadangTerakhir ? `● Terakhir ${labelRela(cadangTerakhir)}` : '● Belum pernah'}
                  </span>
                </div>
                <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 10px' }}>
                  Seluruh data (master, stok, transaksi, shift, finansial) diekspor ke satu file JSON. Simpan di
                  tempat aman — Google Drive, WhatsApp, flashdisk — lalu pulihkan ke perangkat baru bila perlu.
                  {cadangTerakhir && Date.now() - new Date(cadangTerakhir).getTime() > 7 * 24 * 3600 * 1000 && (
                    <>
                      {' '}
                      <span className="err-inline" style={{ display: 'inline' }}>
                        Sudah lebih dari 7 hari sejak cadangan terakhir — sebaiknya cadangkan sekarang.
                      </span>
                    </>
                  )}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="primary" disabled={busyCad} onClick={() => void unduhCadangan()}>
                    {busyCad ? '…' : 'Unduh cadangan (JSON)'}
                  </button>
                  <button className="outline" disabled={busyCad} onClick={() => void bagikanCadangan()}>
                    Bagikan cadangan
                  </button>
                  <button className="outline" disabled={busyCad} onClick={() => fileRef.current?.click()}>
                    Pulihkan dari cadangan…
                  </button>
                  <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pilihFile} aria-label="Pilih file cadangan" />
                </div>
              </div>

              <div className="card" style={{ padding: 14, background: 'var(--soft)', border: '1px solid var(--line)', boxShadow: 'none', marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <b>Pengingat cadangan (notifikasi browser)</b>
                    <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
                      Bila cadangan terakhir lebih dari 7 hari (atau belum pernah dan aplikasi sudah dipakai 7
                      hari), muncul notifikasi — paling sering sekali tiap 7 hari. Ketuk notifikasi untuk
                      langsung mengunduh cadangan.
                    </p>
                  </div>
                  <span className={`pstat ${notifCad === 'on' ? 'on' : notifCad === 'denied' ? 'hab' : 'na'}`}>
                    {notifCad === 'on' ? '● Aktif' : notifCad === 'denied' ? '● Diblokir' : notifCad === 'tidakDidukung' ? '● Tak didukung' : '● Nonaktif'}
                  </span>
                  <button
                    type="button"
                    className={notifCad === 'on' ? 'outline small' : 'primary'}
                    onClick={() => void klikNotifCad()}
                    disabled={notifCad === 'denied' || notifCad === 'tidakDidukung'}
                  >
                    {notifCad === 'on' ? 'Nonaktifkan' : 'Aktifkan pengingat'}
                  </button>
                </div>
              </div>

              <div className="card" style={{ padding: 14, background: 'var(--soft)', border: '1px solid var(--line)', boxShadow: 'none', marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <b style={{ flex: 1, minWidth: 200 }}>Sinkronisasi multi-perangkat</b>
                  <span className={`pstat ${synAktif ? 'on' : 'na'}`}>{synAktif ? '● Aktif' : '● Nonaktif'}</span>
                </div>
                <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 10px' }}>
                  Hubungkan tablet kasir &amp; HP pemilik lewat server kecil di jaringan Anda (panduan:
                  <code style={{ margin: '0 4px' }}>server/README.md</code>). Baris digabung per id — perangkat yang
                  sinkron terakhir didahulukan. Setiap perangkat otomatis mendapat <b>id + secret</b> saat pertama
                  sinkron (header <code style={{ margin: '0 4px' }}>X-Device-Secret</code>) — perangkat tanpa secret
                  ditolak server. Oplog &amp; kunci shift global menyusul di roadmap arsitektur.
                </p>
                <div className="form-grid" style={{ marginTop: 6 }}>
                  <div className="field">
                    <label htmlFor="syn-url">Alamat server</label>
                    <input id="syn-url" autoComplete="off" value={synUrl} onChange={(e) => setSynUrl(e.target.value)} placeholder="http://192.168.1.5:5174" />
                  </div>
                  <div className="field">
                    <label htmlFor="syn-nama">Nama perangkat ini</label>
                    <input id="syn-nama" autoComplete="off" value={synNama} onChange={(e) => setSynNama(e.target.value)} placeholder="Kasir 1" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
                  <button className={synAktif ? 'outline small' : 'primary'} onClick={() => setSynAktif((v) => !v)}>
                    {synAktif ? 'Nonaktifkan sinkronisasi' : 'Aktifkan sinkronisasi'}
                  </button>
                  <button className="outline small" disabled={synBusy} onClick={() => void ujiSinkron()}>
                    Uji koneksi
                  </button>
                  <button className="outline small" disabled={synBusy} onClick={() => void simpanKonfigSinkron()}>
                    Simpan konfigurasi
                  </button>
                  <button className="primary" disabled={synBusy || !synUrl.trim()} onClick={() => void jalankanSinkron()}>
                    {synBusy ? '…' : 'Sinkronkan sekarang'}
                  </button>
                </div>
                {synTerakhir && (
                  <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                    Terakhir sinkron: {labelRela(synTerakhir)}.
                  </p>
                )}
                {synHasil && <div className={`form-note ${synHasil.startsWith('✓') ? 'ok' : 'err'}`}>{synHasil}</div>}
              </div>

              <div className="card" style={{ padding: 14, background: 'var(--soft)', border: '1px solid var(--line)', boxShadow: 'none', marginTop: 12 }}>
                <b>Muat ulang data awal (seed)</b>
                <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 10px' }}>
                  Mengembalikan seluruh master (bahan, produk, resep) ke set seed — perubahan manual yang sudah
                  Anda buat ikut terhapus. Transaksi & stok operasional ikut di-reset.
                </p>
                <button className="outline" onClick={() => setKonfirmasiReset(true)}>
                  Muat ulang data awal (seed)
                </button>
              </div>
            </div>
          )}

          {aktif === 'keamanan' && (
            <div>
              <h3 style={{ margin: '0 0 2px', fontSize: 15.5 }}>Keamanan & peran</h3>
              <p className="muted" style={{ fontSize: 12.5 }}>{KATEGORI[6].keterangan}</p>
              <div className="card" style={{ padding: 14, background: 'var(--soft)', border: '1px solid var(--line)', boxShadow: 'none', marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <b style={{ flex: 1, minWidth: 200 }}>PIN pemilik</b>
                  <span className={`pstat ${pinAktif ? 'on' : 'na'}`}>{pinAktif ? '● Aktif' : '● Nonaktif'}</span>
                  {pinAktif && zonaPemilikTerbuka() && (
                    <button
                      className="outline small"
                      onClick={() => {
                        kunciZona()
                        void catatAudit('zona-kunci')
                      }}
                    >
                      Kunci sekarang
                    </button>
                  )}
                </div>
                <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 10px' }}>
                  Tanpa PIN seluruh aplikasi terbuka. Dengan PIN, halaman Pengaturan, Finansial, Riwayat Shift &amp;
                  master (bahan/produk) terkunci — kasir tetap bisa transaksi &amp; operasi. Setelah PIN dimasukkan
                  benar, zona pemilik terbuka 30 menit.
                </p>
                {!pinAktif ? (
                  <div className="form-grid" style={{ marginTop: 4 }}>
                    <div className="field">
                      <label htmlFor="pin-baru">PIN baru (4–6 angka) *</label>
                      <input
                        id="pin-baru"
                        type="password"
                        inputMode="numeric"
                        autoComplete="new-password"
                        maxLength={6}
                        value={pinBaru}
                        onChange={(e) => setPinBaru(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="••••"
                      />
                    </div>
                    <div className="field" style={{ alignSelf: 'end' }}>
                      <button className="primary" disabled={pinBaru.length < 4} onClick={() => void aktifkanPin()}>
                        Aktifkan PIN
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="form-grid" style={{ marginTop: 4 }}>
                    <div className="field">
                      <label htmlFor="pin-lama">PIN lama *</label>
                      <input
                        id="pin-lama"
                        type="password"
                        inputMode="numeric"
                        autoComplete="current-password"
                        maxLength={6}
                        value={pinLama}
                        onChange={(e) => setPinLama(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="••••"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="pin-baru2">PIN baru *</label>
                      <input
                        id="pin-baru2"
                        type="password"
                        inputMode="numeric"
                        autoComplete="new-password"
                        maxLength={6}
                        value={pinBaru}
                        onChange={(e) => setPinBaru(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="••••"
                      />
                      <button className="outline" style={{ marginTop: 8 }} disabled={pinLama.length < 4 || pinBaru.length < 4} onClick={() => void gantiPin()}>
                        Ganti PIN
                      </button>
                    </div>
                    <div className="field">
                      <label htmlFor="pin-nonaktif">Nonaktifkan (masukkan PIN)</label>
                      <input
                        id="pin-nonaktif"
                        type="password"
                        inputMode="numeric"
                        autoComplete="current-password"
                        maxLength={6}
                        value={pinNonaktif}
                        onChange={(e) => setPinNonaktif(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="••••"
                      />
                      <button className="outline" style={{ marginTop: 8 }} disabled={pinNonaktif.length < 4} onClick={() => void matikanPin()}>
                        Nonaktifkan PIN
                      </button>
                    </div>
                  </div>
                )}
                {pinErr && <p className="err-inline">{pinErr}</p>}
              </div>

              <h3 style={{ margin: '18px 0 2px', fontSize: 15.5 }}>Jejak aktivitas (audit)</h3>
              <p className="muted" style={{ fontSize: 12.5 }}>
                Peristiwa sensitif terbaru di perangkat ini — PIN, pengaturan, catatan finansial, cadangan &amp;
                sinkronisasi.
              </p>
              {audit.length === 0 ? (
                <p className="empty">Belum ada aktivitas tercatat.</p>
              ) : (
                <div>
                  {audit.map((a) => (
                    <div className="fin-row" key={a.id}>
                      <span className="tgl">
                        {labelAudit(a.aksi)}
                        {a.detail ? <small style={{ display: 'block', color: 'var(--muted)', fontWeight: 400 }}>{a.detail}</small> : null}
                      </span>
                      <span className="num dim" style={{ fontSize: 11 }}>{(a.waktu ?? '').replace('T', ' ').slice(0, 16)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {aktif !== 'data' && aktif !== 'keamanan' && (
            <>
              <div className="form-actions">
                <button className="primary" onClick={() => void simpan()}>
                  Simpan pengaturan
                </button>
              </div>
              {pesan && <div className={`form-note ${pesan.startsWith('✓') ? 'ok' : 'err'}`}>{pesan}</div>}
            </>
          )}
        </div>
      </section>

      <ConfirmDialog
        buka={cadanganImport != null}
        judul="Pulihkan dari cadangan?"
        pesan={
          infoImport
            ? `Mengganti seluruh data saat ini dengan isi cadangan (${infoImport}). Kunci perangkat, notifikasi & pengaturan sinkronisasi dipertahankan. Aksi tidak bisa dibatalkan — cadangkan data saat ini dulu bila ragu.`
            : 'Memulihkan data dari file cadangan.'
        }
        labelKonfirmasi="Pulihkan data"
        sibuk={busyCad}
        onKonfirmasi={() => void konfirmasiPulihkan()}
        onBatal={() => setCadanganImport(null)}
      />

      <ConfirmDialog
        buka={konfirmasiReset}
        judul="Muat ulang data awal?"
        pesan="Seluruh master (bahan, produk, resep) akan di-reset ke set seed — perubahan manual yang sudah Anda buat ikut terhapus. Transaksi & stok operasional ikut di-reset. Aksi ini tidak bisa dibatalkan."
        labelKonfirmasi="Muat ulang seed"
        onKonfirmasi={() =>
          void (async () => {
            await loadSeed()
            setKonfirmasiReset(false)
            setAktif('data')
            setPesan('')
          })()
        }
        onBatal={() => setKonfirmasiReset(false)}
      />
    </main>
  )
}
