import { db } from './db';
import { nowISO } from './waktu';
import { kekuranganStok } from '../domain/stok';
import { normalisasiBayar, subtotalBaris } from '../domain/kasir';
import { getSesiAktif } from './kas';
import { catatAudit } from './keamanan';
import type { Bahan, MetodeBayar, MutasiKas, ProdukMenu, SumberPesanan, TransaksiHeader, TransaksiItem } from './db';

export interface ItemJual {
  produkId: number;
  qty: number;
}

export interface Kekurangan {
  nama: string;
  kurang: number;
}

interface Efek {
  produk: Map<number, { qty: number; nama: string; harga: number }>;
  komponen: Map<number, number>;
  bahan: Map<number, number>;
}

/** Efek penjualan: potongan dari produk + resep tahap 'jual' (kemasan/saus dll). */
async function efekPenjualan(items: ItemJual[]): Promise<{ efek: Efek; produkRows: ProdukMenu[]; komponenRows: ProdukMenu[]; bahanRows: Bahan[] }> {
  const byProduk = new Map<number, number>();
  for (const it of items) {
    byProduk.set(it.produkId, (byProduk.get(it.produkId) ?? 0) + it.qty);
  }
  const produkRows = (await db.produk.bulkGet([...byProduk.keys()])) as ProdukMenu[];
  const efek: Efek = { produk: new Map(), komponen: new Map(), bahan: new Map() };
  for (const [pid, qty] of byProduk) {
    const p = produkRows.find((x) => x?.id === pid);
    if (!p) throw new Error('Produk tidak ditemukan.');
    efek.produk.set(pid, { qty, nama: p.nama, harga: p.hargaJual });
    const resep = await db.itemResep.where('produkId').equals(pid).toArray();
    for (const r of resep) {
      if (r.tahap !== 'jual') continue;
      if (r.bahanId != null) efek.bahan.set(r.bahanId, (efek.bahan.get(r.bahanId) ?? 0) + r.qty * qty);
      if (r.produkKomponenId != null)
        efek.komponen.set(r.produkKomponenId, (efek.komponen.get(r.produkKomponenId) ?? 0) + r.qty * qty);
    }
  }
  const komponenRows = (await db.produk.bulkGet([...efek.komponen.keys()])) as ProdukMenu[];
  const bahanRows = (await db.bahan.bulkGet([...efek.bahan.keys()])) as Bahan[];
  return { efek, produkRows, komponenRows, bahanRows };
}

export type HasilJual =
  | { ok: true; id: number; total: number; kembalian: number; metode: MetodeBayar }
  | { ok: false; kekurangan: Kekurangan[]; alasan?: string };

