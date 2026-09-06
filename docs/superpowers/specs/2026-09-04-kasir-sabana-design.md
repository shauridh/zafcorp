# Spesifikasi Desain — Aplikasi Kasir SABANA Fried Chicken

- **Tanggal**: 2026-09-04
- **Status**: Draft untuk direview
- **Platform**: Aplikasi web **PWA** (React + TypeScript) — diinstal ke home screen HP/tablet Android atau dibuka di PC; update cukup deploy ke server
- **Tempat**: 1 outlet (waralaba SABANA Fried Chicken), 1–2 kasir

---

## 1. Ringkasan

Aplikasi kasir personal untuk outlet waralaba SABANA Fried Chicken yang mencatat
seluruh rantai operasional — **beli bahan → penyimpanan → produksi (goreng) → penjualan**
— dalam satu sistem tersambung, sehingga stok produk jadi selalu konsisten dengan stok
di penyimpanan dan setiap angka (omzet, HPP, laba) bisa ditelusuri.

Berjalan **offline penuh** (PWA: aplikasi diinstal ke home screen, semua data di perangkat,
tetap berfungsi 100% tanpa internet). Data dicadangkan sebagai file ekspor (unduh/share,
berkala & manual). Cetak struk: **PDF/gambar struk → WhatsApp** sebagai jalur utama
(dengan best-effort langsung ke printer bila perangkat mendukung), karena printer thermal
Bluetooth klasik (SPP 58 mm) tidak bisa dicetak langsung dari browser.

## 2. Konteks & keputusan kunci (hasil diskusi)

| # | Keputusan |
|---|-----------|
| 1 | Waralaba SABANA: bahan baku, menu, harga jual ditetapkan pusat (data master), outlet menjalankan SOP |
| 2 | Alur: Beli (selling point) → Penyimpanan → Produksi → Penjualan |
| 3 | 1 ekor/pak ayam = **9 potong**: 3 dada, 2 paha atas, 2 paha bawah, 2 sayap; dijual per potong dengan harga berbeda |
| 4 | 1 pak tepung bumbu cukup untuk **3 ekor ayam** (aturan pusat) |
| 5 | Siklus minyak per deep fryer: isi awal **16 L**, top-up setelah **10 pak ayam** digoreng, ganti **maks 30 hari** (atau lebih cepat bila kualitas turun) |
| 6 | Ayam yang dipakai outlet: **Reguler Rp 48.000/ekor** (sheet SBP tidak dipakai) |
| 7 | Menu dijual **pilihan** — setiap produk bisa diaktifkan/dinonaktifkan |
| 8 | Data awal: resep & menu dari `HPP Reguler.xlsx`; daftar & harga beli default bahan dari `Price List Sabana Sharing Mitra.pdf` |
| 9 | Metode bayar: **Tunai, QRIS/e-wallet, Transfer**; tanpa piutang |
| 10 | Sumber pesanan: Offline, GoFood, GrabFood, ShopeeFood — untuk estimasi pendapatan per platform |
| 11 | Ada fitur **pre-order** (pesanan pesta) |
| 12 | Kas tunai (laci): buka shift **Rp 350.000**, tutup kas otomatis menyisakan **Rp 350.000**, sisanya setoran |
| 13 | **Tanpa hardcode**: harga, menu, bahan baku, dan semua daftar operasional adalah data yang dapat ditambah/diedit/dihapus kapan saja |

## 3. Prinsip non-negosiasi: tidak ada hardcode

- **Tidak ada satu pun harga** (jual maupun beli) yang ditulis permanen di kode aplikasi.
  Semua harga tersimpan di database sebagai data master yang bisa diubah kapan saja.
  Perubahan harga jual tercatat riwayatnya; transaksi lama tetap memakai harga saat itu.
- **Menu dan bahan baku adalah data dinamis**: tambah, edit, nonaktifkan, atau hapus
  menu/bahan kapan saja lewat layar pengelolaan — tanpa perlu perubahan aplikasi.
- Parameter operasional (float kas 350.000, isi awal minyak 16 L, top-up tiap 10 pak,
  ganti maks 30 hari, ambang stok rendah, durasi estimasi belanja) semuanya **pengaturan
  yang bisa diubah**, bukan konstanta kode. Angka di dokumen ini hanyalah nilai awal bawaan.
