# Delivery mandiri via tautan web — spec alur (revisi 1)

Status: **rancangan untuk disetujui** (belum diimplementasikan).
Tanggal: 2026-09-06 · Pemilik: owner Ayam Sabana.
Menggantikan revisi 0 (`delivery-mandiri-wa.md`, kanal WhatsApp gateway) — **alasan revisi (keputusan owner):**
1. WhatsApp gateway & QRIS provider resmi **tidak memungkinkan saat ini karena biaya**.
2. Kanal pelanggan dipilih: **tautan web** (katalog + pesan + bayar + status) — bukan bot WA.
3. Pembayaran QRIS: pakai teknik **konversi QRIS statis → nominal terkunci** (referensi: repo `verssache/qris-dinamis` dkk.) dengan verifikasi manual — tanpa MDR provider.
4. Ongkos kirim: **berbasis radius dari titik resto** (biaya per kilometer), bukan zona bebas.

---

## 1. Konteks & kondisi aplikasi saat ini

- Aplikasi **local-first**: seluruh data di IndexedDB (Dexie `pos-sabana` v11) tiap perangkat, offline-first PWA.
- Kasir mencatat penjualan seketika: sumber (Take away / Dine in / GoFood / GrabFood / ShopeeFood) + metode (Tunai / QRIS / Transfer / Online).
- Sudah ada: struk 58 mm (PNG/PDF/Bluetooth/bagikan), mesin refund, notifikasi browser, PIN & jejak audit, server sinkronisasi tipis (`server/server.mjs`), laporan per platform & produk terlaris, shift kas.
- **Belum ada**: pelanggan (nama/HP/alamat), ongkir, kurir, papan status pesanan, maupun kanal pesanan dari luar toko.

## 2. Tujuan & non-tujuan

**Tujuan**
1. Pelanggan memesan dari HP-nya lewat **tautan web** (tanpa aplikasi baru): lihat menu yang sinkron dengan kasir, alamat, bayar, pantau status.
2. **Menu = harga offline**, produk nonaktif/"sementara habis" tidak muncul; perubahan kasir terlihat < menit.
3. Pembayaran **QRIS nominal terkunci** (hasil konversi statis, Rp 0 MDR) + **COD**, dua-duanya dengan verifikasi manusia di kasir.
4. Kasir mengelola semua pesanan di **Papan Pesanan Antar**; rekon laci/shift/laporan otomatis benar (omzet, ongkir, COD belum disetor).
5. **CSAT (1–5)** tetap ada — lewat tautan/QR di struk antar & halaman status (tanpa gateway WA).

**Non-tujuan (v1)**
- Tanpa bot WhatsApp, tanpa push WA otomatis, tanpa pelacakan GPS kurir real-time.
- Tanpa aplikasi pelanggan terpisah; **tanpa QRIS provider resmi** (MDR) — bisa menyusul saat omzet naik (lihat §4.6 tier C).
- Server tetap tipis: harga/resep/stok tetap di kasir; server hanya katalog & pesanan.

## 3. Alur end-to-end (jalan bahagia)

```
1  Pelanggan buka tautan toko (QR di struk/meja/kemasan, link di IG, atau link yang
   dikirim kasir lewat WA biasa) → halaman katalog (menu sinkron kasir)
2  Pilih item + qty → isi alamat → tandai titik di peta (Leaflet/OSM, gratis)
   → jarak dari titik resto dihitung → ongkir tampil: biaya dasar + tarif/km
   → di luar radius maks → pesanan ditolak otomatis
3  Total = harga menu + ongkir → pilih bayar:
     a. QRIS    → server generate QR nominal terkunci (konversi statis→dinamis)
        → pelanggan scan & bayar → tekan "Saya sudah bayar" (+ unggah bukti opsional)
        → kasir verifikasi di papan (uang masuk terlihat di HP/bank shop) → Lunas
     b. COD     → "COD — bayar tunai saat kurir tiba"
4  Kasir terima di Papan Pesanan Antar → cetak slip dapur → "Dibuat"
5  Siap → cetak slip antar (alamat + HP + total COD + QR CSAT) → kurir → "Diantar" (timer SLA)
6  Selesai:
     a. COD        → kurir kembali → kasir tekan "COD dibayar" → tunai masuk laci + transaksi
     b. QRIS lunas → otomatis "Selesai" saat kurir konfirmasi
7  CSAT: halaman status menampilkan rating 1–5; struk antar memuat QR/tautan "nilai pesanan"
```

