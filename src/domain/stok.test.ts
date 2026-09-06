import { describe, expect, it } from 'vitest';
import {
  beliAyamBagian,
  deltaKoreksi,
  hasilProduksiEkor,
  hitungBeliAyam,
  hitungBeliBiasa,
  kekuranganStok,
  konsumsiAyamEkor,
} from './stok';

describe('beli ayam utuh', () => {
  it('3 pak → +9 dada, +6 paha atas, +6 paha bawah, +6 sayap', () => {
    expect(beliAyamBagian(3)).toEqual([
      { bagian: 'dada', delta: 9 },
      { bagian: 'pahaAtas', delta: 6 },
      { bagian: 'pahaBawah', delta: 6 },
      { bagian: 'sayap', delta: 6 },
    ]);
  });
  it('hitungBeliAyam tidak menambah stok dasar agregat', () => {
    const e = hitungBeliAyam(2);
    expect(e.stokDasar).toBe(0);
    expect(e.bagian).toHaveLength(4);
  });
});

describe('beli bahan biasa (konversi satuan)', () => {
  it('2 ikat @100 lembar → +200 pcs', () => {
    const e = hitungBeliBiasa(2, 100);
    expect(e.stokDasar).toBe(200);
    expect(e.bagian).toBeNull();
  });
  it('5 pouch @2 liter → +10 liter', () => {
    expect(hitungBeliBiasa(5, 2).stokDasar).toBe(10);
  });
});

describe('produksi ayam per ekor', () => {
  it('konsumsi 2 ekor = 6 dada + 4 PA + 4 PB + 4 sayap', () => {
    expect(konsumsiAyamEkor(2)).toEqual([
      { bagian: 'dada', delta: 6 },
      { bagian: 'pahaAtas', delta: 4 },
      { bagian: 'pahaBawah', delta: 4 },
      { bagian: 'sayap', delta: 4 },
    ]);
  });
  it('hasil produksi 1 ekor menambah stok jadi per bagian sama', () => {
    expect(hasilProduksiEkor(1)).toEqual(beliAyamBagian(1));
  });
});

describe('kekurangan & koreksi', () => {
  it('stok cukup → kekurangan 0', () => {
    expect(kekuranganStok(10, 8)).toBe(0);
  });
  it('stok kurang → jumlah yang hilang', () => {
    expect(kekuranganStok(2, 10)).toBe(8);
  });
  it('koreksi: stok fisik 40 padahal catatan 35 → +5', () => {
    expect(deltaKoreksi(35, 40)).toBe(5);
  });
  it('koreksi: fisik 30 padahal catatan 35 → -5', () => {
    expect(deltaKoreksi(35, 30)).toBe(-5);
  });
});
