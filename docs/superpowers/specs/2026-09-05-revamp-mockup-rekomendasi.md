# Rekomendasi Mockup & Alur — Kasir SABANA (v8)

> Dokumen ini = *gambaran lengkap* (blueprint) rekomendasi antarmuka & alur untuk seluruh aplikasi,
> agar bisa direview bersama sebelum eksekusi per halaman. Ini **gambar rangka (wireframe teks)**,
> bukan implementasi. Basis: design system `design-system/kasir-sabana/MASTER.md` & mockup v6/v7
> (`mockups/ui-v6-nav.html`, `mockups/ui-v7-dashboard.html`).
> Tanggal: 2026-09-05.

---

## 1. Status halaman hari ini

Legend: 🟢 sudah direvamp · 🟡 dasar/tengah · 🔴 belum tersentuh / masih menyimpang

| Halaman (rute) | Status | Catatan |
|---|---|---|
| Shell & navigasi | 🟢 | kas pill, toggle tema di kaki sidebar, rail dgn pemisah grup, drawer+bottom-nav |
| Dashboard (`/`) | 🟢 | filter Hari ini/Kemarin/7 hari/Bulan ini, kartu KPI, donat, produk terlaris, kas, aksi cepat |
| Kasir (`/kasir`) | 🟢 | checkout dua sisi (struk ⬅ ➡ metode/sumber/numpad), grid 3–6 kolom, bar shift, take-away/dine-in/online |
| Bahan & Stok (`/bahan`, form) | 🟢 | pola daftar+form selesai (ConfirmDialog); catatan kecil di bawah |
| Pengaturan (`/pengaturan`) | 🟢 | sub-menu 6 kategori, semua pengaturan terpusat |
| Struk 58mm | 🟢 | layout profesional + sambutan/penutup dari pengaturan |
| Produk & Menu (`/produk`, form) | 🟡 | **prioritas berikutnya** (master inti, pola dipakai halaman lain) |
| Beli Bahan (`/beli`) | 🟡 | perlu review pola multi-baris + konversi satuan |
| Produksi (`/produksi`) | 🟡 | perlu review meter minyak fryer & hasil potong |
| Koreksi/Opname (`/koreksi`) | 🔴 | belum pernah dibahas |
| Riwayat Stok (`/mutasi`) | 🔴 | belum pernah dibahas |
| Transaksi (`/transaksi`) | 🔴 | ada rute tapi tidak di sidebar — akses terbatas |
| Laporan (`/laporan`) | 🔴 | masih *stub* → redirect Dashboard |
| Pengeluaran (`/pengeluaran`) | 🟡 | dasar, sudah pakai ConfirmDialog |
| Deep Fryer (`/fryer`) | 🔴 | belum pernah dibahas |
| List Belanja (`/belanja`) | 🔴 | belum pernah dibahas |

---

## 2. Peta aplikasi & alur inti

### 2.1 Alur operasional harian (dari bangun sampai tutup)

```
                ┌──────────────┐
    buka toko ─▶│   DASHBOARD  │◀─ pill status kas (topbar) & kartu "Kas tunai"
                └──────┬───────┘
                       │ Buka Kasir (butuh sesi kas: buka kas dulu)
                       ▼
   ┌───────────────────────────────────────────────┐
   │ KASIR  — pilih item → Checkout → bayar        │
   │   • tunai   → numpad/preset → masuk laci      │
   │   • QRIS/Transfer                             │
   │   • GoFood/GrabFood/Shopee → ESTIMASI online  │
   └───────────────┬───────────────────────────────┘
                   │ selesai jual / istirahat
                   ▼
          KASIR bar shift "Kelola/Tutup"
          (uang fisik = catatan; online tampil sbg info)
```

### 2.2 Alur restock & produksi (siklus bahan → stok jadi)

```
 BELI BAHAN ──▶ MUTASI(+beli) ──▶ PRODUKSI ──▶ stok jadi menu ──▶ KASIR
      ▲                              │
      │                              ▼
 LIST BELANJA ◀── (ambang bahan)  DEEP FRYER meter (minyak per ekor)
 (3–7 hari, ambil dari sisa & pemakaian)
```

