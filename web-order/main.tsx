import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { convertStatisKeDinamis } from '../src/domain/qris'
import { chime } from './sound'
import './style.css'

/* ============ tipe & util ============ */
type Produk = {
  id: number; nama: string; kategori: string; harga: number; hargaAsli?: number
  emoji: string; tersedia: boolean; menipis?: boolean; promo?: string
}
type Tarif = { biayaDasar: number; perKm: number; jarakMaxKm: number; gratisMin: number | null }
type Katalog = {
  dibuat: string; resto: { nama: string; alamat: string; lat: number; lng: number }
  tarif: Tarif; terimaCOD: boolean; qrisStatis?: string; gatewayTerpasang?: boolean; bridgeAktif?: boolean; produk: Produk[]
}
type Profil = {
  nama: string; jumlahPesanan: number; total: number; ratingRata: number | null
  alamatTerakhir?: string; terakhirPesan: string | null
}
type ItemOrder = { produkId: number; nama: string; emoji: string; harga: number; hargaAsli?: number; qty: number; subtotal: number }
type Pesan = { dari: 'customer' | 'kasir'; teks: string; waktu: string }
type Pesanan = {
  id: string; no: number; nama: string; hp: string; alamat: string; catatan?: string; jarakKm: number
  ongkir: number; gratis?: boolean; subtotal: number; total: number
  metode: 'qris' | 'transfer' | 'cod' | null
  statusPembayaran: 'belum' | 'menunggu-verifikasi' | 'lunas' | 'refund' | 'cod'
  status: string; buktiNama?: string; verifikasiOtomatis?: boolean; issuer?: string; sumberVerifikasi?: string; nominalUnik?: number; items: ItemOrder[]; pesan: Pesan[]; alasanBatal?: string
  refund?: { nominal: number; metode: 'qris' | 'transfer'; alasan?: string; waktu: string; oleh?: string; transaksiId?: string }
  penilaian?: { rating: number; komentar?: string; waktu: string }
  riwayat: { status: string; waktu: string }[]
}

/* Server order: query ?api= menang; lalu env VITE_API_URL (build produksi);
 * di dev lokal default 5198; di produksi (Vercel) kosong → same-origin /api. */
const API = new URLSearchParams(location.search).get('api')
  || (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL
  || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:5198' : '')
const fmt = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID')
const rupiah = (n: number) => Math.round(n / 100) * 100

/* Server menyimpan waktu UTC ('YYYY-MM-DDTHH:MM:SS' tanpa zona) — tampilkan WIB (UTC+7,
 * tanpa DST) supaya jam pelanggan & jam kasir konsisten di semua perangkat/zona waktu. */
const pad2 = (n: number) => String(n).padStart(2, '0')
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
function tsWIB(iso: string): Date {
  const t = String(iso).replace(' ', 'T')
  return new Date(new Date((t.endsWith('Z') ? t : t + 'Z').slice(0, 19)).getTime() + 7 * 3600_000)
}
const jamWIB = (iso: string) => { const d = tsWIB(iso); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` }
const tglWIB = (iso: string) => { const d = tsWIB(iso); return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}` }
const LS = { token: 'sabana-token', hp: 'sabana-hp', nama: 'sabana-nama', notif: 'sabana-notif' }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...init })
  let body: any = null
  try { body = await r.json() } catch { /* noop */ }
  if (!r.ok) throw new Error(body?.alasan || 'Gagal menghubungi server order.')
  return body as T
}

