import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { daftarMutasi } from '../data/actions'
import { db } from '../data/db'
import type { MutasiStok } from '../data/db'

const LABEL_JENIS: Record<MutasiStok['jenis'], string> = {
  beli: 'Beli',
  produksi: 'Produksi',
  jual: 'Jual',
  koreksi: 'Koreksi',
  opname: 'Opname',
}

export function MutasiPage() {
  const [params] = useSearchParams()
  const tipe = params.get('tipe') as 'bahan' | 'produk' | null
  const id = params.get('id')
  const [rows, setRows] = useState<MutasiStok[]>([])
  const [judul, setJudul] = useState('Semua mutasi stok')

  useEffect(() => {
    void (async () => {
      const list = await daftarMutasi(tipe ?? undefined, id ? Number(id) : undefined)
      setRows(list)
      if (tipe && id) {
        const nama =
          tipe === 'bahan'
            ? (await db.bahan.get(Number(id)))?.nama
            : (await db.produk.get(Number(id)))?.nama
        setJudul(`Mutasi ${tipe === 'bahan' ? 'bahan' : 'produk'}: ${nama ?? '#' + id}`)
      } else {
        setJudul('Semua mutasi stok')
      }
    })()
  }, [tipe, id])

  function fmtWaktu(w: string): string {
    return w.replace('T', ' ')
  }

  return (
    <main>
      <section className="panel">
        <h2>{judul}</h2>
        <p className="muted">
          Setiap perubahan stok tercatat di sini — semua angka bisa ditelusuri kembali.
        </p>
        {rows.length === 0 && <p className="empty">Belum ada mutasi.</p>}
        {rows.map((m) => (
          <div className="row-card" key={m.id}>
            <div className="row-main">
              <div className="row-title">
                <span className="badge">{LABEL_JENIS[m.jenis]}</span>
                {m.bagian && <span className="badge unit">{m.bagian}</span>}
                <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--muted)' }}>{fmtWaktu(m.waktu)}</span>
              </div>
              <div className="row-meta">{m.catatan ?? ''}</div>
            </div>
            <b style={{ color: m.delta >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
              {m.delta >= 0 ? '+' : ''}
              {m.delta}
            </b>
          </div>
        ))}
      </section>
    </main>
  )
}
