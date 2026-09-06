/**
 * Aturan konversi pusat SABANA (nilai awal — semua angka ini adalah DATA,
 * bukan hardcode; di aplikasi dapat diedit via master/pengaturan).
 * Modul ini hanya menyediakan fungsi murni (pure) yang bisa diuji tanpa DB.
 */

export type BagianAyam = 'dada' | 'pahaAtas' | 'pahaBawah' | 'sayap';

export interface AyamKomposisi {
  dada: number;
  pahaAtas: number;
  pahaBawah: number;
  sayap: number;
}

/** 1 ekor/pak AYAM POTONG 9 = 3 dada + 2 paha atas + 2 paha bawah + 2 sayap */
export const AYAM_POTONG_9: AyamKomposisi = { dada: 3, pahaAtas: 2, pahaBawah: 2, sayap: 2 };

export const BAGIAN_AYAM: BagianAyam[] = ['dada', 'pahaAtas', 'pahaBawah', 'sayap'];

export function totalPotongPerEkor(komposisi: AyamKomposisi = AYAM_POTONG_9): number {
  return BAGIAN_AYAM.reduce((sum, b) => sum + komposisi[b], 0);
}

/** Hasil beli "n" pak ayam potong 9, terpecah per bagian potongan. */
export function beliAyam(packs: number, komposisi: AyamKomposisi = AYAM_POTONG_9): Record<BagianAyam, number> {
  const out = {} as Record<BagianAyam, number>;
  for (const b of BAGIAN_AYAM) out[b] = packs * komposisi[b];
  return out;
}

/**
 * Tepung bumbu: 1 pak tepung cukup untuk 3 ekor ayam (aturan pusat).
 * Mengembalikan fraksi pak tepung untuk "ekor" ekor ayam.
 */
export function tepungPackPerEkor(ekor: number, pakTepungUntukEkor: number = 3): number {
  return ekor / pakTepungUntukEkor;
}

/**
 * Estimasi pemakaian minyak goreng per ekor ayam (dari HPP pusat: ±0,2 L/ekor).
 * Dipakai untuk memotong stok minyak gudang saat produksi.
 * Siklus top-up/ganti deep fryer ditangani terpisah (aturan SOP, lihat spec §5.5).
 */
export function minyakLiterPerEkor(ekor: number, literPerEkor: number = 0.2): number {
  return ekor * literPerEkor;
}

/** Format nominal rupiah (tanpa desimal) untuk tampilan. */
export function formatRupiah(value: number): string {
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}
