import { describe, expect, it } from 'vitest';
import {
  AYAM_POTONG_9,
  beliAyam,
  minyakLiterPerEkor,
  tepungPackPerEkor,
  totalPotongPerEkor,
} from './conversions';

describe('komposisi ayam (1 ekor = 9 potong)', () => {
  it('total 1 ekor = 9 potong (3 dada, 2 paha atas, 2 paha bawah, 2 sayap)', () => {
    expect(totalPotongPerEkor()).toBe(9);
    expect(AYAM_POTONG_9).toEqual({ dada: 3, pahaAtas: 2, pahaBawah: 2, sayap: 2 });
  });

  it('beli 3 pak → 9 dada, 6 paha atas, 6 paha bawah, 6 sayap', () => {
    expect(beliAyam(3)).toEqual({ dada: 9, pahaAtas: 6, pahaBawah: 6, sayap: 6 });
  });

  it('beli 1 pak menghasilkan 9 potong total', () => {
    const parts = beliAyam(1);
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    expect(total).toBe(9);
  });
});

describe('tepung bumbu (1 pak : 3 ekor)', () => {
  it('3 ekor memakai 1 pak', () => {
    expect(tepungPackPerEkor(3)).toBe(1);
  });
  it('1 ekor memakai ⅓ pak', () => {
    expect(tepungPackPerEkor(1)).toBeCloseTo(1 / 3);
  });
  it('2 pak (ekor) memakai ⅔ pak tepung', () => {
    expect(tepungPackPerEkor(2)).toBeCloseTo(2 / 3);
  });
});

describe('minyak goreng (estimasi ±0,2 L/ekor)', () => {
  it('1 ekor = 0.2 L', () => {
    expect(minyakLiterPerEkor(1)).toBeCloseTo(0.2);
  });
  it('10 ekor = 2 L (setara 1 pouch 2L top-up)', () => {
    expect(minyakLiterPerEkor(10)).toBeCloseTo(2);
  });
});
