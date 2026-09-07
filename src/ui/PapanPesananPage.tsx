import { useCallback, useEffect, useRef, useState } from 'react'
import { formatRupiah } from '../domain/conversions'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * Papan Pesanan Antar — pesanan delivery dari portal customer.
 * Terhubung ke server order ringan (server/order.mjs) via URL yang bisa diatur.
 * Login pelanggan cukup nomor HP (tanpa OTP); verifikasi QRIS bisa otomatis
 * via gateway ShopeePay (repo shoppepay-api-gateway) bila dikonfigurasi.
 */

type ItemOrder = { produkId: number; nama: string; emoji: string; harga: number; qty: number; subtotal: number }
type Pesan = { dari: 'customer' | 'kasir'; teks: string; waktu: string }
interface Pesanan {
  id: string; no: number; nama: string; hp: string; alamat: string; catatan?: string; jarakKm: number
  ongkir: number; subtotal: number; total: number
  metode: 'qris' | 'transfer' | 'cod' | null
  statusPembayaran: 'belum' | 'menunggu-verifikasi' | 'lunas' | 'refund' | 'cod'
  status: string; buktiNama?: string; verifikasiOtomatis?: boolean; issuer?: string; sumberVerifikasi?: string; nominalUnik?: number; items: ItemOrder[]; pesan: Pesan[]; alasanBatal?: string; rentangBayar?: string
  refund?: { nominal: number; metode: 'qris' | 'transfer'; alasan?: string; waktu: string; oleh?: string; transaksiId?: string; verifikasiOtomatis?: boolean }
  penilaian?: { rating: number; komentar?: string; waktu: string }
}
interface Pelanggan { hp: string; nama?: string; alamatTerakhir?: string; jumlahPesanan: number; total: number; ratingRata: number | null; terakhirPesan?: string }
interface Tarif { biayaDasar: number; perKm: number; jarakMaxKm: number; gratisMin: number | null }

import { ORDER_URL_DEFAULT } from '../data/orderKonfig'

const LS_URL = 'papan-order-url'
const LS_SECRET = 'papan-kasir-secret'

const LABEL_STATUS: Record<string, string> = {
  cek: 'Cek ketersediaan', 'menunggu-bayar': 'Menunggu bayar pelanggan', baru: 'Menunggu konfirmasi kasir',
  dibuat: 'Dibuat (dapur)', siap: 'Siap', diantar: 'Diantar', selesai: 'Selesai', batal: 'Batal',
}

async function api(url: string, path: string, init?: RequestInit): Promise<any> {
  const secret = localStorage.getItem(LS_SECRET) || ''
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret) h['X-Kasir-Secret'] = secret
  const r = await fetch(url + path, { headers: h, ...init })
  let body: any = null
  try { body = await r.json() } catch { /* noop */ }
  if (!r.ok) throw new Error(body?.alasan || 'Gagal menghubungi server order.')
  return body
}

function chime() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    const ac = new AC()
    const t = ac.currentTime
    ;([[880, 0], [1174.7, 0.16], [880, 0.34]] as const).forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + d)
      g.gain.exponentialRampToValueAtTime(0.4, t + d + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5)
      o.connect(g); g.connect(ac.destination)
      o.start(t + d); o.stop(t + d + 0.55)
    })
  } catch { /* audio diblokir */ }
}

/* bunyi khas uang masuk — beda dari chime pesanan baru */
function chimeLunas() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    const ac = new AC()
    const t = ac.currentTime
    ;([[659.25, 0], [987.77, 0.12], [1318.5, 0.26], [1975.5, 0.42]] as const).forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain()
      o.type = 'triangle'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + d)
      g.gain.exponentialRampToValueAtTime(0.45, t + d + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.45)
      o.connect(g); g.connect(ac.destination)
      o.start(t + d); o.stop(t + d + 0.5)
    })
  } catch { /* audio diblokir */ }
}

function pill(p: Pesanan) {
  if (p.statusPembayaran === 'refund') return <span className="tag merah">↩️ Refund · dana kembali</span>
  if (p.status === 'batal') return <span className="tag merah">Batal</span>
  if (p.status === 'cek') return <span className="tag kuning">Cek ketersediaan</span>
  if (p.status === 'menunggu-bayar') return <span className="tag kuning">Menunggu bayar</span>
  if (p.metode === 'cod') return <span className="tag biru">COD</span>
  if (p.statusPembayaran === 'lunas') return <span className="tag hijau">✓ Lunas{p.verifikasiOtomatis ? ' · auto' : ''}</span>
  return <span className="tag kuning">Menunggu verifikasi</span>
}

