#!/usr/bin/env node
/**
 * Store JSON untuk server order & server sync — implementasi antarmuka store
 * ({ muatStore, simpanStore }) yang di-inject ke modul handler bersama.
 *
 * Jalur DEV memakai store ini (file di server/data/*.json). Jalur produksi
 * (Vercel) memakai store Supabase — lihat server/store-supabase.mjs. Kedua
 * implementasi memenuhi kontrak yang sama:
 *   muatStore()  → store (objek di-mutasi di memori oleh handler)
 *   simpanStore(s) → persist (boleh sync — dipanggil dengan `await` oleh handler)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

function bacaJson(arsip, kosong) {
  if (!existsSync(arsip)) return kosong
  try {
    const raw = JSON.parse(readFileSync(arsip, 'utf8'))
    return raw == null ? kosong : raw
  } catch {
    return kosong
  }
}

/* ---------- store ORDER (server/data/orders.json) ---------- */
const KOSONG_ORDER = () => ({
  orders: [],
  pengaturan: {},
  pelanggan: {},
  otp: {}, // legacy — tidak dipakai lagi (login via HP + PIN)
  sesi: {},
  subs: {},
  vapid: {},
  webhook: {},
})

export function buatStoreJsonOrder(arsip) {
  return {
    muatStore() {
      if (!existsSync(arsip)) return KOSONG_ORDER()
      try {
        const raw = JSON.parse(readFileSync(arsip, 'utf8'))
        if (Array.isArray(raw)) return { ...KOSONG_ORDER(), orders: raw }
        return {
          orders: Array.isArray(raw.orders) ? raw.orders : [],
          pengaturan: raw.pengaturan || {},
          pelanggan: raw.pelanggan || {},
          otp: raw.otp || {},        // legacy — tidak dipakai lagi
          sesi: raw.sesi || {},
          subs: raw.subs || {},
          vapid: raw.vapid || {},
          webhook: raw.webhook || {}, // dedup event_id dari qrishook
        }
      } catch {
        return KOSONG_ORDER()
      }
    },
    simpanStore(s) {
      mkdirSync(dirname(arsip), { recursive: true })
      writeFileSync(arsip, JSON.stringify(s, null, 2))
    },
  }
}

/* ---------- store SYNC (server/data/store.json) ---------- */
const KOSONG_SYNC = () => ({ perangkat: {}, baris: {}, versi: 0 })

export function buatStoreJsonSync(arsip) {
  return {
    muatStore() {
      const raw = bacaJson(arsip, KOSONG_SYNC())
      if (!raw || typeof raw !== 'object') return KOSONG_SYNC()
      return {
        perangkat: raw.perangkat || {},
        baris: raw.baris || {},
        versi: Number(raw.versi) || 0,
      }
    },
    simpanStore(s) {
      mkdirSync(dirname(arsip), { recursive: true })
      writeFileSync(arsip, JSON.stringify(s))
    },
  }
}
