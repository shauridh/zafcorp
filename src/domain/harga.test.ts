import { describe, expect, it } from 'vitest';
import { hargaSaat, riwayatTerurut, tambahRiwayat } from './harga';

describe('riwayat harga jual', () => {
  it('menambah harga baru tanpa mengubah entri lama', () => {
    const awal = [{ tanggal: '2026-09-01', harga: 11000 }];
    const baru = tambahRiwayat(awal, { tanggal: '2026-09-10', harga: 12000 });
    expect(baru).toHaveLength(2);
    expect(baru[0]).toEqual({ tanggal: '2026-09-01', harga: 11000 });
    expect(awal).toHaveLength(1);
  });

  it('tidak menambah duplikat persis (tanggal & harga sama dengan terbaru)', () => {
    const list = [
      { tanggal: '2026-09-01', harga: 11000 },
      { tanggal: '2026-09-10', harga: 12000 },
    ];
    const after = tambahRiwayat(list, { tanggal: '2026-09-10', harga: 12000 });
    expect(after).toHaveLength(2);
  });

  it('mengurutkan riwayat terbaru lebih dulu untuk tampilan', () => {
    const list = [
      { tanggal: '2026-09-01', harga: 11000 },
      { tanggal: '2026-09-15', harga: 12500 },
      { tanggal: '2026-09-10', harga: 12000 },
    ];
    const sorted = riwayatTerurut(list);
    expect(sorted.map((e) => e.harga)).toEqual([12500, 12000, 11000]);
  });

  it('harga lama tetap berlaku untuk transaksi di tanggal lama', () => {
    const list = [
      { tanggal: '2026-09-01', harga: 11000 },
      { tanggal: '2026-09-10', harga: 12000 },
    ];
    // transaksi 5 Sep memakai harga 11.000, bukan 12.000
    expect(hargaSaat(list, '2026-09-05')?.harga).toBe(11000);
    expect(hargaSaat(list, '2026-09-10')?.harga).toBe(12000);
    expect(hargaSaat(list)?.harga).toBe(12000);
  });
});
