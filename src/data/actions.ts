import { db, type Bahan, type MutasiStok, type ProdukMenu } from './db';
import { nowISO } from './waktu';
import { hitungBeliAyam, hitungBeliBiasa, kekuranganStok, type BagianDelta } from '../domain/stok';

export type BagianAyam = 'dada' | 'pahaAtas' | 'pahaBawah' | 'sayap';

export interface ItemBeliInput {
  bahanId: number;
  qtyBeli: number;
  hargaSatuan: number;
}

export interface HasilBeli {
  ok: true;
  id: number;
  total: number;
}

export interface OpsiBeli {
  /** sumber / supplier nota (bebas teks) */
  sumber?: string;
  /** catatan nota (opsional) */
  catatan?: string;
  /** ISO datetime lokal — default sekarang (untuk mencatat beli kemarin/backdate) */
  waktu?: string;
}

export async function beliBahan(items: ItemBeliInput[], opts: OpsiBeli = {}): Promise<HasilBeli> {
  const bahans = await db.bahan.bulkGet(items.map((i) => i.bahanId));
  if (bahans.some((b) => !b)) throw new Error('Ada bahan yang tidak ditemukan.');

  const waktu = opts.waktu ?? nowISO();
  const header = { waktu, sumber: opts.sumber ?? 'Pusat', total: 0, catatan: opts.catatan ?? '' };
  const total = items.reduce((s, i) => s + i.qtyBeli * i.hargaSatuan, 0);
  header.total = total;

  const id = await db.transaction('rw', db.beli, db.beliItem, db.bahan, db.mutasiStok, async () => {
    const beliId = await db.beli.add(header);
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const bahan = bahans[k] as Bahan;
      const efek =
        bahan.isAyam && bahan.komposisiAyam
          ? hitungBeliAyam(it.qtyBeli, bahan.komposisiAyam)
          : hitungBeliBiasa(it.qtyBeli, bahan.jumlahDasarPerBeli ?? 1);
      await db.beliItem.add({
        beliId,
        bahanId: it.bahanId,
        qtyBeli: it.qtyBeli,
        hargaSatuan: it.hargaSatuan,
        subtotal: it.qtyBeli * it.hargaSatuan,
      });
      const update: Partial<Bahan> = { hargaBeliDefault: it.hargaSatuan };
      if (efek.bagian) {
        for (const b of efek.bagian) {
          update[stokFieldBagian(b.bagian)] = (bahan[stokFieldBagian(b.bagian)] ?? 0) + b.delta;
          await db.mutasiStok.add({
            waktu,
            jenis: 'beli',
            entitas: 'bahan',
            entitasId: it.bahanId,
            bagian: b.bagian,
            delta: b.delta,
            referensi: `Beli #${beliId}`,
            catatan: bahan.nama,
          });
        }
      } else {
        update.stok = (bahan.stok ?? 0) + efek.stokDasar;
        await db.mutasiStok.add({
          waktu,
          jenis: 'beli',
          entitas: 'bahan',
          entitasId: it.bahanId,
          delta: efek.stokDasar,
          referensi: `Beli #${beliId}`,
          catatan: bahan.nama,
        });
      }
      await db.bahan.update(it.bahanId, update);
    }
    return beliId;
  });
  return { ok: true, id, total };
}

function stokFieldBagian(b: BagianAyam): 'stokDada' | 'stokPahaAtas' | 'stokPahaBawah' | 'stokSayap' {
  switch (b) {
    case 'dada':
      return 'stokDada';
    case 'pahaAtas':
      return 'stokPahaAtas';
    case 'pahaBawah':
      return 'stokPahaBawah';
    case 'sayap':
      return 'stokSayap';
  }
}

function nilaiBagian(b: Bahan, bagian: BagianAyam): number {
  return b[stokFieldBagian(bagian)] ?? 0;
}

// ---------------------------------------------------------------------------
// Produksi produk umum (memakai resep tahap 'produksi')
// ---------------------------------------------------------------------------

export interface OutputProduksi {
  produkId: number;
  qty: number;
}

