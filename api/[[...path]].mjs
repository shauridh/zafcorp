/**
 * Vercel Function catch-all — api/[[...path]].mjs
 *
 * Semua /api/* (portal delivery + sinkronisasi) masuk ke satu fungsi ini.
 * Logika endpoint dipakai bersama dari server/handler-order.mjs &
 * server/handler-sync.mjs — bedanya hanya STORE: JSON (dev) vs Supabase
 * (produksi, di-inject di sini).
 *
 * Konsekuensi serverless (lihat docs/BACKEND-SUPABASE-VERCEL.md):
 *  - SSE /api/events NONAKTIF (aturSseAktif(false)) → 501. Notifikasi instan
 *    papan kasir diganti Supabase Realtime broadcast (P3).
 *  - Tidak ada polling gateway 20 dtk → webhook QRIS Bridge + polling
 *    per-pesanan oleh klien sebagai gantinya.
 *
 * Env (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KASIR_SECRET,
 * CORS_ORIGIN, opsional VAPID_PUBLIC/VAPID_PRIVATE.
 */
import { penanganOrder, pasangStore as pasangOrderStore, aturSseAktif } from '../server/handler-order.mjs'
import { penanganSync, pasangStore as pasangSyncStore } from '../server/handler-sync.mjs'
import { buatKlienSupabase, buatStoreSupabaseOrder, buatStoreSupabaseSync } from '../server/store-supabase.mjs'

let siap = null
async function pastikanSiap() {
  if (siap) return
  const klien = buatKlienSupabase() // throw bila env belum diset
  pasangOrderStore(buatStoreSupabaseOrder(klien))
  pasangSyncStore(buatStoreSupabaseSync(klien))
  aturSseAktif(false)
  siap = true
}

function route(pathname) {
  return pathname === '/api/devices' || pathname === '/api/sync' || pathname === '/api/health'
    ? penanganSync
    : penanganOrder
}

export default {
  async fetch(request) {
    try {
      await pastikanSiap()
      const url = new URL(request.url)
      const headers = {}
      request.headers.forEach((v, k) => { headers[k] = v })

      // adapter req/res ala node:http — penangan bersama memakai baca(req)
      // dengan fast-path _bacaSiap (body sudah dibaca sebagai teks di sini).
      const req = {
        method: request.method,
        url: request.url,
        headers,
        _bacaSiap: await request.text(),
        on() { return this },
        once() { return this },
        removeListener() { return this },
        destroy() {},
      }
      const res = {
        kasirOrigin: undefined,
        _status: 200,
        _headers: {},
        _body: '',
        writeHead(kode, h) { this._status = kode; Object.assign(this._headers, h || {}) },
        write(s) { this._body += s === undefined ? '' : String(s) },
        end(s) { this._body += s === undefined ? '' : String(s) },
        setHeader(k, v) { this._headers[k] = v },
        getHeader(k) { return this._headers[k] },
        removeHeader(k) { delete this._headers[k] },
        on() { return this },
        once() { return this },
      }

      await route(url.pathname)(req, res)
      return new Response(res._body, { status: res._status, headers: res._headers })
    } catch (e) {
      console.error('[kasir-sabana] fungsi API gagal:', e)
      return new Response(JSON.stringify({ ok: false, alasan: 'Kesalahan server.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    }
  },
}
