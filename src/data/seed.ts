import { db, type Bahan, type ProdukMenu } from './db';
import seedData from './seed-data.json';

/**
 * Data awal (seed) — hasil generate `tools/make_seed.py` dari file master SABANA.
 * Ini DATA IMPOR PERTAMA (bukan hardcode): setelah masuk database, semua isi
 * bisa ditambah/diedit/dihapus lewat layar aplikasi.
 */

export interface SeedBahan {
  kodePusat?: string;
  nama: string;
  kategori: string;
  satuanBeli?: string;
  isiLabel?: string;
  satuanDasar: string;
  hargaBeliDefault?: number;
  jumlahDasarPerBeli?: number;
  isAyam?: boolean;
  komposisiAyam?: { dada: number; pahaAtas: number; pahaBawah: number; sayap: number } | null;
}

export interface SeedResepDraft {
  bahan: string;
  satuan: string;
  biaya?: number;
  total?: number;
  keterangan: string;
}

export interface SeedProduk {
  nama: string;
  kategori: string;
  hargaJual: number;
  tipeStok: 'produksi' | 'langsung';
  aktif: boolean;
  sheet?: string;
  resepDraft: SeedResepDraft[];
}

export interface SeedData {
  version: number;
  bahan: SeedBahan[];
  produk: SeedProduk[];
}

const seed = seedData as SeedData;

export interface SeedResult {
  loaded: boolean;
  bahan: number;
  produk: number;
}

/** Muat data awal bila belum pernah dimuat (idempoten). */
export async function ensureSeedLoaded(): Promise<SeedResult> {
  const meta = await db.meta.get('seed');
  if (meta && meta.value === String(seed.version)) {
    const bahan = await db.bahan.count();
    const produk = await db.produk.count();
    return { loaded: false, bahan, produk };
  }
  return loadSeed();
}

/** (Ulang) muat data awal; menghapus isi tabel master terlebih dahulu. */
export async function loadSeed(): Promise<SeedResult> {
  await db.transaction('rw', db.bahan, db.produk, db.itemResep, db.meta, async () => {
    await db.bahan.clear();
    await db.produk.clear();
    await db.itemResep.clear();

    const bahan: Bahan[] = seed.bahan.map((b) => ({
      kodePusat: b.kodePusat,
      nama: b.nama,
      kategori: b.kategori,
      aktif: true,
      satuanBeli: b.satuanBeli,
      isiLabel: b.isiLabel,
      satuanDasar: b.satuanDasar,
      hargaBeliDefault: b.hargaBeliDefault,
      jumlahDasarPerBeli: 'jumlahDasarPerBeli' in b ? (b.jumlahDasarPerBeli ?? 1) : 1,
      stok: 0,
      isAyam: 'isAyam' in b && b.isAyam === true,
      komposisiAyam: 'komposisiAyam' in b && b.komposisiAyam ? b.komposisiAyam : null,
    }));
    await db.bahan.bulkAdd(bahan);

    const produk: ProdukMenu[] = seed.produk.map((p) => ({
      nama: p.nama,
      kategori: p.kategori,
      aktif: p.aktif,
      hargaJual: p.hargaJual,
      tipeStok: p.tipeStok,
      satuanProduksi: p.sheet,
      stok: 0,
    }));
    await db.produk.bulkAdd(produk);

    await db.meta.put({ key: 'seed', value: String(seed.version) });
  });

  const nBahan = await db.bahan.count();
  const nProduk = await db.produk.count();
  return { loaded: true, bahan: nBahan, produk: nProduk };
}
