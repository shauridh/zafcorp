import { daftarFryer, statusFryer } from './fryer';

/**
 * Pengingat deep fryer (Notifications API) — perangkat ini hanya.
 * Aplikasi bisa menampilkan notifikasi saat ada fryer yang wajib top-up/ganti
 * minyak, walau pengguna sedang di layar lain / tab di background.
 */

const KEY_AKTIF = 'kasir.notifFryer';
const KEY_TERAKHIR = (id: number) => `kasir.notif.fryer.${id}`;
/** Jeda antar notifikasi per fryer (1 jam) — tetap mengingatkan tanpa spam. */
const JEDA_ULANG_MS = 60 * 60 * 1000;

export interface FryerDue {
  id: number;
  nama: string;
  ganti: boolean;
  topUp: boolean;
  teks: string;
}

export function notifFryerDiaktifkan(): boolean {
  try {
    return localStorage.getItem(KEY_AKTIF) === '1';
  } catch {
    return false;
  }
}

export function setNotifFryerDiaktifkan(aktif: boolean): void {
  try {
    if (aktif) localStorage.setItem(KEY_AKTIF, '1');
    else localStorage.removeItem(KEY_AKTIF);
  } catch {
    /* abaikan — penyimpanan tak tersedia */
  }
}

/** Daftar fryer aktif yang saat ini sudah wajib top-up dan/atau ganti minyak. */
export async function daftarFryerDue(): Promise<FryerDue[]> {
  const out: FryerDue[] = [];
  for (const f of (await daftarFryer()).filter((x) => x.aktif)) {
    const st = await statusFryer(f);
    if (!st.dueGanti && !st.dueTopUp) continue;
    const teks = st.dueGanti && st.dueTopUp
      ? `sudah ${st.hariSejakGanti} hari & ${st.ekorSejakTopUp}/${f.topUpPak} ekor`
      : st.dueGanti
        ? `sudah ${st.hariSejakGanti} hari sejak ganti terakhir`
        : `sudah ${st.ekorSejakTopUp}/${f.topUpPak} ekor sejak top-up`;
    out.push({ id: f.id as number, nama: f.nama, ganti: st.dueGanti, topUp: st.dueTopUp, teks });
  }
  return out;
}

function sudahDikirim(id: number): boolean {
  try {
    const t = Number(localStorage.getItem(KEY_TERAKHIR(id)) || 0);
    return Date.now() - t < JEDA_ULANG_MS;
  } catch {
    return false;
  }
}

function tandaiDikirim(id: number): void {
  try {
    localStorage.setItem(KEY_TERAKHIR(id), String(Date.now()));
  } catch {
    /* abaikan */
  }
}

/** Tampilkan notifikasi browser (via service worker bila siap, fallback ke API langsung). */
export async function kirimNotifikasiFryer(d: FryerDue): Promise<void> {
  const judul = `${d.nama}: ${d.ganti ? 'ganti minyak' : 'top-up minyak'}`;
  const body = `${d.teks}. Selesaikan di layar Deep Fryer sebelum produksi berikutnya.`;
  const opt: NotificationOptions = {
    body,
    tag: `fryer-${d.id}`,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
  };
  try {
    const sw = navigator.serviceWorker;
    if (sw) {
      // getRegistration() cepat & tak menggantung (tidak seperti ready() saat tak ada SW)
      const reg = await sw.getRegistration();
      if (reg && 'showNotification' in reg) {
        reg.showNotification(judul, opt);
        return;
      }
    }
  } catch {
    /* fallback ke Notification langsung */
  }
  if ('Notification' in window && Notification.permission === 'granted') new Notification(judul, opt);
}

/**
 * Periksa semua fryer & kirim notifikasi yang baru wajib top-up/ganti.
 * Aman dipanggil periodik dari mana saja — internal anti-spam 1 jam/fryer.
 */
export async function cekDanKirimNotifFryer(): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const due = await daftarFryerDue();
  for (const d of due) {
    if (sudahDikirim(d.id)) continue;
    tandaiDikirim(d.id);
    await kirimNotifikasiFryer(d);
  }
}