### 2.3 Alur master & kontrol

```
 BAHAN (gudang) ──┐
                  ├──▶ PRODUK & MENU (harga + resep: bahan & komponen) ──▶ KASIR
 RESEP tahap ─────┘
 KOREKSI/OPNAME ──▶ MUTASI Stok (±)   (catat fisik vs catatan)
 TRANSAKSI ──▶ detail → batalkan ──▶ stok & kas dikembalikan
 PENGELUARAN ──▶ kas keluar (laci) / beban laporan
 LAPORAN ──▶ omzet, HPP, laba, metode, sumber, produk terlaris
```

**Kesenjangan alur yang perlu diputuskan (lihat §4):**
1. `/transaksi` & `/laporan` tidak ada di sidebar → jalan buntu dari Dashboard.
2. Belanja tidak bisa "langsung jadi nota Beli" (klik → bawa ke `/beli`).
3. Produk nonaktif/habis tidak punya satu tampilan "sembunyikan kasir" yang jelas.
4. HPP produk: aturan harga rata-rata vs FIFO belum tampil transparan di mana pun.

---

## 3. Standar komponen lintas halaman (dipakai seragam)

Agar review per halaman cepat & tidak bolak-balik, standar berikut dipakai di semua halaman baru:

| Bagian | Standar |
|---|---|
| Halaman daftar | judul + tombol "+" di kanan atas; toolbar: pencarian + chip kategori; daftar baris/kartu; empty-state ramah |
| Halaman form | `form-grid` 2 kolom (1 kolom di <640px); label kecil jelas; hint bawah; tombol Simpan kanan + Batal kiri; validasi inline |
| Aksi destruktif | selalu `ConfirmDialog` (komponen sudah ada): judul, penjelasan, tombol merah |
| Badge | `badge` netral · `badge.stock` hijau (stok) · amber = peringatan · merah = habis/nonaktif |
| Status | pill titik berwarna (hijau aktif/buka, abu tutup, kuning perhatian) |
| Nominal | selalu `formatRupiah`, tabular-nums, konsisten di semua kartu & tabel |
| Kosong vs 0 | nominal kosong tampil "—", bukan Rp 0 (sudah dipakai Dashboard) |
| Pop-up | kelas `km` + `km-overlay` (Escape, fokus) |

---

## 4. Rekomendasi per halaman (yang belum final)

### 4.1 Produk & Menu — `/produk` (+ form) — 🟡 prioritas berikutnya
**Tujuan:** master menu yang dipakai kasir; tiap produk = harga + resep + stok + status.

Daftar:
```
[ Cari menu…        ] [Kategori ▾ semua/ayam/…]  [+ Menu baru]
┌──────────────────────────────────────────────────────────┐
│ Ayam Dada Goreng        [Ayam Goreng]  Rp 11.000  ●Aktif  │
│   stok 10 · HPP ±Rp 5.900 · resep 4 bahan                │
│   [Resep] [Harga] [Edit] [Nonaktifkan]  ⋮                │
├──────────────────────────────────────────────────────────┤
│ (baris "Habis"/"Nonaktif" diredupkan + badge)            │
└──────────────────────────────────────────────────────────┘
```
Form (tambahan dari yang sudah ada): **tab/stepper** → ① Info dasar (nama, kategori, harga, tipe stok)
② Stok (awal/opname ringkas) ③ **Resep** (daftar bahan/komponen + tahap produksi/jual, total biaya
langsung = HPP, margin) ④ Riwayat harga (tabel: berlaku sejak, harga, sumber perubahan).

**Poin yang harus direview:**
- [ ] Tampilkan **HPP langsung** & estimasi margin di baris (bukan hanya harga jual).
- [ ] Nonaktifkan: konfirmasi singkat + produk langsung hilang dari kasir (bukan cuma badge).
- [ ] Resep pakai pola "roti isian": tiap baris = pilih entitas (bahan/produk jadi) + satuan dasar + qty + tahap.

---

