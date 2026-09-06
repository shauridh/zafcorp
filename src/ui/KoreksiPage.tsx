import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { koreksiStokBahan, koreksiStokProduk } from '../data/actions'
import { db } from '../data/db'
import { BAGIAN_AYAM_LABEL } from '../domain/master'
import type { Bahan, ProdukMenu } from '../data/db'

export function KoreksiPage() {
  const [params] = useSearchParams()
  const [tipe, setTipe] = useState<'bahan' | 'produk'>(
    params.get('tipe') === 'produk' ? 'produk' : 'bahan',
  )
  const [entityId, setEntityId] = useState<number | ''>(params.get('id') ? Number(params.get('id')) : '')

  const [bahans, setBahans] = useState<Bahan[]>([])
  const [produks, setProduks] = useState<ProdukMenu[]>([])
  const [obj, setObj] = useState<Bahan | ProdukMenu | null>(null)

  // nilai stok fisik yang diinput
  const [nilai, setNilai] = useState('')
  const [perBagian, setPerBagian] = useState<Record<string, string>>({})
  const [alasan, setAlasan] = useState('')
  const [pesan, setPesan] = useState('')

  useEffect(() => {
    void (async () => {
      setBahans((await db.bahan.toArray()).sort((a, b) => a.nama.localeCompare(b.nama)))
      setProduks((await db.produk.toArray()).sort((a, b) => a.nama.localeCompare(b.nama)))
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      setPesan('')
      if (entityId === '') {
        setObj(null)
        return
      }
      if (tipe === 'bahan') {
        const b = await db.bahan.get(Number(entityId))
        setObj(b ?? null)
        if (b?.isAyam) {
          const init: Record<string, string> = {}
          for (const { key } of BAGIAN_AYAM_LABEL) init[key] = String(b[`stok${key === 'dada' ? 'Dada' : key === 'pahaAtas' ? 'PahaAtas' : key === 'pahaBawah' ? 'PahaBawah' : 'Sayap'}` as keyof Bahan] ?? 0)
          setPerBagian(init)
        } else {
          setNilai(String(b?.stok ?? 0))
        }
      } else {
        const p = await db.produk.get(Number(entityId))
        setObj(p ?? null)
        setNilai(String(p?.stok ?? 0))
      }
    })()
  }, [tipe, entityId])

  function pilihTipe(t: 'bahan' | 'produk') {
    setTipe(t)
    setEntityId('')
    setObj(null)
  }

  async function simpan() {
    if (entityId === '') {
      setPesan('Pilih bahan/produk dulu.')
      return
    }
    try {
      if (tipe === 'bahan') {
        const b = obj as Bahan
        if (b.isAyam) {
          for (const { key } of BAGIAN_AYAM_LABEL) {
            await koreksiStokBahan(b.id as number, key, Number(perBagian[key] ?? 0) || 0, alasan.trim())
          }
        } else {
          await koreksiStokBahan(b.id as number, null, Number(nilai) || 0, alasan.trim())
        }
      } else {
        await koreksiStokProduk(Number(entityId), Number(nilai) || 0, alasan.trim())
      }
      setPesan(`✓ Koreksi/opname tersimpan${alasan ? ` (${alasan})` : ''}. Selisih tercatat di riwayat stok.`)
      setAlasan('')
    } catch (e) {
      setPesan(`Gagal: ${String(e)}`)
    }
  }

  const isAyam = tipe === 'bahan' && (obj as Bahan | null)?.isAyam === true

  return (
    <main>
      <section className="panel">
        <h2>Koreksi / Opname Stok</h2>
        <p className="muted">Sesuaikan stok dengan hitungan fisik. Selisih dicatat di riwayat mutasi.</p>
        <div className="toolbar">
          <button className={`chip ${tipe === 'bahan' ? 'on' : ''}`} onClick={() => pilihTipe('bahan')}>
            Bahan (gudang)
          </button>
          <button className={`chip ${tipe === 'produk' ? 'on' : ''}`} onClick={() => pilihTipe('produk')}>
            Produk (stok jadi)
          </button>
          <select
            style={{ flex: 1, minWidth: 220 }}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">— pilih {tipe === 'bahan' ? 'bahan' : 'produk'} —</option>
            {(tipe === 'bahan' ? bahans : produks).map((x) => (
              <option key={x.id} value={x.id as number}>
                {x.nama}
              </option>
            ))}
          </select>
        </div>

        {obj && (
          <div className="form-grid" style={{ marginTop: 12 }}>
            {isAyam ? (
              BAGIAN_AYAM_LABEL.map(({ key, label }) => (
                <div className="field" key={key}>
                  <label>Stok fisik {label} (potong)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={perBagian[key] ?? ''}
                    onChange={(e) => setPerBagian((p) => ({ ...p, [key]: e.target.value }))}
                  />
                </div>
              ))
            ) : (
              <div className="field">
                <label>Stok fisik ({tipe === 'bahan' ? (obj as Bahan).satuanDasar : 'pcs'})</label>
                <input type="number" min="0" step="any" value={nilai} onChange={(e) => setNilai(e.target.value)} />
              </div>
            )}
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Alasan (mis. opname, rusak, hilang)</label>
              <input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="opsional" />
            </div>
          </div>
        )}

        <div className="form-actions">
          <button className="primary" onClick={() => void simpan()}>
            Simpan koreksi
          </button>
        </div>
        {pesan && <div className={`form-note ${pesan.startsWith('Gagal') ? 'err' : 'ok'}`}>{pesan}</div>}
      </section>
    </main>
  )
}
