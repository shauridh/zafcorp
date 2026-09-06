import Dexie, { type Table } from 'dexie';

/**
 * Skema IndexedDB (Dexie) v1.
 * Perubahan skema berikutnya memakai Dexie .version(n).upgrade(...).
 */

export interface KomposisiAyam {
  dada: number;
  pahaAtas: number;
  pahaBawah: number;
  sayap: number;
}

export interface Bahan {
  id?: number;
  /** kode barang dari pusat (mis. 100001) — opsional untuk bahan lokal */
  kodePusat?: string;
  nama: string;
  kategori: string;
  aktif: boolean;
  /** satuan beli yang dipakai saat belanja (mis. "1 Pack", "1 Karung") */
  satuanBeli?: string;
  /** isi per satuan beli (mis. "9 Potong", "100 Lembar") */
  isiLabel?: string;
  /** satuan dasar stok: potong / pcs / liter / gram / kg / ml */
  satuanDasar: string;
  /** harga beli default terakhir (rupiah per satuan beli) */
  hargaBeliDefault?: number;
  /** ambang peringatan stok rendah (satuan dasar) */
  ambangMin?: number;
  /** konversi: 1 satuan beli = berapa satuan dasar (mis. 1 ikat = 100 pcs) */
  jumlahDasarPerBeli?: number;
  /** stok saat ini dalam satuan dasar */
  stok: number;
  /** khusus ayam mentah: stok & komposisi per bagian potongan */
  isAyam?: boolean;
  komposisiAyam?: KomposisiAyam | null;
  stokDada?: number;
  stokPahaAtas?: number;
  stokPahaBawah?: number;
  stokSayap?: number;
}

export interface ProdukMenu {
  id?: number;
  nama: string;
  kategori: string;
  aktif: boolean;
  /** harga jual saat ini (riwayat harga terpisah, ditambahkan di Fase 1) */
  hargaJual: number;
  /** 'produksi' = perlu digoreng/dibuat (stok jadi) | 'langsung' = siap jual */
  tipeStok: 'produksi' | 'langsung';
  /** jumlah per "pak" saat produksi ayam (mis. 1 ekor = 9 potong) — null bila bukan ayam */
  satuanProduksi?: string;
  /** stok jadi (siap jual) — untuk tipe 'produksi' & 'langsung' */
  stok?: number;
}

export interface ItemResep {
  id?: number;
  produkId: number;
  /** bahan baku dari gudang — atau null bila komponen berupa produk jadi lain */
  bahanId?: number;
  /** komponen produk jadi (mis. sayap goreng untuk rice bowl) — atau null bila bahan */
  produkKomponenId?: number;
  /** qty dalam satuan dasar bahan / satuan produk komponen */
  qty: number;
  /** kapan dikonsumsi: saat produksi atau saat penjualan */
  tahap: 'produksi' | 'jual';
}

export interface HargaRiwayat {
  id?: number;
  produkId: number;
  harga: number;
  /** tanggal ISO (yyyy-mm-dd) mulai harga berlaku */
  tanggal: string;
  catatan?: string;
}

export interface MutasiStok {
  id?: number;
  /** ISO datetime lokal (yyyy-mm-ddThh:mm:ss) */
  waktu: string;
  jenis: 'beli' | 'produksi' | 'jual' | 'koreksi' | 'opname';
  /** entitas stok yang berubah: bahan (gudang) atau produk (stok jadi) */
  entitas: 'bahan' | 'produk';
  entitasId: number;
  /** khusus ayam mentah — bagian potongan yang berubah */
  bagian?: string;
  /** jumlah perubahan (bertanda +/-) dalam satuan dasar entitas */
  delta: number;
  /** teks referensi dokumen, mis. "Beli #12", "Produksi #5", "Koreksi" */
  referensi?: string;
  catatan?: string;
}

export interface BeliHeader {
  id?: number;
  /** ISO datetime lokal */
  waktu: string;
  sumber: string;
  total: number;
  catatan?: string;
}

export interface BeliItem {
  id?: number;
  beliId: number;
  bahanId: number;
  /** qty dalam satuan beli */
  qtyBeli: number;
  /** harga riil per satuan beli (rupiah) */
  hargaSatuan: number;
  subtotal: number;
}

