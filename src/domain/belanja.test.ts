import { describe, expect, it } from 'vitest';
import { kebutuhanAyam, kebutuhanBiasa, rataPerHari, susunPesan } from './belanja';

describe('kebutuhanBiasa', () => {
  it('menghitung rata-rata, sisa hari, dan jumlah beli (dibulatkan ke atas)', () => {
    // 210 pcs kemasan terpakai 7 hari, stok 100, target 3 hari, 1 satuan beli = 100 pcs
    const k = kebutuhanBiasa({ total: 210, hari: 7, stok: 100, targetHari: 3, perBeli: 100 });
    expect(k.rataPerHari).toBe(30);
    expect(k.estHariHabis).toBeCloseTo(3.333, 2);
    expect(k.butuhDasar).toBe(0); // 90 butuh ≤ 100 stok
    expect(k.beli).toBe(0);
    expect(k.cukup).toBe(true);
  });
  it('menyarankan beli bila stok tak cukup target', () => {
    const k = kebutuhanBiasa({ total: 700, hari: 7, stok: 40, targetHari: 7, perBeli: 100 });
    expect(k.butuhDasar).toBe(660);
    expect(k.beli).toBe(7); // ceil(660/100)
    expect(k.cukup).toBe(false);
  });
  it('stok habis → est hari 0 dan beli sesuai kebutuhan', () => {
    const k = kebutuhanBiasa({ total: 70, hari: 7, stok: 0, targetHari: 3 });
    expect(k.estHariHabis).toBe(0);
    expect(k.butuhDasar).toBe(30);
    expect(k.beli).toBe(30);
  });
  it('tanpa pemakaian → tidak menyarankan beli', () => {
    const k = kebutuhanBiasa({ total: 0, hari: 7, stok: 5, targetHari: 3 });
    expect(k.rataPerHari).toBe(0);
    expect(k.estHariHabis).toBeNull();
    expect(k.beli).toBe(0);
    expect(k.cukup).toBe(true);
  });
});

describe('kebutuhanAyam', () => {
  const komposisi = { dada: 3, pahaAtas: 2, pahaBawah: 2, sayap: 2 };
  it('3 ekor/hari, stok habis semua → sarankan 7 ekor untuk 7 hari', () => {
    // 3 ekor/hari selama 3 hari → 9 ekor total → dada 27, PA/PB/sayap 18/18/18
    const k = kebutuhanAyam({
      hari: 3,
      targetHari: 7,
      komposisi,
      bagian: {
        dada: { stok: 0, total: 27 },
        pahaAtas: { stok: 0, total: 18 },
        pahaBawah: { stok: 0, total: 18 },
        sayap: { stok: 0, total: 18 },
      },
    });
    expect(k.ekorPerHari).toBe(3);
    expect(k.ekorBeli).toBe(21); // 3 ekor/hari × 7 hari
    expect(k.cukup).toBe(false);
  });
  it('stok masih cukup untuk target → tidak perlu beli', () => {
    const k = kebutuhanAyam({
      hari: 2,
      targetHari: 3,
      komposisi,
      bagian: {
        dada: { stok: 12, total: 6 },
        pahaAtas: { stok: 8, total: 4 },
        pahaBawah: { stok: 8, total: 4 },
        sayap: { stok: 8, total: 4 },
      },
    });
    expect(k.ekorBeli).toBe(0);
    expect(k.cukup).toBe(true);
  });
  it('bagian tertentu memaksa pembelian lebih banyak', () => {
    // sayap tersisa 1 saja padahal dipakai 2/hari → butuh 3 ekor untuk target 3 hari
    const k = kebutuhanAyam({
      hari: 1,
      targetHari: 3,
      komposisi,
      bagian: {
        dada: { stok: 20, total: 3 },
        pahaAtas: { stok: 10, total: 2 },
        pahaBawah: { stok: 10, total: 2 },
        sayap: { stok: 1, total: 2 },
      },
    });
    expect(k.perBagian.sayap.defisit).toBe(5);
    expect(k.perBagian.sayap.ekor).toBe(3);
    expect(k.ekorBeli).toBe(3);
  });
});

describe('rataPerHari & susunPesan', () => {
  it('rataPerHari membagi dengan aman', () => {
    expect(rataPerHari(210, 7)).toBe(30);
    expect(rataPerHari(10, 0)).toBe(0);
  });
  it('menyusun pesan dengan header dan baris', () => {
    const pesan = susunPesan({
      judul: '🛒 BELANJA — SABANA FRIED CHICKEN',
      subjudul: 'kebutuhan 7 hari · rata-rata 7 hari terakhir',
      baris: [{ nama: 'AYAM POTONG 9', beli: 7, satuan: 'Pak', rincian: 'sisa 0 sayap · habis hari ini' }],
      totalItem: 1,
      estimasi: 'Rp 336.000',
    });
    expect(pesan).toContain('BELANJA');
    expect(pesan).toContain('• AYAM POTONG 9 — beli 7 Pak');
    expect(pesan).toContain('Rp 336.000');
  });
});
