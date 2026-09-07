# Server sinkronisasi multi-perangkat (acuan)

Server tipis untuk menyatukan data antar perangkat (tablet kasir, HP pemilik).
**Tanpa dependensi** — cukup Node.js (≥18):

```bash
node server/server.mjs            # port default 5174
PORT=5174 node server/server.mjs  # ganti port
```

Store disimpan di `server/data/store.json` (bisa diganti lewat env `STORE_FILE`).
Ganti store menjadi PostgreSQL/Supabase saat siap produksi — kontrak endpoint
sama; lihat `docs/BACKEND-SUPABASE-VERCEL.md`.

## Struktur kode (Fase 2: handler bersama + store di-inject)

Logika kedua server dipisah dari node:http supaya kode yang sama dipakai di
jalur dev (JSON) dan produksi (Supabase + Vercel):

| File | Isi |
| --- | --- |
| `handler-order.mjs` | logika portal delivery → `penanganOrder(req, res)`; ekspor `pasangStore`, `aturSseAktif`, `cekGatewayPembayaran` |
| `handler-sync.mjs` | logika sinkronisasi → `penanganSync(req, res)`; ekspor `pasangStore` |
| `store-json.mjs` | store JSON (`buatStoreJsonOrder` / `buatStoreJsonSync`) — jalur dev |
| `store-supabase.mjs` | store Supabase (baca semua baris → bentuk sama → tulis delta) — jalur produksi |
| `order.mjs` / `server.mjs` | thin dev adapter (node:http + SSE + polling gateway 20 dtk utk order) |
| `api/[[...path]].mjs` (root) | Vercel Function catch-all — store Supabase, SSE mati |

SSE `/api/events` dan polling gateway 20 dtk **hanya berjalan di dev** —
serverless tidak punya koneksi panjang / `setInterval`; produksi memakai
webhook QRIS Bridge + polling per-pesanan klien (dan nanti Supabase Realtime,
P3).

## Endpoint

| Metode | Path          | Isi                                                                    |
| ------ | ------------- | --------------------------------------------------------------------- |
| GET    | `/api/health` | status, jumlah tabel, versi global                                     |
| POST   | `/api/devices`| `{ nama }` → `{ id, secret }`                                          |
| POST   | `/api/sync`   | `{ perangkatId, perangkatNama, dorong }` + header `X-Device-Secret`    |

`/api/sync` menyimpan baris push dengan **versi naik global + perangkatId**,
lalu mengembalikan `{ tarik: { tabel: [baris baru] }, versi, masuk }` — baris
yang versinya lebih besar dari versi terakhir yang diterima perangkat itu.

## Keamanan (wajib sebelum dipakai di jaringan nyata)

- **Kredensial perangkat.** `POST /api/devices` kini mengembalikan `{ id, secret }`.
  `POST /api/sync` **menolak (401)** bila header `X-Device-Secret` tidak cocok
  dengan secret yang diberikan saat registrasi — perangkat tanpa secret tidak
  bisa membaca/menulis database. Aplikasi kasir mendaftar otomatis saat pertama
  sinkron dan menyimpan secret-nya; bila server direset, perangkat daftar ulang
  sendiri dan mendapat id+secret baru (data lama di server yang direset hilang
  seperti biasa).
- **CORS allowlist.** Browser hanya boleh memanggil server dari origin yang
  diizinkan: default `localhost`/`127.0.0.1` (dev), atau set
  `CORS_ORIGIN=https://kasir.sabana.id,https://pesan.sabana.id` untuk
  produksi. Tanpa env, origin lain ditolak.
- **Jangan pernah** mengekspos port sinkron ini ke internet terbuka tanpa
  HTTPS + reverse-proxy auth — server ini untuk jaringan lokal (tablet kasir ↔
  HP pemilik).

## Kebijakan konflik (fondasi)

- **Penulis terakhir menang** per id di server (LWW sederhana tanpa jam).
- Perangkat menang "server menang" saat menggabungkan tarikan (baris id sama
  diganti, id baru ditambahkan).
- Keterbatasan yang disengaja (ada di roadmap arsitektur): belum ada oplog
  penuh, counter nota/shift terpusat, maupun kunci shift global — jangan
  dipakai di internet terbuka tanpa lapisan auth/HTTPS.

## Server order delivery (prototipe)

`npm run server:order` → server terpisah (port 5198) untuk prototipe halaman order
pelanggan (`web-order.html`): membaca snapshot katalog kasir
(`web-order/katalog-snapshot.json`), menerima pesanan, menyimpan status & penilaian.

```bash
npm run server:order          # http://localhost:5198/api/katalog
npm run dev                   # halaman: http://localhost:5173/web-order.html
# panel kasir (verifikasi + majukan status, dengan suara): tambahkan ?kasir=1
# tampilan berdampingan portal | papan kasir: http://localhost:5173/web-order-hub.html
```

