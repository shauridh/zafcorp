import { kumpulkanCadangan, namaFileCadangan, tandaiCadangan, terakhirCadangan } from './cadangan';
import { db } from './db';
import { unduhFile } from '../services/struk';

/**
 * Pengingat cadangan data (Notifications API) — perangkat ini hanya.
 * Bila cadangan terakhir lebih dari 7 hari (atau belum pernah, dan perangkat
 * sudah dipakai 7 hari), muncul notifikasi browser — paling sering sekali tiap
 * 7 hari. Ketuk notifikasi → cadangan langsung terunduh.
 */

const KEY_AKTIF = 'kasir.notifCadangan';
const KEY_REMINDER = 'kasir.notif.cadangan';
const JEDA_MS = 7 * 24 * 60 * 60 * 1000;

export function notifCadanganDiaktifkan(): boolean {
  try {
    return localStorage.getItem(KEY_AKTIF) === '1';
  } catch {
    return false;
  }
}

export function setNotifCadanganDiaktifkan(aktif: boolean): void {
  try {
    if (aktif) localStorage.setItem(KEY_AKTIF, '1');
    else localStorage.removeItem(KEY_AKTIF);
  } catch {
    /* abaikan — penyimpanan tak tersedia */
  }
}

function terakhirReminder(): number {
  try {
    return Number(localStorage.getItem(KEY_REMINDER) || 0);
  } catch {
    return 0;
  }
}

function tandaiReminder(): void {
  try {
    localStorage.setItem(KEY_REMINDER, String(Date.now()));
  } catch {
    /* abaikan */
  }
}

/** Aksi satu ketukan: fokus aplikasi + langsung unduh cadangan, lalu ke Pengaturan. */
async function aksiKetuk(): Promise<void> {
  try {
    window.focus();
    const d = await kumpulkanCadangan();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    unduhFile(blob, namaFileCadangan(d));
    await tandaiCadangan();
  } catch {
    /* tetap arahkan ke Pengaturan walau unduhan gagal */
  }
  try {
    location.hash = '#/pengaturan';
  } catch {
    /* abaikan */
  }
}

async function kirimNotifikasiCadangan(hari: number): Promise<void> {
  const judul = 'Cadangan data belum dibuat';
  const body = `Sudah ${hari} hari tanpa cadangan — ketuk notifikasi untuk langsung mengunduh cadangan sekarang.`;
  const opt: NotificationOptions = {
    body,
    tag: 'cadangan-data',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    data: { url: '#/pengaturan' },
  };
  // Utamakan Notification dari halaman agar aksi "ketuk → unduh" bisa berjalan.
  try {
    if ('Notification' in window) {
      const n = new Notification(judul, opt);
      n.onclick = () => {
        void aksiKetuk();
      };
      return;
    }
  } catch {
    /* fallback ke service worker */
  }
  try {
    const sw = navigator.serviceWorker;
    const reg = sw ? await sw.getRegistration() : null;
    if (reg && 'showNotification' in reg) reg.showNotification(judul, opt);
  } catch {
    /* abaikan */
  }
}

/**
 * Periksa apakah cadangan sudah basi (> 7 hari) lalu kirim pengingat.
 * Aman dipanggil periodik — anti-spam 7 hari. Tanpa cadangan sama sekali,
 * acuannya adalah tanggal perangkat pertama dipakai (bukan langsung mengganggu).
 */
export async function cekDanKirimNotifCadangan(): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!notifCadanganDiaktifkan()) return;

  let tBuat = Number((await db.meta.get('perangkat-dibuat'))?.value || 0);
  if (!tBuat) {
    tBuat = Date.now();
    await db.meta.put({ key: 'perangkat-dibuat', value: String(tBuat) });
  }
  const tBackupRaw = await terakhirCadangan();
  const tBackup = tBackupRaw ? new Date(tBackupRaw).getTime() : 0;
  const acuan = tBackup > 0 ? tBackup : tBuat;

  const sekarang = Date.now();
  if (sekarang - acuan < JEDA_MS) return;
  if (sekarang - terakhirReminder() < JEDA_MS) return;

  tandaiReminder();
  const hari = Math.max(1, Math.floor((sekarang - acuan) / (24 * 60 * 60 * 1000)));
  await kirimNotifikasiCadangan(hari);
}