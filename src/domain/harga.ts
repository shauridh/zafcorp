/**
 * Riwayat harga jual produk — murni & bisa diuji.
 * Aturan: harga baru TIDAK mengubah entri lama; harga lama tetap berlaku untuk
 * tanggal sebelum perubahan (transaksi lama memakai harga saat itu).
 * Semua tanggal memakai ISO `yyyy-mm-dd` (lokal, bukan UTC).
 */

export interface HargaEntry {
  /** ISO yyyy-mm-dd — tanggal harga mulai berlaku */
  tanggal: string;
  harga: number;
  /** keterangan sumber perubahan (mis. "Impor awal", "naik harga bahan") */
  catatan?: string;
}

export function byTanggalDesc(a: HargaEntry, b: HargaEntry): number {
  if (a.tanggal === b.tanggal) return 0;
  return a.tanggal < b.tanggal ? 1 : -1;
}

/**
 * Tambahkan harga baru ke riwayat:
 * - duplikat persis (tanggal & harga sama dengan entri teratas) → tidak menambah
 * - selain itu selalu ditambahkan; riwayat lama tidak pernah diubah
 */
export function tambahRiwayat(list: HargaEntry[], next: HargaEntry): HargaEntry[] {
  const sorted = [...list].sort(byTanggalDesc);
  const latest = sorted[0];
  if (latest && latest.tanggal === next.tanggal && latest.harga === next.harga) {
    return list;
  }
  return [...list, next];
}

/** Riwayat terurut menurun (terbaru dulu) untuk ditampilkan. */
export function riwayatTerurut(list: HargaEntry[]): HargaEntry[] {
  return [...list].sort(byTanggalDesc);
}

/**
 * Harga yang berlaku pada tanggal tertentu (entri terakhir dengan tanggal ≤ target).
 * Bila tidak ada → null. Tanpa argumen target → harga terbaru.
 */
export function hargaSaat(list: HargaEntry[], sampaiTanggal?: string): HargaEntry | null {
  const sorted = [...list].sort(byTanggalDesc);
  if (!sampaiTanggal) return sorted[0] ?? null;
  const berlaku = sorted.filter((e) => e.tanggal <= sampaiTanggal).sort(byTanggalDesc);
  return berlaku[0] ?? null;
}
