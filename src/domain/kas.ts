/** Matematika kas tunai (laci kasir) — murni & diuji. */

export interface LedgerKas {
  /** uang awal saat buka kas */
  saldoAwal: number;
  /** total penjualan tunai masuk laci */
  jualTunai: number;
  /** uang dari luar yang ditambahkan ke laci */
  tambah: number;
  /** uang tunai keluar dari laci (kas kecil/belanja) */
  keluar: number;
  /** pengembalian uang tunai karena transaksi dibatalkan */
  batalTunai: number;
}

/** Uang yang seharusnya ada di laci. */
export function uangSeharusnya(l: LedgerKas): number {
  return l.saldoAwal + l.jualTunai + l.tambah - l.keluar - l.batalTunai;
}

/** Selisih hitungan fisik vs catatan (positif = lebih, negatif = kurang). */
export function selisihKas(fisik: number, l: LedgerKas): number {
  return fisik - uangSeharusnya(l);
}

/**
 * Setoran = uang yang dibawa kasir saat tutup: fisik dikurangi float target
 * yang wajib tersisa di laci untuk shift berikutnya. Tidak negatif.
 */
export function setoranKas(fisik: number, floatTarget: number): number {
  return Math.max(0, fisik - floatTarget);
}
