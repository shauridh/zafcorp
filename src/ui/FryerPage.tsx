import { useEffect, useState } from 'react'
import type { Fryer, FryerRiwayat } from '../data/db'
import {
  catatGanti,
  catatTopUp,
  daftarFryer,
  LABEL_JENIS_FRYER,
  riwayatFryer,
  setAktifFryer,
  statusFryer,
  tambahFryer,
  type HasilFryer,
} from '../data/fryer'
import { getPengaturan } from '../data/pengaturan'
import type { JadwalFryer } from '../domain/fryer'

interface FryerView {
  fryer: Fryer
  status: JadwalFryer
  riwayat: FryerRiwayat[]
}

export function FryerPage() {
  const [items, setItems] = useState<FryerView[]>([])
  const [namaBaru, setNamaBaru] = useState('')
  const [literBaru, setLiterBaru] = useState('16')
  const [pesan, setPesan] = useState<{ text: string; err: boolean } | null>(null)
  // input liter opsional per kartu (di-map per fryerId)
  const [literTopUp, setLiterTopUp] = useState<Record<number, string>>({})
  const [reload, setReload] = useState(0)

  async function refresh() {
    const fs = await daftarFryer()
    const views: FryerView[] = []
    for (const f of fs) {
      const [st, rh] = await Promise.all([statusFryer(f), riwayatFryer(f.id as number, 6)])
      views.push({ fryer: f, status: st, riwayat: rh })
    }
    setItems(views)
  }

  useEffect(() => {
    void refresh()
  }, [reload])

  async function tambah() {
    const p = await getPengaturan()
    const hasil: HasilFryer & { id?: number } = await tambahFryer({
      nama: namaBaru,
      isiAwalL: Math.floor(Number(literBaru) || 0) || p.minyakIsiAwalL,
      topUpPak: p.minyakTopUpPak,
      gantiHari: p.minyakGantiHari,
    })
    if (!hasil.ok) return setPesan({ text: hasil.alasan ?? 'Gagal', err: true })
    setPesan({ text: `✓ ${namaBaru.trim()} terdaftar dengan isi awal ${literBaru} L — siklus minyak dimulai.`, err: false })
    setNamaBaru('')
    setReload((r) => r + 1)
  }

  async function topUp(f: Fryer) {
    const liter = Number(literTopUp[f.id as number] ?? '')
    const hasil = await catatTopUp(f.id as number, Number.isFinite(liter) && liter > 0 ? liter : undefined)
    if (!hasil.ok) return setPesan({ text: hasil.alasan ?? 'Gagal', err: true })
    setPesan({ text: `✓ Top-up ${f.nama} dicatat — meter direset, silakan tambahkan minyak ke fryer (pembelian tetap di Beli Bahan).`, err: false })
    setReload((r) => r + 1)
  }

  async function ganti(f: Fryer, alasan: string) {
    const hasil = await catatGanti(f.id as number, { alasan })
    if (!hasil.ok) return setPesan({ text: hasil.alasan ?? 'Gagal', err: true })
    setPesan({ text: `✓ Minyak ${f.nama} diganti (${alasan}) — siklus baru dimulai, meter 0.`, err: false })
    setReload((r) => r + 1)
  }

  async function nonaktifkan(f: Fryer) {
    await setAktifFryer(f.id as number, false)
    setReload((r) => r + 1)
  }

  return (
    <main>
      <section className="panel" style={{ maxWidth: 560 }}>
        <h2>Daftarkan deep fryer</h2>
        <p className="muted">
          Tiap fryer punya siklus minyak sendiri (SOP pusat: isi awal <b>16 L</b>, top-up setelah{' '}
          <b>10 ekor</b>, ganti maks <b>30 hari</b>). Pilih fryer saat catat produksi ayam — meter pak
          bertambah otomatis.
        </p>
        <div className="form-grid">
          <div className="field">
            <label>Nama fryer</label>
            <input value={namaBaru} onChange={(e) => setNamaBaru(e.target.value)} placeholder="mis. Fryer 1" />
          </div>
          <div className="field">
            <label>Isi awal minyak (L)</label>
            <input type="number" inputMode="decimal" value={literBaru} onChange={(e) => setLiterBaru(e.target.value)} />
          </div>
        </div>
        <button className="primary" style={{ marginTop: 12 }} onClick={() => void tambah()}>
          + Daftarkan Fryer
        </button>
        {pesan && <div className={`form-note ${pesan.err ? 'err' : 'ok'}`}>{pesan.text}</div>}
      </section>

      {items.length === 0 && (
        <section className="panel">
          <p className="empty">Belum ada fryer — daftarkan dulu untuk mulai memantau siklus minyak.</p>
        </section>
      )}

      {items.map(({ fryer: f, status: st, riwayat: rh }) => (
        <section className="panel" key={f.id} style={{ opacity: f.aktif ? 1 : 0.6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>{f.nama}</h2>
            <span className="badge stock" style={{ fontSize: 12 }}>
              isi awal {f.isiAwalL} L · top-up tiap {f.topUpPak} ekor · ganti {f.gantiHari} hari
            </span>
          </div>

          {f.aktif ? (
            <>
              <div className="stat-row" style={{ marginTop: 10 }}>
                <div className="stat">
                  <b>{st.ekorSejakGanti}</b>
                  <span>Ekor sejak ganti</span>
                </div>
                <div className="stat">
                  <b style={{ color: st.dueTopUp ? 'var(--danger)' : 'var(--ok)' }}>{st.ekorSejakTopUp}</b>
                  <span>Ekor sejak top-up (ambang {f.topUpPak})</span>
                </div>
                <div className="stat">
                  <b style={{ color: st.dueGanti ? 'var(--danger)' : 'var(--ok)' }}>{st.hariSejakGanti}</b>
                  <span>Hari sejak ganti (maks {f.gantiHari})</span>
                </div>
              </div>

              {st.dueGanti && (
                <div className="warn-banner">
                  ⚠ <b>Ganti minyak sekarang</b> — sudah {st.hariSejakGanti} hari sejak penggantian terakhir.
                </div>
              )}
              {!st.dueGanti && st.dueTopUp && (
                <div className="warn-banner">
                  ⚠ <b>Top-up minyak</b> — sudah {st.ekorSejakTopUp} ekor digoreng sejak top-up terakhir
                  (ambang {f.topUpPak} ekor).
                </div>
              )}
              {!st.dueGanti && !st.dueTopUp && (
                <p className="muted" style={{ marginTop: 8 }}>
                  Siklus sehat — top-up dalam {st.sisaTopUp} ekor · ganti dalam {st.sisaHariGanti} hari.
                </p>
              )}

              <div className="cards" style={{ marginTop: 12 }}>
                <div className="card">
                  <h2>Catat top-up</h2>
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    Setelah menambah minyak (biasanya tiap {f.topUpPak} ekor). Meter top-up direset ke 0.
                  </p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
                    <div className="field" style={{ flex: 1, minWidth: 110 }}>
                      <label>Liter ditambah (opsional)</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={literTopUp[f.id as number] ?? ''}
                        onChange={(e) => setLiterTopUp((prev) => ({ ...prev, [f.id as number]: e.target.value }))}
                      />
                    </div>
                    <button className="outline" onClick={() => void topUp(f)}>
                      ✓ Top-up
                    </button>
                  </div>
                </div>

                <div className="card">
                  <h2>Ganti minyak</h2>
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    Ganti penuh = siklus baru (isi {f.isiAwalL} L). Beli minyak baru dicatat di Beli Bahan.
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="outline" onClick={() => void ganti(f, 'rutin')}>
                      Ganti (jadwal)
                    </button>
                    <button style={{ background: '#fff', color: 'var(--danger)', border: '1px solid var(--danger-soft)' }} onClick={() => void ganti(f, 'kualitas turun')}>
                      Ganti (kualitas turun)
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 8 }}>
              Fryer nonaktif — tidak dihitung meter produksi.
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--muted)' }}>Riwayat siklus:</span>
            {rh.map((r) => (
              <span className="badge unit" key={r.id} title={`${r.waktu.replace('T', ' ')}${r.catatan ? ' — ' + r.catatan : ''}`}>
                {LABEL_JENIS_FRYER[r.jenis]}
                {r.liter != null ? ` ${r.liter}L` : ''}
                {r.jenis !== 'isi' && r.ekor != null && r.ekor > 0 ? ` (${r.ekor} ekor)` : ''}
              </span>
            ))}
            <button className="danger small" style={{ marginLeft: 'auto' }} onClick={() => void nonaktifkan(f)}>
              {f.aktif ? 'Nonaktifkan' : 'Nonaktif'}
            </button>
          </div>
        </section>
      ))}

      <section className="panel" style={{ marginTop: 14 }}>
        <h2>Catatan penting</h2>
        <ul className="muted" style={{ margin: 0, lineHeight: 1.9 }}>
          <li>
            Modul ini <b>penanda jadwal SOP</b> — pembelian minyak tetap dicatat di{' '}
            <b>Beli Bahan</b> (masuk stok gudang & HPP), sedangkan pemakaian minyak sudah terpotong otomatis
            (±0,2 L/ekor) saat produksi.
          </li>
          <li>“Ganti karena kualitas turun” boleh dilakukan kapan saja — siklus direset ke 0 hari/0 ekor.</li>
          <li>Parameter SOP bisa diubah di Pengaturan (dipakai saat mendaftarkan fryer baru).</li>
        </ul>
      </section>
    </main>
  )
}
