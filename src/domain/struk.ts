/**
 * Isi struk 58mm — murni, tanpa canvas/PDF, sehingga bisa diuji.
 * Lebar logis memakai perkiraan karakter monospace (MAX ≈ 44 karakter).
 */

export interface StrukBaris {
  text: string;
  bold?: boolean;
  center?: boolean;
}

export const STRUK_MAX = 44;

/** Potong teks ke N karakter; jika terpotong diberi "…". */
export function potong(text: string, n: number): string {
  return text.length <= n ? text : text.slice(0, n - 1).trimEnd() + '…';
}

export function garis(ch = '='): string {
  return ch.repeat(STRUK_MAX);
}

export function garisTipis(): string {
  return '-'.repeat(STRUK_MAX);
}

/** Bungkus kata agar tiap baris ≤ max (monospace kasar). */
export function bungkus(text: string, max: number = STRUK_MAX): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + ' ' + w).length <= max) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => potong(l, max));
}

export interface ItemStruk {
  nama: string;
  hargaSatuan: number;
  qty: number;
}

export interface DataStruk {
  outlet: string;
  alamat?: string;
  noHp?: string;
  no: string;
  waktu: string;
  sumber: string;
  metode: string;
  items: ItemStruk[];
  total: number;
  dibayar?: number;
  kembalian?: number;
  catatan?: string;
  /** baris sambutan opsional (multi-baris \\n) — dicetak di bawah header outlet */
  sambutan?: string;
  /** pesan penutup (multi-baris \\n); tanpa nilai memakai ucapan bawaan */
  penutup?: string;
}

export function ringkasRupiah(n: number): string {
  const s = n.toLocaleString('id-ID');
  return s.length > 12 ? 'Rp' + s.slice(-11) : 'Rp ' + s;
}

export function rupiahStruk(n: number): string {
  return 'Rp ' + n.toLocaleString('id-ID');
}

/** Tanggal Indonesia + jam tanpa detik: '04/09/2026 18:57'. */
function tglID(iso: string): string {
  const s = (iso || '').replace('T', ' ');
  const [tanggal = '', jam = ''] = s.split(' ');
  const [y, m, d] = tanggal.split('-');
  if (!y || !m || !d) return s.slice(0, 16);
  return `${d}/${m}/${y} ${jam.slice(0, 5)}`;
}

/** Dua kolom dalam satu baris (rata kanan kolom kedua); pecah bila terlalu panjang. */
function duaKolom(kiri: string, kanan: string): StrukBaris[] {
  if (kiri.length + kanan.length + 2 <= STRUK_MAX) {
    const pad = STRUK_MAX - kiri.length - kanan.length;
    return [{ text: kiri + ' '.repeat(Math.max(1, pad)) + kanan }];
  }
  return [{ text: kiri }, { text: kanan }];
}

/** Teks multi-baris (\\n) diratakan tengah, tiap baris dibungkus ≤ max. */
function barisTengah(text: string, max: number): StrukBaris[] {
  const out: StrukBaris[] = [];
  for (const raw of String(text ?? '').split('\n')) {
    if (!raw.trim()) {
      out.push({ text: '', center: true });
      continue;
    }
    for (const l of bungkus(raw, max)) out.push({ text: l, center: true });
  }
  return out;
}

/**
 * Baris item: nama dibungkus (bukan dipotong) di kiri, `qty x harga` di kanan
 * baris pertama, lalu subtotal rata kanan di baris sendiri — rapi & hemat kertas.
 */
function barisItem(nama: string, qty: number, harga: number, subtotal: number): StrukBaris[] {
  const kanan = `${qty} x ${ringkasRupiah(harga)}`;
  const lebarNama = Math.max(12, STRUK_MAX - kanan.length - 1);
  const namaBaris = bungkus(nama, lebarNama);
  const out: StrukBaris[] = [];
  namaBaris.forEach((l, i) => {
    if (i === 0) {
      const pad = Math.max(1, STRUK_MAX - l.length - kanan.length);
      out.push({ text: `${l}${' '.repeat(pad)}${kanan}` });
    } else {
      out.push({ text: `  ${l}` });
    }
  });
  out.push({ text: `   ${potong(ringkasRupiah(subtotal), 11).padStart(11)}` });
  return out;
}

/** Susun seluruh baris struk (dipakai oleh render PNG, PDF, dan ESC/POS). */
export function barisStruk(d: DataStruk): StrukBaris[] {
  const out: StrukBaris[] = [];
  out.push({ text: potong(d.outlet, STRUK_MAX), bold: true, center: true });
  if (d.alamat) for (const l of bungkus(d.alamat, 40)) out.push({ text: l, center: true });
  if (d.noHp) out.push({ text: potong(d.noHp, 40), center: true });
  if (d.sambutan) out.push(...barisTengah(d.sambutan, 40));
  out.push({ text: garis() });
  out.push(...duaKolom(`No    : ${d.no}`, tglID(d.waktu)));
  out.push(...duaKolom(`Sumber: ${d.sumber}`, `Metode: ${d.metode}`));
  if (d.catatan) out.push({ text: `Catatan: ${potong(d.catatan, 34)}` });
  out.push({ text: garisTipis() });
  for (const it of d.items) {
    out.push(...barisItem(it.nama, it.qty, it.hargaSatuan, it.hargaSatuan * it.qty));
  }
  out.push({ text: garisTipis() });
  out.push({
    text: `${'TOTAL'.padEnd(STRUK_MAX - 12)}${rupiahStruk(d.total).padStart(12)}`,
    bold: true,
  });
  if (d.dibayar != null) out.push({ text: `BAYAR  ${dibayarLine(d.dibayar)}` });
  if (d.kembalian != null)
    out.push({ text: `KEMBALI${kembaliLine(d.kembalian)}`, bold: d.kembalian >= 0 });
  out.push({ text: garis() });
  if (d.penutup) out.push(...barisTengah(d.penutup, 40));
  return out;
}

function dibayarLine(n: number): string {
  const s = rupiahStruk(n);
  return s.padStart(12);
}

function kembaliLine(n: number): string {
  const s = rupiahStruk(n);
  return s.padStart(11);
}
