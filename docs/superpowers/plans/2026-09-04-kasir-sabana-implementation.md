# Rencana Implementasi — Aplikasi Kasir SABANA (PWA)

- **Tanggal**: 2026-09-04 (revisi: platform Flutter/Android → **PWA web**)
- **Referensi spec**: `docs/superpowers/specs/2026-09-04-kasir-sabana-design.md`
- **Cara kerja**: setiap fase berakhir dengan aplikasi yang masih berfungsi; logika domain
  (konversi, stok, kas, siklus minyak) ditulis **test-first (TDD)** memakai Vitest.

## Prinsip pelaksanaan
- Tidak ada hardcode harga/menu/bahan — semua data master (spec §3)
- Penyimpanan lokal IndexedDB (Dexie); aturan bisnis murni di `src/domain/` yang bisa
  diuji tanpa UI/browser
- Setiap fase: fitur + tes + validasi manual di browser (Chrome Android/desktop)

## Stack terpilih
- **React + TypeScript + Vite**
- **Dexie** (IndexedDB) — database lokal offline
- **vite-plugin-pwa** (service worker, instalasi ke home screen)
- **Vitest** untuk tes unit domain
- Render struk: **canvas → PNG** (58 mm) + **jsPDF** untuk PDF; **Web Share API**
  (WhatsApp/email) dengan fallback unduh
- Web Bluetooth (opsional, hanya bila printer BLE tersedia) via API browser
- Alat impor data awal: skrip Python (sudah terbukti bisa baca kedua file) →
  menghasilkan `seed-data.json` yang di-commit sebagai data impor awal

---

## Fase 0 — Setup proyek & fondasi data (0,5–1 hari)
**Tujuan**: proyek web jalan; skema IndexedDB & seed data awal masuk; tes hijau.
- [ ] Cek/instal Node.js LTS + npm; init repo git (folder proyek masih kosong)
- [ ] Scaffold Vite + React + TS; aktifkan PWA (vite-plugin-pwa) & Dexie; Vitest siap
- [ ] Skema IndexedDB v1 (entity spec §5) + migrasi versi
- [ ] Skrip Python → parse `HPP Reguler.xlsx` & `Price List Sabana Sharing Mitra.pdf` →
      hasil: `seed-data.json` (bahan dari PDF: kode/nama/satuan/isi/harga; menu & resep
      dari Excel; ayam Reguler 48.000). Hasil impor **ditampilkan untuk direview** di layar
      sebelum disimpan ke DB
- [ ] **Verifikasi**: tes unit konversi satuan & komposisi ayam (3/2/2/2); import dua kali
      tanpa duplikasi
- **Keluaran**: aplikasi kosong berjalan di `localhost`, seed data masuk, tes hijau

## Fase 1 — Master data dinamis: Bahan & Produk/Menu (1–2 hari)
- [ ] CRUD Bahan Baku (tambah/edit/nonaktif/hapus; satuan beli, isi, konversi,
      komposisi ayam, ambang stok, harga beli default)
- [ ] CRUD Produk & Menu (kategori, harga jual + riwayat harga, aktif/nonaktif)
- [ ] Editor resep per produk (ItemResep: bahan/komponen, qty, tahap produksi/jual)
- [ ] Uji: nonaktifkan menu menyembunyikannya dari kasir tanpa menghapus data;
      edit harga tidak mengubah transaksi lama
- **Keluaran**: pengelolaan bahan & produk selesai; tes CRUD + riwayat harga hijau

## Fase 2 — Stok: Beli → Gudang, Produksi → Stok Jadi, Mutasi (2–3 hari)
- [ ] Transaksi Beli Bahan: konversi otomatis (pak ayam → per bagian; ikat → pcs),
      harga riil, mutasi stok, update harga beli terakhir, masuk biaya modal
- [ ] Transaksi Produksi manual: pilih produk + qty → potong resep produksi → tambah
      stok jadi; blokir bila bahan kurang (rincian kekurangan)
- [ ] Baris mutasi stok + riwayat per bahan/produk
- [ ] Koreksi stok / opname (selisih + alasan)
- [ ] Peringatan stok rendah & "perlu goreng X pak / buat Y pcs"
- [ ] **TDD**: 3 pak → 9/6/6/6; produksi 2 pak memotong ⅔ tepung & menambah stok jadi;
      jual memotong stok jadi + kemasan; pembatalan memulihkan stok
- **Keluaran**: rantai beli→produksi→jual konsisten & teruji

## Fase 3 — Kasir (jual) (2–3 hari)
- [ ] Layar kasir: grid menu per kategori (badge stok), keranjang, qty, subtotal
- [ ] Pembayaran: Tunai/QRIS/Transfer; input uang diterima → kembalian
- [ ] Sumber pesanan (Offline/GoFood/GrabFood/ShopeeFood) per transaksi
- [ ] Blokir jual bila stok jadi kurang (info jumlah kekurangan)
- [ ] Struk: render PNG 58 mm; bagikan via WhatsApp/email/unduh (lihat Fase 4 cetak)
- [ ] Pembatalan transaksi (stok & kas kembali, jejak tercatat)
- [ ] **TDD**: total/kembalian; potongan stok per baris; pembatalan
- **Keluaran**: jual end-to-end di browser HP/desktop

## Fase 4 — Cetak struk (printer & share) (1 hari)
- [ ] Panel struk setelah transaksi: pratinjau PNG 58 mm → tombol **bagikan ke
      WhatsApp** (Web Share API; fallback unduh gambar + instruksi cetak)