### 4.2 Beli Bahan — `/beli` — 🟡
**Alur:** buka nota → tambah baris (nama bahan otomatis bawa satuan beli & isi) → isi qty & harga riil
→ total otomatis → Simpan → kas keluar? / stok masuk + mutasi.

- Header nota: sumber (supplier) bebas teks, tanggal, catatan.
- Baris: `Bahan ▾ | qty beli | satuan beli | harga/satuan | subtotal | ✕`
- Ringkas: total; tombol "Simpan Beli" hijau + "Batal".
- Rekomendasi: *(baru)* tombol **"+ dari List Belanja"** — mengisi baris otomatis dari daftar kekurangan.
- Pertanyaan review: apakah belanja tunai otomatis mencatat "Kas keluar" (kategori Belanja bahan) atau dibiarkan manual?

---

### 4.3 Produksi — `/produksi` — 🟡
**Dua konteks:**
1. **Ayam** — pilih ayam mentah (ekor) → pilihan komposisi hasil (mis. 9 potong) → otomatis memotong stok
   bahan (ayam, tepung, minyak via meter) & menambah stok jadi (dada/PA/PB/sayap) — **Fryer meter** bertambah.
2. **Produk lain** (kentang, dsb.) — resep tahap produksi → hasil jadi.

Layout usulan: satu kartu "Catat produksi" dengan stepper ringkas + **panel "Hari ini"** (ekor digoreng per fryer, status minyak: sisa pakai/top-up/ganti).

- Meter minyak harus tampil **sebelum** produksi (kalau ekor berikutnya melewati ambang top-up → peringatan).
- Setelah simpan: ringkasan stok keluar/masuk + tombol "Produksi lagi".

---

### 4.4 Koreksi & Opname — `/koreksi` — 🔴 (belum dibahas)
**Tujuan satu halaman:** menyesuaikan stok saat stok fisik beda dengan catatan (tumpah, salah catat, opname).

```
[Pilih: Bahan gudang ▾ / Produk jadi ▾]  →  tabel:
Bahan        Stok catatan   Stok fisik    Selisih   Ket.
Ayam dada        12           10          −2    tumpah
...
[✓ Simpan koreksi]   ← selalu lewat ConfirmDialog (perubahan stok)
```
- Setiap baris otomatis: selisih + arah (lebih/kurang); simpan → `mutasiStok` jenis `koreksi`.
- Mode **opname**: satu tombol "Mulai opname" → kunci halaman lain? (opsional: isi fisik semua item aktif).

---