/* Server order menyimpan waktu sebagai UTC ('YYYY-MM-DDTHH:MM:SS' tanpa zona).
 * Penampil di sini mengubahnya ke WIB (UTC+7, tanpa DST) agar jam kasir & jam
 * pelanggan konsisten walau perangkat berada di zona waktu lain. */
const pad2 = (n: number) => String(n).padStart(2, '0')
function tsWIB(iso: string): Date {
  const t = String(iso).replace(' ', 'T')
  return new Date(new Date((t.endsWith('Z') ? t : t + 'Z').slice(0, 19)).getTime() + 7 * 3600_000)
}
function jamWIB(iso: string): string {
  const d = tsWIB(iso)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}
function tglWIB(iso: string): string {
  const d = tsWIB(iso)
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}
function tglJamWIB(iso: string): string {
  const d = tsWIB(iso)
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

export default function PapanPesananPage() {
  const [url, setUrl] = useState(() => localStorage.getItem(LS_URL) || ORDER_URL_DEFAULT)
  const [secret, setSecret] = useState(() => localStorage.getItem(LS_SECRET) || '')
  const [daftar, setDaftar] = useState<Pesanan[]>([])
  const [banner, setBanner] = useState('')
  const lastNo = useRef(0)
  const [err, setErr] = useState('')
  const [terhubung, setTerhubung] = useState(false)
  const [balasan, setBalasan] = useState<Record<string, string>>({})

  // modal pengaturan
  const [showPengaturan, setShowPengaturan] = useState(false)
  const [cod, setCod] = useState(false)
  const [t, setT] = useState<Tarif>({ biayaDasar: 5000, perKm: 2000, jarakMaxKm: 7, gratisMin: 50000 })
  const [qrisStatis, setQrisStatis] = useState('')
  const [gwUrl, setGwUrl] = useState('')
  const [gwKey, setGwKey] = useState('')
  const [gwOn, setGwOn] = useState(false)
  const [bridgeSecret, setBridgeSecret] = useState('')
  const [strategi, setStrategi] = useState<'total' | 'unik'>('total')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [simpanMsg, setSimpanMsg] = useState('')

  // modal pelanggan
  const [showPelanggan, setShowPelanggan] = useState(false)
  const [pelanggan, setPelanggan] = useState<Pelanggan[]>([])
  const [qCust, setQCust] = useState('')

  // modal ubah item
  const [editId, setEditId] = useState('')
  const [editQty, setEditQty] = useState<Record<string, Record<number, number>>>({})

  // modal batal / tidak-tersedia
  const [aksiTarget, setAksiTarget] = useState<{ p: Pesanan; aksi: 'batal' | 'tidak-tersedia' } | null>(null)
  const [alasanAksi, setAlasanAksi] = useState('')
  const [hapusTarget, setHapusTarget] = useState<Pesanan | null>(null)

  // modal refund
  const [refundTarget, setRefundTarget] = useState<Pesanan | null>(null)
  const [refundAlasan, setRefundAlasan] = useState('')
  const [refundMetode, setRefundMetode] = useState<'qris' | 'transfer'>('qris')
  const [refundNominal, setRefundNominal] = useState(0)
  const [refundSibuk, setRefundSibuk] = useState(false)

  const ambil = useCallback(async () => {
    try {
      const r = await api(url, '/api/pesan')
      const sorted: Pesanan[] = [...r.pesanan].sort((a, b) => b.no - a.no)
      setDaftar(sorted)
      setTerhubung(true)
      setErr('')
      const maxNo = sorted.length ? Math.max(...sorted.map((p) => p.no)) : 0
      if (!lastNo.current) { lastNo.current = maxNo; return }
      if (maxNo > lastNo.current) {
        lastNo.current = maxNo
        chime()
        if (navigator.vibrate) navigator.vibrate([120, 60, 120])
        const baru = sorted.find((p) => p.no === maxNo)
        if (baru) {
          setBanner(`🔔 Pesanan #${baru.no} masuk — ${baru.status === 'cek' ? 'cek ketersediaan' : 'baru'}`)
          setTimeout(() => setBanner(''), 5000)
        }
      }
    } catch (e) {
      setTerhubung(false)
      setErr(String((e as Error).message))
    }
  }, [url])

  useEffect(() => {
    ambil()
    const t1 = setInterval(ambil, 2500)
    return () => { clearInterval(t1) }
  }, [ambil])

  /* SSE: event realtime dari server order — lunas via QRIS Bridge langsung muncul
   * (suara + banner) tanpa menunggu polling. Pesanan baru juga disegarkan seketika. */
  useEffect(() => {
    if (!url) return
    let es: EventSource | null = null
    try {
      const sseUrl = url.replace(/\/$/, '') + '/api/events' + (secret ? '?sse=' + encodeURIComponent(secret) : '')
      es = new EventSource(sseUrl)
    } catch { return }
    const onLunas = (e: Event) => {
      let d: any = null
      try { d = JSON.parse((e as MessageEvent).data) } catch { return }
      chimeLunas()
      if (navigator.vibrate) navigator.vibrate([200, 60, 200])
      setBanner(`💰 Pesanan #${d.no} lunas otomatis via QRIS Bridge${d.issuer ? ` (${d.issuer})` : ''} — terdeteksi dari HP toko, tanpa menunggu polling.`)
      setTimeout(() => setBanner(''), 7000)
      ambil()
    }
    const onBaru = () => ambil()
    es.addEventListener('lunas-bridge', onLunas)
    es.addEventListener('pesanan-baru', onBaru)
    return () => { es?.close() }
  }, [url, secret, ambil])

  const aksi = async (id: string, a: string, alasan?: string) => {
    await api(url, `/api/pesan/${id}/aksi`, { method: 'POST', body: JSON.stringify({ aksi: a, alasan }) })
    ambil()
  }
  const kirimBalasan = async (id: string) => {
    const teks = (balasan[id] || '').trim()
    if (!teks) return
    await api(url, `/api/pesan/${id}/pesan`, { method: 'POST', body: JSON.stringify({ dari: 'kasir', teks }) })
    setBalasan({ ...balasan, [id]: '' })
    ambil()
  }
  const simpanEdit = async (id: string) => {
    const items = Object.entries(editQty[id] || {}).filter(([, q]) => (q || 0) > 0).map(([pid, q]) => ({ produkId: Number(pid), qty: q }))
    await api(url, `/api/pesan/${id}/ubah`, { method: 'POST', body: JSON.stringify({ items }) })
    setEditId(''); ambil()
  }
  const bukaEdit = (p: Pesanan) => {
    setEditId(p.id)
    setEditQty({ ...editQty, [p.id]: Object.fromEntries(p.items.map((i) => [i.produkId, i.qty])) })
  }
  const hapus = async (id: string) => {
    await api(url, `/api/pesan/${id}`, { method: 'DELETE' })
    setHapusTarget(null)
    ambil()
  }
  const notif = async (hp: string, no: number, teks: string) => {
    await api(url, '/api/push', { method: 'POST', body: JSON.stringify({ hp, title: 'Pesanan #' + no, body: teks }) })
  }
  const cekGateway = async (p: Pesanan) => {
    try {
      const r = await api(url, `/api/pesan/${p.id}/cek-pembayaran`, { method: 'POST', body: '{}' })
      if (r?.lunas) setBanner(`💰 Pesanan #${p.no} lunas — diverifikasi otomatis gateway.`)
      else if (r?.alasan) setBanner(`ℹ️ ${r.alasan}`)
      setTimeout(() => setBanner(''), 4000)
    } catch { /* noop */ }
    ambil()
  }

  const bukaPengaturan = async () => {
    setShowPengaturan(true)
    setSimpanMsg('')
    try {
      const k = await api(url, '/api/pengaturan')
      setCod(k.pengaturan.terimaCOD === true)
      setT(k.pengaturan.tarif)
      setQrisStatis(k.pengaturan.qrisStatis || '')
      setGwUrl(k.pengaturan.gateway?.url || '')
      setGwKey(k.pengaturan.gateway?.apiKey || '')
      setGwOn(!!k.pengaturan.gatewayTerpasang)
      setBridgeSecret(k.pengaturan.bridge?.secret || '')
      setStrategi(k.pengaturan.strategiCocok === 'unik' ? 'unik' : 'total')
      setWebhookUrl(k.pengaturan.webhookUrl || url + '/api/webhook/qris')
    } catch { /* server belum siap */ }
  }
  const simpanPengaturan = async () => {
    try {
      await api(url, '/api/pengaturan', {
        method: 'POST',
        body: JSON.stringify({ terimaCOD: cod, qrisStatis, gateway: { url: gwUrl, apiKey: gwKey }, bridge: { secret: bridgeSecret, strategiCocok: strategi }, tarif: { ...t, gratisMin: t.gratisMin } }),
      })
      setSimpanMsg('✓ Pengaturan disimpan.')
    } catch (e) { setSimpanMsg('✗ ' + String((e as Error).message)) }
  }

  const muatPelanggan = useCallback(async () => {
    try {
      const p = await api(url, '/api/pelanggan?q=' + encodeURIComponent(qCust))
      setPelanggan(p.pelanggan || [])
    } catch { /* noop */ }
  }, [url, qCust])
  useEffect(() => {
    if (showPelanggan) muatPelanggan()
  }, [showPelanggan, muatPelanggan])

  const konfirmasiAksi = async () => {
    if (!aksiTarget) return
    const { p, aksi: a } = aksiTarget
    const alasan = alasanAksi.trim() || (a === 'batal' ? 'dibatalkan kasir' : 'Sebagian menu tidak tersedia — silakan ubah pesanan.')
    await aksi(p.id, a === 'batal' ? 'batal' : 'tidak-tersedia', alasan)
    setAksiTarget(null)
    setAlasanAksi('')
  }

  const bukaRefund = (p: Pesanan) => {
    setRefundTarget(p)
    setRefundAlasan('')
    setRefundMetode(p.metode === 'transfer' ? 'transfer' : 'qris')
    setRefundNominal(p.total)
  }
  const konfirmasiRefund = async () => {
    if (!refundTarget) return
    const p = refundTarget
    setRefundSibuk(true)
    try {
      await api(url, `/api/pesan/${p.id}/aksi`, {
        method: 'POST',
        body: JSON.stringify({ aksi: 'refund', alasan: refundAlasan.trim(), metode: refundMetode, nominal: refundNominal }),
      })
      setBanner(`↩️ Pesanan #${p.no} di-refund — dana ${formatRupiah(refundNominal)} dikembalikan via ${refundMetode === 'transfer' ? 'Transfer bank' : 'QRIS'} (manual).`)
      setTimeout(() => setBanner(''), 6000)
      setRefundTarget(null)
      ambil()
    } catch (e) {
      setBanner('✗ ' + String((e as Error).message))
      setTimeout(() => setBanner(''), 5000)
    } finally {
      setRefundSibuk(false)
    }
  }

  const gantiUrl = (v: string) => { setUrl(v); localStorage.setItem(LS_URL, v); lastNo.current = 0 }
  const gantiSecret = (v: string) => { setSecret(v); if (v) localStorage.setItem(LS_SECRET, v); else localStorage.removeItem(LS_SECRET) }

  const berjalan = daftar.filter((p) => p.status !== 'selesai' && p.status !== 'batal').length

  return (
    <div className="page papan">
      <div className="dhead">
        <div>
          <h1>Papan Pesanan Antar</h1>
          <div className="sub2">{terhubung ? 'Terhubung ke server order' : 'Server order belum terhubung'} · {url}</div>
        </div>
        <span className="sp2" style={{ flex: 1 }} />
        <span className={`stat ${terhubung ? 'on' : 'off'}`}>{terhubung ? 'online' : 'offline'}</span>
      </div>

      <div className="papan-tool">
        <div className="search" style={{ maxWidth: 300 }}>
          <span>🔗</span>
          <input value={url} onChange={(e) => gantiUrl(e.target.value)} placeholder="http://127.0.0.1:5198" />
        </div>
        <div className="search" style={{ maxWidth: 260 }} title="Kredensial kasir (X-Kasir-Secret) — wajib bila server dijalankan dengan env KASIR_SECRET">
          <span>🔑</span>
          <input type="password" value={secret} onChange={(e) => gantiSecret(e.target.value)} placeholder="secret kasir (opsional di dev)" autoComplete="off" />
        </div>
        <button className="btn-outline sm" onClick={() => { lastNo.current = 0; ambil() }}>Tarik sekarang</button>
        <span className="sp2" style={{ flex: 1 }} />
        <button className="btn-outline sm" onClick={bukaPengaturan}>⚙️ Pengaturan</button>
        <button className="btn-outline sm" onClick={() => setShowPelanggan(true)}>📇 Pelanggan</button>
      </div>

      {banner && <div className="nbanner papan-banner">{banner}</div>}
      {err && !terhubung && <div className="errbox" style={{ marginBottom: 10 }}>Server order tak terjangkau: {err}</div>}

      <div className="papan-list">
        <div className="dhead" style={{ marginBottom: 8 }}>
          <h2>Pesanan</h2>
          <span className="sp2" style={{ flex: 1 }} />
          <span className="stat on">{berjalan} berjalan</span>
        </div>
        {daftar.length === 0 && <div className="note">Belum ada pesanan — buka portal customer lalu pesan.</div>}
        {daftar.map((p) => (
          <div key={p.id} className="panel papan-card">
            <div className="papan-card-head">
              <b>#{p.no} · {p.nama}</b>
              {pill(p)}
            </div>
            <div className="papan-card-body">
              <b>{LABEL_STATUS[p.status] || p.status}</b> · {p.items.map((i) => (i.qty > 1 ? i.qty + '× ' : '') + i.nama).join(', ')} · {formatRupiah(p.total)}
              <br />{p.alamat} · {p.jarakKm.toLocaleString('id-ID')} km · ongkir {formatRupiah(p.ongkir)}
              {p.catatan && <><br />📝 <b>{p.catatan}</b></>}
              {p.buktiNama && <><br />🧾 bukti: {p.buktiNama}</>}
              {p.nominalUnik && <div className="muted" style={{ marginTop: 4 }}>💳 nominal QR unik: {formatRupiah(p.nominalUnik)}</div>}
              {p.verifikasiOtomatis && <div className="muted" style={{ marginTop: 4 }}>⚡ Lunas diverifikasi otomatis {p.sumberVerifikasi === 'qris-bridge' ? 'QRIS Bridge (notifikasi HP toko)' : 'gateway'}{p.issuer ? ` (${p.issuer})` : ''}</div>}
              {p.refund && <div className="muted" style={{ marginTop: 4, color: 'var(--danger)' }}>↩️ Dana {formatRupiah(p.refund.nominal)} dikembalikan via {p.refund.metode === 'transfer' ? 'Transfer bank' : 'QRIS'} · {tglJamWIB(p.refund.waktu)} WIB{p.refund.alasan ? ` — ${p.refund.alasan}` : ''}{p.refund.transaksiId ? ` · tx ${p.refund.transaksiId}` : ''}</div>}
              {p.alasanBatal && <div style={{ color: 'var(--danger)', marginTop: 4 }}>Batal: {p.alasanBatal}</div>}
            </div>

            {p.pesan.length > 0 && (
              <div className="papan-chat">
                {p.pesan.map((m, i) => (
                  <div key={i} className={`bubble ${m.dari === 'kasir' ? 'kasir' : 'cust'}`}>
                    <div>{m.teks}</div>
                    <div className="bw">{jamWIB(m.waktu)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="papan-reply">
              <input value={balasan[p.id] || ''} onChange={(e) => setBalasan({ ...balasan, [p.id]: e.target.value })}
                placeholder="Balas pelanggan…" />
              <button className="btn-outline sm" disabled={!(balasan[p.id] || '').trim()} onClick={() => kirimBalasan(p.id)}>Kirim</button>
            </div>

            {p.status !== 'batal' && p.status !== 'selesai' && (
              <div className="papan-actions">
                {p.status === 'cek' && <button className="btn-primary sm" onClick={() => aksi(p.id, 'tersedia')}>✓ Tersedia — kirim QR bayar</button>}
                {p.status === 'cek' && <button className="btn-danger sm" onClick={() => { setAksiTarget({ p, aksi: 'tidak-tersedia' }); setAlasanAksi('') }}>✗ Tidak tersedia</button>}
                {p.status === 'menunggu-bayar' && <span className="tag kuning">Menunggu bayar pelanggan</span>}
                {p.status === 'baru' && p.metode !== 'cod' && p.statusPembayaran === 'menunggu-verifikasi' && (
                  <>
                    <button className="btn-primary sm" onClick={() => aksi(p.id, 'verifikasi')}>✓ Verifikasi bayar</button>
                    <button className="btn-outline sm" onClick={() => cekGateway(p)}>🔍 Cek gateway</button>
                    <button className="btn-outline sm" onClick={() => api(url, `/api/pesan/${p.id}/qris-callback`, { method: 'POST', body: '{}' }).then(ambil)}>💰 Simulasi callback</button>
                  </>
                )}
                {p.status === 'baru' && (p.metode === 'cod' || p.statusPembayaran === 'lunas') && (
                  <button className="btn-primary sm" onClick={() => aksi(p.id, 'terima')}>Terima → dapur</button>)}
                {p.status === 'dibuat' && <button className="btn-outline sm" onClick={() => aksi(p.id, 'siap')}>Siap</button>}
                {p.status === 'siap' && <button className="btn-outline sm" onClick={() => aksi(p.id, 'diantar')}>Antarkan</button>}
                {p.status === 'diantar' && <button className="btn-primary sm" onClick={() => aksi(p.id, 'selesai')}>Selesai</button>}
                {p.statusPembayaran === 'lunas' && p.metode && p.metode !== 'cod' && !p.refund && (
                  <button className="btn-danger sm" onClick={() => bukaRefund(p)}>↩️ Refund</button>)}
                <span className="papan-sep" />
                {(p.status === 'cek' || p.status === 'menunggu-bayar') && (
                  <button className="btn-outline sm" onClick={() => bukaEdit(p)}>Ubah item</button>)}
                <button className="btn-outline sm" onClick={() => notif(p.hp, p.no, `Status: ${LABEL_STATUS[p.status] || p.status} — pantau di portal.`)}>🔔 Notif</button>
                <button className="btn-outline sm" onClick={() => { setAksiTarget({ p, aksi: 'batal' }); setAlasanAksi('') }}>Batal</button>
                <button className="btn-danger sm" onClick={() => setHapusTarget(p)}>Hapus</button>
              </div>
            )}
            {/* pesanan selesai/batal yang sudah lunas: refund tetap tersedia */}
            {(p.status === 'selesai' || p.status === 'batal') && p.statusPembayaran === 'lunas' && p.metode && p.metode !== 'cod' && !p.refund && (
              <div className="papan-actions">
                <button className="btn-danger sm" onClick={() => bukaRefund(p)}>↩️ Refund dana ({formatRupiah(p.total)})</button>
                <span className="muted">Dana QRIS/transfer dikembalikan manual ke pelanggan — tercatat sebagai audit.</span>
              </div>
            )}
            {p.penilaian && <div className="note" style={{ marginTop: 8 }}>⭐ {p.penilaian.rating}/5{p.penilaian.komentar ? ` — ${p.penilaian.komentar}` : ''}</div>}
          </div>
        ))}
      </div>

      {/* ===== modal pengaturan ===== */}
      {showPengaturan && (
        <div className="km-overlay">
          <div className="km" role="dialog" aria-modal="true" aria-label="Pengaturan antar" tabIndex={-1} style={{ maxWidth: 520 }}>
            <h3>⚙️ Pengaturan antar</h3>
            <p className="sub">Berlaku langsung di portal customer — tidak perlu restart.</p>

            <label className="chk"><input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} />
              <b>Terima COD</b> — nonaktif = pelanggan hanya QRIS/transfer (anti-scam).</label>

            <div className="km-sec">
              <p className="km-lbl">Ongkos kirim</p>
              <div className="km-grid2">
                <div className="field"><label>Biaya dasar</label>
                  <input type="number" value={t.biayaDasar} onChange={(e) => setT({ ...t, biayaDasar: Number(e.target.value) })} /></div>
                <div className="field"><label>Tarif per km</label>
                  <input type="number" value={t.perKm} onChange={(e) => setT({ ...t, perKm: Number(e.target.value) })} /></div>
                <div className="field"><label>Jarak maks (km)</label>
                  <input type="number" value={t.jarakMaxKm} onChange={(e) => setT({ ...t, jarakMaxKm: Number(e.target.value) })} /></div>
                <div className="field"><label>Gratis ongkir ≥ (0 = mati)</label>
                  <input type="number" value={t.gratisMin ?? 0} onChange={(e) => setT({ ...t, gratisMin: Number(e.target.value) || null })} /></div>
              </div>
            </div>

            <div className="km-sec">
              <p className="km-lbl">QRIS dinamis (nominal terkunci)</p>
              <div className="field"><label>String QRIS statis toko</label>
                <textarea value={qrisStatis} onChange={(e) => setQrisStatis(e.target.value)} placeholder="0002010102112657…" /></div>
            </div>

            <div className="km-sec">
              <p className="km-lbl">QRIS Bridge (rekomendasi — verifikasi dari HP toko)</p>
              <div className="field"><label>URL webhook — tempel di app qrishook (Android)</label>
                <input readOnly value={webhookUrl} onClick={(e) => (e.target as HTMLInputElement).select()} /></div>
              <div className="field" style={{ marginTop: 8 }}><label>Secret (opsional — wajib sama dengan di qrishook)</label>
                <input value={bridgeSecret} onChange={(e) => setBridgeSecret(e.target.value)} placeholder="mis. rahasia-sabana" /></div>
              <p className="km-lbl" style={{ marginTop: 10 }}>Strategi pencocokan pembayaran</p>
              <label className="chk"><input type="radio" name="strategi" checked={strategi === 'total'}
                onChange={() => setStrategi('total')} />
                <b>Total pas + jendela waktu (default)</b> — pelanggan bayar nominal pesanan yang sama persis;
                penanda unik (total + Rp1–200) hanya dibuat otomatis bila ada pesanan lain senominal dalam ±10 menit.</label>
              <label className="chk"><input type="radio" name="strategi" checked={strategi === 'unik'}
                onChange={() => setStrategi('unik')} />
                <b>Selalu penanda unik</b> — tiap QR memakai total + Rp1–200 agar pencocokan pasti, tapi pelanggan
                membayar sedikit lebih besar.</label>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                Pasang app <b>qrishook</b> (MIT, repo <b>suriyadi15/qrishook</b>) di HP toko → izinkan akses notifikasi →
                isi URL webhook + secret di atas. Setiap notifikasi QRIS masuk diteruskan ke server, dicocokkan sesuai
                strategi di atas, dan status langsung <b>Lunas otomatis</b> tanpa upload bukti — papan berbunyi &
                banner “💰 lunas via QRIS Bridge” seketika. Kosongkan secret = fitur mati (verifikasi manual).
              </p>
            </div>

            <div className="km-sec">
              <p className="km-lbl">Gateway ShopeePay (alternatif, opsional)</p>
              <label className="chk"><input type="checkbox" checked={gwOn} onChange={(e) => setGwOn(e.target.checked)} />
                <b>Gateway aktif</b> — polling otomatis tiap 20 dtk, tanpa upload bukti.</label>
              <div className="km-grid2" style={{ marginTop: 8 }}>
                <div className="field"><label>URL gateway</label>
                  <input value={gwUrl} onChange={(e) => setGwUrl(e.target.value)} placeholder="http://localhost:3001" /></div>
                <div className="field"><label>X-API-Key</label>
                  <input value={gwKey} onChange={(e) => setGwKey(e.target.value)} placeholder="shopee-secret-key" /></div>
              </div>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                Repo <b>shoppepay-api-gateway</b> (unofficial, tanpa lisensi — hanya untuk uji): verifikasi via
                <code>/check-payment</code> dengan amount + waktu order; transaksiId di-dedup anti-klaim dobel.
                Kosongkan URL = verifikasi manual bukti oleh kasir.
              </p>
            </div>

            {simpanMsg && <div className={`form-note ${simpanMsg.startsWith('✓') ? 'ok' : 'err'}`}>{simpanMsg}</div>}

            <div className="km-buttons">
              <button className="primary" onClick={simpanPengaturan}>Simpan pengaturan</button>
              <button className="ghost" onClick={() => setShowPengaturan(false)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== modal pelanggan ===== */}
      {showPelanggan && (
        <div className="km-overlay">
          <div className="km" role="dialog" aria-modal="true" aria-label="Database pelanggan" tabIndex={-1} style={{ maxWidth: 480 }}>
            <h3>📇 Database pelanggan</h3>
            <p className="sub">Nama, nomor & alamat terakhir tersimpan otomatis — repeat order tanpa ketik ulang.</p>
            <div className="search" style={{ marginBottom: 10 }}>
              <span>🔎</span>
              <input value={qCust} onChange={(e) => setQCust(e.target.value)} placeholder="cari nama / HP" />
            </div>
            {pelanggan.length === 0 && <div className="note">Belum ada pelanggan terdaftar.</div>}
            {pelanggan.map((p) => (
              <div key={p.hp} className="km-pelanggan">
                <div>
                  <b>{p.nama || '(tanpa nama)'}</b> · {p.hp}
                  {p.alamatTerakhir && <div className="muted">{p.alamatTerakhir}</div>}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {p.jumlahPesanan} pesanan · {formatRupiah(p.total || 0)} · ⭐ {p.ratingRata ?? '—'}
                  {p.terakhirPesan ? ` · terakhir ${tglWIB(p.terakhirPesan)}` : ''}
                </div>
              </div>
            ))}
            <div className="km-buttons">
              <button className="ghost" style={{ flex: 1 }} onClick={() => setShowPelanggan(false)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== modal ubah item ===== */}
      {editId && (() => {
        const p = daftar.find((x) => x.id === editId)
        if (!p) return null
        return (
          <div className="km-overlay">
            <div className="km" role="dialog" aria-modal="true" aria-label="Ubah item" tabIndex={-1} style={{ maxWidth: 460 }}>
              <h3>Ubah item — #{p.no}</h3>
              <p className="sub">Setel ulang jumlah; item dengan jumlah 0 dihapus. Total dihitung ulang otomatis.</p>
              <div className="km-grid2" style={{ marginTop: 10 }}>
                {p.items.map((i) => (
                  <div key={i.produkId} className="field">
                    <label>{i.nama}</label>
                    <input type="number" min={0} value={editQty[p.id]?.[i.produkId] ?? i.qty}
                      onChange={(e) => setEditQty({ ...editQty, [p.id]: { ...(editQty[p.id] || {}), [i.produkId]: Number(e.target.value) } })} />
                  </div>
                ))}
              </div>
              <div className="km-buttons">
                <button className="primary" onClick={() => simpanEdit(p.id)}>Simpan ubah</button>
                <button className="ghost" onClick={() => setEditId('')}>Tutup</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ===== modal refund ===== */}
      {refundTarget && (
        <div className="km-overlay">
          <div className="km" role="dialog" aria-modal="true" aria-label="Refund pesanan" tabIndex={-1} style={{ maxWidth: 460 }}>
            <h3>↩️ Refund dana — #{refundTarget.no}</h3>
            <p className="sub">Pelanggan sudah bayar <b>{formatRupiah(refundTarget.total)}</b> via {refundTarget.metode === 'transfer' ? 'Transfer bank' : 'QRIS'}. Dana dikembalikan <b>manual</b> oleh Anda — semua tercatat sebagai jejak audit.</p>
            <div className="km-sec">
              <p className="km-lbl">Pengembalian</p>
              <div className="km-grid2">
                <div className="field"><label>Via</label>
                  <select value={refundMetode} onChange={(e) => setRefundMetode(e.target.value === 'transfer' ? 'transfer' : 'qris')}>
                    <option value="qris">QRIS</option>
                    <option value="transfer">Transfer bank</option>
                  </select></div>
                <div className="field"><label>Nominal (maks {formatRupiah(refundTarget.total)})</label>
                  <input type="number" min={0} max={refundTarget.total} value={refundNominal}
                    onChange={(e) => setRefundNominal(Math.min(refundTarget.total, Math.max(0, Number(e.target.value) || 0)))} /></div>
              </div>
              <div className="field" style={{ marginTop: 8 }}><label>Alasan refund (tampil di chat pelanggan)</label>
                <input value={refundAlasan} onChange={(e) => setRefundAlasan(e.target.value)}
                  placeholder="mis. pesanan tidak jadi, komplain pelanggan" autoFocus /></div>
            </div>
            <div className="errbox" style={{ marginBottom: 10 }}>⚠️ Pastikan dana <b>{formatRupiah(refundNominal)}</b> sudah benar-benar Anda kembalikan sebelum konfirmasi.</div>
            <div className="km-buttons">
              <button className="danger" disabled={refundSibuk || refundNominal <= 0} onClick={konfirmasiRefund}>
                {refundSibuk ? 'Memproses…' : 'Konfirmasi refund'}</button>
              <button className="ghost" disabled={refundSibuk} onClick={() => setRefundTarget(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== modal batal / tidak tersedia ===== */}
      {aksiTarget && (
        <div className="km-overlay">
          <div className="km" role="dialog" aria-modal="true" aria-label="Konfirmasi aksi" tabIndex={-1} style={{ maxWidth: 420 }}>
            <h3>{aksiTarget.aksi === 'batal' ? `Batal pesanan #${aksiTarget.p.no}?` : `Tidak tersedia — #${aksiTarget.p.no}`}</h3>
            <p className="sub">Alasan dikirim ke pelanggan lewat chat.</p>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Alasan</label>
              <input value={alasanAksi} onChange={(e) => setAlasanAksi(e.target.value)}
                placeholder={aksiTarget.aksi === 'batal' ? 'mis. kehabisan bahan, ditutup' : 'mis. ayam dada habis'} autoFocus />
            </div>
            <div className="km-buttons">
              <button className={aksiTarget.aksi === 'batal' ? 'danger' : 'primary'} onClick={konfirmasiAksi}>Kirim ke pelanggan</button>
              <button className="ghost" onClick={() => setAksiTarget(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== konfirmasi hapus ===== */}
      <ConfirmDialog
        buka={!!hapusTarget}
        judul={hapusTarget ? `Hapus pesanan #${hapusTarget.no}?` : ''}
        pesan={<>Pesanan <b>{hapusTarget?.nama}</b> akan dihapus permanen dari papan — tidak bisa dikembalikan.</>}
        labelKonfirmasi="Ya, hapus"
        onKonfirmasi={() => hapusTarget && hapus(hapusTarget.id)}
        onBatal={() => setHapusTarget(null)}
      />
    </div>
  )
}