import { describe, expect, it } from 'vitest';
import {
  agregasiProduk,
  biayaEkorAyamGoreng,
  biayaPerPotong,
  bulanDariTanggal,
  dalamBulan,
  dalamHari,
  formatQty,
  hargaPerDasar,
  marginPct,
  sumPerKunci,
} from './laporan';

describe('agregasiProduk', () => {
  it('menggabungkan qty & omzet per produk lalu urut terlaris dulu', () => {
    const rows = [
      { produkId: 1, nama: 'Dada', qty: 2, subtotal: 22000 },
      { produkId: 2, nama: 'Sayap', qty: 1, subtotal: 8000 },
      { produkId: 1, nama: 'Dada', qty: 1, subtotal: 11000 },
    ];
    const agg = agregasiProduk(rows);
    expect(agg).toHaveLength(2);
    expect(agg[0]).toMatchObject({ produkId: 1, nama: 'Dada', qty: 3, omzet: 33000 });
    expect(agg[1]).toMatchObject({ produkId: 2, qty: 1, omzet: 8000 });
  });
});

describe('sumPerKunci', () => {
  it('menjumlahkan per metode bayar', () => {
    const out = sumPerKunci([
      { kunci: 'tunai' as const, nilai: 1000 },
      { kunci: 'qris' as const, nilai: 2000 },
      { kunci: 'tunai' as const, nilai: 500 },
    ]);
    expect(out.tunai).toBe(1500);
    expect(out.qris).toBe(2000);
  });
});

describe('hargaPerDasar', () => {
  it('membagi harga beli dengan isi satuan beli', () => {
    expect(hargaPerDasar(165000, 10)).toBe(16500); // beras 10 kg
    expect(hargaPerDasar(23500, 1)).toBe(23500);
  });
  it('memakai 1 bila isi tidak diketahui', () => {
    expect(hargaPerDasar(5000, undefined)).toBe(5000);
  });
});

describe('biaya ayam utuh (aturan pusat)', () => {
  it('1 ekor = ayam + 1/3 pak tepung + 0,2 L minyak', () => {
    const ekor = biayaEkorAyamGoreng(48000, 23500, 21700); // minyak 43.400/2L
    expect(ekor).toBeCloseTo(48000 + 23500 / 3 + 21700 * 0.2, 2);
  });
  it('biaya per potong membagi rata 9 potong', () => {
    const perPotong = biayaPerPotong(60173.3333, 9);
    expect(perPotong).toBeCloseTo(6685.9259, 2);
    expect(biayaPerPotong(90000, 0)).toBe(90000); // hindari bagi nol
  });
});

describe('margin & window', () => {
  it('marginPct', () => {
    expect(marginPct(3000, 11000)).toBeCloseTo(27.2727, 2);
    expect(marginPct(0, 0)).toBe(0);
  });
  it('dalamHari / dalamBulan mencocokkan string ISO', () => {
    expect(dalamHari('2026-09-04T19:13:00', '2026-09-04')).toBe(true);
    expect(dalamHari('2026-09-04T00:00:01', '2026-09-05')).toBe(false);
    expect(dalamBulan('2026-09-04T19:13:00', '2026-09')).toBe(true);
    expect(dalamBulan('2026-10-01T00:00:00', '2026-09')).toBe(false);
    expect(bulanDariTanggal('2026-09-04')).toBe('2026-09');
  });
  it('formatQty memangkas desimal panjang', () => {
    expect(formatQty(2)).toBe('2');
    expect(formatQty(0.6666667)).toBe('0,67');
  });
});
