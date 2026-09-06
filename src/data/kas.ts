import { db, type MutasiKas, type SesiKas } from './db';
import { nowISO } from './waktu';
import { selisihKas, setoranKas, uangSeharusnya, type LedgerKas } from '../domain/kas';

export interface HasilKas {
  ok: boolean;
  alasan?: string;
}

/** Sesi kas yang sedang terbuka (maksimal satu). */
export async function getSesiAktif(): Promise<SesiKas | undefined> {
  const all = await db.sesiKas.where('status').equals('buka').toArray();
  return all.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0];
}

/**
 * Nomor shift sesi kas dalam tanggal bukanya (1 = shift pertama hari itu).
 * Buka–tutup kas diartikan sebagai satu shift — beberapa shift boleh bergantian
 * dalam sehari (pagi, sore, …) asalkan tidak ada dua yang aktif bersamaan.
 */
export async function nomorShiftSesi(sesi: Pick<SesiKas, 'id' | 'bukaWaktu'>): Promise<number> {
  const tgl = (sesi.bukaWaktu ?? '').slice(0, 10);
  const id = sesi.id ?? 0;
  const all = await db.sesiKas.toArray();
  return all.filter((s) => (s.bukaWaktu ?? '').slice(0, 10) === tgl && (s.id ?? 0) <= id).length;
}

export async function bukaKas(input: { saldoAwal: number; floatTarget: number; catatan?: string }): Promise<HasilKas> {
  if (await getSesiAktif()) return { ok: false, alasan: 'Masih ada sesi kas yang terbuka — tutup dulu.' };
  if (input.saldoAwal <= 0) return { ok: false, alasan: 'Saldo awal harus lebih dari 0.' };
  const waktu = nowISO();
  const id = await db.transaction('rw', db.sesiKas, db.mutasiKas, async () => {
    const sid = await db.sesiKas.add({
      bukaWaktu: waktu,
      saldoAwal: input.saldoAwal,
      floatTarget: input.floatTarget,
      status: 'buka',
      catatan: input.catatan,
    });
    await db.mutasiKas.add({
      sesiId: sid,
      waktu,
      jenis: 'buka',
      nominal: input.saldoAwal,
      keterangan: 'Saldo awal laci',
    });
    return sid;
  });
  void id;
  return { ok: true };
}

export async function mutasiLaci(
  sesiId: number,
  jenis: 'jual-tunai' | 'batal-tunai' | 'tambah' | 'keluar',
  nominal: number,
  keterangan?: string,
  referensi?: string,
): Promise<HasilKas> {
  const sesi = await db.sesiKas.get(sesiId);
  if (!sesi || sesi.status !== 'buka') return { ok: false, alasan: 'Sesi kas tidak aktif.' };
  if (nominal <= 0) return { ok: false, alasan: 'Nominal harus lebih dari 0.' };
  await db.mutasiKas.add({
    sesiId,
    waktu: nowISO(),
    jenis,
    nominal: jenis === 'keluar' || jenis === 'batal-tunai' ? -nominal : nominal,
    keterangan,
    referensi,
  } satisfies MutasiKas);
  return { ok: true };
}

export interface RingkasanSesi {
  ledger: LedgerKas;
  mutasi: MutasiKas[];
  terakhirBerubah: string;
}

export async function ringkasanSesi(sesiId: number): Promise<RingkasanSesi | undefined> {
  const sesi = await db.sesiKas.get(sesiId);
  if (!sesi) return undefined;
  const rows = (await db.mutasiKas.where('sesiId').equals(sesiId).toArray()).sort((a, b) =>
    (a.id ?? 0) - (b.id ?? 0),
  );
  const sum = (j: MutasiKas['jenis']) =>
    rows.filter((r) => r.jenis === j).reduce((s, r) => s + Math.abs(r.nominal), 0);
  const ledger: LedgerKas = {
    saldoAwal: sesi.saldoAwal,
    jualTunai: sum('jual-tunai'),
    tambah: sum('tambah'),
    keluar: sum('keluar'),
    batalTunai: sum('batal-tunai'),
  };
  return { ledger, mutasi: rows, terakhirBerubah: sesi.bukaWaktu };
}

