#!/usr/bin/env node
/**
 * Server order delivery mandiri — portal customer (prototipe backend ringan).
 *
 * Node + web-push (satu-satunya dependensi). Katalog dari snapshot kasir:
 * web-order/katalog-snapshot.json. Data di server/data/orders.json.
 *
 * Fitur:
 *  - Login pelanggan: cukup nomor HP → token sesi (riwayat lintas perangkat).
 *    Nama & alamat terakhir tersimpan di database pelanggan → repeat order
 *    tidak perlu mengetik ulang (profil dikirim saat login).
 *  - Database pelanggan: { hp, nama, alamatTerakhir, jumlahPesanan, total, terakhirPesan, ratingRata }.
 *  - Pesanan draft + chat cek ketersediaan: pelanggan kirim draft & pesan → kasir
 *    cek stok, balas "tersedia" (→ pelanggan bisa bayar, QR muncul) atau tidak;
 *    kasir juga bisa ubah item / hapus pesanan.
 *  - Catatan pesanan (mis. "tanpa sambal").
 *  - Pengaturan tidak hardcode: terimaCOD + tarif ongkir + QRIS gateway, diubah kasir.
 *  - QRIS: nominal terkunci dari string statis toko + verifikasi otomatis opsional
 *    via gateway ShopeePay (repo shoppepay-api-gateway — layanan eksternal sendiri,
 *    endpoint /create-qris & /check-payment, header X-API-Key). Bila gateway tidak
 *    dikonfigurasi, verifikasi manual kasir (bukti) tetap berlaku.
 *  - Push notifikasi ke pelanggan (web-push, VAPID auto-generated).
 *
 * Endpoint:
 *   GET  /api/katalog /api/pengaturan /api/pelanggan /api/vapid
 *   POST /api/pengaturan  POST /api/auth/login   GET /api/auth/me?token=
 *   POST /api/pesan (draft)  GET /api/pesan?token=  GET /api/pesan/:id
 *   POST /api/pesan/:id/pesan   POST /api/pesan/:id/aksi
 *   POST /api/pesan/:id/ubah    POST /api/pesan/:id/bayar
 *   POST /api/pesan/:id/cek-pembayaran   POST /api/pesan/:id/qris-callback
 *   DELETE /api/pesan/:id       POST /api/pesan/:id/penilaian
 *   POST /api/webhook/qris (QRIS Bridge — qrishook)   GET /api/events (SSE papan kasir)
 *   POST /api/subscribe         POST /api/push
 *
 *  Aksi kasir (POST /api/pesan/:id/aksi): terima/dibuat/siap/diantar/selesai,
 *  tersedia / tidak-tersedia / verifikasi / batal / hapus / **refund**.
 *  Refund → statusPembayaran 'refund' + jejak audit di { refund, riwayat }; total
 *  belanja pelanggan di database pelanggan otomatis dikurangi (ringkasan Finansial);
 *  dana QRIS/transfer dikembalikan manual oleh kasir.
 *
 *  Strategi pencocokan pembayaran QRIS Bridge (pengaturan.bridge.strategiCocok):
 *   - 'total' (default) — pelanggan bayar nominal pas; penanda unik (total + Rp1–200)
 *     hanya dibuat otomatis bila ada pesanan lain senominal yang masih aktif
 *     dalam jendela ±10 menit (mencegah webhook salah mencocokkan).
 *   - 'unik' — selalu pakai penanda unik.
 *
 * Jalankan:  PORT=5198 node server/order.mjs
 */

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import webpush from 'web-push'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 5198)
const KATALOG_FILE = process.env.KATALOG_FILE || join(__dirname, '..', 'web-order', 'katalog-snapshot.json')
const ORDERS_FILE = process.env.ORDERS_FILE || join(__dirname, 'data', 'orders.json')

/* ---------- keamanan: kredensial kasir + CORS allowlist ---------- */
/* KASIR_SECRET (env) wajib diisi saat deploy — endpoint manajemen kasir menolak
 * tanpa header X-Kasir-Secret. Kosong = mode dev (terbuka, dengan peringatan). */
const KASIR_SECRET = (process.env.KASIR_SECRET || '').trim()
/* CORS_ORIGIN: daftar origin (dipisah koma) yang boleh dipanggil browser, mis.
 * https://pesan.sabana.id. Kosong = izinkan localhost/127.0.0.1 (dev) saja. */
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)

function izinkanOrigin(req) {
  const o = req.headers.origin
  if (!o) return null // bukan browser / same-origin — tidak butuh ACAO
  if (CORS_ORIGIN.length) return CORS_ORIGIN.includes(o) ? o : null
  try {
    const h = new URL(o).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' ? o : null
  } catch { return null }
}
function samaSecret(a, b) {
  const A = Buffer.from(String(a ?? '')), B = Buffer.from(String(b ?? ''))
  return A.length === B.length && timingSafeEqual(A, B)
}
function kasirSah(req) {
  if (!KASIR_SECRET) return true // mode dev — tanpa proteksi
  return samaSecret(req.headers['x-kasir-secret'], KASIR_SECRET)
}
function butuhKasir(req, res) {
  if (kasirSah(req)) return true
  json(res, 401, { ok: false, alasan: 'Kredensial kasir tidak valid.' })
  return false
}
/* sesi login dibatasi per HP (brute-force) — 6 percobaan / menit */
const loginCoba = new Map()

function muatKatalog() {
  if (!existsSync(KATALOG_FILE)) return null
  try { return JSON.parse(readFileSync(KATALOG_FILE, 'utf8')) } catch { return null }
}

/* ---------- store: { orders, pengaturan, pelanggan, sesi, subs, vapid } ---------- */
function muatStore() {
  if (!existsSync(ORDERS_FILE)) {
    return { orders: [], pengaturan: {}, pelanggan: {}, sesi: {}, subs: {}, vapid: {}, webhook: {} }
  }
  try {
    const raw = JSON.parse(readFileSync(ORDERS_FILE, 'utf8'))
    if (Array.isArray(raw)) return { orders: raw, pengaturan: {}, pelanggan: {}, sesi: {}, subs: {}, vapid: {}, webhook: {} }
    return {
      orders: Array.isArray(raw.orders) ? raw.orders : [],
      pengaturan: raw.pengaturan || {},
      pelanggan: raw.pelanggan || {},
      otp: raw.otp || {},        // legacy — tidak dipakai lagi (login via HP saja)
      sesi: raw.sesi || {},
      subs: raw.subs || {},
      vapid: raw.vapid || {},
      webhook: raw.webhook || {}, // dedup event_id dari qrishook
    }
  } catch {
    return { orders: [], pengaturan: {}, pelanggan: {}, sesi: {}, subs: {}, vapid: {}, webhook: {} }
  }
}
function simpanStore(s) {
  mkdirSync(dirname(ORDERS_FILE), { recursive: true })
  writeFileSync(ORDERS_FILE, JSON.stringify(s, null, 2))
}