- Data awal (seed) hanya **data impor pertama**, selalu bisa dikoreksi di aplikasi.

## 4. Arsitektur

- **Stack**: React + TypeScript (Vite), dibuild sebagai **PWA** (service worker untuk
  offline & instalasi ke home screen); host statis HTTPS (Vercel/Netlify/Cloudflare Pages
  atau sejenisnya) agar bisa diinstal & tetap jalan offline.
- Penyimpanan lokal **IndexedDB** (via Dexie); aplikasi berfungsi penuh tanpa internet.
- **Backup/restore**: ekspor data ke file JSON — unduh ke perangkat, bagikan ke
  WhatsApp/email, atau simpan di cloud (Drive/OneDrive) lewat share OS; restore dari file.
  (Cadangan otomatis berkala di perangkat + pengingat ekspor berkala.)
- **Cetak struk 58 mm**: ESC/POS dirender sebagai PDF/gambar → dibagikan/dicetak;
  percobaan langsung ke printer via **Web Bluetooth** bila printer mendukung BLE;
  printer **WiFi/network** bisa ditambahkan belakangan (kirim ESC/POS ke IP printer).
- Desain UI layout besar & tombol sentuh ramah jari (mode kasir); tema terang/gelap.
- Tanpa akun wajib, tanpa langganan; data milik pemilik outlet sepenuhnya.

### Struktur kode (tingkat tinggi)

- `src/data/` — IndexedDB (Dexie), repository per domain (bahan, produk, transaksi, kas, laporan)
- `src/domain/` — model & aturan bisnis murni (konversi pak→potong, resep, siklus minyak, hitung kas)
- `src/ui/` — layar & alur (kasir, produksi, beli, laporan, pengaturan)
- `src/services/` — render struk/PDF, Web Bluetooth (opsional), ekspor/impor cadangan, share

## 5. Model data

Entitas utama:

### 5.1 BahanBaku (bahan mentah & kemasan, stok gudang)
- kode pusat (mis. 100001), nama, kategori (Ayam, Minyak, Tepung & Bumbu, Saus/Sambal,
  Kemasan, Nasi & Kentang, Minuman, Gas, Lainnya), aktif
- satuan beli + isi per satuan (dari PDF: "1 Pack = 9 Potong", "1 Ikat = 100 Lembar")
- **satuan dasar** untuk stok (potong, pcs, liter, gram, kg)
- faktor konversi satuan beli → satuan dasar
- **khusus ayam**: komposisi pecahan 1 pak = {dada: 3, paha_atas: 2, paha_bawah: 2, sayap: 2} —
  stok ayam mentah dilacak per potongan (lihat 6.1)
- harga beli default (terakhir), ambang stok rendah (peringatan), estimasi pemakaian harian
  (dihitung otomatis dari riwayat — untuk list belanja)

### 5.2 ProdukMenu (yang dijual)
- nama, kategori jual (Ayam Goreng, Paket, Nasi, Aneka Gorengan, Sambal, Minuman, Lainnya), aktif
- harga jual **saat ini** + **riwayat harga**
- tipe stok:
  - **produksi** (perlu digoreng/dibuat dulu → stok jadi) — ayam per potongan, roll, baso,
    kulit, kentang, katsu, nasi, sambal cup, dll.
  - **langsung jual** (minuman & sejenisnya — tidak lewat produksi)
- resep produksi & resep jual (daftar ItemResep)
- label/varian bila perlu (paket isi 2 nasi dll.)

### 5.3 ItemResep (BOM per produk)
- produk id, bahan baku id **atau** komponen produk jadi id (mis. rice bowl memakai "sayap goreng" = produk jadi, plus kemasan = bahan)
- qty dalam satuan dasar bahan / satuan produk komponen
- tahap konsumsi: **produksi** (saat digoreng/dibuat) atau **penjualan** (kemasan, saus, plastik)

### 5.4 Stok
- **StokGudang**: per bahan baku (dalam satuan dasar). Ayam mentah dilacak per bagian potongan.
- **StokJadi**: per produk produksi (jumlah siap jual: dada goreng, sayap goreng, nasi, dst.)
- **StokLangsung**: minuman & produk siap jual tanpa produksi (cukup satu baris per produk)
- Setiap perubahan stok menghasilkan **baris mutasi** (waktu, jenis: beli/produksi/jual/koreksi,
  referensi dokumen) — semua angka bisa ditelusuri.

