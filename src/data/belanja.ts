import { db } from './db';
import { hariIniISO } from './waktu';
import { kebutuhanAyam, kebutuhanBiasa, susunPesan } from '../domain/belanja';
import { formatRupiah } from '../domain/conversions';
import { formatQty } from '../domain/laporan';

export interface OpsiBelanja {
  /** berapa hari ke depan yang diestimasi (3–7) */
  targetHari: number;
  /** berapa hari ke belakang dipakai sebagai rata-rata pemakaian */
  riwayatHari: number;
}

export interface BarisBelanja {
  bahanId: number;
  nama: string;
  kategori: string;
  /** jumlah satuan beli yang disarankan (0 = tidak perlu beli) */
  beli: number;
  satuan: string;
  rincian: string;
  estHari: number | null;
  cukup: boolean;
  estimasiRp: number;
}

export interface HasilBelanja {
  dibuat: string;
  targetHari: number;
  riwayatHari: number;
  /** jumlah hari yang benar-benar punya catatan pemakaian di window */
  hariData: number;
  kurangData: boolean;
  baris: BarisBelanja[];
  beliCount: number;
  estimasiTotal: number;
  pesan: string;
}

function satuanPendek(satuanBeli?: string, fallback = 'satuan'): string {
  const t = (satuanBeli ?? '').trim();
  if (!t) return fallback;
  const kata = t.split(/\s+/);
  const last = kata[kata.length - 1];
  return /^\d/.test(last) ? fallback : last;
}

function bulat2(n: number): string {
  return formatQty(Math.round(n * 100) / 100);
}

/** Mulai window: tanggal hari ini minus n hari. */
function tanggalWindow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Agregasi konsumsi nyata dari mutasi stok (jenis produksi & jual, entitas bahan). */
async function konsumsiWindow(mulaiTanggal: string): Promise<{
  perBahan: Map<number, number>;
  perBagian: Map<number, Map<string, number>>;
  hariData: Set<string>;
}> {
  const mulai = `${mulaiTanggal}T00:00:00`;
  const rows = await db.mutasiStok.toArray();
  const perBahan = new Map<number, number>();
  const perBagian = new Map<number, Map<string, number>>();
  const hariData = new Set<string>();
  for (const m of rows) {
    if (m.entitas !== 'bahan') continue;
    if (m.jenis !== 'produksi' && m.jenis !== 'jual') continue;
    if (m.waktu < mulai || m.delta >= 0) continue;
    hariData.add(m.waktu.slice(0, 10));
    if (m.bagian) {
      let bag = perBagian.get(m.entitasId);
      if (!bag) {
        bag = new Map<string, number>();
        perBagian.set(m.entitasId, bag);
      }
      bag.set(m.bagian, (bag.get(m.bagian) ?? 0) + Math.abs(m.delta));
    } else {
      perBahan.set(m.entitasId, (perBahan.get(m.entitasId) ?? 0) + Math.abs(m.delta));
    }
  }
  return { perBahan, perBagian, hariData };
}

