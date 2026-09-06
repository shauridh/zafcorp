import { db } from './db';

export interface Pengaturan {
  namaOutlet: string;
  alamat: string;
  noHp: string;
  /** uang yang wajib tersisa di laci kasir saat tutup kas */
  floatKas: number;
  /** liter isi awal minyak deep fryer (default pusat 16 L) */
  minyakIsiAwalL: number;
  /** ambang top-up minyak dalam ekor/pak ayam (default pusat 10) */
  minyakTopUpPak: number;
  /** batas hari ganti minyak (default pusat 30 hari) */
  minyakGantiHari: number;
  /** tampilan antarmuka: ikuti sistem / selalu terang / selalu gelap */
  tema: 'auto' | 'terang' | 'gelap';
  /** baris sambutan opsional di bawah nama outlet pada struk (boleh multi-baris \n) */
  strukSambutan: string;
  /** pesan penutup struk — kosongkan agar tanpa penutup */
  strukPenutup: string;
  /** sisa stok item yang dianggap "menipis" di layar kasir (badge amber) */
  ambangStokKasir: number;
}

export const PENGATURAN_DEFAULT: Pengaturan = {
  namaOutlet: 'SABANA FRIED CHICKEN',
  alamat: '',
  noHp: '',
  floatKas: 350000,
  minyakIsiAwalL: 16,
  minyakTopUpPak: 10,
  minyakGantiHari: 30,
  tema: 'auto',
  strukSambutan: '',
  strukPenutup: 'Terima kasih 🙏\nSemoga hari Anda menyenangkan',
  ambangStokKasir: 3,
};

export async function getPengaturan(): Promise<Pengaturan> {
  const row = await db.meta.get('pengaturan');
  if (!row) return { ...PENGATURAN_DEFAULT };
  try {
    const parsed = JSON.parse(row.value) as Partial<Pengaturan>;
    return { ...PENGATURAN_DEFAULT, ...parsed };
  } catch {
    return { ...PENGATURAN_DEFAULT };
  }
}

export async function savePengaturan(p: Pengaturan): Promise<void> {
  await db.meta.put({ key: 'pengaturan', value: JSON.stringify(p) });
}
