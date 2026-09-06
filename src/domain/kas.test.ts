import { describe, expect, it } from 'vitest';
import { selisihKas, setoranKas, uangSeharusnya } from './kas';

describe('kas tunai (float 350.000)', () => {
  it('skenario shift: buka 350rb, jual tunai + koreksi dari Fase 2-3', () => {
    const l: import('./kas').LedgerKas = {
      saldoAwal: 350000,
      jualTunai: 50000, // transaksi #2 sayap tunai
      tambah: 100000, // penambahan laci dari luar
      keluar: 25000, // beli kecil pakai kas
      batalTunai: 30000, // transaksi tunai dibatalkan
    };
    expect(uangSeharusnya(l)).toBe(350000 + 50000 + 100000 - 25000 - 30000);
    expect(uangSeharusnya(l)).toBe(445000);
  });

  it('hitungan fisik pas → selisih 0 & setoran = fisik − 350.000', () => {
    const l: import('./kas').LedgerKas = { saldoAwal: 350000, jualTunai: 0, tambah: 0, keluar: 0, batalTunai: 0 };
    expect(selisihKas(350000, l)).toBe(0);
    expect(setoranKas(500000, 350000)).toBe(150000);
  });

  it('selisih lebih & kurang terbaca', () => {
    const l: import('./kas').LedgerKas = { saldoAwal: 350000, jualTunai: 310000, tambah: 0, keluar: 25000, batalTunai: 0 };
    expect(uangSeharusnya(l)).toBe(635000);
    expect(selisihKas(635000, l)).toBe(0);
    expect(selisihKas(640000, l)).toBe(5000); // lebih 5rb
    expect(selisihKas(630000, l)).toBe(-5000); // kurang 5rb
  });

  it('fisik di bawah float target → setoran 0 (laci belum penuh float)', () => {
    expect(setoranKas(300000, 350000)).toBe(0);
    expect(setoranKas(350000, 350000)).toBe(0);
  });
});