export async function jualProduk(input: {
  sumber: SumberPesanan;
  metode: MetodeBayar;
  dibayar: number;
  catatan?: string;
  items: ItemJual[];
}): Promise<HasilJual> {
  const bersih = input.items.filter((i) => i.qty > 0);
  if (bersih.length === 0) return { ok: false, kekurangan: [], alasan: 'Keranjang kosong.' };

  let sesiId: number | undefined;
  if (input.metode === 'tunai') {
    const sesi = await getSesiAktif();
    if (!sesi) {
      return { ok: false, kekurangan: [], alasan: 'Kas belum dibuka — buka Kas Tunai dulu untuk menerima pembayaran tunai.' };
    }
    sesiId = sesi.id;
  }

  const { efek, produkRows, komponenRows, bahanRows } = await efekPenjualan(bersih);

  // cek kecukupan stok
  const kekurangan: Kekurangan[] = [];
  for (const [pid, e] of efek.produk) {
    const p = produkRows.find((x) => x?.id === pid);
    if (!p) continue;
    const kurang = kekuranganStok(p.stok ?? 0, e.qty);
    if (kurang > 0) kekurangan.push({ nama: e.nama, kurang });
  }
  for (const [cid, butuh] of efek.komponen) {
    const p = komponenRows.find((x) => x?.id === cid);
    if (!p) continue;
    const kurang = kekuranganStok(p.stok ?? 0, butuh);
    if (kurang > 0) kekurangan.push({ nama: p.nama, kurang });
  }
  for (const [bid, butuh] of efek.bahan) {
    const b = bahanRows.find((x) => x?.id === bid);
    if (!b) continue;
    const kurang = kekuranganStok(b.stok ?? 0, butuh);
    if (kurang > 0) kekurangan.push({ nama: b.nama, kurang });
  }
  if (kekurangan.length > 0) return { ok: false, kekurangan };

  const subtotal = subtotalBaris([...efek.produk.values()].map((e) => ({ qty: e.qty, harga: e.harga })));
  const bayar = normalisasiBayar({ metode: input.metode, dibayar: input.dibayar }, subtotal);
  if (bayar.kembalian < 0) return { ok: false, kekurangan: [], alasan: 'Uang tunai yang diterima kurang.' };

  const waktu = nowISO();
  const header: TransaksiHeader = {
    waktu,
    sumber: input.sumber,
    metode: input.metode,
    subtotal,
    total: subtotal,
    dibayar: bayar.dibayar,
    kembalian: bayar.kembalian,
    status: 'selesai',
    catatan: input.catatan,
  };

  const id = await db.transaction('rw', [db.transaksi, db.transaksiItem, db.produk, db.bahan, db.mutasiStok, db.mutasiKas], async () => {
    const txId = await db.transaksi.add(header);
    const ref = `Jual #${txId}`;

    // uang tunai masuk ke laci kas (bersih = total; kembalian sudah dari laci)
    if (input.metode === 'tunai' && sesiId != null) {
      await db.mutasiKas.add({
        sesiId,
        waktu,
        jenis: 'jual-tunai',
        nominal: header.total,
        keterangan: `Uang masuk dari penjualan tunai (dibayar ${header.dibayar}, kembalian ${header.kembalian})`,
        referensi: ref,
      } satisfies MutasiKas);
    }

    // item & potong stok produk
    const listItems: TransaksiItem[] = [];
    for (const [pid, e] of efek.produk) {
      const p = produkRows.find((x) => x?.id === pid);
      if (!p) continue;
      await db.produk.update(pid, { stok: (p.stok ?? 0) - e.qty });
      listItems.push({ transaksiId: txId, produkId: pid, nama: e.nama, hargaSatuan: e.harga, qty: e.qty, subtotal: e.harga * e.qty });
      await db.mutasiStok.add({ waktu, jenis: 'jual', entitas: 'produk', entitasId: pid, delta: -e.qty, referensi: ref, catatan: e.nama });
    }
    await db.transaksiItem.bulkAdd(listItems);

    // komponen produk jadi & bahan kemasan
    for (const [cid, butuh] of efek.komponen) {
      const p = komponenRows.find((x) => x?.id === cid);
      if (!p) continue;
      await db.produk.update(cid, { stok: (p.stok ?? 0) - butuh });
      await db.mutasiStok.add({ waktu, jenis: 'jual', entitas: 'produk', entitasId: cid, delta: -butuh, referensi: ref, catatan: `${p.nama} (kemasan)` });
    }
    for (const [bid, butuh] of efek.bahan) {
      const b = bahanRows.find((x) => x?.id === bid);
      if (!b) continue;
      await db.bahan.update(bid, { stok: (b.stok ?? 0) - butuh });
      await db.mutasiStok.add({ waktu, jenis: 'jual', entitas: 'bahan', entitasId: bid, delta: -butuh, referensi: ref, catatan: b.nama });
    }
    return txId;
  });

  return { ok: true, id, total: subtotal, kembalian: bayar.kembalian, metode: input.metode };
}

export interface HasilBatal {
  /** true bila uang tunai sudah dikembalikan ke buku kas laci (shift masih buka) */
  kasDibalik: boolean;
  /** catatan bila pengembalian tunai tidak bisa otomatis (shift sudah ditutup) */
  catatanKas?: string;
}

/**
 * Batalkan transaksi → kembalikan semua stok, balik pembayaran tunai dari buku
 * kas laci (bila shift masih buka), catat alasan + jejak audit. QRIS/Transfer/
 * Online dibatalkan di aplikasi (stok kembali, status batal) — uangnya di-refund
 * lewat penyedia pembayaran, tidak lewat laci kas.
 */