### Login pelanggan — nomor HP + PIN (dibuat saat daftar pertama)

- **`POST /api/auth/register { hp, nama?, pin }`** — daftar pertama: wajib
  membuat PIN 4–6 angka. PIN disimpan sebagai **scrypt + salt acak** per
  pelanggan (bukan plaintext/SHA). Nomor yang sudah terdaftar ditolak (409).
- **`POST /api/auth/login { hp, pin }`** → `{ token, hp, nama, profil }`.
  PIN salah → 401. Pelanggan lama (sebelum PIN) masuk sekali dengan
  `perluSetPin: true`, lalu **`POST /api/auth/atur-pin { token, pin }`**
  menetapkan PIN — berikutnya wajib PIN.
- Nama & alamat terakhir tersimpan otomatis dan dikirim lagi saat login →
  repeat order tanpa mengetik ulang (`GET /api/auth/me?token=`).
- Login dibatasi **6 percobaan/menit per HP** (anti brute-force) dan jumlah
  sesi tersimpan dibatasi 2.000.

### Verifikasi jarak ongkir (server-side)

Portal mengirim **koordinat pin peta** (`lat`/`lng`) saat membuat pesanan;
server menghitung jarak dengan **haversine** dari koordinat resto
(`katalog.resto.lat/lng`) dan memakainya untuk ongkir + batas jangkauan —
klaim jarak dari klien (`jarakKm`) **diabaikan** bila koordinat tersedia.
Fallback ke `jarakKm` klien hanya untuk snapshot katalog lama tanpa koordinat.

### Keamanan endpoint kasir (wajib sebelum deploy)

Jalankan server dengan env **`KASIR_SECRET`** (contoh:
`KASIR_SECRET=$(openssl rand -hex 16) node server/order.mjs`). Saat diset,
semua endpoint manajemen kasir menolak (401) permintaan tanpa header
**`X-Kasir-Secret`** yang cocok:

- `GET/POST /api/pengaturan` (tarif, QRIS, gateway, bridge)
- `GET /api/pelanggan` (database pelanggan — PII)
- `GET /api/pesan` **tanpa** token pelanggan (daftar semua pesanan + chat)
- `POST /api/pesan/:id/aksi` (semua aksi kecuali `batal` pelanggan sendiri),
  `ubah`, `qris-callback`, dan `DELETE /api/pesan/:id`
- `POST /api/push` dengan `hp` langsung
- SSE `GET /api/events` → ganti header dengan query `?sse=<secret>`
  (EventSource tidak bisa set header)

Aksi pelanggan pada pesanan miliknya (lihat detail, chat, `bayar`, `batal`,
`penilaian`) memakai **token sesi pelanggan** (`?token=`), bukan secret kasir.
Tanpa `KASIR_SECRET`, server tetap terbuka penuh — hanya untuk dev (ada
peringatan di log saat start). **CORS:** browser hanya boleh memanggil dari
origin yang diizinkan (`CORS_ORIGIN=https://pesan.sabana.id` saat produksi;
default dev: localhost/127.0.0.1).

Cara isi secret di UI: Papan Pesanan Antar → kotak "🔑" di toolbar, dan panel
kasir portal (`?kasir=1`) → kolom "Secret kasir" di Pengaturan. Nilai tersimpan
di localStorage masing-masing perangkat.

### Verifikasi QRIS otomatis (opsional)

Ada dua jalur otomatis (bisa diaktifkan sendiri-sendiri; kosong = verifikasi
manual bukti oleh kasir tetap berlaku):

**1. QRIS Bridge (rekomendasi produksi) — dari notifikasi HP toko.**
Pasang app **qrishook** (MIT, repo `suriyadi15/qrishook`) di HP Android toko,
beri izin akses notifikasi, lalu isi URL webhook (`{server}/api/webhook/qris`)
dan secret di Pengaturan Papan (atau langsung di app). Setiap notifikasi
"pembayaran QRIS masuk" dari app merchant (bank/GoPay/OVO/DANA apa pun)
diteruskan ke `POST /api/webhook/qris` dengan payload qrishook
(`event_id`, `payment.amount`, `payment.payment_source`). `X-Webhook-Secret`
divalidasi bila secret diset; tanpa secret, fitur mati (pelanggan bayar
nominal pas tanpa penanda). `event_id` di-dedup anti-dobel. Begitu cocok →
pesanan langsung **Lunas otomatis** (`sumberVerifikasi: 'qris-bridge'`),
status naik ke "baru", dan chat pelanggan mendapat konfirmasi — sekaligus
server mengirim event **SSE** (`GET /api/events`) sehingga papan kasir
langsung berbunyi & menampilkan banner "💰 Pesanan lunas otomatis via QRIS
Bridge" **tanpa menunggu polling**.

