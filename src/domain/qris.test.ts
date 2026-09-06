import { describe, expect, it } from 'vitest'
import { convertStatisKeDinamis, crc16, nominalQris, parseTlv, validasiQris } from './qris'

// bangun payload QRIS statis yang valid (dengan CRC asli dari crc16)
const NAMA = 'WARUNG SAYUR'
const KOTA = 'KAB. DEMAK'
const INTI =
  '000201' + // payload format 01
  '010211' + // POI statis
  '2615' + '0011ID.DANA.WWW' + // info akun merchant (contoh ringkas)
  '52045812' + // MCC resto
  '5303360' + // IDR
  '5802ID' +
  '59' + String(NAMA.length).padStart(2, '0') + NAMA +
  '60' + String(KOTA.length).padStart(2, '0') + KOTA
const STATIS = INTI + '6304' + crc16(INTI + '6304')

describe('qris — parse & CRC', () => {
  it('mengurai TLV tingkat atas', () => {
    const items = parseTlv(STATIS)
    expect(items.find((t) => t.tag === '00')?.value).toBe('01')
    expect(items.find((t) => t.tag === '01')?.value).toBe('11')
    expect(items.find((t) => t.tag === '59')?.value).toBe(NAMA)
    expect(items.find((t) => t.tag === '63')?.value).toBe(crc16(INTI + '6304'))
  })

  it('validasi menerima payload sah & menolak yang bukan QRIS', () => {
    expect(validasiQris(STATIS).ok).toBe(true)
    expect(validasiQris('hello world').ok).toBe(false)
  })

  it('validasi menolak CRC yang diubah', () => {
    const rusak = STATIS.slice(0, -4) + '0000'
    expect(validasiQris(rusak).ok).toBe(false)
  })
})

describe('qris — konversi statis → dinamis', () => {
  it('mengunci nominal & mengubah point of initiation, CRC tetap sah', () => {
    const din = convertStatisKeDinamis(STATIS, 25000)
    expect(validasiQris(din).ok).toBe(true)
    expect(nominalQris(din)).toBe(25000)
    const items = parseTlv(din)
    expect(items.find((t) => t.tag === '01')?.value).toBe('12')
    expect(items.find((t) => t.tag === '59')?.value).toBe(NAMA) // data merchant utuh
    const tanpa63 = din.slice(0, din.length - 4)
    expect(crc16(tanpa63)).toBe(din.slice(-4))
  })

  it('nominal berbeda menghasilkan payload berbeda', () => {
    const a = convertStatisKeDinamis(STATIS, 11000)
    const b = convertStatisKeDinamis(STATIS, 38000)
    expect(a).not.toBe(b)
    expect(nominalQris(a)).toBe(11000)
    expect(nominalQris(b)).toBe(38000)
  })

  it('menolak input invalid', () => {
    expect(() => convertStatisKeDinamis('not-qris', 1000)).toThrow()
  })
})