export interface Kekurangan {
  nama: string;
  kurang: number;
}

export interface HasilProduksi {
  ok: boolean;
  id?: number;
  ringkasan?: string;
  kekurangan: Kekurangan[];
}

export async function catatProduksiProduk(outputs: OutputProduksi[], catatan = ''): Promise<HasilProduksi> {
  const produkList = (await db.produk.bulkGet(outputs.map((o) => o.produkId))) as ProdukMenu[];
  if (produkList.some((p) => !p)) throw new Error('Produk tidak ditemukan.');

  // kumpulkan kebutuhan resep (tahap produksi) — bahan & komponen produk jadi
  const needsBahan = new Map<number, number>(); // bahanId -> butuh (satuan dasar)
  const needsKomponen = new Map<number, number>(); // produkId -> butuh
  for (const o of outputs) {
    const resep = await db.itemResep.where('produkId').equals(o.produkId).toArray();
    for (const r of resep) {
      if (r.tahap !== 'produksi') continue;
      if (r.bahanId != null) needsBahan.set(r.bahanId, (needsBahan.get(r.bahanId) ?? 0) + r.qty * o.qty);
      if (r.produkKomponenId != null)
        needsKomponen.set(r.produkKomponenId, (needsKomponen.get(r.produkKomponenId) ?? 0) + r.qty * o.qty);
    }
  }

  // cek kecukupan sebelum mencatat
  const kekurangan: Kekurangan[] = [];
  const bahans = (await db.bahan.bulkGet([...needsBahan.keys()])) as Bahan[];
  let idxB = 0;
  for (const butuh of needsBahan.values()) {
    const b = bahans[idxB++];
    if (!b) continue;
    const kurang = kekuranganStok(b.stok ?? 0, butuh);
    if (kurang > 0) kekurangan.push({ nama: b.nama, kurang });
  }
  const komps = (await db.produk.bulkGet([...needsKomponen.keys()])) as ProdukMenu[];
  let idxK = 0;
  for (const butuh of needsKomponen.values()) {
    const p = komps[idxK++];
    if (!p) continue;
    const kurang = kekuranganStok(p.stok ?? 0, butuh);
    if (kurang > 0) kekurangan.push({ nama: p.nama, kurang });
  }
  if (kekurangan.length > 0) return { ok: false, kekurangan };

  const ringkasan = outputs.map((o) => `${produkList.find((p) => p?.id === o.produkId)?.nama ?? '?'} ${o.qty}`).join(', ');

  const id = await db.transaction('rw', db.produksi, db.produk, db.bahan, db.mutasiStok, async () => {
    const prodId = await db.produksi.add({ waktu: nowISO(), catatan, ringkasan });
    for (const o of outputs) {
      const p = produkList.find((x) => x?.id === o.produkId);
      if (!p) continue;
      await db.produk.update(o.produkId, { stok: (p.stok ?? 0) + o.qty });
      await db.mutasiStok.add({
        waktu: nowISO(),
        jenis: 'produksi',
        entitas: 'produk',
        entitasId: o.produkId,
        delta: o.qty,
        referensi: `Produksi #${prodId}`,
        catatan: p.nama,
      });
    }
    // potong bahan & komponen
    for (const [bahanId, butuh] of needsBahan) {
      const b = bahans.find((x) => x?.id === bahanId);
      if (!b) continue;
      await db.bahan.update(bahanId, { stok: (b.stok ?? 0) - butuh });
      await db.mutasiStok.add({
        waktu: nowISO(),
        jenis: 'produksi',
        entitas: 'bahan',
        entitasId: bahanId,
        delta: -butuh,
        referensi: `Produksi #${prodId}`,
        catatan: b.nama,
      });
    }
    for (const [kompId, butuh] of needsKomponen) {
      const p = komps.find((x) => x?.id === kompId);
      if (!p) continue;
      await db.produk.update(kompId, { stok: (p.stok ?? 0) - butuh });
      await db.mutasiStok.add({
        waktu: nowISO(),
        jenis: 'produksi',
        entitas: 'produk',
        entitasId: kompId,
        delta: -butuh,
        referensi: `Produksi #${prodId}`,
        catatan: p.nama,
      });
    }
    return prodId;
  });
  return { ok: true, id, ringkasan, kekurangan: [] };
}