### 5.5 DeepFryer & siklus minyak
- nama (Fryer 1, Fryer 2…), isi awal liter (default 16), ambang top-up dalam pak ayam (default 10),
  batas hari ganti (default 30), aktif
- pencatatan: tanggal isi awal, jumlah pak ayam digoreng sejak isi, hari sejak isi
- peringatan otomatis: "top-up minyak setelah 10 pak", "ganti minyak — sudah 30 hari"
- penggantian minyak = catat pembelian minyak (masuk gudang) + reset siklus; alasan ganti
  (rutin / kualitas turun) dicatat.

### 5.6 Transaksi penjualan
- no transaksi, waktu, kasir, sumber (Offline/GoFood/GrabFood/ShopeeFood),
  metode bayar (Tunai/QRIS/Transfer), baris item {produk, qty, **harga jual saat transaksi**},
  subtotal, diskon (jika ada), total, dibayar/kembalian (tunai), referensi pre-order (opsional),
  status (selesai/dibatalkan)
- pembatalan = batalkan transaksi → stok & kas dikembalikan otomatis, tercatat di laporan

### 5.7 Produksi
- waktu, produk, qty, catatan
- efek otomatis: stok gudang −(bahan resep produksi) → stok jadi +(produk × qty);
  deep fryer +pak ayam bila produk berbahan ayam (untuk siklus minyak)

### 5.8 Pembelian (Beli Bahan) & penyesuaian stok
- waktu, sumber (Pusat selling point / lokal), baris {bahan, qty dalam satuan beli, harga satuan riil},
  total, metode bayar, nomor bukti (opsional)
- efek otomatis: stok gudang + (dengan konversi satuan; ayam pecah per potongan);
  masuk pengeluaran (modal bahan); harga beli default bahan diperbarui ke harga terakhir
- jenis lain: koreksi stok / stok opname (selisih dicatat, bisa diberi alasan)

### 5.9 Kas Tunai (laci kasir)
- **Sesi kas (shift)**: waktu buka, saldo awal laci (default Rp 350.000, pengaturan — bisa
  diubah; opsi menambah saldo awal bila menaruh lebih), kasir, status (buka/tutup)
- **Mutasi kas**: tunai masuk dari penjualan (otomatis), tunai keluar (pengeluaran tunai
  dari laci, wajib kategori), penambahan laci (uang luar masuk laci)
- **Tutup kas**: hitung uang seharusnya = saldo awal + tunai masuk − tunai keluar;
  kasir input **hitungan fisik** → selisih ± dihitung & dicatat (tampil mencolok bila ≠ 0);
  **setoran** = uang fisik − Rp 350.000 (otomatis menyisakan float untuk shift berikutnya)
- riwayat sesi kas & rekap setoran per hari

### 5.10 Pengeluaran operasional
- kategori (Listrik, Gaji Karyawan, Sewa Kios, Gas, Perawatan, Kas Kecil, Lainnya),
  nominal, tanggal, sumber dana (laci kas / rekening / lain), keterangan
- beli bahan otomatis tercatat sebagai biaya modal; kas kecil dari laci ikut memengaruhi buku kas

### 5.11 PreOrder
- pelanggan, no hp, tanggal ambil/kirim, daftar item (produk + qty), uang muka (DP) + metode,
  status (dipesan / diambil / batal)
- saat diambil → menjadi transaksi penjualan (sisa dibayar; DP dipakai); pembatalan tercatat

### 5.12 Pengaturan
- nama outlet, alamat, no HP (untuk struk & laporan), default float kas, parameter deep fryer,
  ambang stok, komisi platform (opsional, %), PIN kasir (opsional), printer bluetooth

## 6. Alur inti & aturan bisnis

### 6.1 Beli
Beli 3 pak ayam potong 9 (Rp 48.000/pak) →
stok ayam mentah bertambah: dada 9, paha atas 6, paha bawah 6, sayap 6.
Beli tepung 1 pak → gudang tepung +1 pak (dasar: 1 pak).
Setiap pembelian menyimpan harga riil per satuan beli → dasar HPP.