export type SumberPesanan = 'takeaway' | 'dinein' | 'gofood' | 'grabfood' | 'shopee';
/** 'online' = dibayar lewat platform (GoFood/GrabFood/ShopeeFood) — bukan dari kas/QRIS. */
export type MetodeBayar = 'tunai' | 'qris' | 'transfer' | 'online';

export interface SesiKas {
  id?: number;
  bukaWaktu: string;
  /** uang awal yang ditaruh di laci saat buka */
  saldoAwal: number;
  /** nominal float yang wajib tersisa di laci saat tutup (biasanya 350.000) */
  floatTarget: number;
  status: 'buka' | 'tutup';
  tutupWaktu?: string;
  uangSeharusnya?: number;
  fisik?: number;
  selisih?: number;
  setoran?: number;
  catatan?: string;
}

export type JenisMutasiKas =
  | 'buka'
  | 'jual-tunai'
  | 'tambah'
  | 'keluar'
  | 'batal-tunai'
  | 'selisih';

export interface MutasiKas {
  id?: number;
  sesiId: number;
  waktu: string;
  jenis: JenisMutasiKas;
  /** nominal bertanda: masuk laci positif, keluar laci negatif */
  nominal: number;
  keterangan?: string;
  referensi?: string;
}

export interface TransaksiHeader {
  id?: number;
  /** ISO datetime lokal */
  waktu: string;
  sumber: SumberPesanan;
  metode: MetodeBayar;
  subtotal: number;
  total: number;
  dibayar: number;
  kembalian: number;
  status: 'selesai' | 'batal';
  catatan?: string;
  /** alasan pembatalan (diisi saat refund) */
  alasanBatal?: string;
}

export interface TransaksiItem {
  id?: number;
  transaksiId: number;
  produkId: number;
  /** snapshot nama & harga saat transaksi (harga jual lama tidak berubah) */
  nama: string;
  hargaSatuan: number;
  qty: number;
  subtotal: number;
}

export interface ProduksiHeader {
  id?: number;
  /** ISO datetime lokal */
  waktu: string;
  catatan?: string;
  /** ringkasan output, mis. "Ayam 2 ekor (6 dada, 4 paha atas…)" */
  ringkasan?: string;
}

export interface Fryer {
  id?: number;
  nama: string;
  aktif: boolean;
  /** liter minyak saat isi awal / penggantian terakhir (default 16) */
  isiAwalL: number;
  /** ambang top-up: berapa pak/ekor ayam sejak top-up terakhir (default 10) */
  topUpPak: number;
  /** batas hari penggantian minyak sejak isi (default 30) */
  gantiHari: number;
  /** ISO datetime isi awal / ganti terakhir */
  sejakWaktu: string;
  /** total ekor ayam digoreng sejak sejakWaktu */
  ekorSejakGanti: number;
  /** ekor ayam digoreng sejak top-up terakhir (mulai ulang dari 0 saat ganti) */
  ekorSejakTopUp: number;
}

export type JenisEventFryer = 'isi' | 'top-up' | 'ganti';

export interface FryerRiwayat {
  id?: number;
  fryerId: number;
  /** ISO datetime lokal */
  waktu: string;
  jenis: JenisEventFryer;
  /** liter yang diisi/di-top-up/diganti (opsional) */
  liter?: number;
  /** meter ekor ayam saat kejadian (snapshot) */
  ekor?: number;
  catatan?: string;
}

export interface Pengeluaran {
  id?: number;
  /** ISO datetime lokal (yyyy-mm-ddThh:mm:ss) */
  waktu: string;
  /** kategori biaya operasional (Listrik, Gas, Gaji, Sewa, dll) */
  kategori: string;
  keterangan?: string;
  jumlah: number;
}

/**
 * Catatan finansial manual (non-operasional / pelengkap laporan):
 * pemasukan & pengeluaran bisnis yang dicatat sendiri di halaman Keuangan.
 */
export interface CatatanFinansial {
  id?: number;
  /** tanggal ISO (yyyy-mm-dd) */
  tanggal: string;
  jenis: 'masuk' | 'keluar';
  jumlah: number;
  kategori: string;
  keterangan?: string;
  /** ISO datetime lokal saat dicatat */
  waktuCatat: string;
}