// ---------------------------------------------------------------------------
// Produksi ayam utuh per ekor (aturan pusat)
// ---------------------------------------------------------------------------

export interface BahanAyamDefault {
  ayamId: number;
  tepungId: number;
  minyakId: number;
}

/** Rekomendasi bahan untuk produksi ayam: ayam utuh, tepung, minyak (per kategori). */
export async function rekomendasiBahanAyam(): Promise<BahanAyamDefault> {
  const all = await db.bahan.toArray();
  const pilih = (pred: (b: Bahan) => boolean): Bahan | undefined =>
    all.filter((b) => b.aktif && pred(b)).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0];
  const ayam = all
    .filter((b) => b.aktif && b.isAyam && b.komposisiAyam)
    .sort((a, b) => (a.kodePusat === '100001' ? 0 : 1) - (b.kodePusat === '100001' ? 0 : 1))
    [0];
  const tepung = pilih((b) => b.kategori === 'Tepung & Bumbu');
  const minyak = pilih((b) => b.kategori === 'Minyak');
  if (!ayam || !tepung || !minyak) throw new Error('Atur dulu bahan ayam utuh, tepung, dan minyak (kategori) di master bahan.');
  return { ayamId: ayam.id as number, tepungId: tepung.id as number, minyakId: minyak.id as number };
}

export interface HasilProduksiAyam {
  ok: boolean;
  id?: number;
  ringkasan?: string;
  kekurangan: Kekurangan[];
}

