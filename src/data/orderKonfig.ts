/* Konfigurasi server order (portal delivery) untuk aplikasi kasir.
 * URL + kredensial kasir tersimpan di localStorage — dipakai Papan Pesanan Antar
 * dan panel Pesanan Antar di Finansial. Kredensial kasir wajib dikirim sebagai
 * header X-Kasir-Secret bila server dijalankan dengan env KASIR_SECRET. */

const LS_URL = 'papan-order-url'
const LS_SECRET = 'papan-kasir-secret'

/* Default server order: env VITE_ORDER_API_URL menang; di dev lokal (localhost)
 * pakai server prototipe 5198; di produksi (Vercel) kosong → same-origin /api
 * yang ditangani Vercel Function. */
function bakuDefault(): string {
  const dariEnv = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ORDER_API_URL
  if (dariEnv) return dariEnv
  const h = typeof location !== 'undefined' ? location.hostname : ''
  return h === '127.0.0.1' || h === 'localhost' ? 'http://127.0.0.1:5198' : ''
}

export const ORDER_URL_DEFAULT = bakuDefault()

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