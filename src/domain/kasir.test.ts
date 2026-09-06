import { describe, expect, it } from 'vitest';
import { bayarTunaiCukup, kembalian, normalisasiBayar, subtotalBaris } from './kasir';

describe('subtotal & kembalian', () => {
  it('2 dada (11.000) + 1 paha bawah (9.000) = 31.000', () => {
    expect(subtotalBaris([{ qty: 2, harga: 11000 }, { qty: 1, harga: 9000 }])).toBe(31000);
  });
  it('bayar 50.000 utk total 31.000 → kembalian 19.000', () => {
    expect(kembalian(50000, 31000)).toBe(19000);
  });
  it('bayar kurang → kembalian negatif & ditolak', () => {
    expect(kembalian(20000, 31000)).toBe(-11000);
    expect(bayarTunaiCukup(20000, 31000)).toBe(false);
    expect(bayarTunaiCukup(31000, 31000)).toBe(true);
  });
});

describe('normalisasi pembayaran', () => {
  it('qris/transfer selalu dicatat pas total tanpa kembalian', () => {
    const r = normalisasiBayar({ metode: 'qris', dibayar: 999999 }, 31000);
    expect(r).toEqual({ dibayar: 31000, kembalian: 0 });
  });
  it('tunai memakai jumlah yang diterima', () => {
    const r = normalisasiBayar({ metode: 'tunai', dibayar: 50000 }, 31000);
    expect(r).toEqual({ dibayar: 50000, kembalian: 19000 });
  });
});
