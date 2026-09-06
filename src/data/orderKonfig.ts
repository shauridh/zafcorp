/* Konfigurasi server order (portal delivery) untuk aplikasi kasir.
 * URL + kredensial kasir tersimpan di localStorage — dipakai Papan Pesanan Antar
 * dan panel Pesanan Antar di Finansial. Kredensial kasir wajib dikirim sebagai
 * header X-Kasir-Secret bila server dijalankan dengan env KASIR_SECRET. */

const LS_URL = 'papan-order-url'
const LS_SECRET = 'papan-kasir-secret'

export const ORDER_URL_DEFAULT = 'http://127.0.0.1:5198'

export function orderUrl(): string {
  return localStorage.getItem(LS_URL) || ORDER_URL_DEFAULT
}

export function setOrderUrl(v: string): void {
  localStorage.setItem(LS_URL, v)
}

export function kasirSecret(): string {
  return localStorage.getItem(LS_SECRET) || ''
}

export function setKasirSecret(v: string): void {
  if (v) localStorage.setItem(LS_SECRET, v)
  else localStorage.removeItem(LS_SECRET)
}

export function headerKasir(): Record<string, string> {
  const s = kasirSecret()
  return s ? { 'X-Kasir-Secret': s } : {}
}