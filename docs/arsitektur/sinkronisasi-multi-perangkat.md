# Sinkronisasi multi-perangkat — blueprint arsitektur

Status: **rancangan** (belum diimplementasikan). Dipicu kebutuhan: “shift & stok terbaca dari semua perangkat outlet” dan blokir shift ganda lintas perangkat.

## 1. Konteks & batasan saat ini

- Aplikasi **local-first**: semua data di IndexedDB (Dexie) tiap perangkat — `pos-sabana` v9, tanpa server.
- Konsekuensi: data per perangkat; tidak ada cara mendeteksi “shift aktif di perangkat lain”, “stok dipakai kasir lain”, atau laporan terpusat.
- Fitur yang paling merasakan batas ini: **shift kas** (satu shift aktif global), **stok gudang/jadi**, **harga & resep**, **fryer meter**, **transaksi**, **catatan finansial**.

## 2. Tujuan & non-tujuan

**Tujuan**
1. Semua perangkat outlet (kasir, dapur, meja owner) membaca **data yang sama** dengan jeda rendah (detik–menit).
2. Tetap berfungsi penuh saat **offline** (kasir jalan terus walau jaringan putus).
3. Satu **shift aktif global**: perangkat kedua tidak bisa membuka shift bila shift masih aktif di perangkat lain; pergantian shift konsisten.
4. Rekonsiliasi stok lintas perangkat (beli di satu perangkat langsung terlihat kasir lain).
5. Migrasi bertahap tanpa menghentikan pemakaian.

**Non-tujuan**
- Tidak membangun aplikasi cloud penuh / multi-cabang pada iterasi pertama.
- Tidak mendukung edit pararel konflik rumit antar-kasir pada dokumen yang sama (kasus utama adalah append/entri, bukan edit bersama).

## 3. Keputusan utama

### 3.1 Model: local-first + sinkronisasi terkelola (server tipis)

Pertahankan Dexie sebagai sumber utama di perangkat; server menjadi **koordinator & replika**. Alasan:
- Lanjutan dari arsitektur sekarang (SeedGate, Dexie versioning, PWA offline sudah ada).
- Server tidak perlu jadi “source of truth yang cepat” — cukup tolak ukur konsistensi & push.

Pilihan server (opsi A/B):

| Opsi | Kelebihan | Catatan |
|---|---|---|
| **A. Supabase (Postgres + Realtime + Storage + Auth)** | cepat dibangun, auth + push + storage gambar struk gratis; bahasa client mapan | vendor cloud; tabel + RLS perlu dirancang |
| **B. Self-hosted Node + Postgres/Redis + WebSocket** | kontrol penuh & biaya tetap | lebih banyak pekerjaan operasional |

Rekomendasi: mulai **A (Supabase)** karena kecepatan pengiriman nilai; rancangan skema/netral sama untuk B.

### 3.2 Sinkronisasi: oplog + LWW dengan jam versi

Setiap entitas mendapat:

```
entity_kind   — 'bahan' | 'produk' | 'transaksi' | 'sesiKas' | …
entity_id     — UUID global (bukan auto-increment lokal)
updated_at    — server clock (dari server saat commit)
origin        — device_id yang terakhir menulis
deleted       — tombstone (soft delete)
```

Tiap perangkat menulis ke **oplog lokal** (append-only):

```
oplog(id, entity_kind, entity_id, op, payload, device_id, updated_at)
```

- Sinkronisasi periodik (dan saat online): pull oplog `updated_at > lastSeen` → terapkan ke DB lokal lewat fungsi domain yang sama dengan alur offline.
- Konflik ditangani **LWW per-entitas** (`updated_at`), bukan merge per-field, kecuali tipe tertentu (lihat §4).
- Karena hampir semua alur berbentuk *entri baru* (transaksi, beli, produksi, mutasi, riwayat harga, catatan finansial), LWW-per-baris hampir tanpa konflik nyata. Kasus edit-bersama (master produk/bahan/resep/harga) langka dan LWW dapat diterima untuk iterasi 1 dengan UI konfirmasi saat “perubahan jauh” (bandingkan `origin`/waktu).

**Batas lokal-id vs UUID**: tabel berelasi (beli→beliItem, transaksi→transaksiItem, produksi→header) butuh id global stabil. Strategi: simpan id numerik lokal **dan** `uid` global; relasi memakai `uid`. Di iterasi pertama cukup tabel induk + anak dikirim dalam satu “dokumen” ber-`doc_id` bersama.

### 3.3 Penomoran (no transaksi, shift #, id struk)

