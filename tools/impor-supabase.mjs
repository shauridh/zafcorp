#!/usr/bin/env node
/**
 * Impor data server/data/*.json → Supabase.
 *
 * Memakai store Supabase yang SAMA dengan produksi (server/store-supabase.mjs)
 * jadi mapping kolom & logika diff sudah teruji. Skrip ini:
 *   1. Baca orders.json → bentuk store order in-memory
 *   2. Baca store.json → bentuk store sync in-memory
 *   3. buatStoreSupabaseOrder/Sync → muatStore (snapshot kosong/isi) →
 *      timpa dengan data JSON → simpanStore (upsert delta)
 *
 * Idempoten: jalankan ulang = baris di-update (LWW), bukan duplikat.
 *
 * Wajib dulu: supabase/schema.sql sudah dijalankan (tabel ada).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (dari .env.local).
 *
 * Usage: node --env-file=.env.local tools/impor-supabase.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buatKlienSupabase, buatStoreSupabaseOrder, buatStoreSupabaseSync } from '../server/store-supabase.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dirname, '..', 'server', 'data')

function muatJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(join(DATA, file), 'utf8'))
  } catch {
    console.log(`  ⚠️  ${file} tidak ada — dilewati`)
    return fallback
  }
}

const klon = (o) => JSON.parse(JSON.stringify(o ?? null))

async function imporOrder(klien) {
  const raw = muatJson('orders.json', null)
  if (!raw) return
  const store = buatStoreSupabaseOrder(klien)
  await store.muatStore() // snapshot kondisi DB saat ini
  // bentuk in-memory identik store JSON
  const data = {
    orders: Array.isArray(raw.orders) ? raw.orders : [],
    pengaturan: raw.pengaturan || {},
    pelanggan: raw.pelanggan || {},
    otp: {},
    sesi: raw.sesi || {},
    subs: raw.subs || {},
    vapid: raw.vapid || {},
    webhook: raw.webhook || {},
  }
  // timpa store aktif dengan data JSON lalu tulis delta
  const kunci = klon(store)
  Object.keys(data).forEach((k) => (kunci[k] = data[k]))
  await store.simpanStore(kunci)
  const n = (k) => (k === 'orders' ? data.orders.length : Object.keys(data[k] || {}).length)
  console.log(`  orders       : ${n('orders')} pesanan`)
  console.log(`  pelanggan    : ${n('pelanggan')} pelanggan`)
  console.log(`  sesi         : ${n('sesi')} sesi`)
  console.log(`  subs         : ${n('subs')} langganan push`)
  console.log(`  webhook      : ${n('webhook')} event dedup`)
  console.log(`  vapid        : ${data.vapid && data.vapid.publicKey ? 'ada' : 'tidak'}`)
  console.log(`  pengaturan   : ${Object.keys(data.pengaturan).length} kunci`)
}

async function imporSync(klien) {
  const raw = muatJson('store.json', null)
  if (!raw) return
  const store = buatStoreSupabaseSync(klien)
  await store.muatStore()
  const data = {
    perangkat: raw.perangkat || {},
    baris: raw.baris || {},
    versi: raw.versi || 0,
  }
  const kunci = klon(store)
  Object.keys(data).forEach((k) => (kunci[k] = data[k]))
  await store.simpanStore(kunci)
  const nBaris = Object.values(data.baris || {}).reduce((a, b) => a + Object.keys(b).length, 0)
  console.log(`  perangkat    : ${Object.keys(data.perangkat).length} perangkat`)
  console.log(`  baris_sync   : ${nBaris} baris`)
  console.log(`  versi        : ${data.versi}`)
}

try {
  const klien = buatKlienSupabase()
  console.log('Impor data lokal → Supabase')
  console.log('  order:')
  await imporOrder(klien)
  console.log('  sync:')
  await imporSync(klien)
  console.log('Selesai ✅ (idempoten — aman dijalankan ulang)')
} catch (e) {
  console.error('GAGAL:', e.message)
  if (/does not exist|relation|42P01|404/i.test(String(e.message))) {
    console.error('Kemungkinan tabel belum ada — jalankan supabase/schema.sql dulu (SQL Editor atau via DB password).')
  }
  process.exit(1)
}