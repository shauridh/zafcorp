# Checklist Go-Live — Kasir SABANA

Checklist wajib sebelum aplikasi dipakai dengan pelanggan/uang sungguhan.
Kerangka: hasil security review (lihat ringkasan di bawah) + kebutuhan deploy.

## 🔴 Wajib — keamanan (blokir go-live bila belum)

- [ ] **Order server (port 5198) dijalankan dengan `KASIR_SECRET`**
      ```bash
      KASIR_SECRET=$(openssl rand -hex 16) PORT=5198 node server/order.mjs
      ```
      Tanpa ini semua endpoint kasir terbuka — siapa pun yang tahu alamat server
      bisa menandai pesanan Lunas, me-refund, menghapus pesanan, membaca seluruh
      data pelanggan, dan mengganti string QRIS (pembayaran pelanggan bisa
      dialihkan ke rekening penyerang).
- [ ] **Kasir (papan/panel) memakai secret yang sama** — isi di toolbar Papan
      Pesanan Antar (kotak 🔑) dan panel kasir portal bila dipakai.
- [ ] **`CORS_ORIGIN` diset** ke origin nyata portal & aplikasi
      (mis. `https://pesan.sabana.id,https://kasir.sabana.id`). Tanpa env ini,
      server hanya menerima browser dari localhost (dev).
- [ ] **Server sinkronisasi (port 5174) sudah versi terbaru** (perangkat dapat
      `id + secret`, `/api/sync` menolak tanpa `X-Device-Secret`). Perangkat
      kasir mendaftar otomatis; pastikan satu kali "Sinkronkan sekarang" berhasil
      setelah upgrade.
- [ ] **Jangan ekspos port 5198/5174 ke internet tanpa HTTPS + reverse proxy.**
      Kalau portal harus diakses publik, pakai HTTPS (mis. Caddy/nginx) di depan
      server order, dan batasi origin via `CORS_ORIGIN`.
- [ ] **PIN pemilik diaktifkan** di aplikasi kasir (Pengaturan → Keamanan) —
      melindungi zona Finansial/master di perangkat (hash PBKDF2 150k iterasi +
      kunci 10 menit setelah 5× salah).
- [ ] **PIN pelanggan aktif** — pelanggan baru wajib daftar dengan PIN 4–6 angka
      (scrypt + salt acak di server); alur `perluSetPin` untuk pelanggan lama
      sudah disiapkan.

## 🟠 Penting sebelum transaksi nyata

- [ ] **QRIS Bridge dipasang** (qrishook di HP toko + secret webhook di
      Pengaturan Papan) — verifikasi otomatis dari notifikasi HP; strategi
      pencocokan default `total pas + jendela waktu`. Uji dengan nominal kecil
      dulu. Alternatif gateway ShopeePay **hanya untuk uji** (unofficial,
      berisiko akun).
- [ ] **Uji alur bayar tanpa bukti** (bridge aktif): pelanggan bayar → server
      deteksi → Lunas otomatis → suara + banner di papan.
- [ ] **Uji alur refund** di papan: lunas → Refund → total belanja pelanggan
      turun, omzet portal Finansial net.
- [ ] **Cadangan otomatis diaktifkan** (Pengingat cadangan 7 hari) dan satu kali
      unduh cadangan berhasil.
- [ ] **Sinkronisasi dicek dua arah**: ubah harga produk di tablet → sinkron →
      HP pemilik melihat perubahan (dan sebaliknya).

## 🟡 Setelah live pertama

- [ ] Pastikan **jam WIB** konsisten di papan/portal/Finansial (server simpan UTC).
- [ ] Pantau **refund bulanan** di halaman Finansial (panel Pesanan Antar).
- [ ] Pastikan **push notifikasi pelanggan** terkirim (aktifkan di portal sekali).
- [ ] **Ongkir terverifikasi server-side** — portal kirim koordinat pin peta,
      server hitung haversine dari koordinat resto (klaim jarak klien diabaikan).
      Pastikan koordinat resto di snapshot katalog akurat.

## Ringkasan hasil security review (referensi)

- **Critical** (sudah diperbaiki dalam kode): endpoint kasir tanpa auth →
      `KASIR_SECRET` + token pelanggan; `POST /api/pengaturan` terbuka (redirect
      QRIS, SSRF) → dilindungi; sync server terbaca/ditulis bebas → secret
      perangkat; CORS `*` → allowlist.
- **High** (diperbaiki): jarak ongkir diisi klien → kini dihitung server dari
      koordinat (haversine); klaim jarak klien diabaikan.
- **Medium** (diperbaiki): prototype pollution lewat `hp` (disanitasi digit),
      push tanpa auth (butuh kasir), rate-limit login, perbandingan secret
      timing-safe, batas sesi tersimpan.
- **Aplikasi utama**: hash PIN pemilik ditingkatkan SHA-256 → **PBKDF2-SHA256
      150k iterasi + salt acak** dengan migrasi hash lama otomatis, plus kunci
      10 menit setelah 5× percobaan salah.
- **Catatan desain**: token sesi tidak kedaluwarsa (batas jumlah tersimpan
      2.000). Login pelanggan kini PIN-based; HP saja tidak cukup lagi.