Nomor cantik (nota #N, shift #N) tidak lagi murni dari id auto-increment lokal:
- `id` numerik lokal tetap untuk UX; **`no` tampilan dihitung per-outlet** dari counter terpusat (tabel `counter`) atau counter berbasis tanggal (idempotent: `YYYYMMDD-seq` dari server). Memakai `no` berbasis tanggal menghindari race & tetap cantik di struk.

### 3.4 Satu shift global (blokir lintas perangkat)

- `sesiKas` disimpan server dengan status; **buka shift = operasi atomik server**:
  1. perangkat kirim `bukaShift(device, saldoAwal, float, nama)`.
  2. server menolak bila `sesiKas` aktif masih ada (status `buka`) → alasan jelas (“shift #N aktif sejak … oleh perangkat X”).
- Offline → izinkan **kunci “pending buka”** maksimal N menit lalu dipaksa konfirmasi saat online kembali; aturan SOP: kasir harus online untuk *mulai* & *akhiri* shift (momen jarang, toleran terhadap jaringan).
- `tutupShift` juga atomik (perhitungan fisik/selisih/setoran sekali di server; klien hanya kirim input fisik).

### 3.5 Stok: jangan simpan stok sebagai angka tunggal yang di-edit

Hindari “stok = angka di mana-mana di-update”. Stok dihitung = saldo awal + **mutasi** (tabel `mutasiStok` append-only per entitas/bagian). Ini membuat:
- sinkronisasi cukup menyebar mutasi baru (tidak ada update-stok yang bertabrakan);
- setiap perangkat menghitung ulang stok dari mutasi yang sudah ia terima;
- riwayat/opname/beli/produksi/jual konsisten.

Penghitungan ulang dari nol per render tidak praktis → simpan **snapshot kalkulasi** lokal + proses replay mutasi yang belum terpakai (sudah menjadi model `mesinHpp`/`laporan` saat ini — diperluas ke stok).

## 4. Aturan konflik per entitas (ringkas)

| Entitas | Strategi |
|---|---|
| transaksi + item | append; tidak diedit → tidak konflik |
| mutasiStok / mutasiKas / oplog | append; konflik tak mungkin |
| beli/produksi/koreksi + baris | satu dokumen LWW; anti-ganda via `client_id` unik di header |
| master produk/bahan/resep/harga | LWW per entitas + tombstone; UI menandai “diubah perangkat lain” |
| sesiKas | **server-lock atomik** (bukan LWW) |
| fryer (meter ekor) | meter adalah angka agregat — simpan sebagai *events* top-up/ganti/goreng (mirip mutasi) lalu agregasi |
| catatanFinansial / pengeluaran | append per baris; hapus pakai tombstone |

Anti-duplikasi penting untuk **transaksi**: klien membuat `client_id` (UUID) saat checkout; server dedup berdasarkan `client_id` → retry aman saat offline/online.

## 5. Auth, keamanan & identitas perangkat

- **Identitas perangkat**: `device_id` dibuat sekali & disimpan (crypto.randomUUID) + nama perangkat.
- **Akun outlet**: owner membuat akun (email/sandi atau magic-link) → satu **workspace outlet**; perangkat bergabung via kode undangan 6 digit (bisa offline setelah join).
- Supabase RLS: semua baris di-scope `outlet_id`; hanya anggota workspace yang bisa membaca/menulis; `sesiKas` punya constraint server untuk lock.
- Struk/sharing tidak berubah (share file lokal); tidak ada data sensitif pelanggan selain nama item & nominal.

## 6. Skema & migrasi

- Tambahkan kolom sinkron: `uid`, `outlet_id`, `updated_at`, `origin_device`, `deleted` pada tabel yang akan disinkron — dipindah bertahap per kelompok tabel (master → transaksi → stok → shift → finansial).
- Dexie tetap versi bertingkat; **lokal menyimpan kedua** nilai (id lama + uid) sampai semua fitur memakai uid.
- Server memakai Postgres dengan skema mirror + tabel `oplog`, `outlet`, `device`, `invite`.

## 7. Alur sinkron (perangkat)

```
online / interval 15–30 dtk
  └ pull:   /sync?after=<lastSeen>          → oplog baru server → terapkan
  └ push:   POST /sync  (oplog lokal)       → server validasi + dedup(client_id)
  └ pushResult → tandai terkirim; tulis lastSeen = max(updated_at)
offline
  └ semua entri jalan normal (local) + antre di oplog; badge “N belum tersinkron”
  └ saat kembali online: push dulu, lalu pull
```

Batas ukuran: `oplog` paginasi; payload kecil (baris), bukan seluruh DB.

## 8. Dampak ke UI & fitur terkait

- Topbar/pill Shift menampilkan device origin aktif; halaman Riwayat Shift menandai asal device.
- Dashboard/Finansial menambah mode “data tersinkron dari N perangkat · terakhir HH:MM”.
- Notifikasi PWA saat “shift dibuka dari perangkat lain” / konflik stok menipis — melengkapi watcher fryer yang sudah ada.
- Struk & ekspor gambar tidak berubah (selalu build dari data lokal).

## 9. Roadmap bertahap

1. **P0 — Fondasi**: identitas outlet/device, auth, tabel sinkron, oplog push/pull, migrasi master (bahan/produk/resep/harga), badge offline.
2. **P1 — Transaksi & stok**: transaksi + mutasi + counter no-nota; snapshot stok perangkat; dedup client_id.
3. **P2 — Shift lintas perangkat**: server lock buka/tutup shift, riwayat per device, notifikasi.
4. **P3 — Fryer, finansial, pelengkap**: event meter fryer, catatan finansial/pengeluaran.
5. **P4 — Operasional**: retensi & arsip, audit, multi-cabang (outlet berbeda) bila diperlukan.

## 10. Pertanyaan terbuka (perlu keputusan owner)

- Server: Supabase (cepat, vendor) vs self-hosted?
- Periode offline maksimum untuk *mulai/akhiri shift* tanpa online (usulan: wajib online saat dua momen itu)?
- Aturan konflik edit master secara bersamaan: LWW cukup, atau perlu UI “gabung manual”?
- Kebutuhan multi-cabang dalam 1–2 tahun (mempengaruhi desain `outlet_id` & no-nota)?
