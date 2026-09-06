/** Matematika kasir — fungsi murni yang diuji unit. */

export interface BarisHarga {
  qty: number;
  harga: number;
}

/** Subtotal baris = Σ qty × harga. */
export function subtotalBaris(rows: BarisHarga[]): number {
  return Math.round(rows.reduce((s, r) => s + r.qty * r.harga, 0));
}

/** Uang kembalian (negatif = uang diterima kurang). */
export function kembalian(dibayar: number, total: number): number {
  return Math.round(dibayar) - Math.round(total);
}

/** Tunai valid bila yang diterima ≥ total. */
export function bayarTunaiCukup(dibayar: number, total: number): boolean {
  return kembalian(dibayar, total) >= 0;
}

export interface MetodeRule {
  metode: 'tunai' | 'qris' | 'transfer' | 'online';
  dibayar: number;
}

/**
 * Validasi pembayaran: tunai harus ≥ total (non-tunai — termasuk online platform —
 * dianggap pas = total). Mengembalikan nilai `dibayar` efektif untuk dicatat.
 */
export function normalisasiBayar(rule: MetodeRule, total: number): { dibayar: number; kembalian: number } {
  if (rule.metode === 'tunai') {
    return { dibayar: rule.dibayar, kembalian: kembalian(rule.dibayar, total) };
  }
  return { dibayar: total, kembalian: 0 };
}
