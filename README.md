# Kasir SABANA — Aplikasi Kasir Outlet Fried Chicken

Aplikasi **kasir & manajemen stok** untuk outlet SABANA Fried Chicken.
PWA offline-first: semua data tersimpan di perangkat (IndexedDB), tanpa
server backend. React + TypeScript + Vite.

## Fitur

- **Kasir** — grid menu per kategori, badge stok & keranjang, pembayaran
  Tunai/QRIS/Transfer, sumber pesanan (Offline/GoFood/GrabFood/ShopeeFood),
  blokir jual saat stok kurang
- **Struk 58 mm** — PNG/PDF + bagikan WhatsApp/unduh + cetak Bluetooth
  best-effort
- **Rantai stok** — Beli Bahan (konversi pak→potong), Produksi (per ekor &
  per produk), mutasi & koreksi stok
- **Kas Tunai** — buka/tutup shift, float Rp 350.000 (bisa diubah), setoran
  & selisih
- **Deep Fryer** — siklus minyak: isi awal 16 L, meter per ekor, ingatkan
  top-up 10 ekor & ganti 30 hari
- **List Belanja 3–7 hari** — dari pemakaian nyata, bagikan ke WhatsApp
- **Pengeluaran & Laporan** — HPP dari resep × harga beli riil, laba bersih,
  omzet per metode/platform, produk terlaris, rekap kas
- **Bahan & Produk** — kelola master, harga dengan riwayat, editor resep
- **Mode gelap**, sidebar + bottom nav mobile, aksesibilitas WCAG AA

## Perintah

```bash
npm install
npm run dev          # server pengembangan (localhost:5173)
npm run build        # build produksi ke dist/ (+ service worker PWA)
npm run lint         # oxlint
npm test             # unit test (vitest) — domain murni
npm run test:e2e     # tes end-to-end Playwright (alur kasir + offline PWA)
npm run preview      # sajikan build produksi (localhost:4173)
```

Tes E2E otomatis menjalankan build + dua server lokal (dev & preview) dan
menguji: jual via QRIS sampai struk, alur tunai dengan Buka/Tutup Kas, serta
aplikasi tetap berfungsi saat koneksi diputus (offline).

## Deploy

Lihat [docs/DEPLOY.md](docs/DEPLOY.md) — hosting statis HTTPS (Vercel /
Netlify / Cloudflare Pages) + panduan uji offline di HP.

## Desain sistem

Token warna/tipografi & keputusan UI disimpan di `design-system/kasir-sabana/`.
