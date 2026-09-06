import { db, type CatatanFinansial } from './db';
import { nowISO } from './waktu';

/** Catatan finansial manual — pelengkap laporan operasional (di luar kasir). */

export interface HasilCatatFinansial {
  ok: boolean;
  alasan?: string;
  id?: number;
}

export interface RekapFinansial {
  masuk: number;
  keluar: number;
  net: number;
  n: number;
}

export const KATEGORI_MASUK = [
  'Modal dari pemilik',
  'Pinjaman masuk',
  'Penjualan non-kasir',
  'Lain-lain (masuk)',
];

export const KATEGORI_KELUAR = [
  'Listrik',
  'Gas',
  'Gaji & THR',
  'Sewa kios / tempat',
  'Air',
  'Internet',
  'Transportasi',
  'Kebersihan',
  'Pemasaran & promo',
  'Perawatan alat',
  'Pajak',
  'Lainnya',
];

export function kategoriUntuk(jenis: 'masuk' | 'keluar'): string[] {
  return jenis === 'masuk' ? KATEGORI_MASUK : KATEGORI_KELUAR;
}

/** Catatan dalam rentang tanggal (inklusif), terbaru lebih dulu. */
export async function listCatatanFinansial(from?: string, to?: string): Promise<CatatanFinansial[]> {
  const all = await db.catatanFinansial.toArray();
  const terfilter = all.filter(
    (c) =>
      (!from || (c.tanggal ?? '') >= from) && (!to || (c.tanggal ?? '') <= to),
  );
  return terfilter.sort(
    (a, b) => (b.tanggal ?? '').localeCompare(a.tanggal ?? '') || (b.id ?? 0) - (a.id ?? 0),
  );
}

export async function tambahCatatanFinansial(input: {
  tanggal: string;
  jenis: 'masuk' | 'keluar';
  jumlah: number;
  kategori: string;
  keterangan?: string;
}): Promise<HasilCatatFinansial> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tanggal)) return { ok: false, alasan: 'Tanggal tidak valid.' };
  if (!(input.jumlah > 0)) return { ok: false, alasan: 'Jumlah harus lebih dari 0.' };
  const kategori = input.kategori.trim();
  if (!kategori) return { ok: false, alasan: 'Pilih kategori dulu.' };
  const id = await db.catatanFinansial.add({
    tanggal: input.tanggal,
    jenis: input.jenis,
    jumlah: Math.round(input.jumlah),
    kategori,
    keterangan: input.keterangan?.trim() || undefined,
    waktuCatat: nowISO(),
  } satisfies CatatanFinansial);
  return { ok: true, id };
}

export async function hapusCatatanFinansial(id: number): Promise<void> {
  await db.catatanFinansial.delete(id);
}

/** Ringkasan sederhana sejumlah catatan: total masuk, keluar, & net. */
export function rekapCatatan(rows: CatatanFinansial[]): RekapFinansial {
  const masuk = rows.filter((r) => r.jenis === 'masuk').reduce((s, r) => s + r.jumlah, 0);
  const keluar = rows.filter((r) => r.jenis === 'keluar').reduce((s, r) => s + r.jumlah, 0);
  return { masuk, keluar, net: masuk - keluar, n: rows.length };
}
