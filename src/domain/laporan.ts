/** Matematika laporan keuangan & penjualan — murni & diuji (tanpa DB). */

export interface BarisJualAgg {
  produkId: number;
  nama: string;
  qty: number;
  subtotal: number;
}

export interface AgregatProduk {
  produkId: number;
  nama: string;
  qty: number;
  omzet: number;
}

/** Gabungkan item transaksi per produk lalu urutkan qty menurun (terlaris dulu). */
export function agregasiProduk(items: BarisJualAgg[]): AgregatProduk[] {
  const byId = new Map<number, AgregatProduk>();
  for (const it of items) {
    const a = byId.get(it.produkId) ?? { produkId: it.produkId, nama: it.nama, qty: 0, omzet: 0 };
    a.qty += it.qty;
    a.omzet += it.subtotal;
    byId.set(it.produkId, a);
  }
  return [...byId.values()].sort((a, b) => (b.qty - a.qty) || (b.omzet - a.omzet));
}

/** Jumlahkan nilai bertanda dari sekumpulan transaksi per kelompok kunci. */
export function sumPerKunci<T extends string>(rows: { kunci: T; nilai: number }[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const r of rows) out[r.kunci] = (out[r.kunci] ?? 0) + r.nilai;
  return out;
}

/**
 * Harga bahan per SATUAN DASAR dari harga per satuan beli.
 * 1 satuan beli = `jumlahDasarPerBeli` satuan dasar (mis. 1 ikat = 100 pcs).
 */
export function hargaPerDasar(hargaPerSatuanBeli: number, jumlahDasarPerBeli?: number): number {
  return hargaPerSatuanBeli / Math.max(1, jumlahDasarPerBeli ?? 1);
}

/**
 * Biaya menggoreng satu ekor ayam utuh (aturan pusat SABANA):
 * ayam ekor + ⅓ pak tepung + 0,2 L minyak per ekor.
 * Angka ⅓ dan 0,2 identik dengan yang dipakai mesin produksi (domain/stok & actions).
 */
export function biayaEkorAyamGoreng(hargaEkor: number, hargaPerPakTepung: number, hargaPerLiterMinyak: number): number {
  return hargaEkor + hargaPerPakTepung / 3 + hargaPerLiterMinyak * 0.2;
}

/** Biaya satu potong ayam goreng bila 1 ekor menghasilkan `totalPotong` potong seragam. */
export function biayaPerPotong(biayaEkor: number, totalPotong: number): number {
  return biayaEkor / Math.max(1, totalPotong);
}

/** Margin persen (0–100). Omzet 0 → 0. */
export function marginPct(laba: number, omzet: number): number {
  return omzet > 0 ? (laba / omzet) * 100 : 0;
}

/** Apakah datetime lokal (yyyy-mm-ddThh:mm:ss) berada pada tanggal tertentu. */
export function dalamHari(datetimeISO: string, tanggal: string): boolean {
  return datetimeISO.slice(0, 10) === tanggal;
}

/** Apakah datetime lokal berada pada bulan tertentu (yyyy-mm). */
export function dalamBulan(datetimeISO: string, bulan: string): boolean {
  return datetimeISO.slice(0, 7) === bulan;
}

/** Bulan (yyyy-mm) dari tanggal ISO. */
export function bulanDariTanggal(tanggal: string): string {
  return tanggal.slice(0, 7);
}

/** Format qty tampilan (maks 2 desimal). */
export function formatQty(qty: number): string {
  return qty.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
