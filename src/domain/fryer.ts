/** Matematika siklus minyak deep fryer (SOP pusat SABANA) — murni & diuji. */

export interface FryerJadwalInput {
  /** ISO datetime isi awal / ganti terakhir */
  sejakWaktu: string;
  ekorSejakGanti: number;
  ekorSejakTopUp: number;
  /** ambang top-up dalam ekor/pak ayam (default 10) */
  topUpPak: number;
  /** batas hari ganti (default 30) */
  gantiHari: number;
}

export interface JadwalFryer {
  hariSejakGanti: number;
  ekorSejakGanti: number;
  ekorSejakTopUp: number;
  /** ekor tersisa sebelum wajib top-up */
  sisaTopUp: number;
  /** hari tersisa sebelum wajib ganti */
  sisaHariGanti: number;
  dueTopUp: boolean;
  dueGanti: boolean;
}

function nowLokalISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Selisih hari (dibulatkan ke bawah) antara dua datetime ISO lokal. */
export function hariSejak(isoWaktu: string, sekarang: string): number {
  const t = Date.parse(isoWaktu);
  const n = Date.parse(sekarang);
  if (Number.isNaN(t) || Number.isNaN(n)) return 0;
  return Math.max(0, Math.floor((n - t) / 86_400_000));
}

/** Status jadwal sebuah fryer saat ini (waktu sekarang opsional untuk pengujian). */
export function jadwalFryer(f: FryerJadwalInput, sekarang?: string): JadwalFryer {
  const now = sekarang ?? nowLokalISO();
  const hari = hariSejak(f.sejakWaktu, now);
  return {
    hariSejakGanti: hari,
    ekorSejakGanti: f.ekorSejakGanti,
    ekorSejakTopUp: f.ekorSejakTopUp,
    sisaTopUp: Math.max(0, f.topUpPak - f.ekorSejakTopUp),
    sisaHariGanti: Math.max(0, f.gantiHari - hari),
    dueTopUp: f.ekorSejakTopUp >= f.topUpPak,
    dueGanti: hari >= f.gantiHari,
  };
}

/** Meter setelah n ekor ayam digoreng (kedua penghitung bertambah). */
export function setelahGorengEkor(f: FryerJadwalInput, ekor: number): Pick<FryerJadwalInput, 'ekorSejakGanti' | 'ekorSejakTopUp'> {
  return {
    ekorSejakGanti: f.ekorSejakGanti + ekor,
    ekorSejakTopUp: f.ekorSejakTopUp + ekor,
  };
}