export interface Meta {
  key: string;
  value: string;
}

/** Jejak aktivitas sensitif (perangkat ini): PIN, pengaturan, catatan finansial, dll. */
export interface JejakAudit {
  id?: number;
  /** ISO datetime lokal (yyyy-mm-ddThh:mm:ss) */
  waktu: string;
  aksi: string;
  detail?: string;
}

export interface PerangkatInfo {
  id: string;
  nama: string;
  dibuat: string;
}

export class PosDb extends Dexie {
  bahan!: Table<Bahan, number>;
  produk!: Table<ProdukMenu, number>;
  itemResep!: Table<ItemResep, number>;
  hargaRiwayat!: Table<HargaRiwayat, number>;
  mutasiStok!: Table<MutasiStok, number>;
  beli!: Table<BeliHeader, number>;
  beliItem!: Table<BeliItem, number>;
  produksi!: Table<ProduksiHeader, number>;
  transaksi!: Table<TransaksiHeader, number>;
  transaksiItem!: Table<TransaksiItem, number>;
  sesiKas!: Table<SesiKas, number>;
  mutasiKas!: Table<MutasiKas, number>;
  pengeluaran!: Table<Pengeluaran, number>;
  catatanFinansial!: Table<CatatanFinansial, number>;
  fryer!: Table<Fryer, number>;
  fryerRiwayat!: Table<FryerRiwayat, number>;
  jejakAudit!: Table<JejakAudit, number>;
  meta!: Table<Meta, string>;

  constructor() {
    super('pos-sabana');
    this.version(1).stores({
      bahan: '++id, nama, kategori, aktif, kodePusat',
      produk: '++id, nama, kategori, aktif',
      itemResep: '++id, produkId, tahap',
      meta: 'key',
    });
    this.version(2).stores({
      hargaRiwayat: '++id, produkId, tanggal',
    });
    this.version(3).stores({
      mutasiStok: '++id, waktu, entitas, entitasId, jenis',
      beli: '++id, waktu',
      beliItem: '++id, beliId, bahanId',
      produksi: '++id, waktu',
    });
    this.version(4).stores({
      transaksi: '++id, waktu, status, sumber, metode',
      transaksiItem: '++id, transaksiId, produkId',
    });
    this.version(5).stores({
      sesiKas: '++id, status, bukaWaktu',
      mutasiKas: '++id, sesiId, waktu, jenis',
    });
    this.version(6).stores({
      pengeluaran: '++id, waktu, kategori',
    });
    this.version(7).stores({
      fryer: '++id, aktif',
      fryerRiwayat: '++id, fryerId, waktu, jenis',
    });
    this.version(8)
      .stores({})
      .upgrade(async (tx) => {
        // v8: 'offline' dipecah jadi takeaway/dinein — data lama diasumsikan take away.
        await tx
          .table('transaksi')
          .toCollection()
          .modify((h: { sumber?: string }) => {
            if (h.sumber === 'offline') h.sumber = 'takeaway';
          });
      });
    this.version(9).stores({
      catatanFinansial: '++id, tanggal, jenis, kategori',
    });
    this.version(10)
      .stores({})
      .upgrade(async (tx) => {
        // v10: halaman Pengeluaran digabung ke catatan Finansial — semua biaya
        // (operasional & non-operasional) kini satu sumber. Data lama dipindah.
        const lama = (await tx.table('pengeluaran').toArray()) as {
          id?: number;
          waktu: string;
          kategori: string;
          keterangan?: string;
          jumlah: number;
        }[];
        if (lama.length) {
          for (const p of lama) {
            await tx.table('catatanFinansial').add({
              tanggal: (p.waktu ?? '').slice(0, 10),
              jenis: 'keluar',
              jumlah: Math.round(p.jumlah) || 0,
              kategori: p.kategori?.trim() || 'Lainnya',
              keterangan: p.keterangan?.trim() || undefined,
              waktuCatat: p.waktu,
            });
          }
          await tx.table('pengeluaran').clear();
        }
      });
    this.version(11).stores({
      jejakAudit: '++id, waktu, aksi',
    });
  }
}

export const db = new PosDb();