export async function catatProduksiAyam(
  ekor: number,
  bahan: BahanAyamDefault,
  catatan = '',
  fryerId?: number,
): Promise<HasilProduksiAyam> {
  const [ayam, tepung, minyak] = (await db.bahan.bulkGet([bahan.ayamId, bahan.tepungId, bahan.minyakId])) as Bahan[];
  if (!ayam || !tepung || !minyak || !ayam.komposisiAyam) throw new Error('Konfigurasi bahan ayam tidak lengkap.');
  const komposisi = ayam.komposisiAyam;

  const bagianProduk = new Map<BagianAyam, ProdukMenu>();
  const semuaproduk = await db.produk.toArray();
  const cari = (bagian: string) =>
    semuaproduk.find((p) => p.kategori === 'Ayam Goreng' && p.nama.toLowerCase().includes(bagian));
  const mapBagian: Record<BagianAyam, string> = { dada: 'dada', pahaAtas: 'paha atas', pahaBawah: 'paha bawah', sayap: 'sayap' };
  for (const b of ['dada', 'pahaAtas', 'pahaBawah', 'sayap'] as BagianAyam[]) {
    const p = cari(mapBagian[b]);
    if (p) bagianProduk.set(b, p);
  }
  if (bagianProduk.size < 4) throw new Error('Produk potongan ayam goreng belum lengkap (Dada/PA/PB/Sayap).');

  // kebutuhan bahan mentah & tepung/minyak
  const butuhBagian: BagianDelta[] = [
    { bagian: 'dada', delta: ekor * komposisi.dada },
    { bagian: 'pahaAtas', delta: ekor * komposisi.pahaAtas },
    { bagian: 'pahaBawah', delta: ekor * komposisi.pahaBawah },
    { bagian: 'sayap', delta: ekor * komposisi.sayap },
  ];
  const tepungPerEkor = 1 / 3; // 1 pak tepung : 3 ekor
  const minyakLiterPerEkor = 0.2;
  const butuhTepung = ekor * tepungPerEkor * (tepung.jumlahDasarPerBeli ?? 1);
  const butuhMinyak = ekor * minyakLiterPerEkor;

  // cek kecukupan
  const kekurangan: Kekurangan[] = [];
  for (const k of butuhBagian) {
    const kurang = kekuranganStok(nilaiBagian(ayam, k.bagian), k.delta);
    if (kurang > 0) kekurangan.push({ nama: `${ayam.nama} (${k.bagian})`, kurang });
  }
  const kurangTepung = kekuranganStok(tepung.stok ?? 0, butuhTepung);
  if (kurangTepung > 0) kekurangan.push({ nama: tepung.nama, kurang: kurangTepung });
  const kurangMinyak = kekuranganStok(minyak.stok ?? 0, butuhMinyak);
  if (kurangMinyak > 0) kekurangan.push({ nama: minyak.nama, kurang: kurangMinyak });
  if (kekurangan.length > 0) return { ok: false, kekurangan };

  // deep fryer: meter pak ayam untuk siklus minyak (bila dipilih di layar)
  let meterFryer: { id: number; ekor: number } | undefined;
  if (fryerId != null) {
    const fr = await db.fryer.get(fryerId);
    if (fr?.aktif) meterFryer = { id: fryerId, ekor };
  }

  const ringkasan = `Ayam ${ekor} ekor → ${butuhBagian.map((k) => `${k.delta} ${k.bagian}`).join(', ')}`;
  const id = await db.transaction('rw', db.produksi, db.produk, db.bahan, db.mutasiStok, db.fryer, async () => {
    const prodId = await db.produksi.add({ waktu: nowISO(), catatan, ringkasan });
    if (meterFryer) {
      const fr = await db.fryer.get(meterFryer.id);
      if (fr) {
        await db.fryer.update(meterFryer.id, {
          ekorSejakGanti: (fr.ekorSejakGanti ?? 0) + meterFryer.ekor,
          ekorSejakTopUp: (fr.ekorSejakTopUp ?? 0) + meterFryer.ekor,
        });
      }
    }
    // output stok jadi per potongan
    for (const [bagian, p] of bagianProduk) {
      const delta = ekor * komposisi[bagian];
      await db.produk.update(p.id as number, { stok: (p.stok ?? 0) + delta });
      await db.mutasiStok.add({
        waktu: nowISO(),
        jenis: 'produksi',
        entitas: 'produk',
        entitasId: p.id as number,
        delta,
        referensi: `Produksi #${prodId}`,
        catatan: p.nama,
      });
    }
    // potong ayam mentah per bagian
    for (const k of butuhBagian) {
      const field = stokFieldBagian(k.bagian);
      await db.bahan.update(ayam.id as number, { [field]: (ayam[field] ?? 0) - k.delta } as Partial<Bahan>);
      await db.mutasiStok.add({
        waktu: nowISO(),
        jenis: 'produksi',
        entitas: 'bahan',
        entitasId: ayam.id as number,
        bagian: k.bagian,
        delta: -k.delta,
        referensi: `Produksi #${prodId}`,
        catatan: `${ayam.nama} (${k.bagian})`,
      });
    }
    await db.bahan.update(tepung.id as number, { stok: (tepung.stok ?? 0) - butuhTepung });
    await db.mutasiStok.add({
      waktu: nowISO(),
      jenis: 'produksi',
      entitas: 'bahan',
      entitasId: tepung.id as number,
      delta: -butuhTepung,
      referensi: `Produksi #${prodId}`,
      catatan: tepung.nama,
    });
    await db.bahan.update(minyak.id as number, { stok: (minyak.stok ?? 0) - butuhMinyak });
    await db.mutasiStok.add({
      waktu: nowISO(),
      jenis: 'produksi',
      entitas: 'bahan',
      entitasId: minyak.id as number,
      delta: -butuhMinyak,
      referensi: `Produksi #${prodId}`,
      catatan: minyak.nama,
    });
    return prodId;
  });
  return { ok: true, id, ringkasan, kekurangan: [] };
}

// ---------------------------------------------------------------------------
// Koreksi / opname
// ---------------------------------------------------------------------------

export interface HasilKoreksi {
  ok: boolean;
  delta: number;
  keterangan?: string;
}