/* ---------- VAPID (auto-generate sekali) ---------- */
function pastikanVapid(store) {
  if (store.vapid && store.vapid.publicKey && store.vapid.privateKey) return
  const k = webpush.generateVAPIDKeys()
  store.vapid = { publicKey: k.publicKey, privateKey: k.privateKey }
  simpanStore(store)
}
function konfigPush(store) {
  pastikanVapid(store)
  webpush.setVapidDetails('mailto:owner@sabana.id', store.vapid.publicKey, store.vapid.privateKey)
}

function json(res, kode, obj) {
  const s = JSON.stringify(obj)
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Kasir-Secret',
    'Content-Length': Buffer.byteLength(s),
  }
  if (res.kasirOrigin) h['Access-Control-Allow-Origin'] = res.kasirOrigin
  res.writeHead(kode, h)
  res.end(s)
}
function baca(req) {
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => {
      d += c
      if (d.length > 2_000_000) { reject(new Error('payload terlalu besar')); req.destroy() }
    })
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })
}

const rupiah = (n) => Math.round(n / 100) * 100
const nowISO = () => new Date().toISOString().slice(0, 19) // UTC — semua waktu tersimpan konsisten
/* nowISO() memakai UTC; parse ulang sebagai UTC (akhiran 'Z') supaya selisih waktu benar. */
const tsUTC = (s) => { const t = String(s).replace(' ', 'T'); return new Date(t.endsWith('Z') ? t : t + 'Z').getTime() }

/* ---------- PIN pelanggan (register) — scrypt + salt acak per pelanggan ---------- */
const pinValid = (pin) => /^\d{4,6}$/.test(String(pin || ''))
function buatPinHash(pin) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(String(pin), salt, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}
function cekPinHash(pin, tersimpan) {
  if (!tersimpan || typeof tersimpan !== 'string') return false
  const [algo, salt, hash] = tersimpan.split('$')
  if (algo !== 'scrypt' || !salt || !hash) return false
  try {
    const calc = scryptSync(String(pin), salt, 32)
    return timingSafeEqual(calc, Buffer.from(hash, 'hex'))
  } catch { return false }
}

/* jarak haversine (km) — dipakai verifikasi ongkir server-side dari koordinat pelanggan */
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function tarifEfektif(katalog, pengaturan) {
  const def = katalog.tarif || {}
  const o = pengaturan.tarif || {}
  return {
    biayaDasar: Number(o.biayaDasar ?? def.biayaDasar ?? 5000),
    perKm: Number(o.perKm ?? def.perKm ?? 2000),
    jarakMaxKm: Number(o.jarakMaxKm ?? def.jarakMaxKm ?? 7),
    gratisMin: o.gratisMin === null ? null : Number(o.gratisMin ?? def.gratisMin ?? null),
  }
}
function ongkir(tarif, subtotal, jarakKm) {
  if (tarif.gratisMin && subtotal >= tarif.gratisMin) return { ongkir: 0, gratis: true }
  return { ongkir: rupiah(tarif.biayaDasar + tarif.perKm * jarakKm), gratis: false }
}

/* ---------- strategi pencocokan pembayaran (QRIS Bridge) ---------- */
const JENDELA_BAYAR_MS = 10 * 60 * 1000 // total pas dicocokkan dalam ±10 mnt sejak kasir nyatakan 'Tersedia'

/* pesanan yang pembayarannya masih mungkin dicocokkan otomatis (belum Lunas/refund) */
const aktifBayar = (o) =>
  (o.status === 'menunggu-bayar' || (o.status === 'baru' && o.statusPembayaran === 'menunggu-verifikasi'))
  && o.statusPembayaran !== 'refund'
const mulaiBayar = (o) => tsUTC(o.rentangBayar || o.waktuBuat)

/* penanda unik (total + suffix 001-200) agar webhook QRIS Bridge bisa mencocokkan pesanan
 * secara pasti. Dipilih supaya TIDAK bentrok dengan target nominal pesanan aktif lain
 * (baik penanda milik pesanan lain maupun total pas pesanan lain). */
function buatNominalUnik(orders, total) {
  const dipakai = new Set(orders.filter(aktifBayar).map((o) => o.nominalUnik || o.total))
  for (let i = 1; i <= 200; i++) {
    const n = total + i
    if (!dipakai.has(n)) return n
  }
  return total // 200 slot penuh — fallback nominal persis
}

/* 'mati' | 'total' | 'unik' */
function strategiBridge(pengaturan) {
  const b = pengaturan.bridge
  if (!b || !b.secret) return 'mati'
  return b.strategiCocok === 'unik' ? 'unik' : 'total'
}

/* Nominal yang wajib dibayar pelanggan. Strategi 'total' (default): nominal pas —
 * penanda unik hanya bila ada pesanan LAIN senominal yang masih aktif dalam jendela
 * ±10 mnt (dua pesanan nominal sama berdekatan), supaya webhook tidak salah cocok.
 * Strategi 'unik': selalu penanda unik. Tanpa bridge: nominal pas tanpa penanda. */
function nominalBayar(store, order) {
  const s = strategiBridge(store.pengaturan)
  if (s === 'mati') return undefined
  if (s === 'unik') return buatNominalUnik(store.orders, order.total)
  const tabrakan = store.orders.some((c) =>
    c.id !== order.id && aktifBayar(c) && !c.nominalUnik && c.total === order.total
    && Math.abs(mulaiBayar(c) - mulaiBayar(order)) < JENDELA_BAYAR_MS,
  )
  return tabrakan ? buatNominalUnik(store.orders, order.total) : undefined
}