Kegagalan: tolak oleh kasir (stok tak cukup) / batal pelanggan → **Batal + alasan** → stok dilepas; QRIS yang sudah dibayar di-refund manual (alur refund yang ada) & pelanggan dihubungi.

**Dua momen dipisah** (laporan jujur):
- Stok/antrean produksi bergerak saat kasir **mengonfirmasi** pesanan.
- Uang tercatat saat **settlement**: COD saat kurir menyerahkan tunai (masuk laci shift); QRIS saat **verifikasi kasir** (masuk rekening toko — tidak menyentuh laci, seperti perlakuan omzet platform hari ini).

## 4. Keputusan arsitektur utama

### 4.1 Sisi komponen & hosting (tanpa biaya gateway)

| Sisi | Komponen | Status |
|---|---|---|
| **Kasir (aplikasi ini)** | Papan Pesanan Antar, pelanggan/kurir/tarif radius, slip, rekon laporan & shift | dibangun di aplikasi |
| **Halaman pelanggan (web)** | katalog + keranjang + peta alamat + QRIS + status + CSAT | baru — front-end statis |
| **Order server** | terima pesanan, simpan, webhook/status, katalog tersinkron | perluas fondasi yang ada |

Arah sync: kasir **dorong** katalog (tiap perubahan master + berkala ±5 mnt); kasir **tarik** pesanan baru ±10–30 dtk saat online + notifikasi browser.

Opsi hosting (tanpa gateway, tetap serendah mungkin):

| Opsi | Biaya | Keterangan |
|---|---|---|
| **A. Supabase (gratis) + front statis (Vercel/Netlify gratis)** | Rp 0 di skala kecil | sama dgn rekomendasi blueprint sinkronisasi; Postgres + REST mudah dipakai aplikasi; tinggal scale saat ramai |
| B. VPS kecil (Node + server yang ada) | Rp 30–80rb/bln | satu proses untuk order + sync; kendali penuh |
| C. Komputer toko + tunnel | Rp 0–tunnel | hanya uji coba lokal; mati saat listrik/internet toko mati |

Rekomendasi: **A** sekarang (biaya nol, backend terkelola), fallback B bila butuh kendali. Lapisan koneksi dibuat abstrak sehingga pindah A↔B tidak menyentuh UI.

### 4.2 Ketersediaan menu ("sync dengan kasir")

1. Produk nonaktif → tidak tampil (sinkron < menit).
2. Override manual **"Sementara habis"** per produk → langsung hilang.
3. Indikator lembut "Stok menipis" dari stok jadi/bahan di bawah ambang; batas akhir tetap **konfirmasi kasir** (§4.4) — bukan blokir otomatis.

### 4.3 Model data (penambahan)

Kasir (Dexie v12):
- `pelanggan(id, nama, noHp, alamatUtama?, lat/lng?, jumlahPesanan, terakhirPesan, ratingRata?)`.
- `kurir(id, nama, aktif)`.
- `pesananAntar(id?, uid, no, pelangganId?, nama, noHp, alamat, latLng?, jarakKm, ongkir, subtotal, total, metode: 'qris'|'cod', status, itemSnapshot[], catatan, kurirId?, waktuBuat, waktuBayar?, waktuVerifikasi?, waktuKirim?, waktuSelesai?, alasanBatal?, refTransaksiId?)`.
- `penilaian(id, pesananId, rating 1–5, catatan?, waktu)`.
- Pengaturan baru `tarifAntar`: `{ titikResto: {lat,lng}, biayaDasar, perKm, jarakMaxKm, gratisMin?, }`.
- Enum `SumberPesanan` + `'antar'` (label "Antar sendiri") → laporan per platform ikut otomatis.

Server: `katalog(produkUid, nama, harga, tersedia, habis, diperbarui)`, `pesanan(...)`, `penilaian`, `pelanggan` ringkas.

### 4.4 Mesin status & kontrol kasir

```
menunggu-bayar → (QRIS) menunggu-verifikasi → lunas / (COD) bayar-di-tempat
              → menunggu-konfirmasi-kasir → dibuat → siap → diantar → selesai
sembarang → batal (alasan wajib; stok dilepas; refund utk QRIS yang sudah dibayar)
```

Setiap status dari luar adalah peristiwa yang kasir **tarik**; kasir tidak pernah mengurangi stok tanpa keputusan manusia (**"Terima pesanan"** → cek stok singkat, boleh tolak → batal + info ke pelanggan). Konflik dua pesanan berebut stok diselesaikan lewat urutan konfirmasi ini.

### 4.5 Rekon laci & shift

