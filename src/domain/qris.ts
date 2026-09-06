/**
 * QRIS (EMVCo) — fungsi murni.
 *
 * Konversi QRIS statis → dinamis: ubah tag 01 (Point of Initiation) 11→12,
 * sisipkan tag 54 (nominal), lalu hitung ulang CRC16-CCITT (tag 63).
 * Data merchant (tag 26–51) tidak berubah → uang tetap masuk akun yang sama.
 *
 * Catatan jujur: QR "dinamis" hasil konversi ini tidak terdaftar di acquirer,
 * jadi TIDAK ada callback otomatis — verifikasi tetap manual oleh kasir, atau
 * lewat callback provider bila toko memakai aggregator resmi (lapisan pluggable).
 */

export interface TlvItem {
  tag: string
  len: number
  value: string
}

/** Parse string QRIS menjadi daftar TLV tingkat atas (tag 2 digit, panjang 2 digit). */
export function parseTlv(qris: string): TlvItem[] {
  const out: TlvItem[] = []
  let i = 0
  while (i + 4 <= qris.length) {
    const tag = qris.slice(i, i + 2)
    const len = Number.parseInt(qris.slice(i + 2, i + 4), 10)
    if (!/^[0-9A-Fa-f]{2}$/.test(tag) || !Number.isFinite(len) || i + 4 + len > qris.length) break
    out.push({ tag, len, value: qris.slice(i + 4, i + 4 + len) })
    i += 4 + len
  }
  return out
}

function bangunTlv(items: TlvItem[]): string {
  return items.map((t) => t.tag + String(t.len).padStart(2, '0') + t.value).join('')
}

/** CRC16-CCITT (false, poly 0x1021, init 0xFFFF) — dipakai tag 63 QRIS. */
export function crc16(data: string): string {
  const bytes = new TextEncoder().encode(data)
  let crc = 0xffff
  for (const b of bytes) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
      crc &= 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Validasi struktur & CRC QRIS. */
export function validasiQris(qris: string): { ok: boolean; alasan?: string } {
  if (!/^000201/.test(qris)) return { ok: false, alasan: 'Bukan payload QRIS (format 00 = 01).' }
  const items = parseTlv(qris)
  if (!items.length) return { ok: false, alasan: 'TLV tidak dapat diurai.' }
  const tag63 = items.find((t) => t.tag === '63')
  if (tag63) {
    const tanpa63 = bangunTlv(items.filter((t) => t.tag !== '63')) + '63' + String(tag63.len).padStart(2, '0')
    const hitung = crc16(tanpa63)
    if (hitung !== tag63.value.toUpperCase()) return { ok: false, alasan: `CRC tidak cocok (${hitung} vs ${tag63.value}).` }
  }
  return { ok: true }
}

/**
 * Konversi statis → dinamis dengan nominal terkunci.
 * Nominal dibulatkan ke rupiah penuh (QRIS IDR tanpa desimal).
 */
export function convertStatisKeDinamis(qris: string, nominal: number): string {
  const valid = validasiQris(qris)
  if (!valid.ok) throw new Error(valid.alasan || 'QRIS tidak valid.')

  let items = parseTlv(qris).filter((t) => t.tag !== '63')

  // tag 01: statis(11) → dinamis(12)
  const poi = items.find((t) => t.tag === '01')
  if (poi) poi.value = '12'
  else items = [{ tag: '01', len: 2, value: '12' }, ...items]

  // tag 54: nominal (ganti bila ada, sisipkan setelah 53 bila belum)
  const amt = String(Math.max(1, Math.round(nominal)))
  const tag54 = items.find((t) => t.tag === '54')
  if (tag54) {
    tag54.value = amt
    tag54.len = amt.length
  } else {
    const idx = items.findIndex((t) => t.tag === '53')
    const baris: TlvItem = { tag: '54', len: amt.length, value: amt }
    items = idx >= 0 ? [...items.slice(0, idx + 1), baris, ...items.slice(idx + 1)] : [...items, baris]
  }

  const dasar = bangunTlv(items)
  return dasar + '6304' + crc16(dasar + '6304')
}

/** Ambil nominal dari tag 54 (bila ada). */
export function nominalQris(qris: string): number | null {
  const t = parseTlv(qris).find((x) => x.tag === '54')
  return t ? Number.parseInt(t.value, 10) || null : null
}