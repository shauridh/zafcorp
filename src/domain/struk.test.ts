import { describe, expect, it } from 'vitest';
import { barisStruk, bungkus, garis, potong, STRUK_MAX, type DataStruk } from './struk';

const data: DataStruk = {
  outlet: 'SABANA FRIED CHICKEN — Cabang Sudirman',
  alamat: 'Jl. Sudirman No. 12',
  no: '12',
  waktu: '2026-09-04 18:57:17',
  sumber: 'Offline',
  metode: 'Tunai',
  items: [
    { nama: 'Ayam Dada Goreng', hargaSatuan: 11000, qty: 2 },
    { nama: 'Ayam Sayap Goreng', hargaSatuan: 8000, qty: 1 },
  ],
  total: 30000,
  dibayar: 50000,
  kembalian: 20000,
};

describe('baris struk 58mm', () => {
  it('semua baris ≤ lebar maksimal', () => {
    for (const b of barisStruk(data)) expect(b.text.length).toBeLessThanOrEqual(STRUK_MAX + 1);
  });
  it('memuat total, bayar & kembalian', () => {
    const text = barisStruk(data).map((b) => b.text).join('\n');
    expect(text).toContain('Rp 30.000');
    expect(text).toContain('Rp 50.000');
    expect(text).toContain('Rp 20.000');
  });
  it('memuat nama outlet & item', () => {
    const text = barisStruk(data).map((b) => b.text).join('\n');
    expect(text).toContain('SABANA FRIED CHICKEN');
    expect(text).toContain('Ayam Dada Goreng');
    expect(text).toContain('2 x');
  });
  it('memakai sambutan & pesan penutup yang bisa diatur', () => {
    const text = barisStruk({
      ...data,
      sambutan: '★ ENAKNYA NAGIH ★',
      penutup: 'Terima kasih 🙏\nSemoga hari Anda menyenangkan',
    })
      .map((b) => b.text)
      .join('\n');
    expect(text).toContain('★ ENAKNYA NAGIH ★');
    expect(text).toContain('Terima kasih 🙏');
    expect(text).toContain('Semoga hari Anda menyenangkan');
  });
  it('nama item panjang dibungkus rapi (tidak terpotong) & semua baris tetap muat', () => {
    const nama = 'Ayam Crispy Sambal Matah Spesial Rumahan Ekstra Pedas'; // ~58 karakter
    const baris = barisStruk({ ...data, items: [{ nama, hargaSatuan: 11000, qty: 2 }] });
    for (const b of baris) expect(b.text.length).toBeLessThanOrEqual(STRUK_MAX + 1);
    const text = baris.map((b) => b.text).join('\n');
    expect(text).toContain('2 x');
    for (const kata of nama.split(' ')) expect(text).toContain(kata);
  });
});

describe('helper teks', () => {
  it('bungkus menjaga ≤ max', () => {
    for (const l of bungkus('teks yang sangat panjang sekali untuk diuji wrapping baris struk', 20)) {
      expect(l.length).toBeLessThanOrEqual(20);
    }
  });
  it('potong menambahkan elipsis', () => {
    expect(potong('abcdefghij', 5)).toBe('abcd…');
    expect(garis().length).toBe(STRUK_MAX);
  });
});
