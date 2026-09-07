#!/usr/bin/env node
/**
 * Server dev order delivery mandiri — lapisan node:http tipis di atas
 * server/handler-order.mjs (logika bersama dev ↔ Vercel).
 *
 * Store: JSON (server/store-json.mjs → server/data/orders.json). SSE papan
 * kasir + polling gateway 20 dtk hanya ada di jalur dev ini (tidak berjalan
 * di serverless). Produksi = Vercel Function + store Supabase.
 *
 * Jalankan:  PORT=5198 node server/order.mjs
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buatStoreJsonOrder } from './store-json.mjs'
import { cekGatewayPembayaran, pasangStore, penanganOrder } from './handler-order.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 5198)
const KATALOG_FILE = process.env.KATALOG_FILE || join(__dirname, '..', 'web-order', 'katalog-snapshot.json')
const ORDERS_FILE = process.env.ORDERS_FILE || join(__dirname, 'data', 'orders.json')
const KASIR_SECRET = (process.env.KASIR_SECRET || '').trim()
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)

const storeJson = buatStoreJsonOrder(ORDERS_FILE)
pasangStore(storeJson)

createServer(penanganOrder).listen(PORT, () => {
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

/* ---- polling otomatis (jalur dev): begitu gateway mendeteksi pembayaran masuk,
 *      status langsung Lunas tanpa perlu kasir klik 'Cek gateway' ataupun
 *      pelanggan upload bukti. Serverless tidak punya setInterval — di produksi
 *      gantinya: webhook QRIS Bridge + polling per-pesanan oleh klien. ---- */
setInterval(async () => {
  const store = storeJson.muatStore()
  const g = (store.pengaturan || {}).gateway
  if (!g || !g.url) return
  let berubah = false
  for (const o of store.orders) {
    if ((o.metode === 'qris' || o.metode === 'transfer') && o.statusPembayaran === 'menunggu-verifikasi') {
      const h = await cekGatewayPembayaran(store, o)
      if (h.lunas) berubah = true
    }
  }
  if (berubah) await storeJson.simpanStore(store)
}, 20000)