export async function koreksiStokBahan(
  bahanId: number,
  bagian: BagianAyam | null,
  stokBaru: number,
  alasan: string,
): Promise<HasilKoreksi> {
  const b = await db.bahan.get(bahanId);
  if (!b) throw new Error('Bahan tidak ditemukan.');
  const now = nowISO();
  const id = await db.transaction('rw', db.bahan, db.mutasiStok, async () => {
    if (bagian) {
      const field = stokFieldBagian(bagian);
      const lama = nilaiBagian(b, bagian);
      const delta = stokBaru - lama;
      await db.bahan.update(bahanId, { [field]: stokBaru } as Partial<Bahan>);
      await db.mutasiStok.add({
        waktu: now,
        jenis: 'koreksi',
        entitas: 'bahan',
        entitasId: bahanId,
        bagian,
        delta,
        catatan: `${b.nama} (${bagian}) — ${alasan || 'opname'}`,
      });
      return delta;
    }
    const lama = b.stok ?? 0;
    const delta = stokBaru - lama;
    await db.bahan.update(bahanId, { stok: stokBaru });
    await db.mutasiStok.add({
      waktu: now,
      jenis: 'koreksi',
      entitas: 'bahan',
      entitasId: bahanId,
      delta,
      catatan: `${b.nama} — ${alasan || 'opname'}`,
    });
    return delta;
  });
  return { ok: true, delta: id };
}

export async function koreksiStokProduk(produkId: number, stokBaru: number, alasan: string): Promise<HasilKoreksi> {
  const p = await db.produk.get(produkId);
  if (!p) throw new Error('Produk tidak ditemukan.');
  const lama = p.stok ?? 0;
  const delta = stokBaru - lama;
  const now = nowISO();
  await db.transaction('rw', db.produk, db.mutasiStok, async () => {
    await db.produk.update(produkId, { stok: stokBaru });
    await db.mutasiStok.add({
      waktu: now,
      jenis: 'koreksi',
      entitas: 'produk',
      entitasId: produkId,
      delta,
      catatan: `${p.nama} — ${alasan || 'opname'}`,
    });
  });
  return { ok: true, delta };
}

// ---------------------------------------------------------------------------
// Riwayat mutasi
// ---------------------------------------------------------------------------

export async function daftarMutasi(entitas?: 'bahan' | 'produk', entitasId?: number): Promise<MutasiStok[]> {
  let all = await db.mutasiStok.toArray();
  if (entitas && entitasId != null) all = all.filter((m) => m.entitas === entitas && m.entitasId === entitasId);
  return all.sort((a, b) => (a.waktu < b.waktu ? 1 : -1)).slice(0, 200);
}

export async function riwayatBeli(limit = 30): Promise<{ header: { id: number; waktu: string; sumber: string; total: number }; items: { nama: string; qtyBeli: number; hargaSatuan: number; subtotal: number }[] }[]> {
  const hs = (await db.beli.toArray()).sort((a, b) => (a.id ?? 0) > (b.id ?? 0) ? -1 : 1).slice(0, limit);
  const out: { header: { id: number; waktu: string; sumber: string; total: number }; items: { nama: string; qtyBeli: number; hargaSatuan: number; subtotal: number }[] }[] = [];
  for (const h of hs) {
    const its = await db.beliItem.where('beliId').equals(h.id as number).toArray();
    const namaB = new Map((await db.bahan.bulkGet(its.map((i) => i.bahanId))).filter(Boolean).map((b) => [(b as Bahan).id, (b as Bahan).nama]));
    out.push({
      header: { id: h.id as number, waktu: h.waktu, sumber: h.sumber, total: h.total },
      items: its.map((i) => ({ nama: namaB.get(i.bahanId) ?? '?', qtyBeli: i.qtyBeli, hargaSatuan: i.hargaSatuan, subtotal: i.subtotal })),
    });
  }
  return out;
}

export async function riwayatProduksi(limit = 30): Promise<{ id: number; waktu: string; ringkasan?: string; catatan?: string }[]> {
  const rows = await db.produksi.toArray();
  return rows
    .sort((a, b) => (a.id ?? 0) > (b.id ?? 0) ? -1 : 1)
    .slice(0, limit)
    .map((h) => ({ id: h.id as number, waktu: h.waktu, ringkasan: h.ringkasan, catatan: h.catatan }));
}