### 6.2 Produksi
Dicatat **manual** oleh kasir/owner — aplikasi tidak menebak kapan menggoreng:
- "Produksi 2 pak ayam (18 potong)" → gudang −(ayam mentah per komposisi 2 pak,
  ⅔ pak tepung, minyak sesuai resep) → stok jadi +(dada goreng 6, paha atas 4, paha bawah 4,
  sayap 4); deep fryer mencatat +2 pak untuk siklus minyak.
- "Produksi 10 tusuk chicken roll" → gudang −(10 roll mentah, minyak per resep) → stok jadi +10.
- "Produksi 10 cup sambal geprek" → gudang −(sambal, cup) → stok jadi +10.
- Bahan yang dikonsumsi **saat penjualan** (kemasan, saus sachet, plastik) tidak terpotong
  di produksi, melainkan saat jual.
- Stok jadi di bawah ambang → peringatan "goreng X pak / buat Y pcs".

### 6.3 Jual (kasir)
Pilih produk (stok jadi / langsung) → qty → subtotal → pilih sumber & metode bayar →
tunai: input uang diterima → hitung kembalian → cetak struk (bluetooth) →
stok terpotong otomatis (stok jadi & kemasan dari resep jual), kas tunai masuk (bila tunai).
Bila stok jadi tidak cukup → kasir diblokir dengan info kekurangannya.

### 6.4 Konversi & resep kunci (nilai awal — semua bisa diedit)
- 1 ekor ayam = 9 potong (3 dada, 2 PA, 2 PB, 2 sayap) — beli & produksi memakai komposisi ini
- Tepung: ±⅓ pak per ekor ayam (dari aturan pusat 1 pak : 3 ekor)
- Minyak goreng: ±0,2 L per ekor ayam (sesuai sheet HPP) → dasar pemakaian gudang;
  siklus fryer mengikuti SOP (16 L / top-up tiap 10 pak / ganti 30 hari)
- Per produk: resep mengikuti angka BOM di `HPP Reguler.xlsx` (mis. nasi = ⅑ L beras/bungkus,
  chicken bun = ⅓ sayap goreng per bun, dst.) — dihitung & diverifikasi saat implementasi seed
- HPP dihitung aplikasi dari **harga beli riil** + resep (metode biaya rata-rata) — angka HPP
  di Excel hanya referensi validasi, bukan sumber hitung

### 6.5 Kas Tunai
Alur shift harian: **Buka Kas (350.000)** → transaksi tunai (masuk laci) & pengeluaran tunai
(keluar laci, dicatat) → **Tutup Kas**: hitung fisik → selisih ± → setoran = fisik − 350.000.
Tanpa sesi kas terbuka, pembayaran tunai tidak bisa diselesaikan (wajib buka kas dulu).

### 6.6 Order online
Transaksi normal + label sumber. Opsional: komisi % per platform → laporan menampilkan
omzet per platform dan estimasi bersih setelah komisi. Stok & kas terpotong sama seperti offline.

### 6.7 Pre-order
Pesanan dicatat lebih dulu (tanggal ambil, DP) → stok dapat "dipesan" (opsi kunci stok).
Saat diambil: konversi ke transaksi penjualan, sisa dibayar, struk dicetak.

### 6.8 List belanja 3–7 hari
- konsumsi harian rata-rata per bahan dihitung dari pemakaian nyata (jendela 14–30 hari),
- kebutuhan = (rata-rata harian × horizon) − stok gudang saat ini,
- dibulatkan ke satuan beli (pak/karung/ikat),
- output: daftar "yang harus dibelanjakan" per sumber (pusat/lokal) → salin/bagikan ke WhatsApp.

### 6.9 Pengeluaran & laba
- Laba kotor = omzet − HPP (biaya bahan yang benar-benar terpakai, dari mutasi stok & harga riil)
- Laba bersih = laba kotor − pengeluaran operasional
- Beli bahan = biaya modal saat dibeli; yang belum terpakai = aset stok (tidak langsung jadi beban)

## 7. Layar utama

1. **Kasir** — grid menu per kategori (dengan badge stok menipis), keranjang, bayar
   (metode, sumber, tunai+ kembalian), cetak struk; shortcut buka/tutup kas
