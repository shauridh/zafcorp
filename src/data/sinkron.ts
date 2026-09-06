import { db } from './db'
import { catatAudit } from './keamanan'

/**
 * Sinkronisasi multi-perangkat — fondasi (fase P0/P1 dokumen arsitektur).
 *
 * Arsitektur: local-first + server tipis. Klien mendorong seluruh baris tabel
 * inti; server menyimpan per id dengan `versi` naik + `perangkatId`, lalu
 * mengembalikan baris yang lebih baru dari versi terakhir yang ditarik
 * perangkat ini. Kebijakan konflik saat ini: penulis terakhir menang di server
 * (LWW sederhana tanpa jam — perangkat yang sinkron terakhir didahulukan).
 * Oplog penuh + counter terpusat + kunci shift global: lihat
 * docs/arsitektur/sinkronisasi-multi-perangkat.md (roadmap P2–P4).
 */

export interface KonfigSinkron {
  url: string
  aktif: boolean
}

export const TABEL_SINKRON = [
  'bahan',
  'produk',
  'itemResep',
  'hargaRiwayat',
  'mutasiStok',
  'beli',
  'beliItem',
  'produksi',
  'transaksi',
  'transaksiItem',
  'sesiKas',
  'mutasiKas',
  'catatanFinansial',
  'fryer',
  'fryerRiwayat',
] as const

export async function getKonfigSinkron(): Promise<KonfigSinkron> {
  const row = await db.meta.get('sinkron')
  if (!row) return { url: '', aktif: false }
  try {
    return { url: '', aktif: false, ...(JSON.parse(row.value) as Partial<KonfigSinkron>) }
  } catch {
    return { url: '', aktif: false }
  }
}

export async function saveKonfigSinkron(k: KonfigSinkron): Promise<void> {
  await db.meta.put({ key: 'sinkron', value: JSON.stringify({ url: k.url.trim(), aktif: k.aktif }) })
}

export function buatUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export async function identitasPerangkat(): Promise<{ id: string; nama: string }> {
  let id = (await db.meta.get('perangkat-id'))?.value
  if (!id) {
    id = buatUuid()
    await db.meta.put({ key: 'perangkat-id', value: id })
  }
  let nama = (await db.meta.get('perangkat-nama'))?.value
  if (!nama) {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    nama = ua.includes('Android') ? 'Perangkat Android' : ua.includes('iPhone') || ua.includes('iPad') ? 'iPhone/iPad' : 'Perangkat desktop'
    await db.meta.put({ key: 'perangkat-nama', value: nama })
  }
  return { id, nama }
}

export async function setNamaPerangkat(nama: string): Promise<void> {
  await db.meta.put({ key: 'perangkat-nama', value: nama.trim() })
}

export async function terakhirSinkron(): Promise<string | null> {
  return (await db.meta.get('sinkron-terakhir'))?.value ?? null
}

export interface HasilSinkron {
  ok: boolean
  pesan: string
  dorong?: number
  tarik?: number
}

/**
 * Murni — gabungkan baris yang ditarik dari server ke daftar lokal.
 * Server menang per id (baris server menggantikan baris lokal bila id sama);
 * baris id baru ditambahkan. Dipakai tes unit tanpa IndexedDB.
 */
export function gabungBaris<T extends { id?: number }>(
  lokal: T[],
  server: T[],
): { baris: T[]; baru: number } {
  const peta = new Map<number, T>()
  for (const r of lokal) if (r.id != null) peta.set(r.id, r)
  let baru = 0
  for (const r of server) {
    if (r.id == null) continue
    if (!peta.has(r.id)) baru++
    peta.set(r.id, r)
  }
  return { baris: [...peta.values()], baru }
}

