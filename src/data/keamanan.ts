import { db, type JejakAudit } from './db'

/**
 * Keamanan & peran: PIN pemilik melindungi zona pemilik (Pengaturan, Finansial,
 * Riwayat Shift, master bahan/produk). Tanpa PIN, seluruh aplikasi terbuka
 * (mode awal). Audit mencatat aktivitas sensitif per perangkat.
 */

const PIN_META = 'pin-owner'
const GAGAL_META = 'pin-gagal'
const MASA_ZONA_MS = 30 * 60_000 // sesi pemilik: 30 menit
const PIN_ITERASI = 150_000 // PBKDF2-SHA256 — perlambat brute-force PIN offline
export const BATAS_GAGAL = 5 // kunci 10 menit setelah 5x salah

const hex = (u: Uint8Array) => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('')
function samaHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/* PBKDF2-SHA256 + salt acak per perangkat — format: pbkdf2$<salt>$<iterasi>$<hash>.
 * Hash lama (SHA-256 prefix tetap) tetap diverifikasi lalu di-upgrade otomatis. */
async function buatPinHash(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PIN_ITERASI, hash: 'SHA-256' }, key, 256)
  return `pbkdf2$${hex(salt)}$${PIN_ITERASI}$${hex(new Uint8Array(bits))}`
}
async function cekPinHash(pin: string, tersimpan: string): Promise<boolean> {
  if (!tersimpan || !tersimpan.startsWith('pbkdf2$')) {
    // hash lama (SHA-256, salt statis) — verifikasi kompatibel, lalu upgrade
    const lama = await hashPinLama(pin)
    if (lama === tersimpan) {
      await db.meta.put({ key: PIN_META, value: await buatPinHash(pin) })
      return true
    }
    return false
  }
  const [, saltHex, iterasi, hashHex] = tersimpan.split('$')
  const salt = Uint8Array.from((saltHex.match(/.{2}/g) || []).map((b) => parseInt(b, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: Number(iterasi) || PIN_ITERASI, hash: 'SHA-256' }, key, 256)
  return samaHex(hex(new Uint8Array(bits)), hashHex)
}
/* hash lama — dipakai sekali untuk migrasi, lalu dihapus dari kode */
async function hashPinLama(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`sabana-pin:${pin}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return hex(new Uint8Array(buf))
}

export function pinValid(pin: string): boolean {
  return /^\d{4,6}$/.test(pin)
}

export async function pinDiatur(): Promise<boolean> {
  return (await db.meta.get(PIN_META)) != null
}

export async function aturPin(pin: string): Promise<{ ok: true } | { ok: false; alasan: string }> {
  if (!pinValid(pin)) return { ok: false, alasan: 'PIN harus 4–6 angka.' }
  await db.meta.put({ key: PIN_META, value: await buatPinHash(pin) })
  await resetGagalPin()
  bukaZonaPemilik() // pemilik yang baru mengaktifkan tidak langsung terkunci
  await catatAudit('pin-aktif', 'PIN pemilik diaktifkan')
  return { ok: true }
}

export async function cekPin(pin: string): Promise<boolean> {
  const row = await db.meta.get(PIN_META)
  if (!row) return true // belum diatur → tidak ada kunci
  return cekPinHash(pin, row.value)
}

export async function ubahPin(lama: string, baru: string): Promise<{ ok: true } | { ok: false; alasan: string }> {
  if (!(await cekPin(lama))) return { ok: false, alasan: 'PIN lama salah.' }
  if (!pinValid(baru)) return { ok: false, alasan: 'PIN baru harus 4–6 angka.' }
  await db.meta.put({ key: PIN_META, value: await buatPinHash(baru) })
  await resetGagalPin()
  bukaZonaPemilik()
  await catatAudit('pin-ubah', 'PIN pemilik diganti')
  return { ok: true }
}

export async function nonaktifkanPin(pin: string): Promise<{ ok: true } | { ok: false; alasan: string }> {
  if (!(await cekPin(pin))) return { ok: false, alasan: 'PIN salah.' }
  await db.meta.delete(PIN_META)
  await resetGagalPin()
  kunciZona()
  await catatAudit('pin-nonaktif', 'PIN pemilik dinonaktifkan')
  return { ok: true }
}

/* ---------- kunci percobaan PIN (5x salah → 10 menit) ---------- */
export async function gagalPinBeruntun(): Promise<number> {
  const row = await db.meta.get(GAGAL_META)
  if (!row) return 0
  try {
    const { n, t } = JSON.parse(row.value)
    if (Date.now() - t > 10 * 60_000) return 0
    return n || 0
  } catch { return 0 }
}
export async function catatGagalPin(): Promise<void> {
  const n = await gagalPinBeruntun()
  await db.meta.put({ key: GAGAL_META, value: JSON.stringify({ n: n + 1, t: Date.now() }) })
}
export async function resetGagalPin(): Promise<void> {
  await db.meta.delete(GAGAL_META)
}

/* ---------- zona pemilik (sesi membuka kunci, per tab) ---------- */

let zonaSampai = 0
const pendengar = new Set<() => void>()
function beriTahu() {
  for (const f of pendengar) f()
}

export function zonaPemilikTerbuka(): boolean {
  return Date.now() < zonaSampai
}

export function bukaZonaPemilik(): void {
  zonaSampai = Date.now() + MASA_ZONA_MS
  beriTahu()
}

export function kunciZona(): void {
  zonaSampai = 0
  beriTahu()
}

export function berlanggananZona(fn: () => void): () => void {
  pendengar.add(fn)
  return () => {
    pendengar.delete(fn)
  }
}

/* ---------- jejak aktivitas (audit) ---------- */

export async function catatAudit(aksi: string, detail?: string): Promise<void> {
  try {
    await db.jejakAudit.add({ waktu: new Date().toISOString(), aksi, detail })
  } catch (e) {
    console.error('gagal mencatat audit:', e)
  }
}

export async function riwayatAudit(batas = 40): Promise<JejakAudit[]> {
  return db.jejakAudit.orderBy('waktu').reverse().limit(batas).toArray()
}

const LABEL_AKSI: Record<string, string> = {
  'pin-aktif': 'PIN pemilik diaktifkan',
  'pin-ubah': 'PIN pemilik diganti',
  'pin-nonaktif': 'PIN pemilik dinonaktifkan',
  'zona-buka': 'Zona pemilik dibuka',
  'zona-kunci': 'Zona pemilik dikunci',
  'pengaturan-simpan': 'Pengaturan disimpan',
  'finansial-tambah': 'Catatan finansial ditambah',
  'finansial-hapus': 'Catatan finansial dihapus',
  'transaksi-batal': 'Transaksi dibatalkan (refund)',
  'cadangan-unduh': 'Cadangan data diunduh',
  'cadangan-pulih': 'Cadangan data dipulihkan',
  'sinkron-jalan': 'Sinkronisasi dijalankan',
}

export function labelAudit(aksi: string): string {
  return LABEL_AKSI[aksi] ?? aksi
}