- [ ] Ekspor PDF struk (jsPDF) untuk arsip/cetak lewat dialog print
- [ ] Best-effort **Web Bluetooth** bila browser mendukung & printer BLE terpasang
      (pilih printer → kirim ESC/POS) — gagal → fallback share otomatis
- [ ] Pengaturan perilaku cetak (langsung share / tanya tiap transaksi / hanya simpan)
- **Keluaran**: alur struk lengkap sesuai keterbatasan browser; teruji di HP nyata

## Fase 5 — Kas Tunai (laci, float Rp 350.000) (1–2 hari)
- [ ] Buka Kas: saldo awal default 350.000 (pengaturan, bisa diubah) + opsi tambah saldo
- [ ] Penjualan tunai masuk buku kas otomatis; pengeluaran tunai dari laci dicatat
- [ ] Tutup Kas: hitung uang seharusnya; input hitungan fisik → selisih ±; setoran =
      fisik − 350.000 (float tersisa); laporan shift
- [ ] Blokir pembayaran tunai tanpa sesi kas terbuka
- [ ] **TDD**: simulasi shift (buka 350rb → jual tunai → beli kecil → tutup) →
      setoran & selisih benar; selisih ≠ 0 tampil mencolok
- **Keluaran**: siklus shift kasir lengkap & teruji

## Fase 6 — Pengeluaran, laporan, HPP & laba (2–3 hari)
- [ ] Pengeluaran operasional (kategori: listrik/gaji/sewa/kas kecil/dll., sumber dana)
- [ ] HPP otomatis: biaya rata-rata bahan terpakai × resep (harga beli riil)
- [ ] Laporan harian/bulanan/rentang: omzet per sumber & metode, produk terlaris,
      laba kotor & bersih, rekap produksi vs penjualan, rekap kas & setoran
- [ ] Ekspor laporan CSV
- [ ] **TDD**: HPP & laba cocok skenario manual; rekap produksi − penjualan = stok jadi
- **Keluaran**: laba bersih harian/bulanan akurat

## Fase 7 — Order online & pre-order (1–2 hari)
- [ ] Label platform + laporan per platform (+ komisi opsional %)
- [ ] Pre-order: buat (tanggal ambil, DP, item), opsi kunci stok, ambil → transaksi jual,
      batal → tercatat (pengembalian DP)
- [ ] **TDD**: pre-order → penjualan dengan DP & sisa bayar benar
- **Keluaran**: online & pesta tercatat, stok sinkron

## Fase 8 — Siklus minyak deep fryer (1 hari)
- [ ] CRUD Deep Fryer (isi 16 L, top-up tiap 10 pak, ganti 30 hari — semua editable)
- [ ] Produksi ayam menambah meter; peringatan top-up & ganti
- [ ] Catat penggantian minyak = beli minyak + reset siklus
- [ ] **TDD**: 10 pak → siap top-up; >30 hari → siap ganti; reset benar
- **Keluaran**: SOP minyak pusat terpantau

## Fase 9 — List belanja 3–7 hari & laporan malam (1–2 hari)
- [ ] Konsumsi harian rata-rata (jendela 14–30 hari) per bahan
- [ ] List belanja: kebutuhan = rata-rata × horizon − stok; pembulatan satuan beli;
      kelompok sumber (pusat/lokal); → salin/bagikan WhatsApp
- [ ] Laporan malam ringkas → bagikan WhatsApp/email/unduh
- **Keluaran**: belanja & rekap malam satu ketukan

## Fase 10 — Cadangan, instalasi, deploy & pemolesan (1–2 hari)
- [ ] Ekspor cadangan JSON (unduh/share/email) + impor/restore dari file;
      pengingat cadangan berkala (mis. tiap tutup kas)
- [ ] PIN kasir opsional; konfirmasi aksi sensitif
- [ ] **Deploy**: build PWA ke hosting HTTPS statis; instal di HP Android (home screen);
      uji offline penuh (mode pesawat) + uji struk share di HP nyata
- [ ] Polish: layout tablet/kasir, state kosong/error, tema
- [ ] Dokumentasi singkat pemakaian untuk kasir (termasuk cara cadangkan data)

---

## Urutan & ketergantungan
Fase 0 → 10 berurutan; Fase 4 (struk) menyusul Fase 3; Fase 6–9 bisa tumpang tindih
setelah 5. Deploy/uji perangkat nyata di Fase 10 — sampai saat itu cukup `localhost`.

## Risiko & mitigasi
- **Printer Bluetooth SPP/classic tak bisa dicetak browser** (keputusan desain): jalur
  utama share PNG/PDF ke WhatsApp + Web Bluetooth best-effort untuk printer BLE +
  printer WiFi/network sebagai opsi berikutnya
- **Hosting HTTPS wajib** agar PWA bisa diinstal & offline: pakai hosting statis gratis
  (Vercel/Netlify/Cloudflare Pages) — kredensial/akun disiapkan saat Fase 10
- **Data browser bisa terhapus** (clear cache/penggantian HP): pengingat ekspor cadangan
  berkala + tombol cadangan di layar utama
- **Data Excel/PDF berubah format**: alat impor terpisah (skrip Python) → hasil direview
  sebelum masuk DB
- **Angka resep Excel berbasis biaya**: jumlah bahan dihitung ulang & ditampilkan untuk
  validasi owner sebelum dipakai
- **Estimasi waktu**: ±12–18 hari kerja efektif; tiap fase menghasilkan versi terpakai