### 4.5 Riwayat Stok (Mutasi) — `/mutasi` — 🔴
- Filter: jenis (Beli/Produksi/Jual/Koreksi/Opname) × entitas (Bahan/Produk) × tanggal; pencarian nama.
- Baris: waktu | entitas | jenis (badge warna) | ±qty | referensi (Beli #12) | catatan.
- Klik baris `Beli #12` → buka modal detail nota beli (read-only). Klik `Jual #3` → detail transaksi.
- Tampilan **saldo berjalan** opsional per bahan (mode: pilih bahan → grafik/urutan mutasi).

---

### 4.6 Transaksi — `/transaksi` — 🔴 (di sidebar? keputusan §4.0)
- Daftar riwayat (default hari ini, filter tanggal/status), kartu tiap nota: `#nomor · waktu · metode · sumber · total`.
- Klik → **detail & aksi**: rincian item, struk ulang (panel aksi PNG/PDF/share/cetak — reuse StrukPanel),
  tombol **"Batalkan transaksi"** (ConfirmDialog; jelaskan stok & kas dikembalikan) + badge "Batal" bila sudah.
- **Keputusan peta:** taruh di sidebar grup *Harian* sebagai "Penjualan" (sebelum Kasir) — menghilangkan jalan buntu.

---

### 4.7 Pengeluaran — `/pengeluaran` — 🟡
Sudah baik (daftar + form + hapus). Penyempurnaan:
- Kategori tetap berbentuk chip pilihan cepat + tetap boleh kategori bebas.
- Baris menampilkan "asal dana": **Laci kas (tunai)** vs **Beban operasional**? → pengaruhi buku kas vs laporan laba. *(keputusan data)*
- Filter bulan + total per kategori ringkas.

---

### 4.8 Deep Fryer — `/fryer` — 🔴
Kartu per fryer (nama, aktif): isi awal L, top-up setelah N pak, ganti setelah H hari — dari pengaturan.
```
┌ Fryer 1 ●aktif ─────────────────────────────┐
│ Minyak 16 L sejak 02/09   • dipakai 38 ekor  │
│ Meter: [██████████░░░░] sisa ±6 ekor s/d top-up│
│ [Top-up] [Ganti minyak] [Riwayat]           │
└──────────────────────────────────────────────┘
```
- Riwayat tiap fryer (isi/top-up/ganti) + peringatan bila lewat ambang hari.
- Angka dipakai ekor = dari produksi (otomatis) — review akurasi pembagian antar-fryer.

---

### 4.9 List Belanja — `/belanja` — 🔴
- Menghitung kebutuhan **3–7 hari** (pilihan hari) dari: stok sisa + ambang + resep/jualan estimasi.
- Tabel: bahan | satuan beli | stok (dasar) | estimasi butuh | **rekomendasi beli** (dibulatkan ke satuan beli).
- Tombol besar **"Bawa ke Beli Bahan"** → isi nota beli otomatis (alur §4.2) — menghilangkan kesenjangan #2.
- Panel kecil: estimasi biaya total & bahan yang masih cukup (jangan dibeli).

---

### 4.10 Laporan — `/laporan` — 🔴 (stub saat ini)
Jadikan halaman mandiri; Dashboard = ringkas, Laporan = dalam + ekspor.
- Tab/jeda waktu: Hari ini · Kemarin · 7 hari · Bulan ini · **Rentang custom**.
- Blok: KPI (omzet, transaksi, rata-rata nota, laba bersih, online) → grafik omzet → **tabel rinci per hari**
  (omzet, HPP, pengeluaran, laba) → breakdown metode & sumber → produk terlaris (qty + omzet + %).
- Aksi: **Cetak / simpan PDF ringkasan harian** (layout A5) & **Ekspor CSV**.
- Nav: masuk sidebar grup *Harian* → Dashboard & Laporan berdampingan; Dashboard tetap cepat, Laporan untuk telaah.

---

### 4.11 Dashboard — polish lanjutan (setelah halaman lain mantap)
- Kartu **"Perlu perhatian"** tetap; tambahkan shortcut sesuai peran: stok menipis → `/mutasi?f=stok`, bahan habis → `/beli?dari=list`.
- Strip laba tambah **drill** (klik hari → buka `/transaksi?tanggal=…`).

---

## 5. Rekomendasi urutan implementasi berikutnya

Karena pola sudah disepakati (form-grid, dialog, chips, tab), eksekusi sebaiknya:

1. **Produk & Menu** — settle pola form+resep+harga (dipakai Produksi/Koreksi).
2. **Transaksi** (detail + batalkan + struk ulang) — paling sering dipakai staf.
3. **Beli → List Belanja** (dua-duanya saling menyambung, kerjakan berurutan).
4. **Koreksi/Opname → Riwayat Stok** (sumber & tampilan data yang sama).
5. **Deep Fryer → Produksi** (meter minyak & produksi saling terkait).
6. **Pengeluaran** polish → **Laporan** (butuh semua sumber data final) → Dashboard drill.

## 6. Catatan untuk sesi review

Beri tanda/setujui/tolak untuk tiap keputusan bertanda **★**:
- ★ `/transaksi` & `/laporan` masuk sidebar grup *Harian*?
- ★ Beli tunai otomatis "Kas keluar" atau manual?
- ★ Koreksi/opname: mode kunci opsional saat opname?
- ★ Pengeluaran: bedakan sumber dana laci vs beban?
- ★ HPP: aturan rata-rata (default) — tampilkan di produk & laporan?
- ★ List Belanja: cakupan default 5 hari?

Setelah review menyeluruh disetujui, halaman berikutnya dikerjakan satu per satu mulai **Produk & Menu**, lalu lanjut per daftar §5.
