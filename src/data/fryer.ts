import { db, type Fryer, type FryerRiwayat } from './db';
import { nowISO } from './waktu';
import { jadwalFryer, setelahGorengEkor, type JadwalFryer } from '../domain/fryer';

export interface HasilFryer {
  ok: boolean;
  alasan?: string;
}

export const LABEL_JENIS_FRYER: Record<FryerRiwayat['jenis'], string> = {
  isi: 'Isi awal',
  'top-up': 'Top-up',
  ganti: 'Ganti minyak',
};

export async function daftarFryer(): Promise<Fryer[]> {
  const all = await db.fryer.toArray();
  return all.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function fryerAktif(): Promise<Fryer[]> {
  return (await daftarFryer()).filter((f) => f.aktif);
}

/** Registrasi fryer baru + isi awal minyak (menjadi awal siklus). */
export async function tambahFryer(input: {
  nama: string;
  isiAwalL: number;
  topUpPak: number;
  gantiHari: number;
  catatan?: string;
}): Promise<HasilFryer & { id?: number }> {
  const nama = input.nama.trim();
  if (!nama) return { ok: false, alasan: 'Nama fryer wajib diisi.' };
  if (!(input.isiAwalL > 0)) return { ok: false, alasan: 'Isi awal minyak harus lebih dari 0 liter.' };
  const waktu = nowISO();
  const id = await db.transaction('rw', db.fryer, db.fryerRiwayat, async () => {
    const fid = await db.fryer.add({
      nama,
      aktif: true,
      isiAwalL: input.isiAwalL,
      topUpPak: input.topUpPak,
      gantiHari: input.gantiHari,
      sejakWaktu: waktu,
      ekorSejakGanti: 0,
      ekorSejakTopUp: 0,
    } satisfies Fryer);
    await db.fryerRiwayat.add({
      fryerId: fid,
      waktu,
      jenis: 'isi',
      liter: input.isiAwalL,
      ekor: 0,
      catatan: input.catatan?.trim() || 'Isi awal minyak baru',
    } satisfies FryerRiwayat);
    return fid;
  });
  return { ok: true, id };
}

/** Catat top-up: meter ekor sejak top-up dikembalikan ke 0. */
export async function catatTopUp(fryerId: number, liter?: number, catatan?: string): Promise<HasilFryer> {
  const f = await db.fryer.get(fryerId);
  if (!f || !f.aktif) return { ok: false, alasan: 'Fryer tidak ditemukan / nonaktif.' };
  const waktu = nowISO();
  await db.transaction('rw', db.fryer, db.fryerRiwayat, async () => {
    await db.fryer.update(fryerId, { ekorSejakTopUp: 0 });
    await db.fryerRiwayat.add({
      fryerId,
      waktu,
      jenis: 'top-up',
      liter: liter && liter > 0 ? liter : undefined,
      ekor: f.ekorSejakGanti,
      catatan: catatan?.trim() || undefined,
    } satisfies FryerRiwayat);
  });
  return { ok: true };
}

/**
 * Ganti minyak — memulai siklus baru (reset waktu & meter).
 * Penggantian fisik = beli minyak baru di Beli Bahan; di sini hanya siklus SOP-nya.
 */
export async function catatGanti(
  fryerId: number,
  opts: { liter?: number; alasan?: string; catatan?: string } = {},
): Promise<HasilFryer> {
  const f = await db.fryer.get(fryerId);
  if (!f || !f.aktif) return { ok: false, alasan: 'Fryer tidak ditemukan / nonaktif.' };
  const waktu = nowISO();
  const liter = opts.liter && opts.liter > 0 ? opts.liter : f.isiAwalL;
  const catatan = [opts.alasan, opts.catatan].filter(Boolean).join(' — ') || undefined;
  await db.transaction('rw', db.fryer, db.fryerRiwayat, async () => {
    await db.fryer.update(fryerId, {
      isiAwalL: liter,
      sejakWaktu: waktu,
      ekorSejakGanti: 0,
      ekorSejakTopUp: 0,
    });
    await db.fryerRiwayat.add({
      fryerId,
      waktu,
      jenis: 'ganti',
      liter,
      ekor: f.ekorSejakGanti,
      catatan,
    } satisfies FryerRiwayat);
  });
  return { ok: true };
}

/** Tambahkan ekor ayam yang digoreng ke meter fryer (dipanggil dari produksi). */
export async function catatEkorDigoreng(fryerId: number, ekor: number): Promise<boolean> {
  const f = await db.fryer.get(fryerId);
  if (!f || !f.aktif || ekor <= 0) return false;
  const meter = setelahGorengEkor(f, ekor);
  await db.fryer.update(fryerId, meter);
  return true;
}

export async function setAktifFryer(fryerId: number, aktif: boolean): Promise<void> {
  await db.fryer.update(fryerId, { aktif });
}

export async function riwayatFryer(fryerId: number, limit = 20): Promise<FryerRiwayat[]> {
  const rows = await db.fryerRiwayat.where('fryerId').equals(fryerId).toArray();
  return rows.sort((a, b) => (b.id ?? 0) - (a.id ?? 0)).slice(0, limit);
}

/** Status jadwal fryer terhadap SOP (top-up tiap X pak, ganti tiap Y hari). */
export async function statusFryer(f: Fryer): Promise<JadwalFryer> {
  return jadwalFryer(f, nowISO());
}

/** Daftar peringatan aktif semua fryer (teks siap tampil). */
export async function peringatanFryer(): Promise<{ nama: string; teks: string; dueGanti: boolean }[]> {
  const out: { nama: string; teks: string; dueGanti: boolean }[] = [];
  for (const f of await fryerAktif()) {
    const st = await statusFryer(f);
    if (st.dueGanti) out.push({ nama: f.nama, teks: `ganti minyak — sudah ${st.hariSejakGanti} hari`, dueGanti: true });
    else if (st.dueTopUp) out.push({ nama: f.nama, teks: `top-up minyak — sudah ${st.ekorSejakTopUp} ekor`, dueGanti: false });
    else if (st.hariSejakGanti >= f.gantiHari - 3) {
      out.push({ nama: f.nama, teks: `ganti minyak dalam ${st.sisaHariGanti} hari`, dueGanti: true });
    }
  }
  return out;
}
