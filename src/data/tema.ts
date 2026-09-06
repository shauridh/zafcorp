import { getPengaturan, savePengaturan } from './pengaturan';

export type ModeTampil = 'terang' | 'gelap';
export type PilihanTema = 'auto' | 'terang' | 'gelap';

const MQ = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Selesaikan pilihan tersimpan menjadi mode tampil aktual. */
export function modeAktif(pilihan: PilihanTema): ModeTampil {
  if (pilihan === 'terang') return 'terang';
  if (pilihan === 'gelap') return 'gelap';
  return MQ().matches ? 'gelap' : 'terang';
}

export function terapkanTema(pilihan: PilihanTema): ModeTampil {
  const mode = modeAktif(pilihan);
  document.documentElement.dataset.theme = mode === 'gelap' ? 'gelap' : 'terang';
  return mode;
}

/** Muat preferensi tersimpan → terapkan → kembalikan mode tampil aktual. */
export async function muatTemaAktif(): Promise<ModeTampil> {
  const p = await getPengaturan();
  return terapkanTema(p.tema ?? 'auto');
}

/**
 * Simpan pilihan eksplisit & terapkan. `modeAktif` opsional untuk menyimpan
 * hasil pembalikan pintasan (terang/gelap) saat preferensi lama 'auto'.
 */
export async function simpanTema(pilihan: PilihanTema): Promise<ModeTampil> {
  const p = await getPengaturan();
  await savePengaturan({ ...p, tema: pilihan });
  return terapkanTema(pilihan);
}

/**
 * Panggil `onMode` tiap preferensi sistem berubah — hanya berdampak saat
 * preferensi tersimpan 'auto'. Kembalikan fungsi untuk berhenti berlangganan.
 */
export function berlanggananSistem(onMode: (m: ModeTampil) => void): () => void {
  const mq = MQ();
  const handle = () => {
    void getPengaturan().then((p) => {
      if ((p.tema ?? 'auto') === 'auto') onMode(terapkanTema('auto'));
    });
  };
  mq.addEventListener('change', handle);
  return () => mq.removeEventListener('change', handle);
}

export const LABEL_TEMA: Record<PilihanTema, string> = {
  auto: 'Ikuti sistem',
  terang: 'Terang',
  gelap: 'Gelap',
};
