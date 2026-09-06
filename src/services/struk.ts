import { rupiahStruk, type DataStruk, type StrukBaris } from '../domain/struk';
import type { Pengaturan } from '../data/pengaturan';
import type { TransaksiHeader, TransaksiItem } from '../data/db';
import { LABEL_METODE, labelSumber } from '../data/sales';

export function dataStrukDari(
  p: Pengaturan,
  header: TransaksiHeader,
  items: TransaksiItem[],
): DataStruk {
  return {
    outlet: p.namaOutlet || 'SABANA FRIED CHICKEN',
    alamat: p.alamat || undefined,
    noHp: p.noHp || undefined,
    no: String(header.id ?? 0),
    waktu: (header.waktu || '').replace('T', ' '),
    sumber: labelSumber(header.sumber),
    metode: LABEL_METODE[header.metode] ?? header.metode,
    items: items.map((i) => ({ nama: i.nama, hargaSatuan: i.hargaSatuan, qty: i.qty })),
    total: header.total,
    dibayar: header.metode === 'tunai' ? header.dibayar : undefined,
    kembalian: header.metode === 'tunai' ? header.kembalian : undefined,
    catatan: header.catatan,
    sambutan: p.strukSambutan || undefined,
    penutup: p.strukPenutup || undefined,
  };
}

// ---------------------------------------------------------------------------
// PNG (canvas, ~2× untuk ketajaman di layar/share)
// ---------------------------------------------------------------------------

const SCALE = 2;
const LINE = 24 * SCALE;

export async function renderPng(baris: StrukBaris[]): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas tidak tersedia.');

  const font = (bold: boolean, px: number) => `${bold ? 'bold ' : ''}${px}px 'Courier New', monospace`;
  ctx.font = font(false, 12 * SCALE);
  const textW = (s: string) => ctx.measureText(s).width;
  let width = 380 * SCALE;
  for (const b of baris) width = Math.max(width, Math.ceil(textW(b.text)) + 16 * SCALE);
  const height = baris.length * LINE + 20 * SCALE;

  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#111111';

  baris.forEach((b, i) => {
    ctx.font = font(b.bold === true, 12 * SCALE);
    const y = 14 * SCALE + i * LINE + 12 * SCALE;
    if (b.center) {
      const w = textW(b.text);
      ctx.fillText(b.text, (width - w) / 2, y);
    } else {
      ctx.fillText(b.text, 8 * SCALE, y);
    }
  });

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Gagal membuat gambar.'))), 'image/png');
  });
}

// ---------------------------------------------------------------------------
// PDF (kertas lebar 80 mm)
// ---------------------------------------------------------------------------

function ascii(s: string): string {
  // jspdf font standar hanya ASCII dasar
  return s.replace(/[^\x20-\x7E]/g, '');
}

export async function renderPdf(baris: StrukBaris[]): Promise<Blob> {
  // jsPDF besar (~±300 kB) — muat hanya saat benar-benar membuat PDF
  const { jsPDF } = await import('jspdf');
  const mmPerLine = 3.4;
  const heightMm = 12 + baris.length * mmPerLine + 8;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [80, heightMm] });
  pdf.setFont('courier', 'normal');
  pdf.setFontSize(9);
  let y = 8;
  for (const b of baris) {
    if (b.bold) pdf.setFont('courier', 'bold');
    else pdf.setFont('courier', 'normal');
    const text = ascii(b.text);
    const w = pdf.getTextWidth(text);
    pdf.text(text, b.center ? (80 - w) / 2 : 4, y);
    y += mmPerLine;
  }
  return pdf.output('blob');
}

// ---------------------------------------------------------------------------
// Unduh & bagikan
// ---------------------------------------------------------------------------

function unduh(blob: Blob, namaFile: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaFile;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type HasilBagikan = 'shared' | 'download' | 'failed';

export async function bagikanFile(blob: Blob, namaFile: string, judul: string): Promise<HasilBagikan> {
  const file = new File([blob], namaFile, { type: blob.type });
  try {
    if (navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: judul, files: [file] });
      return 'shared';
    }
  } catch (e) {
    // pengguna membatalkan atau gagal → lanjut ke unduh
    void e;
  }
  try {
    unduh(blob, namaFile);
    return 'download';
  } catch {
    return 'failed';
  }
}

export function unduhFile(blob: Blob, namaFile: string) {
  unduh(blob, namaFile);
}

// ---------------------------------------------------------------------------
// ESC/POS via Web Bluetooth (best-effort — printer harus mendukung BLE)
// ---------------------------------------------------------------------------

export function escposDariBaris(baris: StrukBaris[]): Uint8Array {
  const sb: number[] = [0x1b, 0x40]; // init
  for (const b of baris) {
    const line = b.center ? b.text.trim() : b.text;
    for (const ch of ascii(line)) sb.push(ch.charCodeAt(0));
    sb.push(0x0a);
  }
  sb.push(0x1b, 0x64, 0x02); // feed 2 lines
  sb.push(0x1d, 0x56, 0x00); // cut
  return new Uint8Array(sb);
}

const SERVICE_CANDIDATES = [
  '0000ff00-0000-1000-8000-00805f9b34fb', // FF00 vendor (banyak printer thermal BLE)
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // protokol generik (mis. modul RN-42/BLE)
  '000018f0-0000-1000-8000-00805f9b34fb', // 18F0 vendor umum
];

interface BLEChar {
  properties: Record<string, boolean | undefined>;
  writeValue(d: Uint8Array): Promise<unknown>;
  writeValueWithoutResponse(d: Uint8Array): Promise<unknown>;
}

interface BLEService {
  getCharacteristics(): Promise<BLEChar[]>;
}

interface BLEServer {
  getPrimaryService(uuid: string): Promise<BLEService>;
  disconnect(): void;
}

interface BLEDevice {
  gatt?: { connect(): Promise<BLEServer> };
}

export async function cetakBluetooth(baris: StrukBaris[]): Promise<string> {
  const nav = navigator as Navigator & {
    bluetooth?: { requestDevice(o: { acceptAllDevices: boolean; optionalServices: string[] }): Promise<BLEDevice> };
  };
  if (!nav.bluetooth) throw new Error('Browser ini tidak mendukung Web Bluetooth.');
  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: SERVICE_CANDIDATES,
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error('Tidak dapat terhubung ke printer.');

  let written = false;
  for (const uuid of SERVICE_CANDIDATES) {
    try {
      const service = await server.getPrimaryService(uuid);
      const chars = await service.getCharacteristics();
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          const bytes = escposDariBaris(baris);
          if (c.properties.writeWithoutResponse) await c.writeValueWithoutResponse(bytes);
          else await c.writeValue(bytes);
          written = true;
          break;
        }
      }
    } catch {
      /* coba service berikutnya */
    }
    if (written) break;
  }
  await server.disconnect();
  if (!written) throw new Error('Karakteristik tulis tidak ditemukan pada printer.');
  return 'Struk terkirim ke printer.';
}

export function rupiahUntukLabel(n: number): string {
  return rupiahStruk(n);
}