function qrSvg(seed: number) {
  const N = 25; let s = seed; const out: string[] = []
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const inFinder = (x < 7 && y < 7) || (x > N - 8 && y < 7) || (x < 7 && y > N - 8)
    let on = false
    if (inFinder) {
      const fx = x < 7 ? x : x - (N - 7), fy = y < 7 ? y : y - (N - 7)
      on = !(fx === 0 || fx === 6 || fy === 0 || fy === 6) || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4)
    } else if (x > N - 9 && y > N - 9) on = (x + y) % 2 === 0 && !(x > N - 4 && y > N - 4)
    else if (x === 6 || y === 6) on = (x + y) % 2 === 0
    else on = rnd() > 0.52
    if (on) out.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`)
  }
  return `<svg viewBox="0 0 ${N} ${N}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">${out.join('')}</svg>`
}
function urlBase64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

const LABEL_STATUS: Record<string, string> = {
  cek: 'Cek ketersediaan', 'menunggu-bayar': 'Menunggu pembayaran', baru: 'Menunggu konfirmasi kasir',
  dibuat: 'Dibuat (dapur)', siap: 'Siap — kurir berangkat', diantar: 'Diantar', selesai: 'Selesai', batal: 'Batal',
}
const LABEL_METODE: Record<string, string> = { qris: 'QRIS', transfer: 'Transfer', cod: 'COD' }
function pillStatus(p: Pesanan) {
  if (p.statusPembayaran === 'refund') return <span className="pill batal">↩️ Dana dikembalikan</span>
  if (p.status === 'batal') return <span className="pill batal">Batal</span>
  if (p.status === 'cek') return <span className="pill wait">Menunggu cek kasir</span>
  if (p.status === 'menunggu-bayar') return <span className="pill wait">Siap bayar — menunggu Anda</span>
  if (p.metode === 'cod') return <span className="pill cod">COD — bayar saat kurir tiba</span>
  if (p.statusPembayaran === 'lunas') return <span className="pill lunas">✓ Lunas ({LABEL_METODE[p.metode!]})</span>
  return <span className="pill wait">Menunggu verifikasi kasir</span>
}
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, dLat = (bLat - aLat) * Math.PI / 180, dLng = (bLng - aLng) * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/* ============ komponen utama ============ */
function App() {
  const [katalog, setKatalog] = useState<Katalog | null>(null)
  const [katErr, setKatErr] = useState('')
  const [auth, setAuth] = useState<{ token: string; hp: string; nama: string; profil?: Profil }>(() => {
    const t = localStorage.getItem(LS.token)
    return t ? { token: t, hp: localStorage.getItem(LS.hp) || '', nama: localStorage.getItem(LS.nama) || '' } : null
  })
  const [view, setView] = useState<'menu' | 'riwayat' | 'akun' | 'alamat' | 'cek' | 'status'>('menu')
  const [cat, setCat] = useState('Semua')
  const [cart, setCart] = useState<Record<number, number>>({})
  const [nama, setNama] = useState('')
  const [hp, setHp] = useState('')
  const [alamat, setAlamat] = useState('')
  const [catatan, setCatatan] = useState('')
  const [jarak, setJarak] = useState(2)
  const [pinPos, setPinPos] = useState<{ lat: number; lng: number } | null>(null)
  const [orderId, setOrderId] = useState('')
  const [pesanan, setPesanan] = useState<Pesanan | null>(null)
  const [pesanTeks, setPesanTeks] = useState('')
  const [metode, setMetode] = useState<'qris' | 'transfer' | 'cod'>('qris')
  const [buktiNama, setBuktiNama] = useState('')
  const [buktiPrev, setBuktiPrev] = useState('')
  const [err, setErr] = useState('')
  const [kirim, setKirim] = useState(false)
  const [csat, setCsat] = useState(0)
  const [csatTxt, setCsatTxt] = useState('')
  const [riwayat, setRiwayat] = useState<Pesanan[] | null>(null)
  const [hapusPesan, setHapusPesan] = useState(false)
  const [qrUrl, setQrUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const kasirMode = new URLSearchParams(location.search).get('kasir') === '1'

  /* tambahkan token sesi pelanggan ke URL — dipakai untuk aksi pada pesanan miliknya */
  const tq = (p: string) => (auth ? p + (p.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(auth.token) : p)

  const fetchKatalog = useCallback(async () => {
    try {
      const r = await api<{ katalog: Katalog }>('/api/katalog')
      setKatalog(r.katalog); setKatErr('')
    } catch (e) { setKatErr(String((e as Error).message)) }
  }, [])
  useEffect(() => { fetchKatalog() }, [fetchKatalog])

  /* muat profil (nama & alamat terakhir) saat sesi tersimpan — repeat order tanpa ketik ulang */
  useEffect(() => {
    const t = localStorage.getItem(LS.token)
    if (!t) return
    api<{ nama: string; profil: Profil }>('/api/auth/me?token=' + encodeURIComponent(t))
      .then((r) => {
        setAuth((prev) => (prev?.token === t ? { ...prev, nama: r.nama || prev.nama, profil: r.profil } : prev))
        setNama(r.nama || '')
        setAlamat(r.profil.alamatTerakhir || '')
      })
      .catch(() => {
        // sesi kedaluwarsa / store direset — bersihkan token lokal
        localStorage.removeItem(LS.token)
        setAuth(null)
      })
    setHp(localStorage.getItem(LS.hp) || '')
  }, [])

  /* saat login: isi otomatis nama/hp/alamat terakhir dari profil pelanggan */
  useEffect(() => {
    if (!auth) return
    setHp(auth.hp)
    setNama(auth.nama || auth.profil?.nama || '')
    setAlamat(auth.profil?.alamatTerakhir || '')
  }, [auth])

  const fetchRiwayat = useCallback(async () => {
    if (!auth) { setRiwayat(null); return }
    try {
      const r = await api<{ pesanan: Pesanan[] }>('/api/pesan?token=' + encodeURIComponent(auth.token))
      setRiwayat(r.pesanan)
    } catch { setRiwayat([]) }
  }, [auth])
  useEffect(() => { if (view === 'riwayat') fetchRiwayat() }, [view, fetchRiwayat])

  const subtotal = useMemo(
    () => Object.entries(cart).reduce((s, [id, q]) => s + (katalog?.produk.find((p) => p.id === Number(id))?.harga || 0) * q, 0),
    [cart, katalog],
  )
  const tarif = katalog?.tarif
  const ongkir = useMemo(() => {
    if (!tarif) return 0
    if (tarif.gratisMin && subtotal >= tarif.gratisMin) return 0
    return rupiah(tarif.biayaDasar + tarif.perKm * jarak)
  }, [tarif, subtotal, jarak])
  const diLuar = !!tarif && jarak > tarif.jarakMaxKm
  const total = subtotal + (diLuar ? 0 : ongkir)
  const codAktif = katalog?.terimaCOD === true
  const autoVerif = katalog?.gatewayTerpasang === true || katalog?.bridgeAktif === true

  /* QRIS dinamis asli — dari string statis toko + nominal (unik bila QRIS Bridge aktif) */
  useEffect(() => {
    let batal = false
    setQrUrl('')
    if (metode === 'qris' && katalog?.qrisStatis && pesanan?.status === 'menunggu-bayar') {
      try {
        const nominal = pesanan.nominalUnik || pesanan.total
        const payload = convertStatisKeDinamis(katalog.qrisStatis, nominal)
        QRCode.toDataURL(payload, { width: 240, margin: 1 }).then((url) => { if (!batal) setQrUrl(url) }).catch(() => {})
      } catch { /* QRIS statis invalid — fallback dekoratif */ }
    }
    return () => { batal = true }
  }, [metode, katalog?.qrisStatis, pesanan?.status, pesanan?.total, pesanan?.nominalUnik])

  /* polling pesanan aktif (cek/status) */
  useEffect(() => {
    if (!orderId || (view !== 'cek' && view !== 'status')) return
    let stop = false
    const t = setInterval(async () => {
      try {
        let r = await api<{ pesanan: Pesanan }>(tq('/api/pesan/' + orderId))
        // verifikasi otomatis gateway QRIS: begitu pembayaran terdeteksi masuk → Lunas
        if (r.pesanan.metode === 'qris' && r.pesanan.statusPembayaran === 'menunggu-verifikasi' && katalog?.gatewayTerpasang) {
          const c = await api<{ lunas?: boolean }>(`/api/pesan/${orderId}/cek-pembayaran`, { method: 'POST', body: '{}' }).catch(() => null)
          if (c?.lunas) r = await api<{ pesanan: Pesanan }>(tq('/api/pesan/' + orderId))
        }
        if (stop) return
        setPesanan(r.pesanan)
        const s = r.pesanan.status
        if (s === 'selesai' || s === 'batal') clearInterval(t)
        if (view === 'cek' && s !== 'cek' && s !== 'menunggu-bayar') { setView('status') }
        setHapusPesan(false)
      } catch (e) {
        if (String((e as Error).message).includes('tidak ditemukan')) setHapusPesan(true)
      }
    }, 2500)
    return () => { stop = true; clearInterval(t) }
  }, [orderId, view, katalog?.gatewayTerpasang])

  const ubah = (id: number, d: number) => setCart((c) => {
    const n = { ...c }; const q = (n[id] || 0) + d
    if (q <= 0) delete n[id]; else n[id] = q
    return n
  })
  const jmlItem = Object.keys(cart).length

  const pilihBukti = (f: File | undefined) => {
    if (!f) return
    setBuktiNama(f.name)
    if (buktiPrev) URL.revokeObjectURL(buktiPrev)
    setBuktiPrev(URL.createObjectURL(f))
  }

  /* kirim draft (belum bayar) → kasir cek ketersediaan */
  const kirimDraft = async () => {
    setErr('')
    const items = Object.entries(cart).map(([id, q]) => ({ produkId: Number(id), qty: q }))
    if (!items.length) return
    if (pesanan && (pesanan.status === 'cek' || pesanan.status === 'menunggu-bayar')) {
      // revisi: batalkan draft lama dulu (diproses oleh kasir sebagai "diganti")
      await api(tq(`/api/pesan/${pesanan.id}/aksi`), { method: 'POST', body: JSON.stringify({ aksi: 'batal', alasan: 'diganti pelanggan' }) }).catch(() => {})
    }
    setKirim(true)
    try {
      const r = await api<{ id: string; no: number }>('/api/pesan', {
        method: 'POST',
        body: JSON.stringify({ nama, hp, alamat, catatan, jarakKm: jarak, lat: pinPos?.lat, lng: pinPos?.lng, items }),
      })
      setOrderId(r.id); setPesanan(null); setHapusPesan(false); setView('cek')
      setPesanTeks('')
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setKirim(false) }
  }

  const kirimPesan = async () => {
    if (!pesanTeks.trim()) return
    await api(tq(`/api/pesan/${orderId}/pesan`), { method: 'POST', body: JSON.stringify({ dari: 'customer', teks: pesanTeks.trim() }) })
    setPesanTeks('')
    const r = await api<{ pesanan: Pesanan }>(tq('/api/pesan/' + orderId))
    setPesanan(r.pesanan)
  }

  /* bayar setelah kasir nyatakan tersedia */
  const bayarPesanan = async () => {
    setErr('')
    setKirim(true)
    try {
      const r = await api<{ pesanan: Pesanan }>(tq(`/api/pesan/${orderId}/bayar`), {
        method: 'POST',
        body: JSON.stringify({ metode, buktiNama: metode === 'cod' ? undefined : buktiNama }),
      })
      setPesanan(r.pesanan); setView('status')
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setKirim(false) }
  }

  const langkah = ['Diterima', 'Dibuat', 'Siap', 'Diantar', 'Selesai']
  const IDX_STATUS: Record<string, number> = { baru: 0, dibuat: 1, siap: 2, diantar: 3, selesai: 4, batal: -1 }
  const idxStatus = pesanan ? (IDX_STATUS[pesanan.status] ?? 0) : 0
  const bukaRiwayat = (p: Pesanan) => {
    setOrderId(p.id); setPesanan(p)
    setView(p.status === 'cek' || p.status === 'menunggu-bayar' ? 'cek' : 'status')
  }

  /* ====== PUSH notifikasi (customer) ====== */
  const subscribePush = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setErr('Browser tak mendukung push.'); return false }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setErr('Izin notifikasi ditolak.'); return false }
      await navigator.serviceWorker.register('/web-order-sw.js')
      const v = await api<{ publicKey: string }>('/api/vapid')
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(v.publicKey) })
      await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ token: auth!.token, subscription: sub.toJSON() }) })
      localStorage.setItem(LS.notif, '1')
      setErr('')
      return true
    } catch (e) { setErr('Gagal aktifkan notifikasi: ' + String((e as Error).message)); return false }
  }

  if (!auth && !kasirMode) return <Login onAuth={setAuth} kasirMode={false} />

  /* panel kasir tidak butuh login pelanggan */
  if (!auth && kasirMode) {
    return (
      <>
        <div className="hdr">
          <div className="row">
            <div className="shop">
              <div className="nm">{katalog?.resto.nama || 'Ayam SABANA'} 🍗</div>
              <div className="sub">Panel kasir — tanpa login pelanggan</div>
            </div>
            <span className="sp" />
          </div>
        </div>
        {katErr && <div className="errbox" style={{ margin: '0 16px' }}>{katErr}</div>}
        {katalog && <KasirPanel katalog={katalog} onKatalogRefresh={fetchKatalog} />}
      </>
    )
  }

  return (
    <>
      <div className="hdr">
        <div className="row">
          <div className="shop">
            <div className="nm">{katalog?.resto.nama || 'Ayam SABANA'} 🍗</div>
            <div className="sub">Halo, {auth.nama || auth.hp}</div>
          </div>
          <span className="sp" />
          <span className="sync"><span className="dot" />{katalog ? 'terbuka' : '…'}</span>
        </div>
        {kasirMode && <div className="sub" style={{ marginTop: 6 }}>Panel kasir aktif (?kasir=1).</div>}
      </div>

      <div className="content">
        {katErr && <div className="errbox">Katalog belum tersedia: {katErr}. Jalankan backend: <b>npm run server:order</b></div>}
        {!katalog && !katErr && <div className="muted" style={{ padding: 24, textAlign: 'center' }}>Memuat…</div>}

        {/* ===== MENU ===== */}
        {katalog && view === 'menu' && (
          <>
            <div className="chips">
              {['Semua', ...Array.from(new Set(katalog.produk.map((p) => p.kategori)))].map((k) => (
                <button key={k} className={`chip ${cat === k ? 'on' : ''}`} onClick={() => setCat(k)}>{k}</button>
              ))}
            </div>
            {katalog.produk.filter((p) => cat === 'Semua' || p.kategori === cat).map((p) => {
              const q = cart[p.id] || 0
              const hemat = p.hargaAsli && p.hargaAsli > p.harga ? p.hargaAsli - p.harga : 0
              return (
                <div key={p.id} className={`row ${!p.tersedia ? 'habis' : ''}`}>
                  <div className="thumb">{p.emoji}</div>
                  <div className="r-mid">
                    <div className="r-nm">{p.nama}</div>
                    <div className="r-ct">{p.kategori}</div>
                    <div className="r-pc">
                      {hemat > 0 && <span className="coret">{fmt(p.hargaAsli!)}</span>} {fmt(p.harga)}
                    </div>
                    <div>
                      {!p.tersedia
                        ? <span className="badge habis">Sementara habis</span>
                        : p.menipis
                          ? <span className="badge low">Stok menipis</span>
                          : <span className="badge ava">Tersedia</span>}
                      {hemat > 0 && <span className="badge promo">HEMAT {fmt(hemat)}</span>}
                      {p.promo && <span className="badge promo2">{p.promo}</span>}
                    </div>
                  </div>
                  <div className="qty">
                    <button disabled={q === 0} onClick={() => ubah(p.id, -1)}>−</button>
                    <span className="v">{q}</span>
                    <button disabled={!p.tersedia} onClick={() => ubah(p.id, 1)}>+</button>
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* ===== RIWAYAT ===== */}
        {view === 'riwayat' && (
          <>
            <div className="sec">Riwayat pesanan Anda</div>
            {riwayat === null && <div className="muted" style={{ padding: 14 }}>Memuat…</div>}
            {riwayat !== null && riwayat.length === 0 && <div className="note">Belum ada pesanan untuk nomor ini.</div>}
            {riwayat?.map((p) => (
              <div key={p.id} className="kscard" onClick={() => bukaRiwayat(p)} style={{ cursor: 'pointer' }}>
                <div className="khead">
                  <span className="kno">#{p.no} · {tglPesan(p.waktuBuat)}</span>
                  {pillStatus(p)}
                </div>
                <div className="kbody">
                  <b>{LABEL_STATUS[p.status] || p.status}</b> · {p.items.reduce((s, i) => s + (i.qty > 1 ? i.qty + '× ' : '') + i.nama + ', ', '').replace(/,\s*$/, '')} · {fmt(p.total)}
                  <br />{p.alamat} · {p.jarakKm.toLocaleString('id-ID')} km · ongkir {fmt(p.ongkir)}
                  {p.penilaian && <span> · ⭐ {p.penilaian.rating}/5</span>}
                </div>
              </div>
            ))}
          </>
        )}

        {/* ===== AKUN ===== */}
        {view === 'akun' && (
          <>
            <div className="sec">Akun</div>
            <div className="kscard">
              <div className="kbody">
                <b>{auth.nama || 'Belum ada nama'}</b><br />{auth.hp}
              </div>
            </div>
            <div className="sec">Notifikasi push</div>
            <div className="kscard">
              <div className="kbody">Info pesanan (status, estimasi, CSAT) dikirim ke perangkat ini walau portal tertutup.</div>
              {localStorage.getItem(LS.notif) === '1'
                ? <div className="kbody" style={{ marginTop: 6 }}><span className="pill lunas">✓ Notifikasi aktif</span></div>
                : <div className="kact"><button className="ok" onClick={async () => { if (await subscribePush()) setErr('') }}>🔔 Aktifkan notifikasi</button></div>}
            </div>
            <div className="kact" style={{ marginTop: 10 }}>
              <button className="no" style={{ flex: 1 }} onClick={() => {
                Object.values(LS).forEach((k) => localStorage.removeItem(k))
                setAuth(null); setView('menu')
              }}>Keluar</button>
            </div>
          </>
        )}

        {/* ===== ALAMAT ===== */}
        {katalog && view === 'alamat' && (
          <>
            <div className="sec">Keranjang</div>
            {Object.entries(cart).map(([id, q]) => {
              const p = katalog.produk.find((x) => x.id === Number(id))!
              return (
                <div key={id} className="row">
                  <div className="thumb">{p.emoji}</div>
                  <div className="r-mid"><div className="r-nm">{p.nama}</div>
                    <div className="r-pc">{p.hargaAsli && p.hargaAsli > p.harga && <span className="coret">{fmt(p.hargaAsli)}</span>} {fmt(p.harga)} × {q}</div></div>
                  <div className="qty">
                    <button onClick={() => ubah(p.id, -1)}>−</button>
                    <span className="v">{q}</span>
                    <button onClick={() => ubah(p.id, 1)}>+</button>
                  </div>
                </div>
              )
            })}
            <div className="sec">Alamat penerima</div>
            <div className="field"><label>Nama</label><input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. Bu Sari" /></div>
            <div className="field"><label>No. HP / WhatsApp</label><input value={hp} onChange={(e) => setHp(e.target.value)} placeholder="08xx-xxxx-xxxx" /></div>
            <div className="field"><label>Alamat lengkap</label><input value={alamat} onChange={(e) => setAlamat(e.target.value)} placeholder="Jl., no., patokan…" /></div>
            <div className="field"><label>Catatan pesanan (opsional)</label><textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. tanpa sambal, minta bon, dsb." /></div>
            <div className="field"><label>Pin titik pengantaran di peta</label></div>
            <MapPin katalog={katalog} onJarak={setJarak} jarak={jarak} onPosisi={setPinPos} />
            <div className={`fee ${diLuar ? 'err' : tarif?.gratisMin && subtotal >= tarif.gratisMin ? 'free' : ''}`}>
              <div className="l">{diLuar ? 'Di luar jangkauan pengantaran' : 'Ongkos kirim (radius dari resto)'}</div>
              <div className="big">{diLuar ? `Maksimal ${tarif?.jarakMaxKm} km` : ongkir === 0 && tarif?.gratisMin && subtotal >= tarif.gratisMin ? 'GRATIS 🎉' : fmt(ongkir)}</div>
              <div className="rinci">{diLuar ? '' : tarif?.gratisMin && subtotal >= tarif.gratisMin
                ? `Belanja ≥ ${fmt(tarif.gratisMin)} → ongkir gratis.`
                : `${fmt(tarif?.biayaDasar || 0)} dasar + ${fmt(tarif?.perKm || 0)}/km · ${jarak.toLocaleString('id-ID')} km`}</div>
            </div>
            {err && <div className="errbox">{err}</div>}
          </>
        )}

        {/* ===== CEK KETERSEDIAAN + CHAT ===== */}
        {view === 'cek' && (
          <>
            {hapusPesan ? (
              <div className="errbox">Pesanan ini dihapus/dibatalkan kasir. <button className="cta ghost" style={{ marginTop: 8 }} onClick={() => { setOrderId(''); setPesanan(null); setView('menu') }}>Kembali ke menu</button></div>
            ) : (
              <>
                <div className="orderinfo">
                  <div className="no">Pesanan #{pesanan?.no || '…'}</div>
                  <div className="det">
                    {pesanan?.items.reduce((s, i) => s + (i.qty > 1 ? i.qty + '× ' : '') + i.nama + ', ', '').replace(/,\s*$/, '')} ·
                    {pesanan && fmt(pesanan.total)} · {pesanan?.jarakKm.toLocaleString('id-ID')} km · ongkir {pesanan && fmt(pesanan.ongkir)}
                    {pesanan?.catatan && <><br />📝 <b>{pesanan.catatan}</b></>}
                  </div>
                  <div style={{ marginTop: 6 }}>{pesanan && pillStatus(pesanan)}</div>
                </div>
                {pesanan?.status === 'menunggu-bayar' && (
                  <div className="okbar">✅ Menu tersedia — silakan bayar di bawah.</div>
                )}

                {/* chat */}
                <div className="sec">Chat dengan kasir</div>
                <div className="chat">
                  {pesanan?.pesan.map((m, i) => (
                    <div key={i} className={`bubble ${m.dari === 'kasir' ? 'kasir' : 'cust'}`}>
                      <div className="bt">{m.teks}</div>
                      <div className="bw">{jamWIB(m.waktu)}</div>
                    </div>
                  ))}
                  {(!pesanan || pesanan.pesan.length === 0) && <div className="muted" style={{ padding: 8 }}>Tulis pesan untuk kroscek ketersediaan menu.</div>}
                </div>
                <div className="chatbar">
                  <input value={pesanTeks} onChange={(e) => setPesanTeks(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') kirimPesan() }} placeholder="Tulis pesan…" />
                  <button className="cta ghost" onClick={kirimPesan} disabled={!pesanTeks.trim()}>Kirim</button>
                </div>

                {/* bayar setelah tersedia */}
                {pesanan?.status === 'menunggu-bayar' && (
                  <>
                    <div className="sec" style={{ marginTop: 12 }}>Pembayaran</div>
                    {!codAktif && <div className="note"><b>🛡️ Anti-scam:</b> hanya QRIS/transfer — COD nonaktif.</div>}
                    <div className={`payopt q ${metode === 'qris' ? 'on' : ''}`} onClick={() => setMetode('qris')}>
                      <div className="ico">📱</div>
                      <div><div className="pm">QRIS — bayar dulu</div><div className="ps">{autoVerif ? 'Verifikasi otomatis — tanpa upload bukti.' : 'Scan QR nominal terkunci, unggah bukti.'}</div></div>
                      <div className="rad" />
                    </div>
                    <div className={`payopt t ${metode === 'transfer' ? 'on' : ''}`} onClick={() => setMetode('transfer')}>
                      <div className="ico">🏦</div>
                      <div><div className="pm">Transfer bank</div><div className="ps">{autoVerif ? 'Verifikasi otomatis — tanpa upload bukti.' : 'Transfer ke rekening toko, kirim bukti.'}</div></div>
                      <div className="rad" />
                    </div>
                    <div className={`payopt c ${metode === 'cod' ? 'on' : ''} ${!codAktif ? 'locked' : ''}`} onClick={() => { if (codAktif) setMetode('cod') }}>
                      <div className="ico">💵</div>
                      <div><div className="pm">COD — bayar di tempat {!codAktif && '🔒'}</div>
                        <div className="ps">{codAktif ? 'Tunai saat kurir tiba.' : 'Nonaktif — aktifkan di pengaturan kasir.'}</div></div>
                      <div className="rad" />
                    </div>
                    {metode !== 'cod' && (
                      <>
                        <div className="qrisbox">
                          {metode === 'qris' && qrUrl
                            ? <img src={qrUrl} alt="QRIS nominal terkunci" style={{ width: 160, height: 160, margin: '4px auto', display: 'block' }} />
                            : <div className="qimg" dangerouslySetInnerHTML={{ __html: qrSvg(pesanan?.nominalUnik || pesanan?.total || 0) }} />}
                          <div className="amt">{fmt(pesanan?.nominalUnik || pesanan?.total || 0)}</div>
                          <div className="meta">{metode === 'qris'
                            ? (katalog?.qrisStatis
                                ? 'QRIS dinamis — nominal terkunci (dari QRIS statis toko)'
                                : 'Contoh QR — isi string QRIS statis toko di pengaturan kasir')
                            : 'Transfer ke rekening toko · cantumkan no. pesanan'}</div>
                        </div>
                        {pesanan?.nominalUnik && pesanan.nominalUnik !== pesanan.total && (
                          <div className="note">🔢 Total Anda <b>{fmt(pesanan.total)}</b> — mohon bayar tepat <b>{fmt(pesanan.nominalUnik)}</b>
                            (penanda unik {fmt(pesanan.nominalUnik - pesanan.total)}) agar pembayaran terdeteksi otomatis tanpa bukti.</div>
                        )}
                        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pilihBukti(e.target.files?.[0])} />
                        <div className={`upload ${buktiNama ? 'done' : ''}`} onClick={() => fileRef.current?.click()}>
                          <div className="uico">{buktiNama ? '✅' : '📷'}</div>
                          <div className="ut">{buktiNama ? 'Bukti terpasang' : (autoVerif ? 'Unggah bukti (opsional)' : 'Unggah bukti pembayaran')}</div>
                          <div className="us">{buktiNama ? buktiNama : (autoVerif ? 'Verifikasi otomatis — bisa langsung bayar' : 'Screenshot QRIS / transfer')}</div>
                        </div>
                        {buktiPrev && <img src={buktiPrev} alt="bukti" style={{ width: '100%', borderRadius: 10, marginTop: 8, border: '1px solid var(--line)' }} />}
                        {autoVerif
                          ? <div className="note">⚡ <b>Verifikasi otomatis aktif</b> — status jadi Lunas saat pembayaran terdeteksi (gateway / QRIS Bridge). Bukti opsional.</div>
                          : <div className="req">Wajib: bukti diverifikasi kasir sebelum diproses.</div>}
                      </>
                    )}
                    {metode === 'cod' && <div className="note">Uang tunai dibayar ke kurir saat tiba; dicatat kasir saat kurir kembali.</div>}
                    <button className="cta" style={{ width: '100%', marginTop: 10 }} disabled={kirim || (metode !== 'cod' && !autoVerif && !buktiNama)} onClick={bayarPesanan}>
                      {kirim ? 'Mengirim…' : (metode !== 'cod' && autoVerif && !buktiNama ? 'Bayar — verifikasi otomatis' : 'Bayar & kirim bukti')}
                    </button>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ===== STATUS ===== */}
        {view === 'status' && (
          <>
            <div className="orderinfo">
              <div className="no">Pesanan #{pesanan?.no || '…'} · {katalog?.resto.nama}</div>
              <div className="det">
                {pesanan?.items.reduce((s, i) => s + (i.qty > 1 ? i.qty + '× ' : '') + i.nama + ', ', '').replace(/,\s*$/, '')} ·
                {pesanan && fmt(pesanan.total)} · {pesanan?.jarakKm.toLocaleString('id-ID')} km
                {pesanan?.catatan && <><br />📝 <b>{pesanan.catatan}</b></>}
              </div>
              <div style={{ marginTop: 6 }}>{pesanan && pillStatus(pesanan)}</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                {(pesanan?.status === 'cek' || pesanan?.status === 'menunggu-bayar') && (
                  <button className="cta" style={{ flex: 1 }} onClick={() => setView('cek')}>
                    {pesanan.status === 'menunggu-bayar' ? '💳 Lanjut bayar' : '💬 Buka chat'}
                  </button>
                )}
                <button className="cta ghost" style={{ flex: 1 }} onClick={() => setView('menu')}>← Menu</button>
              </div>
            </div>
            {pesanan?.status === 'batal' && (
              <div className="errbox">Pesanan dibatalkan{pesanan.alasanBatal ? ` — ${pesanan.alasanBatal}` : ''}.</div>
            )}
            {pesanan?.refund && (
              <div className="errbox">↩️ <b>Dana {fmt(pesanan.refund.nominal)} dikembalikan</b> via {pesanan.refund.metode === 'transfer' ? 'transfer bank' : 'QRIS'}
                {pesanan.refund.alasan ? ` — ${pesanan.refund.alasan}` : ''}. Jika belum diterima, hubungi toko.</div>
            )}
            {pesanan?.metode === 'qris' && pesanan.statusPembayaran === 'menunggu-verifikasi' && autoVerif && (
              <div className="okbar">🔍 <b>Verifikasi otomatis aktif</b> — begitu pembayaran terdeteksi masuk, status langsung jadi Lunas.</div>
            )}
            {pesanan?.verifikasiOtomatis && (
              <div className="okbar">⚡ Lunas — diverifikasi otomatis {pesanan.sumberVerifikasi === 'qris-bridge' ? 'via QRIS Bridge (notifikasi HP toko)' : 'lewat gateway'}{pesanan.issuer ? ` (${pesanan.issuer})` : ''}.</div>
            )}
            {pesanan && pesanan.status !== 'batal' && pesanan.status !== 'cek' && pesanan.status !== 'menunggu-bayar' && (
              <div className="tl">
                {langkah.map((l, i) => (
                  <div key={l} className={`tl-item ${i < idxStatus ? 'done' : i === idxStatus ? 'now' : ''}`}>
                    <div className="tt">{l}</div>
                    <div className="ts">{riwayatWaktu(pesanan, i)}</div>
                  </div>
                ))}
              </div>
            )}
            {pesanan && pesanan.status !== 'selesai' && pesanan.status !== 'batal' && pesanan.status !== 'cek' && (
              <div className="note"><b>Pantau status:</b> halaman menyegarkan otomatis. Aktifkan notifikasi di tab Akun agar dapat info push.</div>
            )}
            {pesanan?.status === 'selesai' && !pesanan.penilaian && (
              <div className="csat">
                <div className="h">Bagaimana pesanan Anda? 🙏</div>
                <div className="s">Nilai pengalaman 1–5 (CSAT) — tampil di laporan toko.</div>
                <div className="stars">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <span key={i} className={i <= csat ? 'on' : ''} onClick={() => setCsat(i)}>★</span>
                  ))}
                </div>
                <textarea placeholder="Komentar (opsional)" value={csatTxt} onChange={(e) => setCsatTxt(e.target.value)} />
                <button className="cta" style={{ width: '100%', marginTop: 8 }} disabled={csat === 0}
                  onClick={async () => {
                    await api(tq(`/api/pesan/${orderId}/penilaian`), { method: 'POST', body: JSON.stringify({ rating: csat, komentar: csatTxt }) })
                    setPesanan({ ...pesanan, penilaian: { rating: csat, komentar: csatTxt, waktu: '' } })
                  }}>Kirim penilaian</button>
              </div>
            )}
            {pesanan?.penilaian && (
              <div className="thanks"><div className="big">🎉</div>
                <div className="tt">Terima kasih — nilai {pesanan.penilaian.rating}/5 tersimpan</div>
                <div className="ts">Pesanan #{pesanan.no} selesai. Sampai jumpa lagi! 🍗</div></div>
            )}
          </>
        )}
      </div>

      {/* ===== BAR BAWAH (checkout) ===== */}
      {(view === 'alamat' || view === 'cek') && !kasirMode && (
        <div className="bar">
          <div className="tot">
            <div className="t1">{view === 'alamat' ? 'Total + ongkir' : pesanan?.status === 'menunggu-bayar' ? 'Menunggu pembayaran' : 'Menunggu cek kasir'}</div>
            <div className="t2">{fmt(view === 'alamat' ? total : (pesanan?.total || 0))}</div>
          </div>
          {view === 'alamat'
            ? <button className="cta" disabled={!jmlItem || diLuar || kirim} onClick={kirimDraft}>
                {kirim ? 'Mengirim…' : 'Kirim & cek ketersediaan'}
              </button>
            : <button className="cta ghost" onClick={() => setView('alamat')}>Ubah pesanan</button>}
        </div>
      )}
      {view === 'status' && !kasirMode && (
        <div className="bar"><div className="tot"><div className="t1">Status pesanan #{pesanan?.no}</div></div></div>
      )}

      {/* ===== BOTTOM NAV (app-like) ===== */}
      {!kasirMode && (view === 'menu' || view === 'riwayat' || view === 'akun') && (
        <div className="tabbar">
          <button className={`tbtn ${view === 'menu' ? 'on' : ''}`} onClick={() => setView('menu')}>
            <span className="tico">🍗</span><span>Menu</span></button>
          <button className={`tbtn ${view === 'riwayat' ? 'on' : ''}`} onClick={() => setView('riwayat')}>
            <span className="tico">🧾</span><span>Riwayat</span></button>
          <button className={`tbtn ${view === 'akun' ? 'on' : ''}`} onClick={() => setView('akun')}>
            <span className="tico">👤</span><span>Akun</span></button>
        </div>
      )}
      {view === 'menu' && !kasirMode && jmlItem > 0 && (
        <div className="fab" onClick={() => setView('alamat')}>
          <span>{jmlItem} item · {fmt(subtotal)}</span><span>Lanjut →</span>
        </div>
      )}

      {kasirMode && katalog && <KasirPanel katalog={katalog} onKatalogRefresh={fetchKatalog} />}
      {err && view !== 'alamat' && <div className="errbox" style={{ margin: '0 16px 12px' }}>{err}</div>}
    </>
  )
}

/* ============ login / daftar — nomor HP + PIN ============ */
interface HasilAuth { token: string; hp: string; nama: string; profil?: Profil; perluSetPin?: boolean }
function Login({ onAuth, kasirMode }: { onAuth: (a: HasilAuth) => void; kasirMode: boolean }) {
  const [hp, setHp] = useState(localStorage.getItem(LS.hp) || '')
  const [nama, setNama] = useState('')
  const [pin, setPin] = useState('')
  const [mode, setMode] = useState<'login' | 'daftar'>('login')
  const [err, setErr] = useState('')
  const [sibuk, setSibuk] = useState(false)
  // pelanggan lama (tanpa PIN) — login sekali lalu wajib set PIN
  const [setPinMode, setSetPinMode] = useState<{ token: string; hp: string; nama: string; profil?: Profil } | null>(null)
  const [pinBaru, setPinBaru] = useState('')
  const [pinUlang, setPinUlang] = useState('')

  const simpanAuth = (r: HasilAuth) => {
    localStorage.setItem(LS.token, r.token)
    localStorage.setItem(LS.hp, r.hp)
    if (r.nama) localStorage.setItem(LS.nama, r.nama)
    onAuth(r)
  }

  const masuk = async () => {
    setErr(''); setSibuk(true)
    try {
      const r = await api<HasilAuth>(mode === 'daftar' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST', body: JSON.stringify({ hp, nama, pin }),
      })
      if (r.perluSetPin && r.token) {
        setSetPinMode({ token: r.token, hp: r.hp, nama: r.nama, profil: r.profil })
        return
      }
      simpanAuth(r)
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setSibuk(false) }
  }

  const kirimPinBaru = async () => {
    setErr('')
    if (!/^\d{4,6}$/.test(pinBaru)) { setErr('PIN harus 4–6 angka.'); return }
    if (pinBaru !== pinUlang) { setErr('PIN tidak sama — ketik ulang.'); return }
    setSibuk(true)
    try {
      await api('/api/auth/atur-pin', { method: 'POST', body: JSON.stringify({ token: setPinMode!.token, pin: pinBaru }) })
      simpanAuth({ token: setPinMode!.token, hp: setPinMode!.hp, nama: setPinMode!.nama, profil: setPinMode!.profil })
    } catch (e) { setErr(String((e as Error).message)) }
    finally { setSibuk(false) }
  }

  if (setPinMode) {
    return (
      <div className="login">
        <div className="lcard">
          <div className="lbig">🔐</div>
          <div className="lt">Atur PIN untuk {setPinMode.hp}</div>
          <div className="ls">Akun lama tanpa PIN — buat PIN 4–6 angka sekali ini; berikutnya masuk pakai nomor + PIN.</div>
          <div className="field"><label>PIN baru</label>
            <input type="password" inputMode="numeric" maxLength={6} value={pinBaru} onChange={(e) => setPinBaru(e.target.value.replace(/\D/g, ''))} placeholder="••••••" /></div>
          <div className="field"><label>Ulangi PIN</label>
            <input type="password" inputMode="numeric" maxLength={6} value={pinUlang} onChange={(e) => setPinUlang(e.target.value.replace(/\D/g, ''))} placeholder="••••••" /></div>
          <button className="cta" style={{ width: '100%' }} disabled={sibuk || pinBaru.length < 4} onClick={kirimPinBaru}>
            {sibuk ? '…' : 'Simpan PIN'}
          </button>
          {err && <div className="errbox" style={{ marginTop: 10 }}>{err}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="login">
      <div className="lcard">
        <div className="lbig">🍗</div>
        <div className="lt">{mode === 'daftar' ? 'Daftar di portal Ayam SABANA' : 'Masuk ke portal Ayam SABANA'}</div>
        <div className="ls">Nomor HP + PIN Anda — riwayat, promo, nama &amp; alamat terakhir ikut nomor Anda di semua perangkat.</div>
        <div className="field"><label>No. HP / WhatsApp</label>
          <input value={hp} onChange={(e) => setHp(e.target.value)} placeholder="08xx-xxxx-xxxx" /></div>
        {mode === 'daftar' && (
          <div className="field"><label>Nama</label>
            <input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. Bu Sari" /></div>
        )}
        <div className="field"><label>{mode === 'daftar' ? 'Buat PIN (4–6 angka)' : 'PIN'}</label>
          <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••••" autoComplete={mode === 'daftar' ? 'new-password' : 'current-password'} /></div>
        <button className="cta" style={{ width: '100%' }} disabled={sibuk || hp.replace(/\D/g, '').length < 8 || pin.length < 4} onClick={masuk}>
          {sibuk ? '…' : mode === 'daftar' ? 'Buat akun & masuk' : 'Masuk'}
        </button>
        <button className="link-btn" style={{ marginTop: 10 }} onClick={() => { setMode((m) => (m === 'login' ? 'daftar' : 'login')); setErr(''); setPin('') }}>
          {mode === 'login' ? 'Belum punya akun? Daftar dengan PIN' : 'Sudah punya PIN? Masuk'}
        </button>
        {err && <div className="errbox" style={{ marginTop: 10 }}>{err}</div>}
        {kasirMode && <div className="muted" style={{ marginTop: 10, fontSize: 11 }}>Panel kasir: login pelanggan tidak wajib — panel tetap tampil di bawah.</div>}
      </div>
    </div>
  )
}

/* ============ peta pin ============ */
function MapPin({ katalog, jarak, onJarak, onPosisi }: { katalog: Katalog; jarak: number; onJarak: (km: number) => void; onPosisi?: (lat: number, lng: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const adaL = typeof (window as any).L !== 'undefined'
  const init = useRef(false)
  useEffect(() => {
    const L = (window as any).L
    if (!L || !ref.current || init.current) return
    init.current = true
    const r = katalog.resto
    const map = L.map(ref.current, { attributionControl: false }).setView([r.lat, r.lng], 13)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    L.marker([r.lat, r.lng], {
      icon: L.divIcon({ className: '', html: '<div class="pin resto"></div>', iconSize: [26, 30], iconAnchor: [13, 28] }),
    }).addTo(map)
    const awal = { lat: r.lat + 0.018, lng: r.lng + 0.006 }
    const mk = L.marker([awal.lat, awal.lng], {
      draggable: true,
      icon: L.divIcon({ className: '', html: '<div class="pin"></div>', iconSize: [24, 28], iconAnchor: [12, 26] }),
    }).addTo(map)
    const setKm = (ll: { lat: number; lng: number }) => {
      onJarak(Math.round(haversineKm(r.lat, r.lng, ll.lat, ll.lng) * 10) / 10)
      onPosisi?.(ll.lat, ll.lng)
    }
    mk.on('dragend', () => setKm(mk.getLatLng()))
    setKm(awal)
    return () => { map.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [katalog, onJarak, onPosisi])

  if (!adaL) {
    return (
      <div className="field">
        <label>Jarak ({jarak.toLocaleString('id-ID')} km) — peta tak termuat, pakai slider</label>
        <div className="range">
          <input type="range" min={0.5} max={(katalog.tarif.jarakMaxKm || 7) + 2} step={0.5} value={jarak}
            onChange={(e) => onJarak(Number(e.target.value))} />
          <span className="v">{jarak.toLocaleString('id-ID')} km</span>
        </div>
      </div>
    )
  }
  return (
    <>
      <div className="map" ref={ref} />
      <div className="map-hint">Geser pin biru ke lokasi Anda · jarak {jarak.toLocaleString('id-ID')} km dari resto</div>
    </>
  )
}

/* ============ panel kasir ============ */
function KasirPanel({ katalog, onKatalogRefresh }: { katalog: Katalog; onKatalogRefresh: () => void }) {
  const [daftar, setDaftar] = useState<Pesanan[]>([])
  const [banner, setBanner] = useState('')
  const lastNo = useRef(0)
  const [cod, setCod] = useState(katalog.terimaCOD)
  const [t, setT] = useState({ ...katalog.tarif })
  const [qrisStatis, setQrisStatis] = useState(katalog.qrisStatis || '')
  const [simpanMsg, setSimpanMsg] = useState('')
  const [pelanggan, setPelanggan] = useState<any[]>([])
  const [qCust, setQCust] = useState('')
  const [gwUrl, setGwUrl] = useState('')
  const [gwKey, setGwKey] = useState('')
  const [gwOn, setGwOn] = useState(false)
  const [balasan, setBalasan] = useState<Record<string, string>>({})
  const [editQty, setEditQty] = useState<Record<string, Record<number, number>>>({})
  const [editId, setEditId] = useState('')
  const [ks, setKs] = useState(() => localStorage.getItem('sabana-kasir-secret') || '')

  /* API dengan kredensial kasir — header X-Kasir-Secret bila server pakai KASIR_SECRET */
  const kapi = async (path: string, init?: RequestInit) => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (ks) h['X-Kasir-Secret'] = ks
    const r = await fetch(API + path, { headers: h, ...init })
    let body: any = null
    try { body = await r.json() } catch { /* noop */ }
    if (!r.ok) throw new Error(body?.alasan || 'Gagal menghubungi server order.')
    return body
  }
  const gantiKs = (v: string) => { setKs(v); if (v) localStorage.setItem('sabana-kasir-secret', v); else localStorage.removeItem('sabana-kasir-secret') }

  const ambil = useCallback(async () => {
    try {
      const r = await kapi<{ pesanan: Pesanan[] }>('/api/pesan')
      const sorted = r.pesanan.sort((a, b) => b.no - a.no)
      setDaftar(sorted)
      const maxNo = sorted.length ? Math.max(...sorted.map((p) => p.no)) : 0
      if (!lastNo.current) { lastNo.current = maxNo; return }
      if (maxNo > lastNo.current) {
        lastNo.current = maxNo
        chime(); if (navigator.vibrate) navigator.vibrate([120, 60, 120])
        const baru = sorted.find((p) => p.no === maxNo)
        setBanner(`🔔 Pesanan #${baru.no} masuk — ${baru.status === 'cek' ? 'cek ketersediaan' : 'baru'}`)
        setTimeout(() => setBanner(''), 5000)
      }
    } catch { /* server belum jalan */ }
  }, [])
  useEffect(() => {
    ambil()
    const t1 = setInterval(ambil, 2500)
    const t2 = setInterval(() => {
      kapi<{ pelanggan: any[] }>('/api/pelanggan?q=' + encodeURIComponent(qCust)).then((r) => setPelanggan(r.pelanggan)).catch(() => {})
      kapi<{ pengaturan: any }>('/api/pengaturan').then((r) => {
        setCod(r.pengaturan.terimaCOD)
        setT(r.pengaturan.tarif)
        setGwUrl(r.pengaturan.gateway?.url || '')
        setGwKey(r.pengaturan.gateway?.apiKey || '')
        setGwOn(!!r.pengaturan.gatewayTerpasang)
      }).catch(() => {})
    }, 4000)
    // SSE — lunas via QRIS Bridge & pesanan baru muncul seketika (tanpa menunggu polling)
    let es: EventSource | null = null
    try {
      es = new EventSource(API + '/api/events' + (ks ? '?sse=' + encodeURIComponent(ks) : ''))
      es.addEventListener('pesanan-baru', () => ambil())
      es.addEventListener('lunas-bridge', (e: Event) => {
        let d: any = null
        try { d = JSON.parse((e as MessageEvent).data) } catch { return }
        chime(); if (navigator.vibrate) navigator.vibrate([200, 60, 200])
        setBanner(`💰 Pesanan #${d.no} lunas otomatis via QRIS Bridge${d.issuer ? ` (${d.issuer})` : ''} — tanpa menunggu polling.`)
        setTimeout(() => setBanner(''), 7000)
        ambil()
      })
    } catch { /* SSE tak didukung */ }
    return () => { clearInterval(t1); clearInterval(t2); es?.close() }
  }, [ambil, qCust, ks])

  const aksi = async (id: string, a: string, alasan?: string) => {
    await kapi(`/api/pesan/${id}/aksi`, { method: 'POST', body: JSON.stringify({ aksi: a, alasan }) })
    ambil()
  }
  const kirimBalasan = async (id: string) => {
    const teks = (balasan[id] || '').trim()
    if (!teks) return
    await kapi(`/api/pesan/${id}/pesan`, { method: 'POST', body: JSON.stringify({ dari: 'kasir', teks }) })
    setBalasan({ ...balasan, [id]: '' })
    ambil()
  }
  const simpanEdit = async (id: string) => {
    const items = Object.entries(editQty[id] || {}).filter(([, q]) => (q || 0) > 0).map(([pid, q]) => ({ produkId: Number(pid), qty: q }))
    await kapi(`/api/pesan/${id}/ubah`, { method: 'POST', body: JSON.stringify({ items }) })
    setEditId(''); ambil()
  }
  const hapus = async (id: string) => {
    if (!confirm('Hapus pesanan ini?')) return
    await kapi(`/api/pesan/${id}`, { method: 'DELETE' })
    ambil()
  }
  const notif = async (hp: string, no: number, teks: string) => {
    await kapi('/api/push', { method: 'POST', body: JSON.stringify({ hp, title: 'Pesanan #' + no, body: teks }) })
  }
  const simpan = async () => {
    setSimpanMsg('')
    try {
      await kapi('/api/pengaturan', { method: 'POST', body: JSON.stringify({
        terimaCOD: cod, qrisStatis,
        gateway: { url: gwUrl, apiKey: gwKey },
        tarif: { ...t, gratisMin: t.gratisMin },
      }) })
      setSimpanMsg('✓ Pengaturan disimpan.')
      onKatalogRefresh()
    } catch (e) { setSimpanMsg('✗ ' + String((e as Error).message)) }
  }
  const cekGateway = async (id: string) => {
    const r = await kapi<{ lunas?: boolean; alasan?: string }>(`/api/pesan/${id}/cek-pembayaran`, { method: 'POST', body: '{}' }).catch(() => null)
    if (r?.lunas) setBanner(`💰 Pesanan #${daftar.find((p) => p.id === id)?.no} lunas — diverifikasi otomatis.`)
    else if (r?.alasan) setBanner(`ℹ️ ${r.alasan}`)
    setTimeout(() => setBanner(''), 4000)
    ambil()
  }

  return (
    <div className="kwrap">
      {banner && <div className="nbanner">{banner}</div>}

      <div className="kh"><h3>⚙️ Pengaturan antar</h3></div>
      <div className="kscard">
        <div className="field" style={{ margin: '8px 14px 0' }}>
          <label>Secret kasir (X-Kasir-Secret) — wajib bila server pakai env KASIR_SECRET</label>
          <input type="password" value={ks} onChange={(e) => gantiKs(e.target.value)} placeholder="kosong = mode dev" autoComplete="off" />
        </div>
        <div className="kbody">
          <label className="chk"><input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} />
            <b>Terima COD</b> — nonaktif = pelanggan hanya QRIS/transfer (anti-scam).</label>
        </div>
        <div className="kbody" style={{ marginTop: 8 }}>
          <div className="grid2">
            <div className="field"><label>Biaya dasar</label><input type="number" value={t.biayaDasar} onChange={(e) => setT({ ...t, biayaDasar: Number(e.target.value) })} /></div>
            <div className="field"><label>Tarif per km</label><input type="number" value={t.perKm} onChange={(e) => setT({ ...t, perKm: Number(e.target.value) })} /></div>
            <div className="field"><label>Jarak maks (km)</label><input type="number" value={t.jarakMaxKm} onChange={(e) => setT({ ...t, jarakMaxKm: Number(e.target.value) })} /></div>
            <div className="field"><label>Gratis ongkir ≥ (0=mati)</label><input type="number" value={t.gratisMin ?? 0} onChange={(e) => setT({ ...t, gratisMin: Number(e.target.value) || null })} /></div>
          </div>
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label>String QRIS statis toko (untuk QR dinamis nominal terkunci)</label>
          <textarea value={qrisStatis} onChange={(e) => setQrisStatis(e.target.value)} placeholder="0002010102112657…" style={{ height: 44 }} />
        </div>
        <div className="kbody" style={{ marginTop: 8 }}>
          <label className="chk"><input type="checkbox" checked={gwOn} onChange={(e) => setGwOn(e.target.checked)} />
            <b>Verifikasi otomatis gateway QRIS</b> {gwOn ? '· aktif' : '· nonaktif (verifikasi manual kasir)'}</label>
          <div className="grid2">
            <div className="field"><label>URL gateway ShopeePay</label><input value={gwUrl} onChange={(e) => setGwUrl(e.target.value)} placeholder="http://localhost:3001" /></div>
            <div className="field"><label>X-API-Key</label><input value={gwKey} onChange={(e) => setGwKey(e.target.value)} placeholder="shopee-secret-key" /></div>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Unofficial gateway (repo shoppepay-api-gateway): cek-payment /check-payment otomatis. Kosongkan URL = verifikasi manual.</div>
        </div>
        <div className="kact"><button className="ok" onClick={simpan}>Simpan pengaturan</button></div>
        {simpanMsg && <div className="kbody" style={{ marginTop: 6 }}>{simpanMsg}</div>}
      </div>

      <div className="kh"><h3>📇 Database pelanggan</h3>
        <input className="q" value={qCust} onChange={(e) => setQCust(e.target.value)} placeholder="cari nama/HP" /></div>
      <div className="kscard">
        {pelanggan.length === 0 && <div className="kbody">Belum ada pelanggan terdaftar.</div>}
        {pelanggan.map((p) => (
          <div key={p.hp} className="kbody" style={{ marginBottom: 6 }}>
            <b>{p.nama || '(tanpa nama)'}</b> · {p.hp}<br />
            <span className="muted">{p.jumlahPesanan} pesanan · {fmt(p.total || 0)} · ⭐ {p.ratingRata ?? '—'}{p.terakhirPesan ? ` · terakhir ${tglWIB(p.terakhirPesan)}` : ''}</span>
          </div>
        ))}
      </div>

      <div className="kh"><h3>Papan Pesanan Antar</h3>
        <span className="pill wait">{daftar.filter((p) => p.status !== 'selesai' && p.status !== 'batal').length} berjalan</span>
      </div>
      {daftar.length === 0 && <div className="muted" style={{ padding: 14 }}>Belum ada pesanan.</div>}
      {daftar.map((p) => (
        <div key={p.id} className="kscard">
          <div className="khead">
            <span className="kno">#{p.no} · {p.nama}</span>
            {pillStatus(p)}
          </div>
          <div className="kbody">
            <b>{LABEL_STATUS[p.status] || p.status}</b> · {p.items.reduce((s, i) => s + (i.qty > 1 ? i.qty + '× ' : '') + i.nama + ', ', '').replace(/,\s*$/, '')} · {fmt(p.total)}
            <br />{p.alamat} · {p.jarakKm.toLocaleString('id-ID')} km · ongkir {fmt(p.ongkir)}
            {p.catatan && <><br />📝 <b>{p.catatan}</b></>}
            {p.buktiNama && <><br />🧾 bukti: {p.buktiNama}</>}
            {p.verifikasiOtomatis && <div className="muted" style={{ marginTop: 4 }}>⚡ Lunas diverifikasi otomatis {p.sumberVerifikasi === 'qris-bridge' ? 'QRIS Bridge (notifikasi HP toko)' : 'gateway'}{p.issuer ? ` (${p.issuer})` : ''}</div>}
            {p.refund && <div style={{ color: 'var(--danger)', marginTop: 4 }}>↩️ Refund {fmt(p.refund.nominal)} via {p.refund.metode}{p.refund.alasan ? ` — ${p.refund.alasan}` : ''} · {jamWIB(p.refund.waktu)}</div>}
            {p.alasanBatal && <div style={{ color: 'var(--danger)', marginTop: 4 }}>Batal: {p.alasanBatal}</div>}
          </div>

          {/* chat thread */}
          {p.pesan.length > 0 && (
            <div className="chat sm">
              {p.pesan.map((m, i) => (
                <div key={i} className={`bubble ${m.dari === 'kasir' ? 'kasir' : 'cust'}`}>
                  <div className="bt">{m.teks}</div>
                  <div className="bw">{jamWIB(m.waktu)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="chatbar sm">
            <input value={balasan[p.id] || ''} onChange={(e) => setBalasan({ ...balasan, [p.id]: e.target.value })}
              placeholder="Balas pelanggan…" />
            <button className="cta ghost" onClick={() => kirimBalasan(p.id)} disabled={!(balasan[p.id] || '').trim()}>Kirim</button>
          </div>

          {/* edit qty inline */}
          {editId === p.id && (
            <div className="grid2" style={{ margin: '8px 0' }}>
              {p.items.map((i) => (
                <div key={i.produkId} className="field">
                  <label>{i.nama}</label>
                  <input type="number" min={0} value={editQty[p.id]?.[i.produkId] ?? i.qty}
                    onChange={(e) => setEditQty({ ...editQty, [p.id]: { ...(editQty[p.id] || {}), [i.produkId]: Number(e.target.value) } })} />
                </div>
              ))}
            </div>
          )}

          {p.status !== 'batal' && p.status !== 'selesai' && (
            <div className="kact">
              {p.status === 'cek' && <button className="ok" onClick={() => aksi(p.id, 'tersedia')}>✓ Tersedia — kirim QR bayar</button>}
              {p.status === 'cek' && <button className="no" onClick={() => aksi(p.id, 'tidak-tersedia', prompt('Alasan (dikirim ke pelanggan):') || 'Sebagian menu tidak tersedia')}>✗ Tidak tersedia</button>}
              {p.status === 'menunggu-bayar' && <span className="pill wait">Menunggu bayar pelanggan</span>}
              {p.status === 'baru' && p.metode !== 'cod' && p.statusPembayaran === 'menunggu-verifikasi' && (
                <button className="ok" onClick={() => aksi(p.id, 'verifikasi')}>✓ Verifikasi bayar</button>)}
              {p.status === 'baru' && p.metode !== 'cod' && p.statusPembayaran === 'menunggu-verifikasi' && (
                <button className="gh" onClick={() => cekGateway(p.id)}>🔍 Cek gateway</button>)}
              {p.status === 'baru' && p.metode !== 'cod' && p.statusPembayaran === 'menunggu-verifikasi' && (
                <button className="gh" onClick={async () => {
                  await api(`/api/pesan/${p.id}/qris-callback`, { method: 'POST', body: JSON.stringify({}) })
                  ambil()
                }}>💰 Simulasi callback</button>)}
              {p.status === 'baru' && (p.metode === 'cod' || p.statusPembayaran === 'lunas') && (
                <button className="ok" onClick={() => aksi(p.id, 'terima')}>Terima → dapur</button>)}
              {p.statusPembayaran === 'lunas' && p.metode !== 'cod' && !p.refund && (
                <button className="no" onClick={refundOrder(p)}>↩️ Refund</button>)}
              {p.status === 'dibuat' && <button className="gh" onClick={() => aksi(p.id, 'siap')}>Siap</button>}
              {p.status === 'siap' && <button className="gh" onClick={() => aksi(p.id, 'diantar')}>Antarkan</button>}
              {p.status === 'diantar' && <button className="ok" onClick={() => aksi(p.id, 'selesai')}>Selesai</button>}
              {(p.status === 'cek' || p.status === 'menunggu-bayar') && (
                <button className="gh" onClick={() => {
                  setEditId(editId === p.id ? '' : p.id)
                  setEditQty({ ...editQty, [p.id]: Object.fromEntries(p.items.map((i) => [i.produkId, i.qty])) })
                }}>Ubah item</button>)}
              {editId === p.id && <button className="ok" onClick={() => simpanEdit(p.id)}>Simpan ubah</button>}
              <button className="no" onClick={() => hapus(p.id)}>Hapus</button>
              <button className="gh" onClick={() => aksi(p.id, 'batal', prompt('Alasan batal:') || 'dibatalkan kasir')}>Batal</button>
              <button className="gh" onClick={() => notif(p.hp, p.no, `Status: ${LABEL_STATUS[p.status] || p.status} — pantau di portal.`)}>🔔 Notif pelanggan</button>
            </div>
          )}              {(p.status === 'selesai' || p.status === 'batal') && p.statusPembayaran === 'lunas' && p.metode && p.metode !== 'cod' && !p.refund && (
                <div className="kact"><button className="no" onClick={refundOrder(p)}>↩️ Refund dana ({fmt(p.total)})</button></div>
              )}
              {p.penilaian && <div className="kbody" style={{ marginTop: 6 }}>⭐ {p.penilaian.rating}/5{p.penilaian.komentar ? ` — ${p.penilaian.komentar}` : ''}</div>}
        </div>
      ))}
    </div>
  )

  /* refund dana QRIS/transfer — kembali manual; jejak audit di server */
  function refundOrder(p: Pesanan) {
    return async () => {
      const alasan = prompt(`Refund #${p.no} — dana ${fmt(p.total)} (${p.metode === 'transfer' ? 'transfer' : 'QRIS'}) dikembalikan manual. Alasan:`)
      if (alasan === null) return
      try {
        await api(`/api/pesan/${p.id}/aksi`, { method: 'POST', body: JSON.stringify({ aksi: 'refund', alasan, metode: p.metode }) })
        setBanner(`↩️ Pesanan #${p.no} di-refund — dana ${fmt(p.total)} dikembalikan.`)
        setTimeout(() => setBanner(''), 5000)
        ambil()
      } catch (e) { alert(String((e as Error).message)) }
    }
  }
}

/* ============ helper ============ */
function riwayatWaktu(p: Pesanan, idx: number) {
  const map = ['baru', 'dibuat', 'siap', 'diantar', 'selesai']
  const r = p.riwayat.find((x) => x.status === map[idx] || (idx === 0 && x.status === 'baru'))
  return r ? jamWIB(r.waktu) : ''
}
function tglPesan(iso: string) {
  const d = tsWIB(iso)
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} · ${jamWIB(iso)} WIB`
}

createRoot(document.getElementById('root')!).render(<App />)