- **COD dibayar** → `mutasiKas jual-tunai` ke shift aktif + transaksi `sumber 'antar', metode 'tunai'` (alur penjualan tunai yang ada).
- **QRIS lunas (terverifikasi)** → transaksi `sumber 'antar'`, metode `'qris'`, `referensi` = uid pesanan; **tidak masuk laci**.
- Shift ditutup saat pesanan berjalan → peringatan "COD belum disetor / pesanan berjalan: Rp …".
- Ongkir di header → laporan pisahkan **omzet produk** vs **pendapatan ongkir**; Finansial & struk shift ikut otomatis (satu sumber `transaksi`).

### 4.6 QRIS nominal terkunci — jujur soal tekniknya

Yang dilakukan repo konversi (mis. `verssache/qris-dinamis`): parse payload EMV/TLV QRIS statis → ubah tag 01 `11→12` (statis→dinamis) → sisip tag 54 (nominal) → hitung ulang CRC16. Hasilnya: QR dengan **nominal terkunci** yang tetap mengarah ke akun merchant yang sama.

**Apa yang berhasil & tidak berhasil:**
- ✅ Uang masuk ke rekening/akun yang sama seperti biasa (data merchant tidak berubah) — tidak ada masalah settlement baru.
- ✅ Pelanggan tidak perlu mengetik nominal; QR sekali pakai per order; UI lebih meyakinkan.
- ❌ **Tidak ada callback resmi / referensi transaksi unik** dari acquirer — QR "dinamis" buatan ini tidak terdaftar di jaringan sebagai transaksi dinamis sesungguhnya.
- ❌ Karena itu **"lunas" tidak bisa otomatis**; tetap perlu verifikasi kasir: pembeli menekan "Saya sudah bayar" + kasir mencocokkan notifikasi uang masuk di HP/bank shop (atau bukti unggah). Kehadiran **orang** adalah bagian desain, bukan kekurangan.
- ⚠️ QRIS dibuat dengan mengubah payload di luar penerbit → uji pilot kecil dulu, dan perhatikan ketentuan acquirer/bank pemilik QRIS (volume kecil UMKM umumnya aman; gunakan QRIS milik toko, bukan pribadi).
- ⚠️ Jangan sisipkan "service fee" (tag 55–57) ke QR — itu membebani pelanggan diam-diam.

Tier pembayaran (lapisan pluggable — kasir tidak berubah saat pindah tier):

| Tier | Cara | MDR/biaya | Callback otomatis | Kapan |
|---|---|---|---|---|
| **A** | QRIS statis biasa + "saya sudah bayar"/bukti + verifikasi kasir | Rp 0 | tidak | v1 (paling sederhana) |
| **B** | QR nominal terkunci (konversi statis→dinamis) + verifikasi kasir | Rp 0 | tidak (verifikasi manual) | v1 — sesuai keputusan owner |
| **C** | QRIS dinamis resmi (iPaymu/Midtrans/Xendit) | ±0,7% | ya (webhook) | nanti saat omzet & volume naik |

### 4.7 Ongkos kirim radius per kilometer

- Kasir menandai **titik resto** sekali di Pengaturan (peta Leaflet/OSM — gratis, tanpa API key).
- Pelanggan menandai titik alamatnya di peta; jarak dihitung **haversine** (km).
- Rumus ongkir: `biayaDasar + tarifPerKm × jarak` (contoh: Rp 5.000 + Rp 2.000 × 3,2 km ≈ Rp 11.400 → dibulatkan).
- Di luar `jarakMaxKm` (mis. 7 km) → **ditolak otomatis** (boleh override manual kasir untuk langganan).
- Opsional: `gratisMin` — gratis ongkir bila belanja ≥ Rp X (biaya ditanggung toko, tampil jujur di laporan).
- Fallback bila pelanggan tak mau peta: pilih dari **daftar area** (nama wilayah → km perkiraan yang ditentukan kasir).

## 5. UI aplikasi kasir

### 5.1 Papan Pesanan Antar (halaman/menu baru — grup Operasi)
- Kartu ber-status: **Baru · Dibuat · Siap · Diantar · Selesai · Batal** + pill (Lunas / COD / Menunggu verifikasi).
- Isi kartu: `#no`, nama + HP, alamat + jarak km, item, total + ongkir, timer SLA, aksi: **Terima → slip dapur**, **Verifikasi bayar**, **Siap → slip antar**, **Antar (pilih kurir)**, **COD dibayar**, **Batal + alasan**.
- Filter Semua/Berjalan/Selesai/Batal; notifikasi + suara saat pesanan baru; sumber `antar` juga untuk pesanan telepon (dicatat manual ke papan — satu alur).