**Strategi pencocokan nominal bisa dipilih** di Pengaturan Papan
(`pengaturan.bridge.strategiCocok`):

- **`total` (default) — total pas + jendela waktu.** Pelanggan membayar
  nominal pesanan yang sama persis; webhook mencocokkan nominal pas dalam
  jendela ±10 menit sejak kasir klik "Tersedia" (urutan paling tua dulu).
  Penanda unik (total + suffix 001-200) **hanya dibuat otomatis bila ada
  pesanan lain senominal yang masih aktif dalam ±10 menit** — dua pesanan
  nominal sama berdekatan tidak pernah saling salah-cocok.
- **`unik` — selalu penanda unik.** Tiap QR memakai total + Rp1–200 agar
  pencocokan pasti, tapi pelanggan membayar sedikit lebih besar dari total.

Tanpa penanda, pembayaran yang tiba >10 menit setelah "Tersedia" tidak
terauto-cocok → kembali ke verifikasi manual kasir / tombol "Cek gateway"
(aman, tidak ada status buntu).

**2. Gateway ShopeePay (alternatif, hanya uji) — repo
`ahmadzakiyox/shoppepay-api-gateway` (layanan eksternal sendiri, tanpa lisensi;
unofficial karena memakai token sesi ShopeePay Partner toko).** Isi URL
gateway + X-API-Key di Pengaturan Papan. Server **mem-poll gateway setiap 20
detik** (`POST {gateway}/check-payment` dengan `amount` = nominal unik/total +
`startTime`) untuk semua pesanan QRIS/transfer yang masih
`menunggu-verifikasi`, dan begitu `paid: true` pesanan langsung **Lunas
otomatis** (`transactionId` di-dedup anti-klaim dobel). Kasir juga punya
tombol manual `POST /api/pesan/:id/cek-pembayaran`.

> Catatan jujur: repo tersebut **unofficial** (memakai token sesi merchant
> ShopeePay Partner sendiri; lisensi proprietary — kita hanya *memanggil*
> endpoint HTTP-nya, tidak menyalin kodenya). Disarankan uji nominal kecil
dulu sebelum dipakai rutin; lisensi & risiko akun tetap tanggung jawab pemilik
toko.

### Refund pesanan (dana QRIS/transfer dikembalikan manual)

`POST /api/pesan/:id/aksi { aksi: 'refund', alasan?, metode?, nominal? }`
hanya berlaku untuk pesanan berstatus pembayaran `lunas` (QRIS/transfer, bukan
COD). Server menandai `statusPembayaran: 'refund'` dan menyimpan jejak audit
lengkap di `order.refund` (`{ nominal, metode, alasan, waktu, oleh: 'kasir',
transaksiId?, verifikasiOtomatis? }`) plus entri `riwayat` berstatus `refund`
dan pesan konfirmasi ke chat pelanggan. Refund otomatis **mengurangi `total`
belanja pelanggan** di database pelanggan (`GET /api/pelanggan`) — nilai yang
dibaca segmen pelanggan & ringkasan omzet portal di halaman Finansial.
Pengaman: refund dobel ditolak (400), `qris-callback`/webhook tidak akan
melunasi ulang pesanan yang sudah refund, dan verifikasi ulang tidak bisa
mengembalikan status ke `lunas`.

Di papan kasir tersedia tombol "↩️ Refund" (modal berisi metode pengembalian,
nominal, dan alasan) untuk pesanan lunas — termasuk yang sudah `selesai`/`batal`.
Portal pelanggan menampilkan "↩️ Dana dikembalikan" beserta rinciannya.

## Uji cepat

```bash
curl http://localhost:5174/api/health
# daftar perangkat → simpan { id, secret }
curl -X POST http://localhost:5174/api/devices -H 'Content-Type: application/json' -d '{"nama":"Kasir 1"}'
# sinkron WAJIB header X-Device-Secret
curl -X POST http://localhost:5174/api/sync -H 'Content-Type: application/json' -H 'X-Device-Secret: <secret>' \
  -d '{"perangkatId":"<id>","dorong":{"bahan":[{"id":1,"nama":"Minyak","stok":5}]}}'
# tanpa secret → 401
curl -X POST http://localhost:5174/api/sync -H 'Content-Type: application/json' -d '{"perangkatId":"<id>"}'
```

Di aplikasi: **Pengaturan → Data → Sinkronisasi** — isi alamat server, aktifkan,
lalu "Sinkronkan sekarang". Alamat bisa `http://IP-KOMPUTER:5174` dalam satu
jaringan Wi-Fi.