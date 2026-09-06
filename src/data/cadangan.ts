import { db } from './db'

/**
 * Cadangan & pulihkan seluruh database (IndexedDB) ke satu file JSON.
 * Baris memakai id asli (bukan auto-increment baru) agar referensi antar-tabel utuh.
 */

export interface CadanganData {
  format: 'pos-sabana-cadangan'
  versi: number
  dibuat: string
  namaOutlet?: string
  data: Record<string, unknown[]>
}

/** Tabel yang tidak ikut dicadangkan (legacy kosong / jejak perangkat). */
const TABEL_DILEWATI = new Set(['pengeluaran', 'jejakAudit'])
/** Kunci meta khusus perangkat — dipertahankan saat pulihkan, tidak ikut cadangan. */
const META_DILEWATI_PREFIX = ['perangkat-', 'notif-', 'cadangan-', 'sinkron-']

function lewatiMeta(key: string): boolean {
  return META_DILEWATI_PREFIX.some((p) => key.startsWith(p))
}

export async function kumpulkanCadangan(): Promise<CadanganData> {
  const data: Record<string, unknown[]> = {}
  for (const t of db.tables) {
    if (t.name === 'meta' || TABEL_DILEWATI.has(t.name)) continue
    data[t.name] = await t.toArray()
  }
  // meta: hanya pengaturan & kunci bisnis (kunci perangkat ditinggalkan di perangkat asal)
  const meta = await db.meta.toArray()
  data.meta = meta.filter((m) => !lewatiMeta(m.key))

  let namaOutlet: string | undefined
  try {
    const row = await db.meta.get('pengaturan')
    if (row) namaOutlet = (JSON.parse(row.value) as { namaOutlet?: string }).namaOutlet
  } catch {
    /* abaikan */
  }
  return { format: 'pos-sabana-cadangan', versi: 1, dibuat: new Date().toISOString(), namaOutlet, data }
}

export function namaFileCadangan(d: CadanganData): string {
  const tgl = d.dibuat.slice(0, 10)
  const slug = (d.namaOutlet ?? 'sabana')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `cadangan-${slug}-${tgl}.json`
}

export async function pulihkanCadangan(
  raw: unknown,
): Promise<{ ok: true; tabel: string[]; baris: number } | { ok: false; alasan: string }> {
  const d = raw as CadanganData
  if (!d || typeof d !== 'object' || d.format !== 'pos-sabana-cadangan')
    return { ok: false, alasan: 'Bukan file cadangan Kasir SABANA.' }
  if (typeof d.versi !== 'number' || d.versi !== 1)
    return { ok: false, alasan: `Versi cadangan ${String(d.versi)} tidak didukung (maksimum 1).` }
  if (!d.data || typeof d.data !== 'object' || Array.isArray(d.data))
    return { ok: false, alasan: 'Isi cadangan tidak valid.' }

  const namaTabel = new Set(db.tables.map((t) => t.name))
  let baris = 0
  const tabel = [] as string[]

  await db.transaction('rw', db.tables, async () => {
    // bersihkan tabel bisnis (jangan sentuh jejakAudit)
    for (const t of db.tables) {
      if (t.name === 'meta' || t.name === 'jejakAudit' || TABEL_DILEWATI.has(t.name)) continue
      await t.clear()
    }
    // meta: pertahankan kunci perangkat (id, notif, cadangan terakhir), ganti sisanya
    const metaSekarang = await db.meta.toArray()
    const dipertahankan = metaSekarang.filter((m) => lewatiMeta(m.key))
    await db.meta.clear()
    await db.meta.bulkPut(dipertahankan)
    const metaBaru = (Array.isArray(d.data.meta) ? d.data.meta : []) as { key: string; value: string }[]
    await db.meta.bulkPut(metaBaru.filter((m) => !lewatiMeta(m.key)))

    // isi ulang tiap tabel dari cadangan (id asli dipertahankan)
    for (const [nama, rows] of Object.entries(d.data)) {
      if (!namaTabel.has(nama) || nama === 'meta' || nama === 'jejakAudit' || TABEL_DILEWATI.has(nama)) continue
      if (!Array.isArray(rows) || rows.length === 0) continue
      await db.table(nama).bulkAdd(rows as never[])
      baris += rows.length
      tabel.push(nama)
    }
  })

  await db.meta.put({ key: 'cadangan-terakhir', value: new Date().toISOString() })
  return { ok: true, tabel, baris }
}

export async function terakhirCadangan(): Promise<string | null> {
  return (await db.meta.get('cadangan-terakhir'))?.value ?? null
}

export async function tandaiCadangan(): Promise<void> {
  await db.meta.put({ key: 'cadangan-terakhir', value: new Date().toISOString() })
}

/** Banyak baris per tabel — untuk pratinjau kecil sebelum pulihkan. */
export async function ringkasanBaris(raw: unknown): Promise<{ tabel: string[]; baris: number } | null> {
  const d = raw as CadanganData
  if (!d || d.format !== 'pos-sabana-cadangan' || !d.data) return null
  const tabel: string[] = []
  let baris = 0
  for (const [nama, rows] of Object.entries(d.data)) {
    if (Array.isArray(rows) && rows.length) {
      tabel.push(nama)
      baris += rows.length
    }
  }
  return { tabel, baris }
}