2. **Produk & Menu** — CRUD menu, kategori, harga (riwayat), resep produksi/jual, aktif/nonaktif
3. **Bahan Baku & Stok** — CRUD bahan, stok gudang per satuan, beli bahan, koreksi/opname,
   riwayat mutasi, peringatan habis, siklus minyak per fryer
4. **Produksi** — catat produksi, panduan jumlah ideal (dari penjualan & stok), riwayat
5. **Kas & Pengeluaran** — buka/tutup kas, mutasi laci, selisih, pengeluaran operasional
6. **Laporan** — harian/bulanan/rentang: omzet per sumber & metode, produk terlaris, HPP &
   laba, pengeluaran, rekap produksi vs penjualan, rekap kas & setoran; **laporan malam** ringkas
   → bagikan ke WhatsApp/email/Drive; **list belanja 3–7 hari**
7. **Pre-order** — daftar & buat pesanan, DP, ambil/kirim, batal
8. **Pengaturan & Data** — identitas outlet, parameter (float kas, fryer, ambang stok, komisi),
   PIN, printer, backup/restore, impor data master awal

## 8. Struk (58 mm)

Header: nama outlet + alamat/no HP; isi: item, qty, harga, total; sub: subtotal, diskon,
total, tunai, kembalian; sumber & metode bayar; footer: terima kasih, no transaksi, tanggal,
kasir. Layout ramping 58 mm (tidak semua kolom muat).

**Alur cetak di PWA**: (1) struk dirender sebagai gambar/PDF 58 mm; (2) kirim ke printer
bila Web Bluetooth tersedia & printer BLE — percobaan gagal/tidak didukung → otomatis
(3) tampilkan struk + tombol **bagikan ke WhatsApp/email/unduh PDF**. Keputusan cetak
langsung vs share bisa diatur di Pengaturan (default: tanya tiap transaksi).

## 9. Data awal (seed dari 2 file)

- **Bahan baku**: daftar dari PDF (~60 item; kode, nama, satuan beli, isi, harga) —
  data impor pertama, bukan hardcode
- **Menu & resep**: dari Excel (sheet PENDAPATAN, NASI, CR, BKS, CS, CHICKEN BUN, KULIT,
  BURGER, KENTANG, GEPREK, BULDAK, MENTAI, SADAS, SAMBAL HITAM, SAMBAL IJO, KATSU,
  RICE BOWL 650/500) dengan harga jual & komposisi resep; ayam memakai sheet REGULER
- Catatan: beberapa resep di Excel berbasis biaya → jumlah bahan dihitung ulang ke satuan
  dasar dan **diverifikasi saat implementasi** (dibantu konfirmasi owner bila perlu)
- Harga beli default memakai PDF; harga jual memakai Excel; keduanya langsung bisa diedit
- Menu tidak aktif saat awal bila qty simulasi 0 (Chicken Bun, Burger, Buldak, Sadas,
  Sambal Hitam) — owner tinggal mengaktifkan bila dijual

## 10. Keamanan & operasional

- PIN kasir opsional (mencegah orang lain membuka layar kasir)
- Aksi sensitif (tutup kas, hapus transaksi, koreksi stok) dikonfirmasi ulang
- Semua perubahan (harga, stok, koreksi) bermutasi & tercatat; transaksi tidak bisa dihapus
  permanen — hanya dibatalkan (jejak tetap ada)

## 11. Non-goals (di luar versi 1)

- Multi-outlet / sinkronisasi antar cabang
- Manajemen karyawan/payroll penuh, akuntansi pajak
- Cetak langsung ke printer thermal Bluetooth SPP/classic & USB (tidak mungkin dari
  browser web) — printer BLE atau WiFi/network bisa ditambahkan belakangan
- Integrasi API GoFood/GrabFood/ShopeeFood (hanya pencatatan manual + komisi opsional)
- Laporan ke pusat waralaba (format khusus) — data bisa diekspor bila dibutuhkan

## 12. Asumsi terbuka (akan dikonfirmasi saat implementasi)

- Komposisi resep non-ayam disusun ulang dari angka biaya Excel → butuh validasi owner/pusat
- Frekuensi produksi dicatat per batch (per pak / per 10 tusuk), bukan per potong
- Satu perangkat utama kasir (data lokal); backup Drive untuk keamanan
