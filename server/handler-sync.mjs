#!/usr/bin/env node
/**
 * Penangan permintaan sinkronisasi multi-perangkat — Kasir SABANA.
 *
 * Logika endpoint yang tadinya ada di server/server.mjs, dipisah dari
 * node:http supaya bisa dipakai server dev (JSON store) maupun Vercel
 * (Supabase store) — kontrak endpoint & auth perangkat sama persis:
 *   GET  /api/health            — status & versi global
 *   POST /api/devices           — daftarkan perangkat { nama } → { id, secret }
 *   POST /api/sync              — push seluruh tabel + tarik baris baru
 *
 * Store di-inject via pasangStore() (lihat store-json.mjs untuk JSON / dev,
 * store-supabase.mjs untuk Supabase / produksi). Kebijakan konflik: penulis
 * terakhir menang per id di server; versi naik global per baris.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buatStoreJsonSync } from './store-json.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const CORS_ORIGIN = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)

/* ---------- store di-inject: dev = JSON, produksi (Vercel) = Supabase ---------- */
let storeApi = null
export function pasangStore(api) { storeApi = api }
const __storeDefault = buatStoreJsonSync(process.env.STORE_FILE || join(__dirname, 'data', 'store.json'))
function muatStore() {
  const api = storeApi || __storeDefault
  return api.muatStore()
}
function simpanStore(s) {
  const api = storeApi || __storeDefault
  return api.simpanStore(s)
}

function izinkanOrigin(req) {
  const o = req.headers.origin
  if (!o) return null
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

const TABEL = [
  'bahan', 'produk', 'itemResep', 'hargaRiwayat', 'mutasiStok',
  'beli', 'beliItem', 'produksi', 'transaksi', 'transaksiItem',
  'sesiKas', 'mutasiKas', 'catatanFinansial', 'fryer', 'fryerRiwayat',
]

function json(res, kode, obj) {
  const s = JSON.stringify(obj)
  const h = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Secret',
    'Content-Length': Buffer.byteLength(s),
  }
  if (res.kasirOrigin) h['Access-Control-Allow-Origin'] = res.kasirOrigin
  res.writeHead(kode, h)
  res.end(s)
}

function baca(req) {
  // fast-path adapter serverless (Vercel): body sudah dibaca sebagai teks
  if (typeof req._bacaSiap === 'string') return Promise.resolve(req._bacaSiap)
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => {
      d += c
      if (d.length > 50_000_000) {
        reject(new Error('payload terlalu besar'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })
}

/* Penangan permintaan sync — dipakai server dev (node:http) maupun Vercel. */
export async function penanganSync(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'OPTIONS') {
    const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Device-Secret' }
    const o = izinkanOrigin(req)
    if (o) h['Access-Control-Allow-Origin'] = o
    res.writeHead(204, h)
    return res.end()
  }
  res.kasirOrigin = izinkanOrigin(req)

  const store = await muatStore()

  if (url.pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, { ok: true, nama: 'kasir-sabana-sync', tabel: TABEL.length, versi: store.versi })
  }

  if (url.pathname === '/api/devices' && req.method === 'POST') {
    let body = {}
    try {
      body = JSON.parse(await baca(req))
    } catch {
      /* nama default */
    }
    const id = randomUUID()
    const secret = randomUUID()
    store.perangkat[id] = {
      id,
      secret,
      nama: String(body.nama || 'Perangkat').slice(0, 80),
      dibuat: new Date().toISOString(),
      terakhirVersi: 0,
      terakhirSync: null,
    }
    await simpanStore(store)
    return json(res, 200, { id, secret, nama: store.perangkat[id].nama })
  }

  if (url.pathname === '/api/sync' && req.method === 'POST') {
    let body = {}
    try {
      body = JSON.parse(await baca(req))
    } catch {
      return json(res, 400, { ok: false, alasan: 'Badan JSON tidak valid.' })
    }
    const perangkatId = String(body.perangkatId || '')
    if (!perangkatId) return json(res, 400, { ok: false, alasan: 'perangkatId wajib diisi.' })
    // kredensial perangkat: secret wajib cocok dengan yang diberikan saat registrasi
    const dev = store.perangkat[perangkatId]
    const secretHdr = req.headers['x-device-secret'] || ''
    if (!dev || !dev.secret || !samaSecret(secretHdr, dev.secret)) {
      return json(res, 401, { ok: false, alasan: 'Perangkat tidak dikenal / secret salah — daftar ulang lewat /api/devices.' })
    }

    // 1) simpan baris push — LWW per id, versi naik global
    const dorong = body.dorong && typeof body.dorong === 'object' ? body.dorong : {}
    let masuk = 0
    for (const t of TABEL) {
      const rows = Array.isArray(dorong[t]) ? dorong[t] : []
      store.baris[t] = store.baris[t] || {}
      for (const r of rows) {
        if (r == null || typeof r !== 'object' || r.id == null) continue
        store.versi += 1
        store.baris[t][r.id] = { ...r, versi: store.versi, perangkatId }
        masuk += 1
      }
    }

    // 2) tarik baris lebih baru dari versi yang sudah diterima perangkat ini
    const tarik = {}
    let tarikCount = 0
    for (const t of TABEL) {
      const peta = store.baris[t] || {}
      const rows = Object.values(peta).filter((r) => (r.versi || 0) > (dev.terakhirVersi || 0))
      if (rows.length) {
        tarik[t] = rows
        tarikCount += rows.length
      }
    }

    dev.terakhirVersi = store.versi
    dev.terakhirSync = new Date().toISOString()
    await simpanStore(store)

    return json(res, 200, {
      ok: true,
      versi: store.versi,
      perangkatId,
      perangkat: { id: dev.id, nama: dev.nama },
      masuk,
      tarik,
      tarikCount,
    })
  }

  return json(res, 404, { ok: false, alasan: 'Tidak ditemukan.' })
}
