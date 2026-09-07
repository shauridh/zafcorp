# Backend: Supabase + Vercel (keputusan)

Database & realtime → **Supabase (Postgres)** · Hosting & fungsi API → **Vercel**.

## Arsitektur target

```
┌─ Kasir PWA (static, Vercel) ─┐   ┌─ Portal customer (static, Vercel) ─┐
│  IndexedDB (local-first)      │   │  katalog, keranjang, PIN login,     │
│  └ sinkron ke /api/sync       │   │  QRIS, status, chat                 │
└──────────────┬────────────────┘   └───────────────┬────────────────────┘
               │                                    │
               └──────────┬─────────────────────────┘
                          ▼
        Vercel Function — api/[[...path]].mjs  (satu catch-all)
        - route: /api/auth·pesan·pengaturan·pelanggan·push·webhook·sync·…
        - logika handler sama persis dgn server lokal (kontrak endpoint sama)
        - auth: KASIR_SECRET (env) + token sesi pelanggan (tabel `sesi`)
                          │
                          ▼
        Supabase Postgres (service role) — tabel pelanggan/pesanan/pengaturan/
        perangkat/baris_sync/… (supabase/schema.sql)
                          │
        Realtime broadcast  → papan kasir & panel kasir dapat event instan
        (pesanan-baru, lunas-bridge) tanpa SSE
```

## Yang berubah dari arsitektur sekarang

| Sekarang (server lokal) | Target (Vercel + Supabase) |
|---|---|
| `server/order.mjs` + `server/server.mjs` (node:http, jalan terus-menerus) | satu Vercel Function `api/[[...path]].mjs` (catch-all, stateless) |
| Store file JSON (`server/data/*.json`) | tabel Postgres (`supabase/schema.sql`) |
| SSE `GET /api/events` (koneksi panjang) | **Supabase Realtime broadcast** — serverless tidak cocok utk SSE |
| polling gateway 20 dtk (`setInterval`) | tidak jalan di serverless → webhook QRIS Bridge = trigger utama; portal sudah poll `cek-pembayaran` per pesanan; opsional pg_cron tiap 5 mnt |
| VAPID di store | tabel `vapid` (id=1) atau env `VAPID_PUBLIC/VAPID_PRIVATE` |
| KASIR_SECRET di env shell | env di Vercel |
| `npm run dev` pakai server lokal | tetap ada utk dev (JSON store) — kode handler sama, store di-inject |

**Tetap sama:** kontrak endpoint, validasi, auth pelanggan (PIN scrypt di
`pelanggan.pin_hash`), token sesi, strategi nominal QRIS Bridge, logika refund.

## Fase

### P1 — Fondasi (✅ selesai)
- Vite multi-page: `index.html` (kasir) + `web-order.html` (portal) + hub
  dibuild ke `dist/` → siap di-host Vercel.
- `vercel.json` (outputDirectory `dist`, `api/[[...path]].mjs` fungsi API).
- `supabase/schema.sql` — skema lengkap + RLS deny-by-default + urutan.
- Dokumen ini.

### P2 — Migrasi kode handler (belum)
- Ekstrak logika handler dari `server/order.mjs` & `server/server.mjs` ke modul
  bersama dengan store di-inject (`muatStore/simpanStore` menjadi antarmuka).
- Implementasi store **Supabase** (baca semua baris → bentuk store yang sama →
  mutasi di memori → upsert kembali; volume UMKM kecil, aman).
- Entry Vercel: `api/[[...path]].mjs` → panggil handler dgn store Supabase.
- Buang SSE & `setInterval` dari jalur produksi (dev tetap bisa).

### P3 — Realtime di klien (belum)
- Papan Pesanan Antar & panel kasir portal: ganti `EventSource(/api/events)`
  dengan langganan **Supabase Realtime broadcast** (`pesanan-baru`,
  `lunas-bridge`) — server (Vercel fn) `supabase.channel('papan').send(...)`
  setelah mutasi. Polling 2,5 dtk tetap sebagai fallback.
- Config klien: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (hanya utk
  realtime — tabel tetap tertutup).

### P4 — Provisioning & deploy (butuh akun Anda)
1. Buat project di [supabase.com](https://supabase.com) (region terdekat).
2. SQL Editor → jalankan `supabase/schema.sql`.
3. Settings → API: salin `Project URL`, `anon public key`,
   `service_role key` (rahasiakan service role!).
4. Deploy repo ke Vercel (dari GitHub `zafcorp`) → Vercel akan deteksi
   `vercel.json` + `api/`.
5. Env di Vercel:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `KASIR_SECRET` (mis. `openssl rand -hex 16`)
   - `CORS_ORIGIN` (origin portal, mis. `https://pesan.anda.vercel.app`)
   - opsional `VAPID_PUBLIC`/`VAPID_PRIVATE`
6. Deploy → uji: portal order → kasir board → lunas QRIS Bridge.

## Biaya (perkiraan, 1 outlet)

- **Supabase Free**: 500 MB DB, 2 project aktif, realtime terbatas — cukup utk
  mulai. Naik ke Pro ($25/bln) saat DB mendekati penuh / butuh backup PITR.
- **Vercel Hobby**: hosting static + serverless functions gratis (batas
  bandwidth 100 GB/bln). Naik Pro ($20/bln) utk cron & fungsi lebih lama.

## Batasan & risiko (jujur)

- **SSE tidak bisa** di Vercel — semua notifikasi instan lewat Realtime
  broadcast (event ephemeral). Kalau klien sempat offline, polling 2,5 dtk
  menutup celanya.
- **Tidak ada proses background**: polling gateway 20 dtk hilang. Konsekuensi:
  verifikasi auto gateway mengandalkan webhook QRIS Bridge + polling klien.
  Kalau butuh verifikasi berkala tanpa klien, pasang pg_cron (contoh di bawah
  `schema.sql`).
- **Fungsi serverless** dingin-dingin (cold start ~300–800 ms) — untuk volume
  UMKM tidak masalah.
- **Data lama** di `server/data/*.json` tidak otomatis pindah — saat P2 selesai,
  jalankan skrip impor sekali (json → tabel) sebelum cutover.
- Jangan pernah menaruh `service_role` key di kode klien — hanya env server.

## Perintah cepat (saat P4)

```bash
# buat env produksi untuk vercel (setelah login vercel + link project)
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add KASIR_SECRET production
vercel env add CORS_ORIGIN production
vercel --prod
```
