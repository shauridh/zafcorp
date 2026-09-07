#!/usr/bin/env node
/**
 * Server dev sinkronisasi acuan — lapisan node:http tipis di atas
 * server/handler-sync.mjs (logika bersama dev ↔ Vercel).
 *
 * Store: JSON (server/store-json.mjs → server/data/store.json). Produksi =
 * Vercel Function + store Supabase.
 *
 * Jalankan:  PORT=5174 node server/server.mjs
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buatStoreJsonSync } from './store-json.mjs'
import { pasangStore, penanganSync } from './handler-sync.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ARSIP = process.env.STORE_FILE || join(__dirname, 'data', 'store.json')
const PORT = Number(process.env.PORT || 5174)
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean)

pasangStore(buatStoreJsonSync(ARSIP))

createServer(penanganSync).listen(PORT, () => {
  console.log(`[kasir-sabana-sync] berjalan di http://localhost:${PORT}`)
  console.log(`  store: ${ARSIP}`)
  console.log(`  cors : ${CORS_ORIGIN.length ? CORS_ORIGIN.join(', ') : 'localhost/127.0.0.1 (dev)'}`)
  console.log(`  uji  : curl http://localhost:${PORT}/api/health`)
})