export interface HasilTutup {
  ok: boolean;
  alasan?: string;
  uangSeharusnya?: number;
  fisik?: number;
  selisih?: number;
  setoran?: number;
  floatTarget?: number;
  tutupWaktu?: string;
  nomorShift?: number;
}

export async function tutupKas(sesiId: number, fisik: number): Promise<HasilTutup> {
  const sesi = await db.sesiKas.get(sesiId);
  if (!sesi || sesi.status !== 'buka') return { ok: false, alasan: 'Sesi kas tidak aktif.' };
  if (fisik < 0) return { ok: false, alasan: 'Hitungan fisik tidak valid.' };
  const r = await ringkasanSesi(sesiId);
  if (!r) return { ok: false, alasan: 'Data sesi tidak ditemukan.' };

  const seharusnya = uangSeharusnya(r.ledger);
  const sisa = selisihKas(fisik, r.ledger);
  const setoran = setoranKas(fisik, sesi.floatTarget);
  const waktu = nowISO();
  const nomorShift = await nomorShiftSesi(sesi);

  await db.transaction('rw', db.sesiKas, db.mutasiKas, async () => {
    if (sisa !== 0) {
      await db.mutasiKas.add({
        sesiId,
        waktu,
        jenis: 'selisih',
        nominal: sisa,
        keterangan: `Selisih kas ${sisa > 0 ? 'lebih' : 'kurang'} saat tutup (fisik ${fisik} vs catatan ${seharusnya})`,
      } satisfies MutasiKas);
    }
    await db.sesiKas.update(sesiId, {
      status: 'tutup',
      tutupWaktu: waktu,
      uangSeharusnya: seharusnya,
      fisik,
      selisih: sisa,
      setoran,
    } satisfies Partial<SesiKas>);
  });
  return {
    ok: true,
    uangSeharusnya: seharusnya,
    fisik,
    selisih: sisa,
    setoran,
    floatTarget: sesi.floatTarget,
    tutupWaktu: waktu,
    nomorShift,
  };
}

/** Satu shift yang sudah ditutup, lengkap dengan ringkasannya (untuk riwayat/rekap). */
export interface BarisShiftRekap {
  sesi: SesiKas;
  ledger: LedgerKas;
  nomor: number;
}

/** Shift tertutup dalam rentang tanggal tutup (inklusif), urut waktu tutup. */
export async function rekapShiftAntara(fromTanggal: string, toTanggal: string): Promise<BarisShiftRekap[]> {
  const all = await db.sesiKas.toArray();
  const tertutup = all
    .filter((s) => s.status === 'tutup' && (s.tutupWaktu ?? '').slice(0, 10) >= fromTanggal && (s.tutupWaktu ?? '').slice(0, 10) <= toTanggal)
    .sort((a, b) => (a.tutupWaktu ?? '').localeCompare(b.tutupWaktu ?? ''));
  const out: BarisShiftRekap[] = [];
  for (const s of tertutup) {
    const r = await ringkasanSesi(s.id as number);
    if (!r) continue;
    out.push({ sesi: s, ledger: r.ledger, nomor: await nomorShiftSesi(s) });
  }
  return out;
}

/** Riwayat sesi kas (terbaru dulu). */
export async function riwayatSesiKas(limit = 30): Promise<SesiKas[]> {
  const all = await db.sesiKas.toArray();
  return all.sort((a, b) => (b.id ?? 0) - (a.id ?? 0)).slice(0, limit);
}

export const LABEL_JENIS_KAS: Record<MutasiKas['jenis'], string> = {
  buka: 'Buka kas',
  'jual-tunai': 'Penjualan tunai',
  tambah: 'Tambah laci',
  keluar: 'Kas keluar',
  'batal-tunai': 'Pembatalan tunai',
  selisih: 'Selisih',
};
