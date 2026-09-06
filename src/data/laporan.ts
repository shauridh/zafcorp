import { db, type Bahan, type ItemResep, type MetodeBayar, type ProdukMenu, type SumberPesanan } from './db';
import { agregasiProduk, biayaEkorAyamGoreng, biayaPerPotong, hargaPerDasar, sumPerKunci, type AgregatProduk } from '../domain/laporan';
import { AYAM_POTONG_9, totalPotongPerEkor } from '../domain/conversions';

export interface BarisProdukLaporan extends AgregatProduk {
  hpp: number;
  laba: number;
}

export interface BarisKasLaporan {
  id: number;
  bukaWaktu: string;
  tutupWaktu?: string;
  fisik?: number;
  selisih?: number;
  setoran?: number;
}

export interface Laporan {
  label: string;
  nTransaksi: number;
  qty: number;
  omzet: number;
  rataTransaksi: number;
  perMetode: Record<MetodeBayar, number>;
  perSumber: Record<SumberPesanan, number>;
  produk: BarisProdukLaporan[];
  /** produk terjual yang belum punya dasar biaya (resep kosong) */
  tanpaHpp: string[];
  hppTotal: number;
  labaKotor: number;
  pengeluaran: { id: number; waktu: string; kategori: string; keterangan?: string; jumlah: number }[];
  totalPengeluaran: number;
  labaBersih: number;
  kas: BarisKasLaporan[];
  setoranTotal: number;
  selisihTotal: number;
}

