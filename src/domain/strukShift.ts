/**
 * Struk rangkuman akhir shift 58mm — murni & diuji.
 * Dipakai oleh render PNG/PDF/ESC-POS yang sama dengan struk penjualan.
 */
import { bungkus, garis, garisTipis, potong, rupiahStruk, STRUK_MAX, type StrukBaris } from './struk';

export interface DataRekapShift {
  outlet: string;
  alamat?: string;
  noHp?: string;
  /** nama shift / kasir — opsional */
  nama?: string;
  /** baris sambutan opsional multi-baris */
  sambutan?: string;
  /** pesan penutup multi-baris */
  penutup?: string;
  nomor: number;
  bukaWaktu: string;
  tutupWaktu: string;
  saldoAwal: number;
  jualTunai: number;
  tambah: number;
  keluar: number;
  batalTunai: number;
  seharusnya: number;
  fisik: number;
  selisih: number;
  setoran: number;
  floatTarget: number;
  omzetOnline?: number;
}

function tglID(iso: string): string {
  const s = (iso || '').replace('T', ' ');
  const [tanggal = '', jam = ''] = s.split(' ');
  const [y, m, d] = tanggal.split('-');
  if (!y || !m || !d) return s.slice(0, 16);
  return `${d}/${m}/${y} ${jam.slice(0, 5)}`;
}

/** Satu baris dua kolom: label kiri, nilai rupiah rata kanan. */
function row(label: string, nilai: number, bold = false): StrukBaris {
  const kanan = rupiahStruk(nilai).padStart(13);
  const kiri = potong(label, STRUK_MAX - 13 - 1);
  const pad = Math.max(1, STRUK_MAX - kiri.length - kanan.length);
  return { text: `${kiri}${' '.repeat(pad)}${kanan}`, bold };
}

/** Baris label: nilai (bukan rupiah), mis. waktu. */
function rowTeks(label: string, nilai: string): StrukBaris {
  const teks = potong(nilai, 24);
  const kiri = potong(label, STRUK_MAX - teks.length - 1);
  const pad = Math.max(1, STRUK_MAX - kiri.length - teks.length);
  return { text: `${kiri}${' '.repeat(pad)}${teks}` };
}

function tengah(text: string, bold = false): StrukBaris[] {
  const out: StrukBaris[] = [];
  for (const l of bungkus(text, 40)) out.push({ text: l, center: true, bold });
  return out;
}

/** Susun baris struk rangkuman akhir shift. */
export function barisRekapShift(d: DataRekapShift): StrukBaris[] {
  const out: StrukBaris[] = [];
  out.push({ text: potong(d.outlet, STRUK_MAX), bold: true, center: true });
  if (d.alamat) for (const l of bungkus(d.alamat, 40)) out.push({ text: l, center: true });
  if (d.noHp) out.push({ text: potong(d.noHp, 40), center: true });
  if (d.sambutan) out.push(...tengah(d.sambutan));
  out.push({ text: garis() });
  out.push(...tengah(`RANGKUMAN AKHIR SHIFT`, true));
  out.push(...tengah(`Shift #${d.nomor}`.toUpperCase(), true));
  if (d.nama) out.push(...tengah(d.nama));
  out.push(rowTeks('Mulai ', tglID(d.bukaWaktu)));
  out.push(rowTeks('Akhir ', tglID(d.tutupWaktu)));
  out.push({ text: garisTipis() });
  out.push(row('Saldo awal', d.saldoAwal));
  out.push(row('Penjualan tunai', d.jualTunai, true));
  out.push(row('Tambah laci', d.tambah));
  out.push(row('Kas keluar', -d.keluar));
  out.push(row('Pembatalan tunai', -d.batalTunai));
  out.push({ text: garisTipis() });
  out.push(row('Uang seharusnya', d.seharusnya, true));
  out.push(row('Fisik di laci', d.fisik));
  out.push(row('Selisih', d.selisih, d.selisih !== 0));
  out.push(row('Setoran', d.setoran, true));
  out.push(row('Float tersisa', d.floatTarget));
  if (d.omzetOnline && d.omzetOnline > 0) {
    out.push({ text: garisTipis() });
    out.push(row('Omzet online (est.)', d.omzetOnline));
    out.push({ text: '(dibayar platform — di luar laci)', center: true });
  }
  out.push({ text: garis() });
  if (d.penutup) out.push(...tengah(d.penutup));
  return out;
}
