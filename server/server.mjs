#!/usr/bin/env node
/**
 * Server sinkronisasi acuan — Kasir SABANA.
 *
 * Node murni tanpa dependensi (cukup `node server/server.mjs`).
 * Store: satu file JSON (default server/data/store.json).
 *
 * Endpoint:
 *   GET  /api/health            — status & versi global
 *   POST /api/devices           — daftarkan perangkat { nama } → { id }
 *   POST /api/sync              — push seluruh tabel + tarik baris baru
 *
 * Kebijakan konflik (fondasi P0): penulis terakhir menang per id di server.
 * Setiap baris yang masuk diberi `versi` naik global + `perangkatId`; perangkat
 * hanya menarik baris dengan versi > versi terakhir yang ia terima. Oplog penuh,
 * auth & counter terpusat ada di roadmap dokumen arsitektur.
 *
 * Jalankan:  PORT=5174 node server/server.mjs
 */

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ARSIP = process.env.STORE_FILE || join(__dirname, 'data', 'store.json')
const PORT = Number(process.env.PORT || 5174)
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)

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

function muatStore() {
  if (!existsSync(ARSIP)) return { perangkat: {}, baris: {}, versi: 0 }
  try {
    return JSON.parse(readFileSync(ARSIP, 'utf8'))
  } catch {
    return { perangkat: {}, baris: {}, versi: 0 }
  }
}

function simpanStore(s) {
  mkdirSync(dirname(ARSIP), { recursive: true })
  writeFileSync(ARSIP, JSON.stringify(s))
}

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

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'OPTIONS') {
    const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Device-Secret' }
    const o = izinkanOrigin(req)
    if (o) h['Access-Control-Allow-Origin'] = o
    res.writeHead(204, h)
    return res.end()
  }
  res.kasirOrigin = izinkanOrigin(req)

  const store = muatStore()

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
    simpanStore(store)
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
    simpanStore(store)

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
}).listen(PORT, () => {
  console.log(`[kasir-sabana-sync] berjalan di http://localhost:${PORT}`)
  console.log(`  store: ${ARSIP} · tabel: ${TABEL.length}`)
  console.log(`  uji: curl http://localhost:${PORT}/api/health`)
})