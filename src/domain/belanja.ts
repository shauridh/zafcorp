/** Matematika list belanja (estimasi 3–7 hari dari pemakaian nyata) — murni & diuji. */

export interface KebutuhanBiasa {
  /** rata-rata pemakaian per hari (satuan dasar) */
  rataPerHari: number;
  /** estimasi hari sampai stok habis (null bila rata-rata 0) */
  estHariHabis: number | null;
  /** kekurangan dalam satuan dasar untuk memenuhi target hari */
  butuhDasar: number;
  /** jumlah satuan beli yang perlu dibeli (dibulatkan ke atas) */
  beli: number;
  /** stok cukup untuk target hari tanpa beli? */
  cukup: boolean;
}

/**
 * Kebutuhan bahan biasa: total konsumsi `total` selama `hari` hari,
 * stok tersisa `stok`, target penjualan `targetHari` hari ke depan.
 */
export function kebutuhanBiasa(p: {
  total: number;
  hari: number;
  stok: number;
  targetHari: number;
  perBeli?: number;
}): KebutuhanBiasa {
  const rata = p.hari > 0 ? p.total / p.hari : 0;
  const butuh = Math.max(0, rata * p.targetHari - p.stok);
  const perBeli = Math.max(1, p.perBeli ?? 1);
  return {
    rataPerHari: rata,
    estHariHabis: rata > 0 ? p.stok / rata : null,
    butuhDasar: butuh,
    beli: Math.ceil(butuh / perBeli),
    cukup: butuh <= 0,
  };
}

export type BagianAyam = 'dada' | 'pahaAtas' | 'pahaBawah' | 'sayap';

export interface BagianPakai {
  stok: number;
  /** konsumsi total selama periode (potong) */
  total: number;
}

export interface KebutuhanAyam {
  /** rata-rata ekor digoreng per hari (dari bagian paling banyak datanya) */
  ekorPerHari: number;
  perBagian: Record<BagianAyam, { stok: number; rataPerHari: number; estHariHabis: number | null; defisit: number; ekor: number }>;
  /** ekor (pak) yang perlu dibeli: terbesar di antara kebutuhan per bagian */
  ekorBeli: number;
  cukup: boolean;
}

/**
 * Kebutuhan ayam potong 9: dibeli per ekor (1 ekor = komposisi dada/PA/PB/sayap),
 * dipakai per bagian saat ekor utuh digoreng.
 */
export function kebutuhanAyam(p: {
  hari: number;
  targetHari: number;
  komposisi: Record<BagianAyam, number>;
  bagian: Record<BagianAyam, BagianPakai>;
}): KebutuhanAyam {
  const rata = {} as Record<BagianAyam, number>;
  const est = {} as Record<BagianAyam, number | null>;
  const defisit = {} as Record<BagianAyam, number>;
  const ekor = {} as Record<BagianAyam, number>;
  const bagian: KebutuhanAyam['perBagian'] = {} as KebutuhanAyam['perBagian'];
  for (const b of ['dada', 'pahaAtas', 'pahaBawah', 'sayap'] as BagianAyam[]) {
    const bp = p.bagian[b] ?? { stok: 0, total: 0 };
    const r = p.hari > 0 ? bp.total / p.hari : 0;
    rata[b] = r;
    est[b] = r > 0 ? bp.stok / r : null;
    defisit[b] = Math.max(0, r * p.targetHari - bp.stok);
    ekor[b] = p.komposisi[b] > 0 ? Math.ceil(defisit[b] / p.komposisi[b]) : 0;
    bagian[b] = { stok: bp.stok, rataPerHari: r, estHariHabis: est[b], defisit: defisit[b], ekor: ekor[b] };
  }
  const ekorBeli = Math.max(0, ...Object.values(ekor));
  return {
    ekorPerHari: p.komposisi.dada > 0 ? rata.dada / p.komposisi.dada : 0,
    perBagian: bagian,
    ekorBeli,
    cukup: ekorBeli <= 0,
  };
}

/** Rata-rata pemakaian per hari bila ada total konsumsi selama `hari` hari. */
export function rataPerHari(total: number, hari: number): number {
  return hari > 0 ? total / hari : 0;
}

export interface BarisPesan {
  nama: string;
  beli: number;
  satuan: string;
  rincian: string;
}

/** Susun pesan teks list belanja untuk WhatsApp / unduhan. */
export function susunPesan(input: {
  judul: string;
  subjudul: string;
  baris: BarisPesan[];
  totalItem: number;
  estimasi: string;
}): string {
  const g = '─'.repeat(40);
  const isi = input.baris.map((b) => `• ${b.nama} — beli ${b.beli} ${b.satuan}\n  ${b.rincian}`);
  return [input.judul, input.subjudul, g, ...isi, g, `${input.totalItem} item · estimasi ${input.estimasi}`, ''].join('\n');
}
