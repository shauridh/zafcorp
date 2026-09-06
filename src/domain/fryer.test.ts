import { describe, expect, it } from 'vitest';
import { hariSejak, jadwalFryer, setelahGorengEkor } from './fryer';

const SEKARANG = '2026-09-04T19:00:00';
const dasar = () => ({
  sejakWaktu: '2026-09-01T08:00:00', // 3 hari lalu
  ekorSejakGanti: 12,
  ekorSejakTopUp: 2,
  topUpPak: 10,
  gantiHari: 30,
});

describe('hariSejak', () => {
  it('menghitung hari yang lewat (floor)', () => {
    expect(hariSejak('2026-09-01T08:00:00', '2026-09-04T19:00:00')).toBe(3);
    expect(hariSejak('2026-09-04T00:00:00', '2026-09-04T23:00:00')).toBe(0);
    expect(hariSejak('2026-08-05T08:00:00', '2026-09-04T19:00:00')).toBe(30);
  });
});

describe('jadwalFryer', () => {
  it('tidak menyalakan peringatan saat di bawah ambang', () => {
    const f = jadwalFryer({ ...dasar(), ekorSejakTopUp: 5 }, SEKARANG);
    expect(f.dueTopUp).toBe(false);
    expect(f.dueGanti).toBe(false);
    expect(f.sisaTopUp).toBe(5);
    expect(f.sisaHariGanti).toBe(27);
  });
  it('due top-up saat ekor sejak top-up mencapai ambang 10', () => {
    const f = jadwalFryer({ ...dasar(), ekorSejakTopUp: 10 }, SEKARANG);
    expect(f.dueTopUp).toBe(true);
    expect(f.sisaTopUp).toBe(0);
  });
  it('due ganti saat sudah 30 hari sejak isi', () => {
    const f = jadwalFryer({ ...dasar(), sejakWaktu: '2026-08-05T08:00:00' }, SEKARANG);
    expect(f.hariSejakGanti).toBe(30);
    expect(f.dueGanti).toBe(true);
    expect(f.sisaHariGanti).toBe(0);
  });
  it('tetap menghitung hari walau ekor belum banyak', () => {
    const f = jadwalFryer({ ...dasar(), sejakWaktu: '2026-08-01T08:00:00', ekorSejakGanti: 1 }, '2026-09-20T08:00:00');
    expect(f.hariSejakGanti).toBe(50);
    expect(f.dueGanti).toBe(true);
    expect(f.dueTopUp).toBe(false);
  });
});

describe('setelahGorengEkor', () => {
  it('menambah kedua penghitung saat produksi 3 ekor', () => {
    const m = setelahGorengEkor(dasar(), 3);
    expect(m.ekorSejakGanti).toBe(15);
    expect(m.ekorSejakTopUp).toBe(5);
  });
});