export async function batalkanTransaksi(id: number, alasan?: string): Promise<HasilBatal> {
  const header = await db.transaksi.get(id);
  if (!header || header.status !== 'selesai') return { kasDibalik: false, catatanKas: 'Transaksi tidak ditemukan atau sudah dibatalkan.' };
  const items = (await db.transaksiItem.where('transaksiId').equals(id).toArray()).map((i) => ({
    produkId: i.produkId,
    qty: i.qty,
  }));
  const { efek, produkRows, komponenRows, bahanRows } = await efekPenjualan(items);
  const waktu = nowISO();

  // pembatalan transaksi tunai: kembalikan dari buku kas laci (bila sesinya masih buka)
  let kasRef: { sesiId: number; nominal: number } | undefined;
  let catatanKas: string | undefined;
  if (header.metode === 'tunai') {
    const jualRow = (await db.mutasiKas.toArray()).find((m) => m.referensi === `Jual #${id}`);
    if (jualRow) {
      const sesi = await db.sesiKas.get(jualRow.sesiId);
      if (sesi && sesi.status === 'buka') {
        kasRef = { sesiId: jualRow.sesiId, nominal: Math.abs(jualRow.nominal) };
      } else {
        catatanKas = 'Shift sudah ditutup — uang tunai tidak otomatis keluar dari laci; kembalikan secara manual ke pembeli.';
      }
    }
  }

  await db.transaction('rw', [db.transaksi, db.produk, db.bahan, db.mutasiStok, db.mutasiKas], async () => {
    if (kasRef) {
      await db.mutasiKas.add({
        sesiId: kasRef.sesiId,
        waktu,
        jenis: 'batal-tunai',
        nominal: -kasRef.nominal,
        keterangan: `Pengembalian tunai karena transaksi #${id} dibatalkan${alasan ? ` (${alasan})` : ''}`,
        referensi: `Batal #${id}`,
      } satisfies MutasiKas);
    }
    const ref = `Batal #${id}`;
    for (const [pid, e] of efek.produk) {
      const p = produkRows.find((x) => x?.id === pid);
      if (!p) continue;
      await db.produk.update(pid, { stok: (p.stok ?? 0) + e.qty });
      await db.mutasiStok.add({ waktu, jenis: 'jual', entitas: 'produk', entitasId: pid, delta: e.qty, referensi: ref, catatan: `${e.nama} (batal${alasan ? ': ' + alasan : ''})` });
    }
    for (const [cid, butuh] of efek.komponen) {
      const p = komponenRows.find((x) => x?.id === cid);
      if (!p) continue;
      await db.produk.update(cid, { stok: (p.stok ?? 0) + butuh });
      await db.mutasiStok.add({ waktu, jenis: 'jual', entitas: 'produk', entitasId: cid, delta: butuh, referensi: ref, catatan: `${p.nama} (batal)` });
    }
    for (const [bid, butuh] of efek.bahan) {
      const b = bahanRows.find((x) => x?.id === bid);
      if (!b) continue;
      await db.bahan.update(bid, { stok: (b.stok ?? 0) + butuh });
      await db.mutasiStok.add({ waktu, jenis: 'jual', entitas: 'bahan', entitasId: bid, delta: butuh, referensi: ref, catatan: b.nama });
    }
    await db.transaksi.update(id, { status: 'batal', alasanBatal: alasan?.trim() || undefined });
  });

  await catatAudit('transaksi-batal', `#${id} · ${header.total.toLocaleString('id-ID')} · ${alasan?.trim() || 'tanpa alasan'}`);
  return { kasDibalik: kasRef != null, catatanKas };
}

export interface BarisTransaksi {
  header: TransaksiHeader;
  items: TransaksiItem[];
}

export async function rinciTransaksi(id: number): Promise<BarisTransaksi | undefined> {
  const h = await db.transaksi.get(id);
  if (!h) return undefined;
  const its = (await db.transaksiItem.where('transaksiId').equals(id).toArray()).sort((a, b) => a.id! > b.id! ? 1 : -1);
  return { header: h, items: its };
}

/**
 * Omzet pesanan online (GoFood/GrabFood/ShopeeFood) pada rentang waktu.
 * Dipakai sebagai ESTIMASI pendapatan platform — tidak pernah masuk hitungan laci kas.
 */
export async function omzetOnlineAntara(mulaiISO: string, sampaiISO?: string): Promise<number> {
  const sampai = sampaiISO ?? nowISO();
  const rows = await db.transaksi.where('waktu').between(mulaiISO, sampai, true, true).toArray();
  return rows
    .filter((h) => h.metode === 'online' && h.status === 'selesai')
    .reduce((s, h) => s + h.total, 0);
}

export async function daftarTransaksi(limit = 100): Promise<BarisTransaksi[]> {
  const hs = (await db.transaksi.toArray()).sort((a, b) => (a.id ?? 0) > (b.id ?? 0) ? -1 : 1).slice(0, limit);
  const out: BarisTransaksi[] = [];
  for (const h of hs) {
    const its = (await db.transaksiItem.where('transaksiId').equals(h.id as number).toArray()).sort((a, b) => a.id! > b.id! ? 1 : -1);
    out.push({ header: h, items: its });
  }
  return out;
}

export const LABEL_SUMBER: Record<SumberPesanan, string> = {
  takeaway: 'Take away',
  dinein: 'Dine in',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopee: 'ShopeeFood',
};

/** Urutan chip sumber di layar kasir & laporan (Take away default pertama). */
export const URUTAN_SUMBER: SumberPesanan[] = ['takeaway', 'dinein', 'gofood', 'grabfood', 'shopee'];

/** Label sumber — toleran terhadap nilai lama 'offline' (dianggap take away). */
export function labelSumber(s: string): string {
  if (s === 'offline') return 'Take away'
  return LABEL_SUMBER[s as SumberPesanan] ?? s
}

export const LABEL_METODE: Record<MetodeBayar, string> = {
  tunai: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  online: 'Online',
};

export const URUTAN_METODE: MetodeBayar[] = ['tunai', 'qris', 'transfer'];
