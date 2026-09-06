/** Preferensi berbagi ringkasan ke WhatsApp (perangkat ini). */

const KEY_AUTO_SHIFT = 'kasir.autoKirimRekapShift';

/** Kirim ringkasan otomatis saat sebuah shift diakhiri. */
export function rekapShiftOtomatisAktif(): boolean {
  try {
    return localStorage.getItem(KEY_AUTO_SHIFT) === '1';
  } catch {
    return false;
  }
}

export function setRekapShiftOtomatis(aktif: boolean): void {
  try {
    if (aktif) localStorage.setItem(KEY_AUTO_SHIFT, '1');
    else localStorage.removeItem(KEY_AUTO_SHIFT);
  } catch {
    /* abaikan */
  }
}