/* ---------- SSE: event realtime ke papan kasir (tanpa menunggu polling) ---------- */
const klienSSE = new Set()
function kirimSSE(ev, data) {
  const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`
  for (const r of [...klienSSE]) {
    try { r.write(s) } catch { klienSSE.delete(r) }
  }
}
function upsertPelanggan(store, hp, nama, alamat) {
  const p = store.pelanggan[hp] || { hp, nama: nama || '', dibuat: nowISO(), jumlahPesanan: 0, total: 0, terakhirPesan: null, ratingRata: null, alamatTerakhir: undefined }
  if (nama) p.nama = nama
  if (alamat) p.alamatTerakhir = alamat
  store.pelanggan[hp] = p
  return p
}
function profilPelanggan(p) {
  return {
    nama: p?.nama || '',
    jumlahPesanan: p?.jumlahPesanan || 0,
    total: p?.total || 0,
    ratingRata: p?.ratingRata ?? null,
    alamatTerakhir: p?.alamatTerakhir || undefined,
    terakhirPesan: p?.terakhirPesan || null,
  }
}

/* verifikasi otomatis via gateway ShopeePay (repo shoppepay-api-gateway, layanan eksternal).
 * Dipakai oleh endpoint /cek-pembayaran DAN polling otomatis server. */
async function cekGatewayPembayaran(store, order) {
  const g = (store.pengaturan || {}).gateway
  if (!g || !g.url) return { lunas: false, alasan: 'Gateway belum dikonfigurasi — verifikasi manual oleh kasir.' }
  if (order.metode !== 'qris' && order.metode !== 'transfer') return { lunas: false, alasan: 'Bukan pembayaran QRIS/transfer.' }
  if (order.statusPembayaran !== 'menunggu-verifikasi') return { lunas: false }
  try {
    const cek = await fetch(g.url + '/check-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(g.apiKey ? { 'X-API-Key': g.apiKey } : {}) },
      body: JSON.stringify({ amount: order.nominalUnik || order.total, startTime: Math.floor(tsUTC(order.waktuBuat) / 1000) }),
      signal: AbortSignal.timeout(12000),
    })
    const data = await cek.json()
    if (data && data.paid === true && data.transaction) {
      const tx = String(data.transaction.transactionId || '')
      const sudahDiklaim = tx && store.orders.some((o) => o.transaksiId && o.transaksiId === tx && o.id !== order.id)
      if (sudahDiklaim) return { lunas: false, alasan: 'Transaksi sudah diklaim pesanan lain (dedup anti-dobel).' }
      order.statusPembayaran = 'lunas'
      order.transaksiId = tx || undefined
      order.issuer = data.transaction.issuer || undefined
      order.verifikasiOtomatis = true
      order.riwayat.push({ status: 'verifikasi', waktu: nowISO() })
      return { lunas: true, issuer: order.issuer || null }
    }
    return { lunas: false }
  } catch {
    return { lunas: false, alasan: 'Gateway tidak merespons.' }
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'OPTIONS') {
    const h = { 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Kasir-Secret' }
    const o = izinkanOrigin(req)
    if (o) h['Access-Control-Allow-Origin'] = o
    res.writeHead(204, h)
    return res.end()
  }
  res.kasirOrigin = izinkanOrigin(req)

  /* ---------- SSE: papan kasir menerima event realtime (lunas bridge dll.) ---------- */
  if (url.pathname === '/api/events' && req.method === 'GET') {
    if (KASIR_SECRET && !samaSecret(url.searchParams.get('sse'), KASIR_SECRET)) {
      return json(res, 401, { ok: false, alasan: 'Token SSE tidak valid.' })
    }
    const h = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
    const o = izinkanOrigin(req)
    if (o) h['Access-Control-Allow-Origin'] = o
    res.writeHead(200, h)
    res.write('retry: 2000\n\n')
    klienSSE.add(res)
    const hb = setInterval(() => { try { res.write(': hb\n\n') } catch { /* tutup */ } }, 15000)
    req.on('close', () => { clearInterval(hb); klienSSE.delete(res) })
    return
  }

  const katalog = muatKatalog()
  const store = muatStore()
  const { orders, pengaturan } = store
  const terimaCOD = pengaturan.terimaCOD === true
  const tarif = katalog ? tarifEfektif(katalog, pengaturan) : null
  konfigPush(store)

  /* ---------- katalog & pengaturan ---------- */
  if (url.pathname === '/api/katalog' && req.method === 'GET') {
    if (!katalog) return json(res, 503, { ok: false, alasan: 'Snapshot katalog belum ada.' })
    return json(res, 200, { ok: true, katalog: { ...katalog, tarif, terimaCOD, qrisStatis: pengaturan.qrisStatis, gatewayTerpasang: !!(pengaturan.gateway && pengaturan.gateway.url), bridgeAktif: !!(pengaturan.bridge && pengaturan.bridge.secret), webhookUrl: `http://${req.headers.host || 'localhost:' + PORT}/api/webhook/qris` } })
  }
  if (url.pathname === '/api/pengaturan' && req.method === 'GET') {
    if (!butuhKasir(req, res)) return
    const b = pengaturan.bridge || {}
    return json(res, 200, { ok: true, pengaturan: { terimaCOD, qrisStatis: pengaturan.qrisStatis, tarif, gateway: pengaturan.gateway || {}, gatewayTerpasang: !!(pengaturan.gateway && pengaturan.gateway.url), bridge: b, bridgeAktif: !!(b && b.secret), strategiCocok: b.strategiCocok === 'unik' ? 'unik' : 'total', webhookUrl: `http://${req.headers.host || 'localhost:' + PORT}/api/webhook/qris` } })
  }
  if (url.pathname === '/api/pengaturan' && req.method === 'POST') {
    if (!butuhKasir(req, res)) return
    let body = {}
    try { body = JSON.parse(await baca(req)) } catch { return json(res, 400, { ok: false, alasan: 'Badan JSON tidak valid.' }) }
    if (typeof body.terimaCOD === 'boolean') store.pengaturan.terimaCOD = body.terimaCOD
    if (typeof body.qrisStatis === 'string') store.pengaturan.qrisStatis = body.qrisStatis.trim() || undefined
    if (body.gateway && typeof body.gateway === 'object') {
      const u = String(body.gateway.url || '').trim().replace(/\/$/, '')
      let urlVal = undefined
      if (u) {
        try { const U = new URL(u); if (U.protocol === 'http:' || U.protocol === 'https:') urlVal = u } catch { /* URL tidak valid — diabaikan */ }
      }
      store.pengaturan.gateway = {
        url: urlVal,
        apiKey: String(body.gateway.apiKey || '').trim() || undefined,
      }
    }
    if (body.bridge && typeof body.bridge === 'object') {
      const lama = store.pengaturan.bridge || {}
      const secret = String(body.bridge.secret || '').trim()
      if (secret) {
        const strategiCocok =
          body.bridge.strategiCocok === 'unik' ? 'unik'
            : body.bridge.strategiCocok === 'total' ? 'total'
              : lama.strategiCocok === 'unik' ? 'unik' : 'total'
        store.pengaturan.bridge = { secret, strategiCocok }
      } else {
        store.pengaturan.bridge = undefined
      }
    }
    if (body.tarif && typeof body.tarif === 'object') {
      const t = body.tarif, cur = tarifEfektif(katalog, store.pengaturan), n = {}
      if (t.biayaDasar != null) n.biayaDasar = Number(t.biayaDasar)
      if (t.perKm != null) n.perKm = Number(t.perKm)
      if (t.jarakMaxKm != null) n.jarakMaxKm = Number(t.jarakMaxKm)
      if ('gratisMin' in t) n.gratisMin = t.gratisMin === null ? null : Number(t.gratisMin)
      store.pengaturan.tarif = { ...cur, ...n }
    }
    simpanStore(store)
    const g = store.pengaturan.gateway
    const b = store.pengaturan.bridge
    return json(res, 200, { ok: true, pengaturan: { terimaCOD: store.pengaturan.terimaCOD === true, qrisStatis: store.pengaturan.qrisStatis, tarif: tarifEfektif(katalog, store.pengaturan), gatewayTerpasang: !!(g && g.url), bridge: b || {}, bridgeAktif: !!(b && b.secret), strategiCocok: (b && b.strategiCocok) === 'unik' ? 'unik' : 'total' } })
  }

  /* ---------- database pelanggan ---------- */
  if (url.pathname === '/api/pelanggan' && req.method === 'GET') {
    if (!butuhKasir(req, res)) return
    const q = (url.searchParams.get('q') || '').trim().toLowerCase()
    const list = Object.values(store.pelanggan).filter((p) => !q || (p.nama || '').toLowerCase().includes(q) || (p.hp || '').includes(q))
      .sort((a, b) => (b.terakhirPesan || '').localeCompare(a.terakhirPesan || ''))
    return json(res, 200, { ok: true, pelanggan: list })
  }

  /* ---------- auth: register (PIN) / login (PIN) / atur-PIN (pelanggan lama) ---------- */
  const buatSesi = (hp, nama) => {
    const token = randomUUID()
    store.sesi[token] = { hp, nama, dibuat: nowISO() }
    const kSesi = Object.keys(store.sesi)
    if (kSesi.length > 2000) for (const k of kSesi.slice(0, kSesi.length - 2000)) delete store.sesi[k]
    return token
  }
  const batasiLogin = (hp) => {
    const kini = Date.now()
    const coba = (loginCoba.get(hp) || []).filter((t) => kini - t < 60_000)
    if (coba.length >= 6) return false
    coba.push(kini)
    loginCoba.set(hp, coba)
    return true
  }
  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    let body = {}
    try { body = JSON.parse(await baca(req)) } catch { /* default */ }
    const hp = String(body.hp || '').replace(/\D/g, '').slice(0, 15)
    if (hp.length < 8) return json(res, 400, { ok: false, alasan: 'Nomor HP tidak valid.' })
    if (!pinValid(body.pin)) return json(res, 400, { ok: false, alasan: 'PIN harus 4–6 angka.' })
    if (!batasiLogin(hp)) return json(res, 429, { ok: false, alasan: 'Terlalu sering mencoba — tunggu sebentar.' })
    if (store.pelanggan[hp]) return json(res, 409, { ok: false, alasan: 'Nomor sudah terdaftar — masuk dengan PIN Anda.' })
    const nama = String(body.nama || '').trim()
    const p = upsertPelanggan(store, hp, nama)
    p.pinHash = buatPinHash(body.pin)
    const token = buatSesi(hp, p.nama)
    simpanStore(store)
    return json(res, 200, { ok: true, token, hp, nama: p.nama, profil: profilPelanggan(p) })
  }
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    let body = {}
    try { body = JSON.parse(await baca(req)) } catch { /* default */ }
    const hp = String(body.hp || '').replace(/\D/g, '').slice(0, 15)
    if (hp.length < 8) return json(res, 400, { ok: false, alasan: 'Nomor HP tidak valid.' })
    if (!batasiLogin(hp)) return json(res, 429, { ok: false, alasan: 'Terlalu sering login — coba lagi sebentar.' })
    const p = store.pelanggan[hp]
    if (!p) return json(res, 401, { ok: false, alasan: 'Nomor belum terdaftar — daftar dulu dengan PIN.' })
    if (p.pinHash) {
      if (!pinValid(body.pin) || !cekPinHash(body.pin, p.pinHash)) {
        return json(res, 401, { ok: false, alasan: 'PIN salah.' })
      }
      const token = buatSesi(hp, p.nama)
      simpanStore(store)
      return json(res, 200, { ok: true, token, hp, nama: p.nama, profil: profilPelanggan(p) })
    }
    // pelanggan lama (sebelum PIN) — masuk sekali untuk langsung set PIN
    const token = buatSesi(hp, p.nama)
    simpanStore(store)
    return json(res, 200, { ok: true, perluSetPin: true, token, hp, nama: p.nama, profil: profilPelanggan(p) })
  }
  if (url.pathname === '/api/auth/atur-pin' && req.method === 'POST') {
    let body = {}
    try { body = JSON.parse(await baca(req)) } catch { /* default */ }
    const s = store.sesi[String(body.token || '')]
    if (!s) return json(res, 401, { ok: false, alasan: 'Login dulu.' })
    if (!pinValid(body.pin)) return json(res, 400, { ok: false, alasan: 'PIN harus 4–6 angka.' })
    const p = store.pelanggan[s.hp]
    if (!p) return json(res, 404, { ok: false, alasan: 'Pelanggan tidak ditemukan.' })
    p.pinHash = buatPinHash(body.pin)
    simpanStore(store)
    return json(res, 200, { ok: true })
  }
  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const s = store.sesi[url.searchParams.get('token') || '']
    if (!s) return json(res, 401, { ok: false, alasan: 'Sesi tidak dikenal.' })
    const p = store.pelanggan[s.hp]
    return json(res, 200, { ok: true, hp: s.hp, nama: p?.nama || s.nama, profil: profilPelanggan(p) })
  }

  /* ---------- VAPID & subscribe & push ---------- */
  if (url.pathname === '/api/vapid' && req.method === 'GET') {
    return json(res, 200, { ok: true, publicKey: store.vapid.publicKey })
  }
  if (url.pathname === '/api/subscribe' && req.method === 'POST') {
    let body = {}
    try { body = JSON.parse(await baca(req)) } catch { /* default */ }
    const s = store.sesi[String(body.token || '')]
    if (!s) return json(res, 401, { ok: false, alasan: 'Login dulu.' })
    if (!body.subscription || !body.subscription.endpoint) return json(res, 400, { ok: false, alasan: 'Subscription tidak valid.' })
    store.subs[s.hp] = store.subs[s.hp] || []
    const arr = store.subs[s.hp].filter((x) => x.endpoint !== body.subscription.endpoint)
    arr.push(body.subscription)
    store.subs[s.hp] = arr.slice(-3)
    simpanStore(store)
    return json(res, 200, { ok: true })
  }
  if (url.pathname === '/api/push' && req.method === 'POST') {
    let body = {}
    try { body = JSON.parse(await baca(req)) } catch { /* default */ }
    // kasir kirim via hp langsung (butuh kredensial kasir), atau pelanggan via token sesi
    let hp = String(body.hp || '').trim()
    if (hp) {
      if (!butuhKasir(req, res)) return
    } else {
      const s = store.sesi[String(body.token || '')]
      if (!s) return json(res, 401, { ok: false, alasan: 'Login dulu.' })
      hp = s.hp
    }
    const subs = store.subs[hp] || []
    if (!subs.length) return json(res, 200, { ok: true, terkirim: 0, alasan: 'Pelanggan belum mengaktifkan notifikasi.' })
    const payload = JSON.stringify({ title: String(body.title || 'Ayam SABANA'), body: String(body.body || '') })
    const hasil = []
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, payload)
        hasil.push(true)
      } catch (e) {
        hasil.push(false)
        if (e.statusCode === 404 || e.statusCode === 410) store.subs[s.hp] = store.subs[s.hp].filter((x) => x.endpoint !== sub.endpoint)
      }
    }
    simpanStore(store)
    return json(res, 200, { ok: true, terkirim: hasil.filter(Boolean).length, total: hasil.length })
  }

  /* ---------- buat pesanan (DRAFT — belum bayar) ---------- */
  if (url.pathname === '/api/pesan' && req.method === 'POST') {
    if (!katalog || !tarif) return json(res, 503, { ok: false, alasan: 'Snapshot katalog belum ada.' })
    let body = {}
    try { body = JSON.parse(await baca(req)) } catch { return json(res, 400, { ok: false, alasan: 'Badan JSON tidak valid.' }) }
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length) return json(res, 400, { ok: false, alasan: 'Keranjang kosong.' })
    if (!body.nama || !body.hp || !body.alamat) return json(res, 400, { ok: false, alasan: 'Nama/HP/alamat wajib diisi.' })
    const hpBersih = String(body.hp).replace(/\D/g, '').slice(0, 15)
    if (hpBersih.length < 8) return json(res, 400, { ok: false, alasan: 'Nomor HP tidak valid.' })
    /* verifikasi jarak server-side: hitung haversine dari koordinat resto ke koordinat
     * pelanggan (dikirim portal dari pin peta). Fallback jarak klien hanya bila snapshot
     * tidak memuat koordinat resto (katalog lama). */
    const resto = katalog.resto
    const lat = Number(body.lat), lng = Number(body.lng)
    let jarakKm = Number(body.jarakKm)
    if (resto && Number.isFinite(resto.lat) && Number.isFinite(resto.lng)
      && Number.isFinite(lat) && Number.isFinite(lng)) {
      jarakKm = Math.round(haversineKm(resto.lat, resto.lng, lat, lng) * 10) / 10
    }
    if (!Number.isFinite(jarakKm) || jarakKm <= 0) return json(res, 400, { ok: false, alasan: 'Jarak tidak valid.' })
    if (jarakKm > tarif.jarakMaxKm) return json(res, 400, { ok: false, alasan: `Di luar jangkauan (maks ${tarif.jarakMaxKm} km).` })

    const detail = []
    for (const it of items) {
      const p = katalog.produk.find((x) => x.id === Number(it.produkId))
      if (!p) return json(res, 400, { ok: false, alasan: `Produk ${it.produkId} tidak ada di katalog.` })
      if (p.tersedia === false) return json(res, 400, { ok: false, alasan: `"${p.nama}" sedang habis.` })
      const qty = Math.max(1, Math.floor(Number(it.qty) || 1))
      detail.push({ produkId: p.id, nama: p.nama, emoji: p.emoji, harga: p.harga, hargaAsli: p.hargaAsli || undefined, qty, subtotal: p.harga * qty })
    }
    const subtotal = detail.reduce((s, d) => s + d.subtotal, 0)
    const { ongkir: ong, gratis } = ongkir(tarif, subtotal, jarakKm)

    const id = randomUUID()
    const no = 100 + orders.length + 1
    const order = {
      id, no, waktuBuat: nowISO(),
      nama: String(body.nama).slice(0, 80),
      hp: hpBersih,
      alamat: String(body.alamat).slice(0, 160),
      catatan: String(body.catatan || '').slice(0, 200) || undefined,
      jarakKm: Math.round(jarakKm * 10) / 10,
      ongkir: ong, gratis, subtotal, total: subtotal + ong,
      metode: null, statusPembayaran: 'belum',
      status: 'cek',                       // draft — menunggu cek ketersediaan kasir
      buktiNama: undefined,
      items: detail,
      pesan: [],                           // thread chat pelanggan ↔ kasir
      penilaian: undefined,
      riwayat: [{ status: 'cek', waktu: nowISO() }],
    }
    store.orders.push(order)
    upsertPelanggan(store, order.hp, order.nama, order.alamat)
    simpanStore(store)
    kirimSSE('pesanan-baru', { id: order.id, no: order.no, status: order.status })
    return json(res, 201, { ok: true, id: order.id, no: order.no, total: order.total, status: order.status })
  }

  /* ---------- daftar pesanan (kasir semua / pelanggan via token) ---------- */
  if (url.pathname === '/api/pesan' && req.method === 'GET') {
    const token = url.searchParams.get('token') || ''
    let list = orders
    if (token) {
      const s = store.sesi[token]
      if (!s) return json(res, 401, { ok: false, alasan: 'Login dulu.' })
      list = orders.filter((o) => (o.hp || '') === s.hp)
    } else {
      if (!butuhKasir(req, res)) return
      const hp = (url.searchParams.get('hp') || '').trim().toLowerCase()
      if (hp) list = orders.filter((o) => (o.hp || '').toLowerCase().includes(hp))
    }
    return json(res, 200, { ok: true, pesanan: [...list].sort((a, b) => (a.no > b.no ? -1 : 1)) })
  }

  /* ---------- webhook QRIS Bridge (qrishook — notifikasi pembayaran masuk dari HP toko) ---------- */
  if (url.pathname === '/api/webhook/qris' && req.method === 'POST') {
    const secret = (store.pengaturan.bridge || {}).secret
    const hdr = req.headers['x-webhook-secret'] || ''
    if (secret && !samaSecret(hdr, secret)) return json(res, 401, { ok: false, alasan: 'X-Webhook-Secret tidak cocok.' })
    let body = {}
    try { body = JSON.parse(await baca(req)) } catch { return json(res, 400, { ok: false, alasan: 'Payload JSON tidak valid.' }) }
    const eventId = String(body.event_id || '').slice(0, 80)
    if (eventId && store.webhook[eventId]) return json(res, 200, { ok: true, cocok: true, duplikat: true })
    const amount = Math.round(Number(body.payment?.amount))
    if (!Number.isFinite(amount) || amount <= 0) return json(res, 200, { ok: true, cocok: false, alasan: 'Nominal tidak terbaca.' })
    const issuer = String(body.payment?.payment_source || body.source_app || 'QRIS').slice(0, 40)

    // kandidat: QRIS menunggu bayar (kasir sudah nyatakan tersedia) atau baru dibayar & belum diverifikasi
    const kandidat = orders.filter((o) =>
      aktifBayar(o) && o.statusPembayaran !== 'refund'
      && (o.metode === 'qris' || (o.metode == null && o.status === 'menunggu-bayar')))
    // 1) penanda unik dulu — pasti & anti-bentrok
    let target = kandidat.find((o) => o.nominalUnik === amount)
    // 2) total pas + jendela waktu (±10 mnt sejak boleh bayar) — paling tua dulu.
    //    (strategi default: nominal pas; penanda unik otomatis hanya saat ada tabrakan)
    if (!target) {
      const sekarang = Date.now()
      target = kandidat
        .filter((o) => !o.nominalUnik && o.total === amount
          && sekarang - mulaiBayar(o) >= 0 && sekarang - mulaiBayar(o) < JENDELA_BAYAR_MS)
        .sort((a, b) => mulaiBayar(a) - mulaiBayar(b))[0]
    }
    if (!target) return json(res, 200, { ok: true, cocok: false, alasan: 'Tidak ada pesanan QRIS dengan nominal itu.' })

    if (target.statusPembayaran !== 'lunas') {
      target.metode = 'qris'
      target.statusPembayaran = 'lunas'
      target.verifikasiOtomatis = true
      target.sumberVerifikasi = 'qris-bridge'
      target.issuer = issuer || undefined
      target.bridgeEventId = eventId || undefined
      if (target.status === 'menunggu-bayar') {
        target.status = 'baru'
        target.riwayat.push({ status: 'baru', waktu: nowISO() })
      }
      target.riwayat.push({ status: 'verifikasi', waktu: nowISO() })
      target.pesan.push({ dari: 'kasir', teks: `✅ Pembayaran ${issuer ? issuer + ' ' : ''}terdeteksi — lunas otomatis via QRIS Bridge.`, waktu: nowISO() })
      if (eventId) store.webhook[eventId] = target.id
      const kunci = Object.keys(store.webhook)
      if (kunci.length > 500) store.webhook = Object.fromEntries(kunci.slice(-500).map((k) => [k, store.webhook[k]]))
      simpanStore(store)
      // kabari papan kasir SEKETIKA (tanpa menunggu polling) — suara + banner
      kirimSSE('lunas-bridge', { id: target.id, no: target.no, issuer: target.issuer || null, total: target.total })
    }
    return json(res, 200, { ok: true, cocok: true, no: target.no, id: target.id, lunas: true })
  }

  /* ---------- detail / aksi / ubah / bayar / hapus / penilaian ---------- */
  const m = url.pathname.match(/^\/api\/pesan\/([0-9a-f-]{36})(?:\/(pesan|aksi|ubah|bayar|cek-pembayaran|qris-callback|penilaian))?$/)
  if (m) {
    const order = orders.find((o) => o.id === m[1])
    if (!order) return json(res, 404, { ok: false, alasan: 'Pesanan tidak ditemukan.' })
    const tok = url.searchParams.get('token') || ''
    const sesi = tok ? store.sesi[tok] : null
    const punyaPesanan = !!sesi && sesi.hp === order.hp // pelanggan pemilik pesanan

    if (req.method === 'GET') {
      if (!punyaPesanan && !kasirSah(req)) return json(res, 401, { ok: false, alasan: 'Tidak berhak melihat pesanan ini.' })
      return json(res, 200, { ok: true, pesanan: order })
    }

    /* chat — kasir, atau pelanggan pemilik pesanan */
    if (m[2] === 'pesan' && req.method === 'POST') {
      if (!punyaPesanan && !kasirSah(req)) return json(res, 401, { ok: false, alasan: 'Tidak berhak mengirim pesan.' })
      let body = {}
      try { body = JSON.parse(await baca(req)) } catch { /* default */ }
      const teks = String(body.teks || '').slice(0, 300).trim()
      if (!teks) return json(res, 400, { ok: false, alasan: 'Pesan kosong.' })
      order.pesan.push({ dari: body.dari === 'kasir' ? 'kasir' : 'customer', teks, waktu: nowISO() })
      simpanStore(store)
      return json(res, 200, { ok: true, pesanan: order })
    }

    /* aksi kasir (batal juga boleh pelanggan pemilik) */
    if (m[2] === 'aksi' && req.method === 'POST') {
      let body = {}
      try { body = JSON.parse(await baca(req)) } catch { /* default */ }
      const aksi = String(body.aksi || '')
      if (aksi !== 'batal' || !punyaPesanan) {
        if (!butuhKasir(req, res)) return
      }
      const MURNI = ['terima', 'dibuat', 'siap', 'diantar', 'selesai']
      if (aksi === 'tersedia' && order.status === 'cek') {
        order.status = 'menunggu-bayar'
        order.rentangBayar = nowISO() // jendela waktu untuk pencocokan total pas
        // strategi: 'total' (default) = nominal pas, penanda unik hanya saat tabrakan;
        // 'unik' = selalu penanda. Tanpa bridge secret = nominal pas tanpa penanda.
        order.nominalUnik = nominalBayar(store, order)
        order.pesan.push({
          dari: 'kasir',
          teks: order.nominalUnik
            ? `Menu tersedia ✅ Silakan bayar tepat ${order.nominalUnik} (nominal unik) — terdeteksi otomatis.`
            : 'Menu tersedia ✅ Silakan lanjut pembayaran.',
          waktu: nowISO(),
        })
        order.riwayat.push({ status: 'menunggu-bayar', waktu: nowISO() })
      } else if (aksi === 'tidak-tersedia' && order.status === 'cek') {
        order.pesan.push({ dari: 'kasir', teks: String(body.alasan || 'Sebagian menu tidak tersedia — silakan ubah pesanan.').slice(0, 200), waktu: nowISO() })
      } else if (aksi === 'verifikasi' && order.metode && order.metode !== 'cod' && order.statusPembayaran === 'menunggu-verifikasi') {
        order.statusPembayaran = 'lunas'
        order.riwayat.push({ status: 'verifikasi', waktu: nowISO() })
      } else if (aksi === 'refund') {
        // refund dana QRIS/transfer — kasir kembalikan manual; jejak audit penuh.
        if (order.refund) return json(res, 400, { ok: false, alasan: 'Pesanan ini sudah di-refund.' })
        if (!order.metode || order.metode === 'cod') return json(res, 400, { ok: false, alasan: 'Refund hanya untuk pembayaran QRIS/transfer.' })
        if (order.statusPembayaran !== 'lunas') return json(res, 400, { ok: false, alasan: 'Belum lunas — tidak ada dana untuk dikembalikan.' })
        const nominal = Math.min(order.total, Math.max(0, Math.round(Number(body.nominal) || order.total)))
        const metode = body.metode === 'transfer' || body.metode === 'qris' ? body.metode : order.metode
        const alasan = String(body.alasan || '').slice(0, 160)
        order.statusPembayaran = 'refund'
        order.refund = {
          nominal, metode,
          alasan,
          waktu: nowISO(),
          oleh: 'kasir',
          transaksiId: order.transaksiId || undefined,
          verifikasiOtomatis: !!order.verifikasiOtomatis,
        }
        order.pesan.push({ dari: 'kasir', teks: `↩️ Dana ${nominal.toLocaleString('id-ID')} dikembalikan via ${metode === 'transfer' ? 'transfer bank' : 'QRIS'}${alasan ? ` — ${alasan}` : ''}.`, waktu: nowISO() })
        order.riwayat.push({ status: 'refund', waktu: nowISO(), nominal, metode, alasan })
        // Refund mengurangi total belanja pelanggan di database pelanggan — ringkasan
        // Finansial (omzet portal & segmen pelanggan) membaca nilai yang sama.
        const cp = store.pelanggan[order.hp]
        if (cp) cp.total = Math.max(0, Math.round((cp.total || 0) - nominal))
        simpanStore(store)
        return json(res, 200, { ok: true, pesanan: order })
      } else if (aksi === 'batal') {
        order.status = 'batal'
        order.alasanBatal = String(body.alasan || '').slice(0, 120)
        order.pesan.push({ dari: 'kasir', teks: `Pesanan dibatalkan — ${order.alasanBatal}`, waktu: nowISO() })
        order.riwayat.push({ status: 'batal', waktu: nowISO() })
      } else if (MURNI.includes(aksi)) {
        order.status = aksi === 'terima' ? 'dibuat' : aksi
        order.riwayat.push({ status: order.status, waktu: nowISO() })
      } else {
        return json(res, 400, { ok: false, alasan: 'Aksi tidak dikenal.' })
      }
      simpanStore(store)
      return json(res, 200, { ok: true, pesanan: order })
    }

    /* verifikasi via gateway ShopeePay — manual (tombol kasir) maupun polling otomatis */
    if (m[2] === 'cek-pembayaran' && req.method === 'POST') {
      if (order.metode !== 'qris' && order.metode !== 'transfer') return json(res, 200, { ok: false, lunas: false, alasan: 'Bukan pembayaran QRIS/transfer.' })
      if (order.statusPembayaran !== 'menunggu-verifikasi') return json(res, 200, { ok: false, lunas: false, alasan: 'Tidak ada pembayaran yang menunggu verifikasi.' })
      const h = await cekGatewayPembayaran(store, order)
      if (h.lunas) simpanStore(store)
      return json(res, 200, { ok: true, lunas: h.lunas, issuer: h.issuer || null, alasan: h.alasan })
    }

    /* callback provider QRIS — hanya kasir (kredensial kasir wajib) */
    if (m[2] === 'qris-callback' && req.method === 'POST') {
      if (!butuhKasir(req, res)) return
      if (order.metode !== 'qris' && order.metode !== 'transfer') return json(res, 400, { ok: false, alasan: 'Bukan pesanan QRIS/transfer.' })
      if (order.statusPembayaran === 'lunas' || order.statusPembayaran === 'refund') return json(res, 200, { ok: true, pesanan: order })
      order.statusPembayaran = 'lunas'
      order.riwayat.push({ status: 'verifikasi', waktu: nowISO() })
      simpanStore(store)
      return json(res, 200, { ok: true, pesanan: order })
    }

    /* kasir ubah item pesanan (draft/cek/menunggu-bayar) */
    if (m[2] === 'ubah' && req.method === 'POST') {
      if (!butuhKasir(req, res)) return
      if (!katalog || !tarif) return json(res, 503, { ok: false, alasan: 'Snapshot katalog belum ada.' })
      if (!['cek', 'menunggu-bayar'].includes(order.status)) return json(res, 400, { ok: false, alasan: 'Pesanan sudah diproses — tidak bisa diubah.' })
      let body = {}
      try { body = JSON.parse(await baca(req)) } catch { /* default */ }
      const items = Array.isArray(body.items) ? body.items : []
      const detail = []
      for (const it of items) {
        const p = katalog.produk.find((x) => x.id === Number(it.produkId))
        if (!p) continue
        const qty = Math.max(1, Math.floor(Number(it.qty) || 1))
        detail.push({ produkId: p.id, nama: p.nama, emoji: p.emoji, harga: p.harga, hargaAsli: p.hargaAsli || undefined, qty, subtotal: p.harga * qty })
      }
      if (!detail.length) return json(res, 400, { ok: false, alasan: 'Hasil ubah kosong.' })
      order.items = detail
      order.subtotal = detail.reduce((s, d) => s + d.subtotal, 0)
      const { ongkir: ong, gratis } = ongkir(tarif, order.subtotal, order.jarakKm)
      order.ongkir = ong; order.gratis = gratis; order.total = order.subtotal + ong
      if (order.status === 'menunggu-bayar') order.nominalUnik = nominalBayar(store, order) // hitung ulang strategi
      order.pesan.push({ dari: 'kasir', teks: 'Pesanan diubah kasir. Silakan periksa kembali.', waktu: nowISO() })
      simpanStore(store)
      return json(res, 200, { ok: true, pesanan: order })
    }

    /* pelanggan bayar (hanya setelah kasir nyatakan tersedia) */
    if (m[2] === 'bayar' && req.method === 'POST') {
      if (!punyaPesanan && !kasirSah(req)) return json(res, 401, { ok: false, alasan: 'Tidak berhak membayar pesanan ini.' })
      let body = {}
      try { body = JSON.parse(await baca(req)) } catch { /* default */ }
      if (order.status !== 'menunggu-bayar') return json(res, 400, { ok: false, alasan: 'Belum bisa dibayar — tunggu konfirmasi kasir.' })
      const metode = body.metode === 'cod' ? 'cod' : body.metode === 'transfer' ? 'transfer' : 'qris'
      if (metode === 'cod' && !terimaCOD) return json(res, 400, { ok: false, alasan: 'COD sedang nonaktif — gunakan QRIS/transfer.' })
      const gatewayOn = !!(pengaturan.gateway && pengaturan.gateway.url)
      const bridgeOn = !!(pengaturan.bridge && pengaturan.bridge.secret)
      if (metode !== 'cod' && !body.buktiNama && !gatewayOn && !bridgeOn) return json(res, 400, { ok: false, alasan: 'Bukti pembayaran wajib diunggah untuk QRIS/transfer.' })
      if (metode !== 'cod' && !body.buktiNama && (gatewayOn || bridgeOn)) order.pesan.push({ dari: 'kasir', teks: bridgeOn ? 'Verifikasi otomatis aktif — pembayaran akan terdeteksi dari HP toko.' : 'Gateway aktif — pembayaran akan diverifikasi otomatis.', waktu: nowISO() })
      order.metode = metode
      order.statusPembayaran = metode === 'cod' ? 'cod' : 'menunggu-verifikasi'
      order.buktiNama = metode === 'cod' ? undefined : (body.buktiNama ? String(body.buktiNama).slice(0, 120) : undefined)
      order.status = 'baru'
      order.riwayat.push({ status: 'baru', waktu: nowISO() })
      const p = upsertPelanggan(store, order.hp, order.nama)
      p.jumlahPesanan += 1
      p.total += order.total
      p.terakhirPesan = nowISO()
      simpanStore(store)
      return json(res, 200, { ok: true, pesanan: order })
    }

    /* kasir hapus pesanan */
    if (req.method === 'DELETE') {
      if (!butuhKasir(req, res)) return
      const i = orders.findIndex((o) => o.id === order.id)
      if (i >= 0) orders.splice(i, 1)
      simpanStore(store)
      return json(res, 200, { ok: true, hapus: true })
    }

    /* penilaian — pelanggan pemilik pesanan, atau kasir */
    if (m[2] === 'penilaian' && req.method === 'POST') {
      if (!punyaPesanan && !kasirSah(req)) return json(res, 401, { ok: false, alasan: 'Tidak berhak menilai.' })
      let body = {}
      try { body = JSON.parse(await baca(req)) } catch { /* rating default */ }
      const rating = Math.max(1, Math.min(5, Math.floor(Number(body.rating) || 1)))
      order.penilaian = { rating, komentar: String(body.komentar || '').slice(0, 280), waktu: nowISO() }
      const p = store.pelanggan[order.hp]
      if (p) {
        const rated = orders.filter((o) => o.hp === order.hp && o.penilaian)
        p.ratingRata = Math.round((rated.reduce((s, o) => s + o.penilaian.rating, 0) / rated.length) * 10) / 10
      }
      simpanStore(store)
      return json(res, 200, { ok: true, pesanan: order })
    }
  }

  return json(res, 404, { ok: false, alasan: 'Tidak ditemukan.' })
}).listen(PORT, () => {
  console.log(`[kasir-sabana-order] portal customer delivery berjalan di http://localhost:${PORT}`)
  console.log(`  katalog : ${KATALOG_FILE}`)
  console.log(`  store   : ${ORDERS_FILE}`)
  if (KASIR_SECRET) {
    console.log(`  🔒 kasir : X-Kasir-Secret wajib pada endpoint manajemen (${KASIR_SECRET.length} karakter)`)
  } else {
    console.log('  ⚠️  KASIR_SECRET kosong — endpoint kasir TANPA proteksi (mode dev).')
    console.log('      Set env KASIR_SECRET sebelum deploy! Contoh: KASIR_SECRET=$(openssl rand -hex 16) node server/order.mjs')
  }
  console.log(`  cors    : ${CORS_ORIGIN.length ? CORS_ORIGIN.join(', ') : 'localhost/127.0.0.1 (dev)'}`)
  console.log(`  uji     : curl http://localhost:${PORT}/api/katalog`)
  console.log('  auto-verifikasi gateway : polling 20 dtk untuk QRIS/transfer yang menunggu')
})

/* ---- polling otomatis: begitu gateway mendeteksi pembayaran masuk, status langsung Lunas
 *      tanpa perlu kasir klik 'Cek gateway' ataupun pelanggan upload bukti. ---- */
setInterval(async () => {
  const store = muatStore()
  const g = (store.pengaturan || {}).gateway
  if (!g || !g.url) return
  let berubah = false
  for (const o of store.orders) {
    if ((o.metode === 'qris' || o.metode === 'transfer') && o.statusPembayaran === 'menunggu-verifikasi') {
      const h = await cekGatewayPembayaran(store, o)
      if (h.lunas) berubah = true
    }
  }
  if (berubah) simpanStore(store)
}, 20000)