export async function hitungBelanja(opts: OpsiBelanja): Promise<HasilBelanja> {
  const target = Math.min(7, Math.max(1, opts.targetHari));
  const window = Math.min(30, Math.max(1, opts.riwayatHari));
  const mulai = tanggalWindow(window);
  const { perBahan, perBagian, hariData } = await konsumsiWindow(mulai);
  const hari = Math.max(1, hariData.size);

  const bahans = (await db.bahan.toArray()).filter((b) => b.aktif);
  const baris: BarisBelanja[] = [];

  for (const b of bahans) {
    // ayam utuh dihitung khusus (per ekor)
    if (b.isAyam && b.komposisiAyam) {
      const bagMap = perBagian.get(b.id as number);
      if (!bagMap || bagMap.size === 0) continue;
      const komposisi = b.komposisiAyam;
      const k = kebutuhanAyam({
        hari,
        targetHari: target,
        komposisi,
        bagian: {
          dada: { stok: b.stokDada ?? 0, total: bagMap.get('dada') ?? 0 },
          pahaAtas: { stok: b.stokPahaAtas ?? 0, total: bagMap.get('pahaAtas') ?? 0 },
          pahaBawah: { stok: b.stokPahaBawah ?? 0, total: bagMap.get('pahaBawah') ?? 0 },
          sayap: { stok: b.stokSayap ?? 0, total: bagMap.get('sayap') ?? 0 },
        },
      });
      const sisa = `${b.stokDada ?? 0} dada, ${b.stokPahaAtas ?? 0} PA, ${b.stokPahaBawah ?? 0} PB, ${b.stokSayap ?? 0} sayap`;
      const rincian = `sisa ${sisa} · pakai ~${bulat2(k.ekorPerHari)} ekor/hari · butuh ${target} hari`;
      const beli = k.ekorBeli;
      const estParts = Object.values(k.perBagian)
        .filter((x) => x.rataPerHari > 0)
        .map((x) => x.stok / x.rataPerHari);
      const estHari = k.ekorPerHari > 0 && estParts.length > 0 ? Math.min(...estParts) : null;
      baris.push({
        bahanId: b.id as number,
        nama: b.nama,
        kategori: b.kategori,
        beli,
        satuan: 'Pak',
        rincian,
        estHari,
        cukup: k.cukup,
        estimasiRp: beli * (b.hargaBeliDefault ?? 0),
      });
      continue;
    }
    const total = perBahan.get(b.id as number) ?? 0;
    if (total <= 0) continue; // belum pernah terpakai → tak ada estimasi
    const perBeli = b.jumlahDasarPerBeli ?? 1;
    const k = kebutuhanBiasa({ total, hari, stok: b.stok ?? 0, targetHari: target, perBeli });
    const sisaTxt = `sisa ${bulat2(b.stok ?? 0)} ${b.satuanDasar}`;
    const pakaiTxt = `pakai ~${bulat2(k.rataPerHari)} ${b.satuanDasar}/hari`;
    const habisTxt =
      k.estHariHabis == null ? '' : k.estHariHabis <= 0.01 ? '· sudah habis' : `· habis ±${bulat2(k.estHariHabis)} hari`;
    baris.push({
      bahanId: b.id as number,
      nama: b.nama,
      kategori: b.kategori,
      beli: k.beli,
      satuan: satuanPendek(b.satuanBeli),
      rincian: `${sisaTxt} · ${pakaiTxt} ${habisTxt}`,
      estHari: k.estHariHabis,
      cukup: k.cukup,
      estimasiRp: k.beli * (b.hargaBeliDefault ?? 0),
    });
  }

  baris.sort((a, b) => {
    const ea = a.estHari ?? Number.POSITIVE_INFINITY;
    const eb = b.estHari ?? Number.POSITIVE_INFINITY;
    return ea - eb || b.beli - a.beli;
  });

  const beliCount = baris.filter((b) => b.beli > 0).length;
  const estimasiTotal = baris.reduce((s, b) => s + b.estimasiRp, 0);

  const pesan = susunPesan({
    judul: `🛒 LIST BELANJA — ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}`,
    subjudul: `kebutuhan ±${target} hari · rata-rata ${hari} hari pemakaian terakhir`,
    baris: baris.map((b) => ({
      nama: b.nama,
      beli: b.beli,
      satuan: b.satuan,
      rincian: `${b.rincian}${b.beli > 0 ? ` · estimasi ${formatRupiah(b.estimasiRp)}` : ' · stok cukup'}`,
    })),
    totalItem: beliCount,
    estimasi: formatRupiah(estimasiTotal),
  });

  return {
    dibuat: hariIniISO(),
    targetHari: target,
    riwayatHari: window,
    hariData: hari,
    kurangData: hariData.size < 2,
    baris,
    beliCount,
    estimasiTotal,
    pesan,
  };
}