/* Daftarkan perangkat ke server sinkron → id + secret (kredensial wajib untuk /api/sync). */
async function daftarPerangkat(url: string, nama: string): Promise<{ id: string; secret: string }> {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nama }),
  })
  if (!res.ok) throw new Error(`Server menolak registrasi (HTTP ${res.status})`)
  const d = (await res.json()) as { id?: string; secret?: string }
  if (!d.id || !d.secret) throw new Error('Jawaban registrasi tidak valid — perbarui server sinkronisasi.')
  await db.meta.put({ key: 'perangkat-id', value: d.id })
  await db.meta.put({ key: 'perangkat-secret', value: d.secret })
  return { id: d.id, secret: d.secret }
}

export async function sinkronkanSekarang(): Promise<HasilSinkron> {
  const konfig = await getKonfigSinkron()
  if (!konfig.url.trim()) return { ok: false, pesan: 'Alamat server sinkronisasi belum diisi.' }
  const url = konfig.url.replace(/\/+$/, '')
  let dev = await identitasPerangkat()

  // kredensial perangkat: daftar otomatis sekali bila belum punya secret
  let secret = (await db.meta.get('perangkat-secret'))?.value
  if (!secret) {
    try {
      const d = await daftarPerangkat(url, dev.nama)
      dev = { id: d.id, nama: dev.nama }
      secret = d.secret
    } catch (e) {
      return { ok: false, pesan: e instanceof Error ? e.message : 'Registrasi perangkat gagal.' }
    }
  }

  // 1) dorong seluruh baris tabel inti
  const dorong: Record<string, unknown[]> = {}
  let nDorong = 0
  for (const t of TABEL_SINKRON) {
    const rows = (await db.table(t).toArray()) as unknown[]
    dorong[t] = rows
    nDorong += rows.length
  }

  async function kirim(perangkatId: string, perangkatNama: string, perangkatSecret: string): Promise<Response> {
    return fetch(`${url}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Secret': perangkatSecret },
      body: JSON.stringify({ perangkatId, perangkatNama, dorong }),
    })
  }

  let res: Response
  try {
    res = await kirim(dev.id, dev.nama, secret)
    if (res.status === 401) {
      // secret tidak dikenal (store direset / perangkat dihapus) → daftar ulang sekali
      const d = await daftarPerangkat(url, dev.nama)
      dev = { id: d.id, nama: dev.nama }
      secret = d.secret
      res = await kirim(dev.id, dev.nama, secret)
    }
  } catch (e) {
    return { ok: false, pesan: `Tidak bisa terhubung ke server: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!res.ok) {
    const teks = await res.text().catch(() => '')
    return { ok: false, pesan: `Server menolak (HTTP ${res.status}): ${teks.slice(0, 120) || 'periksa alamat server'}` }
  }

  let data: { tarik?: Record<string, unknown[]>; masuk?: number }
  try {
    data = (await res.json()) as { tarik?: Record<string, unknown[]>; masuk?: number }
  } catch {
    return { ok: false, pesan: 'Jawaban server tidak valid (bukan JSON).' }
  }

  // 2) tarik & gabung baris lebih baru (server menang per id)
  let nTarik = 0
  if (data.tarik && typeof data.tarik === 'object') {
    for (const t of TABEL_SINKRON) {
      const rows = data.tarik[t]
      if (!Array.isArray(rows) || rows.length === 0) continue
      const table = db.table(t)
      const lokal = (await table.toArray()) as { id?: number }[]
      const { baru } = gabungBaris(lokal, rows as { id?: number }[])
      if (baru > 0) await table.bulkPut(rows as never[])
      nTarik += rows.length
    }
  }

  await db.meta.put({ key: 'sinkron-terakhir', value: new Date().toISOString() })
  await catatAudit('sinkron-jalan', `dorong ${nDorong} baris · tarik ${nTarik} baris`)
  return {
    ok: true,
    pesan: `✓ Sinkronisasi selesai — dorong ${nDorong} baris, terima ${nTarik} baris.`,
    dorong: nDorong,
    tarik: nTarik,
  }
}