import { describe, expect, it } from 'vitest';
import { barisRekapShift, type DataRekapShift } from './strukShift';
import { STRUK_MAX } from './struk';

const dasar: DataRekapShift = {
  outlet: 'SABANA FRIED CHICKEN',
  nomor: 2,
  nama: 'Shift pagi · kasir Ani',
  bukaWaktu: '2026-09-06T07:00:00',
  tutupWaktu: '2026-09-06T15:30:00',
  saldoAwal: 350_000,
  jualTunai: 1_250_000,
  tambah: 100_000,
  keluar: 45_000,
  batalTunai: 10_000,
  seharusnya: 1_645_000,
  fisik: 1_645_000,
  selisih: 0,
  setoran: 1_295_000,
  floatTarget: 350_000,
};

describe('barisRekapShift', () => {
  it('memuat header, waktu, & identitas shift', () => {
    const baris = barisRekapShift(dasar);
    const teks = baris.map((b) => b.text).join('\n');
    expect(teks).toContain('RANGKUMAN AKHIR SHIFT');
    expect(teks).toContain('SHIFT #2');
    expect(teks).toContain('Shift pagi · kasir Ani');
    expect(teks).toContain('06/09/2026 07:00');
    expect(teks).toContain('06/09/2026 15:30');
  });

  it('memuat angka penjualan, selisih, setoran & float', () => {
    const baris = barisRekapShift(dasar);
    const teks = baris.map((b) => b.text).join('\n');
    expect(teks).toContain('Rp 1.250.000');
    expect(teks).toContain('Setoran');
    expect(teks).toContain('Rp 1.295.000');
    expect(teks).toContain('Float tersisa');
    expect(teks).toContain('Rp 350.000');
  });

  it('tidak ada baris yang melebihi lebar struk', () => {
    const baris = barisRekapShift(dasar);
    for (const b of baris) expect(b.text.length).toBeLessThanOrEqual(STRUK_MAX);
  });

  it('omzet online tampil sebagai info tambahan', () => {
    const baris = barisRekapShift({ ...dasar, omzetOnline: 800_000 });
    const teks = baris.map((b) => b.text).join('\n');
    expect(teks).toContain('Omzet online (est.)');
    expect(teks).toContain('Rp 800.000');
  });
});