function esok(tanggal: string): string {
  const d = new Date(`${tanggal}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bulanBerikut(bulan: string): string {
  const [y, m] = bulan.split('-').map(Number);
  const d = new Date(y, m - 1, 1, 12);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Mesin biaya pokok (HPP) per produk
// ---------------------------------------------------------------------------

/**
 * HPP dihitung dari RESEP (itemResep, tahap produksi + jual) dengan harga beli
 * terakhir per satuan dasar. Produk resep kosong boleh memakai komponen produk
 * jadi lain (rekursif, dengan pelindung siklus). Produk Ayam Goreng tanpa resep
 * memakai aturan produksi ayam utuh (1 ekor = ayam + ⅓ pak tepung + 0,2 L minyak,
 * dibagi rata ke potongan) — identik dengan yang dipakai layar Produksi.
 */
/**
 * HPP per produk (satuan rupiah per 1 unit) + penanda produk yang sudah punya
 * dasar biaya (resep terisi / aturan ayam utuh). Dipakai laporan laba dan
 * daftar Produk & Menu (kolom HPP & margin).
 */
export async function mesinHpp(): Promise<{ biaya: Map<number, number>; ada: Map<number, boolean> }> {
  const [bahanAll, produkAll, resepAll] = await Promise.all([
    db.bahan.toArray(),
    db.produk.toArray(),
    db.itemResep.toArray(),
  ]);
  const bahanMap = new Map(bahanAll.map((b) => [b.id as number, b]));
  const produkMap = new Map(produkAll.map((p) => [p.id as number, p]));
  const resepByProduk = new Map<number, ItemResep[]>();
  for (const r of resepAll) {
    const arr = resepByProduk.get(r.produkId) ?? [];
    arr.push(r);
    resepByProduk.set(r.produkId, arr);
  }

  // konfigurasi ayam utuh untuk fallback (sama seperti layar Produksi)
  const ayam = bahanAll
    .filter((b) => b.isAyam && b.komposisiAyam)
    .sort((a, b) => (a.kodePusat === '100001' ? 0 : 1) - (b.kodePusat === '100001' ? 0 : 1))[0];
  const pilih = (kategori: string) =>
    bahanAll.filter((b) => b.aktif && b.kategori === kategori).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0];
  const tepung = pilih('Tepung & Bumbu');
  const minyak = pilih('Minyak');
  const biayaSatuEkor =
    ayam && tepung && minyak && ayam.komposisiAyam
      ? biayaEkorAyamGoreng(
          ayam.hargaBeliDefault ?? 0,
          tepung.hargaBeliDefault ?? 0,
          hargaPerDasar(minyak.hargaBeliDefault ?? 0, minyak.jumlahDasarPerBeli),
        )
      : null;
  const potongPerEkor = ayam?.komposisiAyam ? totalPotongPerEkor(ayam.komposisiAyam) : totalPotongPerEkor(AYAM_POTONG_9);

  /** harga per satuan dasar bahan (ayam utuh dihitung per potong). */
  const hargaDasar = (b: Bahan): number => {
    if (b.isAyam && b.komposisiAyam) return (b.hargaBeliDefault ?? 0) / totalPotongPerEkor(b.komposisiAyam);
    return hargaPerDasar(b.hargaBeliDefault ?? 0, b.jumlahDasarPerBeli);
  };

  const cacheBiaya = new Map<number, number>();
  const cacheAda = new Map<number, boolean>();

  async function cost(p: ProdukMenu, stack: Set<number>): Promise<{ biaya: number; ada: boolean }> {
    const pid = p.id as number;
    if (cacheAda.has(pid)) return { biaya: cacheBiaya.get(pid) ?? 0, ada: cacheAda.get(pid) ?? false };
    if (stack.has(pid)) return { biaya: 0, ada: false };
    const next = new Set(stack);
    next.add(pid);

    let biaya = 0;
    let ada = false;
    for (const r of resepByProduk.get(pid) ?? []) {
      if (r.bahanId != null) {
        const b = bahanMap.get(r.bahanId);
        if (!b) continue;
        biaya += r.qty * hargaDasar(b);
        ada = true;
      } else if (r.produkKomponenId != null) {
        const komp = produkMap.get(r.produkKomponenId);
        if (!komp) continue;
        const c = await cost(komp, next);
        if (c.ada) {
          biaya += r.qty * c.biaya;
          ada = true;
        }
      }
    }

    // Produk potongan ayam goreng tanpa resep → biaya dari aturan produksi ayam utuh.
    if (!ada && biayaSatuEkor != null && p.kategori === 'Ayam Goreng') {
      biaya = biayaPerPotong(biayaSatuEkor, potongPerEkor);
      ada = true;
    }

    cacheBiaya.set(pid, biaya);
    cacheAda.set(pid, ada);
    return { biaya, ada };
  }

  const biaya = new Map<number, number>();
  const ada = new Map<number, boolean>();
  for (const p of produkAll) {
    const c = await cost(p, new Set());
    biaya.set(p.id as number, c.biaya);
    ada.set(p.id as number, c.ada);
  }
  return { biaya, ada };
}

// ---------------------------------------------------------------------------
// Builder laporan
// ---------------------------------------------------------------------------

function bangunLaporan(label: string, dari: string, sampai: string): Promise<Laporan> {
  return (async () => {
    const headers = (await db.transaksi.toArray()).filter(
      (h) => h.status === 'selesai' && h.waktu >= dari && h.waktu < sampai,
    );
    const headerIds = new Set(headers.map((h) => h.id as number));

    let omzet = 0;
    const perMetodeInit: Record<MetodeBayar, number> = { tunai: 0, qris: 0, transfer: 0, online: 0 };
    const perSumberInit: Record<SumberPesanan, number> = { takeaway: 0, dinein: 0, gofood: 0, grabfood: 0, shopee: 0 };
    const metRows: { kunci: MetodeBayar; nilai: number }[] = [];
    const sumRows: { kunci: SumberPesanan; nilai: number }[] = [];
    for (const h of headers) {
      omzet += h.total;
      metRows.push({ kunci: h.metode, nilai: h.total });
      // data lama ber-sumber 'offline' (pra-v8) → ikut dikelompokkan ke take away
      const kunciSumber: SumberPesanan = (h.sumber as string) === 'offline' ? 'takeaway' : h.sumber;
      sumRows.push({ kunci: kunciSumber, nilai: h.total });
    }
    const perMetode = { ...perMetodeInit, ...sumPerKunci(metRows) };
    const perSumber = { ...perSumberInit, ...sumPerKunci(sumRows) };

    const semuaItem = (await db.transaksiItem.toArray()).filter((i) => headerIds.has(i.transaksiId));
    const aggr = agregasiProduk(
      semuaItem.map((i) => ({ produkId: i.produkId, nama: i.nama, qty: i.qty, subtotal: i.subtotal })),
    );
    const qty = aggr.reduce((s, a) => s + a.qty, 0);

    // biaya pokok per produk terjual
    const { biaya, ada } = await mesinHpp();
    const produk: BarisProdukLaporan[] = [];
    const tanpaHpp: string[] = [];
    for (const a of aggr) {
      const unit = biaya.get(a.produkId) ?? 0;
      const tersedia = ada.get(a.produkId) ?? false;
      const hpp = a.qty * unit;
      if (!tersedia) tanpaHpp.push(a.nama);
      produk.push({ ...a, hpp, laba: a.omzet - hpp });
    }
    const hppTotal = produk.reduce((s, p) => s + p.hpp, 0);
    const labaKotor = omzet - hppTotal;

    // Biaya kini satu sumber: catatan Finansial jenis 'keluar' (halaman Pengeluaran
    // lama sudah dimigrasikan ke sana saat upgrade DB v10).
    const tglDari = dari.slice(0, 10);
    const tglSampai = sampai.slice(0, 10);
    const pengeluaran = (await db.catatanFinansial.toArray())
      .filter((p) => p.jenis === 'keluar' && p.tanggal >= tglDari && p.tanggal < tglSampai)
      .sort((a, b) => ((b.tanggal ?? '') + (b.waktuCatat ?? '')).localeCompare((a.tanggal ?? '') + (a.waktuCatat ?? '')))
      .map((p) => ({
        id: p.id as number,
        waktu: p.waktuCatat || `${p.tanggal}T00:00:00`,
        kategori: p.kategori,
        keterangan: p.keterangan,
        jumlah: p.jumlah,
      }));
    const totalPengeluaran = pengeluaran.reduce((s, p) => s + p.jumlah, 0);

    const sesi = (await db.sesiKas.toArray()).filter(
      (s) => s.status === 'tutup' && s.tutupWaktu != null && s.tutupWaktu >= dari && s.tutupWaktu < sampai,
    );
    const kas: BarisKasLaporan[] = sesi
      .sort((a, b) => (a.tutupWaktu ?? '') < (b.tutupWaktu ?? '') ? -1 : 1)
      .map((s) => ({
        id: s.id as number,
        bukaWaktu: s.bukaWaktu,
        tutupWaktu: s.tutupWaktu,
        fisik: s.fisik,
        selisih: s.selisih,
        setoran: s.setoran,
      }));
    const setoranTotal = kas.reduce((sum, k) => sum + (k.setoran ?? 0), 0);
    const selisihTotal = kas.reduce((sum, k) => sum + (k.selisih ?? 0), 0);

    return {
      label,
      nTransaksi: headers.length,
      qty,
      omzet,
      rataTransaksi: headers.length ? omzet / headers.length : 0,
      perMetode,
      perSumber,
      produk,
      tanpaHpp,
      hppTotal,
      labaKotor,
      pengeluaran,
      totalPengeluaran,
      labaBersih: labaKotor - totalPengeluaran,
      kas,
      setoranTotal,
      selisihTotal,
    };
  })();
}

export function laporanHarian(tanggal: string): Promise<Laporan> {
  return bangunLaporan(`Harian · ${tanggal}`, `${tanggal}T00:00:00`, `${esok(tanggal)}T00:00:00`);
}

export function laporanBulanan(bulan: string): Promise<Laporan> {
  return bangunLaporan(`Bulanan · ${bulan}`, `${bulan}-01T00:00:00`, `${bulanBerikut(bulan)}-01T00:00:00`);
}