### 5.2 Pengaturan
- **Tarif antar**: peta → titik resto; biaya dasar, tarif/km, jarak maks, gratis-min; daftar area fallback.
- **Kurir**: tambah/aktifkan staf.
- **Katalog & order**: toggle "terima pesanan web", tautan katalog (untuk QR/copy), status koneksi, "tarik pesanan sekarang"; Produk & Menu: toggle **"Sementara habis"**.
- **Notifikasi manual (opsional, Rp 0)**: tombol salin pesan siap-kirim ke pelanggan (`wa.me/…?text=…`) — kasir tinggal tap & kirim di WA biasa.

## 6. Halaman pelanggan (web, mobile-first)

- **Katalog**: gambar opsional, kategori, harga offline, tanda habis/stok menipis.
- **Keranjang → alamat**: isi + tandai titik di peta → ongkir otomatis.
- **Bayar**: QR nominal terkunci (tier B) dengan nominal & masa berlaku jelas, lalu tombol "Saya sudah bayar" + unggah bukti opsional; atau pilih COD.
- **Status**: halaman ber-link (token per pesanan) — Diterima/Dibuat/Diantar/Selesai/Batal + estimasi; tanpa bot WA, ini "pengganti notifikasi".
- **CSAT**: setelah selesai, halaman menampilkan rating 1–5 + komentar; QR di struk antar menuju halaman ini.
- Statis + REST ringan → bisa di-hosting gratis (Vercel/Netlify) dan dibuka dari QR mana pun.

## 7. Integrasi & perkiraan biaya

| Kebutuhan | Solusi v1 | Biaya |
|---|---|---|
| Kanal pesanan | Tautan web (front statis gratis + Supabase free / VPS) | Rp 0 (tier free) – Rp 80rb/bln |
| Peta & jarak | Leaflet + OpenStreetMap + haversine | Rp 0 |
| Pembayaran QRIS | Statis / konversi nominal terkunci + verifikasi manual | Rp 0 MDR |
| Notifikasi pelanggan | Halaman status + pesan `wa.me` manual oleh kasir | Rp 0 |
| Struk/slip & CSAT | Infra struk 58 mm yang ada + QR/tautan penilaian | Rp 0 |

## 8. Keamanan & privasi

- Halaman publik hanya menampilkan produk aktif (tanpa HPP/stok pasti/resep).
- Order dikunci token acak per pesanan (link status tak bisa ditebak).
- Nama/HP/alamat pelanggan = data pribadi: tampil di kasir & slip antar, tersimpan lokal + server; keputusan retensi dibahas di §10.
- Endpoint order divalidasi & anti-spam (batas per IP/pelanggan).

## 9. Roadmap bertahap

- **P0 — Fondasi kasir (tanpa web)**: `sumber 'antar'`, Papan Pesanan Antar, kurir, tarif antar (radius/km), slip, CSAT manual. Langsung dipakai untuk pesanan telepon/WA-manual.
- **P1 — Link web + order server**: hosting (Supabase free/VPS), katalog sinkron + halaman pelanggan (keranjang, peta→ongkir, status), kasir tarik pesanan + notifikasi.
- **P2 — QRIS nominal terkunci (tier B)**: generator konversi statis→dinamis (uji pilot kecil dulu), alur "saya sudah bayar" + verifikasi, refund QRIS.
- **P3 — CSAT & penguatan**: rating via link/QR, tren kepuasan di Finansial, SLA & keterlambatan, anti-penipuan (batas pesanan/pelanggan), cadangan.
- **P4 — Skala (opsional, nanti)**: QRIS dinamis resmi (tier C), WA gateway bila biaya sudah masuk akal, multi-perangkat penuh.

## 10. Pertanyaan terbuka untuk owner

1. **Hosting**: oke mulai **Supabase free + front gratis** (Rp 0), atau tetap mau VPS kecil?
2. **QRIS**: QRIS statis yang dipakai sekarang milik **toko/badan usaha** (bukan rekening pribadi)? Siap uji pilot tier B dengan nominal kecil dulu?
3. **Tarif antar**: biaya dasar + tarif per km berapa? Jarak maksimum? Titik resto di mana (alamat lengkap)?
4. **Jumlah kurir** aktif sekarang, dan jam buka terima pesanan (di luar jam → tampil "tutup")?
5. **Harga**: benar-benar sama dengan offline (ongkir menutup biaya), atau ingin markup kecil?
6. **COD vs QRIS**: ingin dorong QRIS (bayar dulu) — mis. gratis ongkir khusus bayar dulu?
