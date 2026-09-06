import { db, type Bahan, type HargaRiwayat, type ItemResep, type ProdukMenu } from './db';
import { mesinHpp } from './laporan';
import { riwayatTerurut, type HargaEntry } from '../domain/harga';

/** ISO tanggal lokal hari ini (yyyy-mm-dd). */
export function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Bahan
// ---------------------------------------------------------------------------

export function listBahan(term?: string): Promise<Bahan[]> {
  return db.bahan.toArray().then((all) => {
    if (!term) return all;
    const t = term.toLowerCase();
    return all.filter(
      (b) =>
        b.nama.toLowerCase().includes(t) ||
        (b.kodePusat ?? '').includes(t) ||
        b.kategori.toLowerCase().includes(t),
    );
  });
}

export async function saveBahan(b: Bahan): Promise<number> {
  const id = b.id ?? (await db.bahan.add(b));
  if (b.id) await db.bahan.put(b);
  return id;
}

export async function hapusBahan(id: number): Promise<void> {
  await db.transaction('rw', db.bahan, db.itemResep, async () => {
    await db.itemResep.where('bahanId').equals(id).delete();
    await db.bahan.delete(id);
  });
}

export async function setAktifBahan(id: number, aktif: boolean): Promise<void> {
  await db.bahan.update(id, { aktif });
}

// ---------------------------------------------------------------------------
// Produk & resep
// ---------------------------------------------------------------------------

export function listProduk(term?: string): Promise<ProdukMenu[]> {
  return db.produk.toArray().then((all) => {
    if (!term) return all;
    const t = term.toLowerCase();
    return all.filter((p) => p.nama.toLowerCase().includes(t) || p.kategori.toLowerCase().includes(t));
  });
}

export async function getProduk(id: number): Promise<ProdukMenu | undefined> {
  return db.produk.get(id);
}

export async function resepProduk(produkId: number): Promise<ItemResep[]> {
  return db.itemResep.where('produkId').equals(produkId).toArray();
}

export async function namaItemResep(rows: ItemResep[]): Promise<{ bahan: Map<number, string>; produk: Map<number, string> }> {
  const bahanIds = rows.filter((r) => r.bahanId).map((r) => r.bahanId as number);
  const produkIds = rows.filter((r) => r.produkKomponenId).map((r) => r.produkKomponenId as number);
  const bahans = bahanIds.length ? await db.bahan.bulkGet(bahanIds) : [];
  const produks = produkIds.length ? await db.produk.bulkGet(produkIds) : [];
  const bahanMap = new Map<number, string>();
  for (const b of bahans) if (b) bahanMap.set(b.id as number, b.nama);
  const produkMap = new Map<number, string>();
  for (const p of produks) if (p) produkMap.set(p.id as number, p.nama);
  return { bahan: bahanMap, produk: produkMap };
}

export function riwayatHargaProduk(produkId: number): Promise<HargaEntry[]> {
  return db.hargaRiwayat
    .where('produkId')
    .equals(produkId)
    .toArray()
    .then((rows) => riwayatTerurut(rows.map((r) => ({ tanggal: r.tanggal, harga: r.harga, catatan: r.catatan }))));
}

/**
 * Simpan produk (baru/edit) + resep + catat harga baru bila berubah.
 * - harga baru dicatat dengan tanggal hari ini bila beda dari harga terbaru
 * - itemResep lama produk dihapus lalu diganti (satu transaksi)
 */
export async function saveProdukLengkap(
  p: ProdukMenu,
  resep: ItemResep[],
  catatHarga: boolean,
): Promise<number> {
  return db.transaction('rw', db.produk, db.itemResep, db.hargaRiwayat, async () => {
    let id = p.id;
    if (id) {
      await db.produk.update(id, p);
    } else {
      id = await db.produk.add(p);
    }
    const produkId = id as number;

    if (catatHarga) {
      const rows = await db.hargaRiwayat.where('produkId').equals(produkId).toArray();
      const latestRow = rows.length
        ? rows.reduce((a, b) => (a.tanggal >= b.tanggal ? a : b))
        : undefined;
      if (!latestRow || latestRow.harga !== p.hargaJual) {
        await db.hargaRiwayat.add({
          produkId,
          harga: p.hargaJual,
          tanggal: todayISO(),
          catatan: 'diubah manual',
        } satisfies HargaRiwayat);
      }
    }

    await db.itemResep.where('produkId').equals(produkId).delete();
    for (const r of resep) {
      await db.itemResep.add({ ...r, produkId });
    }
    return produkId;
  });
}

export async function hapusProduk(id: number): Promise<void> {
  await db.transaction('rw', db.produk, db.itemResep, db.hargaRiwayat, async () => {
    await db.itemResep.where('produkId').equals(id).delete();
    await db.hargaRiwayat.where('produkId').equals(id).delete();
    await db.produk.delete(id);
  });
}

export async function setAktifProduk(id: number, aktif: boolean): Promise<void> {
  await db.produk.update(id, { aktif });
}

/** Catat harga baru ke riwayat produk (berlaku sejak hari ini). */
export async function catatHargaBaru(produkId: number, harga: number, catatan?: string): Promise<void> {
  await db.hargaRiwayat.add({
    produkId,
    harga,
    tanggal: todayISO(),
    catatan: catatan?.trim() || 'diubah manual',
  });
}

/**
 * Daftar produk lengkap untuk halaman Produk & Menu: HPP langsung (mesin
 * biaya pokok laporan), penanda ada/tidak dasar biaya, dan jumlah baris resep.
 */
export interface DetailProduk extends ProdukMenu {
  /** HPP per unit (Rp) — dihitung dari resep × harga beli terakhir. */
  hpp: number;
  /** true bila produk punya dasar biaya (resep terisi / aturan ayam utuh). */
  adaHpp: boolean;
  /** jumlah baris resep (bahan + komponen). */
  resepCount: number;
}

export async function detailProduk(): Promise<DetailProduk[]> {
  const [produks, reseps, hpp] = await Promise.all([
    db.produk.toArray(),
    db.itemResep.toArray(),
    mesinHpp(),
  ]);
  const cnt = new Map<number, number>();
  for (const r of reseps) cnt.set(r.produkId, (cnt.get(r.produkId) ?? 0) + 1);
  return produks.map((p) => {
    const id = p.id as number;
    return {
      ...p,
      hpp: hpp.biaya.get(id) ?? 0,
      adaHpp: hpp.ada.get(id) ?? false,
      resepCount: cnt.get(id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Ringkasan untuk beranda
// ---------------------------------------------------------------------------

export interface Ringkasan {
  bahan: number;
  bahanAktif: number;
  produk: number;
  produkAktif: number;
  kategoriProduk: number;
}

export async function ringkasan(): Promise<Ringkasan> {
  const [bahan, produk] = await Promise.all([db.bahan.toArray(), db.produk.toArray()]);
  return {
    bahan: bahan.length,
    bahanAktif: bahan.filter((b) => b.aktif).length,
    produk: produk.length,
    produkAktif: produk.filter((p) => p.aktif).length,
    kategoriProduk: new Set(produk.map((p) => p.kategori)).size,
  };
}
