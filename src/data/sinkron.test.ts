import { describe, expect, it } from 'vitest'
import { gabungBaris } from './sinkron'

interface R {
  id?: number
  nama: string
}

describe('gabungBaris (gabung tarikan server ke lokal)', () => {
  it('menambahkan baris baru dari server', () => {
    const { baris, baru } = gabungBaris<R>([{ id: 1, nama: 'a' }], [{ id: 2, nama: 'b' }, { id: 3, nama: 'c' }])
    expect(baru).toBe(2)
    expect(baris).toHaveLength(3)
    expect(baris.map((b) => b.id)).toEqual([1, 2, 3])
  })

  it('server menang untuk id yang sama (LWW)', () => {
    const { baris, baru } = gabungBaris<R>(
      [{ id: 1, nama: 'lokal' }, { id: 2, nama: 'sama' }],
      [{ id: 1, nama: 'server' }, { id: 2, nama: 'server' }],
    )
    expect(baru).toBe(0)
    expect(baris.find((b) => b.id === 1)?.nama).toBe('server')
    expect(baris.find((b) => b.id === 2)?.nama).toBe('server')
  })

  it('baris tanpa id diabaikan', () => {
    const { baris, baru } = gabungBaris<R>([], [{ nama: 'tanpa-id' }])
    expect(baru).toBe(0)
    expect(baris).toHaveLength(0)
  })

  it('tidak mengubah urutan id yang sudah ada', () => {
    const { baris } = gabungBaris<R>([{ id: 5, nama: 'e' }, { id: 1, nama: 'a' }], [{ id: 2, nama: 'b' }])
    expect(baris.map((b) => b.id).sort()).toEqual([1, 2, 5])
  })
})