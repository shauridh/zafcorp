import { AYAM_POTONG_9, type AyamKomposisi, type BagianAyam } from './conversions';

/**
 * Matematika stok — fungsi murni (tanpa DB) yang diuji unit.
 * Satuan: satuan dasar entitas (potong / pcs / liter / gram / kg / ml).
 */

export interface BagianDelta {
  bagian: BagianAyam;
  delta: number;
}

/** Pembelian ayam utuh: per bagian positif (qty satuan beli × komposisi). */
export function beliAyamBagian(
  qtyPacks: number,
  komposisi: AyamKomposisi = AYAM_POTONG_9,
): BagianDelta[] {
  return [
    { bagian: 'dada', delta: qtyPacks * komposisi.dada },
    { bagian: 'pahaAtas', delta: qtyPacks * komposisi.pahaAtas },
    { bagian: 'pahaBawah', delta: qtyPacks * komposisi.pahaBawah },
    { bagian: 'sayap', delta: qtyPacks * komposisi.sayap },
  ];
}

/** Kebutuhan ayam mentah saat produksi per ekor (dipakai sebagai pemotongan). */
export function konsumsiAyamEkor(ekor: number, komposisi: AyamKomposisi = AYAM_POTONG_9): BagianDelta[] {
  return beliAyamBagian(ekor, komposisi);
}

/** Hasil produksi 1 ekor ayam goreng → stok jadi per potongan. */
export function hasilProduksiEkor(ekor: number, komposisi: AyamKomposisi = AYAM_POTONG_9): BagianDelta[] {
  return beliAyamBagian(ekor, komposisi);
}

export interface EfekBeli {
  /** penambahan stok dasar (0 bila ayam terpecah per bagian) */
  stokDasar: number;
  /** penambahan per bagian (null bila bukan ayam utuh) */
  bagian: BagianDelta[] | null;
}

/** Efek pembelian bahan biasa: stok dasar += qtyBeli × jumlahDasarPerBeli. */
export function hitungBeliBiasa(qtyBeli: number, jumlahDasarPerBeli: number): EfekBeli {
  return { stokDasar: qtyBeli * jumlahDasarPerBeli, bagian: null };
}

/** Efek pembelian ayam utuh (mengabaikan jumlahDasarPerBeli, pakai komposisi). */
export function hitungBeliAyam(qtyPacks: number, komposisi: AyamKomposisi = AYAM_POTONG_9): EfekBeli {
  return { stokDasar: 0, bagian: beliAyamBagian(qtyPacks, komposisi) };
}

/** Berapa stok yang kurang bila tersedia X dan dibutuhkan Y (≥ 0 bila cukup). */
export function kekuranganStok(tersedia: number, dibutuhkan: number): number {
  return Math.max(0, dibutuhkan - tersedia);
}

/** Selisih koreksi/opname: bertanda — jumlah yang harus ditambahkan ke stok. */
export function deltaKoreksi(stokSekarang: number, stokBaru: number): number {
  return stokBaru - stokSekarang;
}
