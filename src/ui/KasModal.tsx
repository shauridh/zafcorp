import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  bukaKas,
  getSesiAktif,
  mutasiLaci,
  nomorShiftSesi,
  ringkasanSesi,
  riwayatSesiKas,
  tutupKas,
  type RingkasanSesi,
} from '../data/kas'
import { ShiftRekapPanel, type InputRekapShift } from './ShiftRekapPanel'
import { getPengaturan } from '../data/pengaturan'
import { omzetOnlineAntara } from '../data/sales'
import { formatRupiah } from '../domain/conversions'
import { selisihKas, setoranKas, uangSeharusnya } from '../domain/kas'
import type { SesiKas } from '../data/db'
import { Icon } from './Icons'

/** Format ringkas utk pilihan cepat (Rp 350 rb / Rp 1 jt). */
function ringkasRp(n: number): string {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} jt`
  return `Rp ${(n / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`
}

interface KasModalProps {
  /** Saat bernilai bukan null, dialog tampil. */
  buka: 'buka' | 'kelola' | null
  /** Label tombol sekunder di tampilan "laci belum dibuka". */
  batalLabel: string
  /** Dipanggil setelah dialog diminta ditutup (batal / selesai). */
  onTutup: () => void
  /** Aksi khusus tombol "batal" di tampilan kas belum dibuka (mis. ganti ke QRIS). Default: onTutup. */
  onBatal?: () => void
  /** Dipanggil setiap ada perubahan sesi kas (dibuka / tambah / keluar / ditutup). */
  onKasBerubah: (sesiAktif: boolean) => void
}

type Muat = { status: 'memuat' } | { status: 'siap' }

export function KasModal({ buka, batalLabel, onTutup, onBatal, onKasBerubah }: KasModalProps) {
  const [muat, setMuat] = useState<Muat>({ status: 'memuat' })
  const [sesi, setSesi] = useState<SesiKas | null>(null)
  const [rinci, setRinci] = useState<RingkasanSesi | null>(null)
  // Nomor shift aktif (1, 2, … dalam hari yang sama)
  const [nomor, setNomor] = useState(0)
  // Estimasi omzet pesanan online (dibayar platform) — info saja, TIDAK masuk laci.
  const [omzetOnline, setOmzetOnline] = useState(0)
  const [floatTarget, setFloatTarget] = useState(350000)

  // shift terakhir yang sudah ditutup (pengingat sebelum mulai shift baru)
  const [shiftTerakhir, setShiftTerakhir] = useState<SesiKas | null>(null)
  // rekap shift yang baru ditutup (arsip cetak) — mengisi layar hasil tutup
  const [rekap, setRekap] = useState<InputRekapShift | null>(null)

  // form buka
  const [saldoAwal, setSaldoAwal] = useState('')
  const [catatan, setCatatan] = useState('')
  // kas keluar / tambah
  const [nomKeluar, setNomKeluar] = useState('')
  const [ketKeluar, setKetKeluar] = useState('')
  const [nomTambah, setNomTambah] = useState('')
  const [ketTambah, setKetTambah] = useState('')
  // tutup
  const [fisik, setFisik] = useState('')
  const [hasilTutup, setHasilTutup] = useState<{ seharusnya: number; fisik: number; selisih: number; setoran: number } | null>(null)
  const [pesan, setPesan] = useState<{ text: string; err: boolean } | null>(null)
  const [sibuk, setSibuk] = useState('')
  const [rel, setRel] = useState(0)
  const focusRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const bukaSebelumnya = useRef(buka)
  const saldoN = Math.floor(Number(saldoAwal) || 0)
  const opsiSaldo = useMemo(() => {
    const pilihan = [...new Set([floatTarget, 250_000, 500_000])]
    return pilihan.map((v) => ({ label: ringkasRp(v), value: v }))
  }, [floatTarget])

  const muatUlang = useCallback(() => setRel((r) => r + 1), [])

  useEffect(() => {
    if (!buka) return
    // Hanya saat dialog BARU dibuka: bersihkan hasil/kesalahan sebelumnya.
    // Reload data (muatUlang) TIDAK boleh menghapus hasil tutup kas / pesan sukses.
    if (bukaSebelumnya.current !== buka) {
      setPesan(null)
      setHasilTutup(null)
      setFisik('')
      setRekap(null)
    }
    bukaSebelumnya.current = buka
    setMuat({ status: 'memuat' })
    void (async () => {
      const p = await getPengaturan()
      setFloatTarget(p.floatKas)
      setSaldoAwal((prev) => (prev === '' ? String(p.floatKas) : prev))
      const aktif = await getSesiAktif()
      setSesi(aktif ?? null)
      setRinci(aktif?.id ? ((await ringkasanSesi(aktif.id)) ?? null) : null)
      setNomor(aktif ? await nomorShiftSesi(aktif) : 0)
      const hist = await riwayatSesiKas(2)
      setShiftTerakhir(hist.find((s) => s.status === 'tutup') ?? null)
      // Jangan reset ke 0 saat sesi tertutup — baris estimasi tetap tampil di layar hasil tutup kas.
      if (aktif?.bukaWaktu) setOmzetOnline(await omzetOnlineAntara(aktif.bukaWaktu))
      setMuat({ status: 'siap' })
    })()
  }, [buka, rel])

  useEffect(() => {
    if (!buka) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onTutup()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [buka, onTutup])

  useEffect(() => {
    if (!buka || sibuk) return
    if (buka === 'buka' && !sesi && muat.status === 'siap') focusRef.current?.focus()
    else dialogRef.current?.focus()
  }, [buka, sibuk, sesi, muat.status])

  if (!buka) return null

  function msg(text: string, err = false) {
    setPesan({ text, err })
  }

  const fizikN = Math.floor(Number(fisik) || 0)
  const previewSelisih = sesi && rinci && fisik !== '' ? selisihKas(fizikN, rinci.ledger) : null
  const previewSetoran = sesi && fisik !== '' ? setoranKas(fizikN, floatTarget) : null
  const seharusnya = rinci ? uangSeharusnya(rinci.ledger) : 0

  async function simpanBuka() {
    const saldo = Math.floor(Number(saldoAwal) || 0)
    setSibuk('buka')
    setPesan(null)
    try {
      const h = await bukaKas({ saldoAwal: saldo, floatTarget, catatan: catatan.trim() || undefined })
      if (!h.ok) return msg(h.alasan ?? 'Gagal mulai shift', true)
      setSesi(null)
      setRinci(null)
      onKasBerubah(true)
      onTutup()
    } catch (e) {
      msg(`Gagal: ${String(e)}`, true)
    } finally {
      setSibuk('')
    }
  }

  async function catat(jenis: 'tambah' | 'keluar') {
    if (sesi?.id == null) return
    const n = Math.floor(Number(jenis === 'tambah' ? nomTambah : nomKeluar) || 0)
    const ket = (jenis === 'tambah' ? ketTambah : ketKeluar).trim() || (jenis === 'tambah' ? 'Penambahan laci' : 'Kas keluar')
    setSibuk(jenis)
    setPesan(null)
    try {
      const h = await mutasiLaci(sesi.id, jenis, n, ket)
      if (!h.ok) return msg(h.alasan ?? 'Gagal', true)
      if (jenis === 'tambah') {
        setNomTambah('')
        setKetTambah('')
      } else {
        setNomKeluar('')
        setKetKeluar('')
      }
      msg(`${jenis === 'tambah' ? '✓ Ditambahkan ke laci' : '✓ Kas keluar dicatat'}: ${formatRupiah(n)}.`)
      onKasBerubah(true)
      muatUlang()
    } catch (e) {
      msg(`Gagal: ${String(e)}`, true)
    } finally {
      setSibuk('')
    }
  }

  async function simpanTutup() {
    if (sesi?.id == null || !rinci) return
    setSibuk('tutup')
    setPesan(null)
    try {
      const h = await tutupKas(sesi.id, fizikN)
      if (!h.ok) return msg(h.alasan ?? 'Gagal akhiri shift', true)
      setHasilTutup({
        seharusnya: h.uangSeharusnya ?? 0,
        fisik: h.fisik ?? 0,
        selisih: h.selisih ?? 0,
        setoran: h.setoran ?? 0,
      })
      // siapkan arsip kasir — struk rangkuman shift yang baru ditutup
      setRekap({
        nomor: h.nomorShift ?? nomor,
        nama: sesi.catatan,
        bukaWaktu: sesi.bukaWaktu,
        tutupWaktu: h.tutupWaktu ?? sesi.bukaWaktu,
        saldoAwal: sesi.saldoAwal,
        jualTunai: rinci.ledger.jualTunai,
        tambah: rinci.ledger.tambah,
        keluar: rinci.ledger.keluar,
        batalTunai: rinci.ledger.batalTunai,
        seharusnya: h.uangSeharusnya ?? 0,
        fisik: h.fisik ?? 0,
        selisih: h.selisih ?? 0,
        setoran: h.setoran ?? 0,
        floatTarget: sesi.floatTarget,
        omzetOnline: omzetOnline > 0 ? omzetOnline : undefined,
      })
      setSesi(null)
      setRinci(null)
      onKasBerubah(false)
      muatUlang()
    } catch (e) {
      msg(`Gagal: ${String(e)}`, true)
    } finally {
      setSibuk('')
    }
  }

  const hasil = hasilTutup
  const selisihLabel =
    hasil == null
      ? ''
      : hasil.selisih === 0
        ? 'Selisih pas — tidak ada'
        : `${hasil.selisih > 0 ? 'Selisih LEBIH' : 'Selisih KURANG'} ${formatRupiah(Math.abs(hasil.selisih))}`

  return (
    <div className="km-overlay">
      <div
        ref={dialogRef}
        className="km"
        role="dialog"
        aria-modal="true"
        aria-label={sesi ? 'Kelola shift kas aktif' : 'Mulai shift kas'}
        tabIndex={-1}
      >
        {muat.status === 'memuat' ? (
          <p className="muted">Memuat data kas…</p>
        ) : hasil ? (
          <>
            <h3>Shift selesai</h3>
            <p className="sub" style={{ marginBottom: 10 }}>
              Uang fisik <b>{formatRupiah(hasil.fisik)}</b> dicocokkan dengan catatan{' '}
              <b>{formatRupiah(hasil.seharusnya)}</b>.
            </p>
            <div className={`form-note ${hasil.selisih === 0 ? 'ok' : 'err'}`} style={{ fontWeight: 800 }}>
              {selisihLabel}
            </div>
            <div className="pay-line total" style={{ marginTop: 10 }}>
              <span>Setoran (float {formatRupiah(floatTarget)} tersisa)</span>
              <span>{formatRupiah(hasil.setoran)}</span>
            </div>
            {omzetOnline > 0 && (
              <div className="pay-line" style={{ fontWeight: 600 }}>
                <span>Omzet online (ke platform — di luar setoran)</span>
                <span>{formatRupiah(omzetOnline)}</span>
              </div>
            )}
            {rekap && <ShiftRekapPanel data={rekap} />}
            <div className="km-buttons">
              <button className="primary" onClick={onTutup} autoFocus>
                Selesai
              </button>
            </div>
          </>
        ) : sesi && rinci ? (
          <>
            <h3>
              Shift {nomor > 0 ? `#${nomor} ` : ''}aktif ⏱ {sesi.bukaWaktu.replace('T', ' ')}
              <span className="badge" style={{ marginLeft: 8, verticalAlign: 2 }}>
                float {formatRupiah(floatTarget)}
              </span>
            </h3>
            {sesi.catatan && (
              <p className="sub" style={{ marginTop: 2 }}>
                {sesi.catatan}
              </p>
            )}
            <div className="km-stats">
              <div className="km-stat">
                <span>Saldo awal</span>
                <b>{formatRupiah(rinci.ledger.saldoAwal)}</b>
              </div>
              <div className="km-stat">
                <span>Penjualan tunai</span>
                <b>{formatRupiah(rinci.ledger.jualTunai)}</b>
              </div>
              <div className="km-stat">
                <span>Kas kecil</span>
                <b style={{ color: 'var(--danger)' }}>−{formatRupiah(rinci.ledger.keluar)}</b>
              </div>
              <div className="km-stat">
                <span>Tambah / batal</span>
                <b>{formatRupiah(rinci.ledger.tambah - rinci.ledger.batalTunai)}</b>
              </div>
              {omzetOnline > 0 && (
                <div className="km-stat">
                  <span>Pesanan online (estimasi)</span>
                  <b>{formatRupiah(omzetOnline)}</b>
                </div>
              )}
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              Uang seharusnya di laci sekarang:{' '}
              <b style={{ fontSize: 17, color: 'var(--ink)' }}>{formatRupiah(seharusnya)}</b>
              <br />
              <small>
                = saldo awal + omzet tunai + tambah − kas kecil − pembatalan tunai (sesuai catatan)
              </small>
            </p>
            {omzetOnline > 0 && (
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                💳 Pesanan online <b>{formatRupiah(omzetOnline)}</b> dibayar lewat platform — estimasi pendapatan,
                tidak masuk hitungan laci/setoran di atas.
              </p>
            )}

            {pesan && <div className={`form-note ${pesan.err ? 'err' : 'ok'}`}>{pesan.text}</div>}

            <div className="km-sec">
              <p className="km-lbl">Kas keluar (kas kecil) &amp; tambah laci</p>
              <div className="km-grid2">
                <div className="field">
                  <label htmlFor="km-nom-keluar">Nominal keluar (Rp)</label>
                  <input id="km-nom-keluar" type="number" inputMode="numeric" autoComplete="off" value={nomKeluar} onChange={(e) => setNomKeluar(e.target.value)} />
                  <input style={{ marginTop: 6 }} placeholder="Keperluan (mis. beli es batu)" value={ketKeluar} onChange={(e) => setKetKeluar(e.target.value)} />
                  <button
                    className="outline"
                    style={{ marginTop: 8, color: 'var(--danger)', width: '100%' }}
                    disabled={sibuk !== ''}
                    onClick={() => void catat('keluar')}
                  >
                    − Keluarkan
                  </button>
                </div>
                <div className="field">
                  <label htmlFor="km-nom-tambah">Nominal tambah (Rp)</label>
                  <input id="km-nom-tambah" type="number" inputMode="numeric" autoComplete="off" value={nomTambah} onChange={(e) => setNomTambah(e.target.value)} />
                  <input style={{ marginTop: 6 }} placeholder="Keterangan (opsional)" value={ketTambah} onChange={(e) => setKetTambah(e.target.value)} />
                  <button
                    className="outline"
                    style={{ marginTop: 8, width: '100%' }}
                    disabled={sibuk !== ''}
                    onClick={() => void catat('tambah')}
                  >
                    + Tambah ke laci
                  </button>
                </div>
              </div>
            </div>

            <div className="km-sec">
              <p className="km-lbl">Akhiri shift — hitung uang fisik di laci</p>
              <div className="field">
                <label htmlFor="km-fisik">Uang fisik di laci (Rp)</label>
                <input id="km-fisik" type="number" inputMode="numeric" autoComplete="off" value={fisik} onChange={(e) => setFisik(e.target.value)} placeholder="0" />
              </div>
              {previewSelisih != null && (
                <div className="pay-line" style={{ marginTop: 6, fontWeight: 700 }}>
                  <span>Selisih</span>
                  <span style={{ color: previewSelisih === 0 ? 'var(--ok)' : previewSelisih > 0 ? 'var(--gold)' : 'var(--danger)' }}>
                    {previewSelisih > 0 ? '+' : ''}
                    {formatRupiah(previewSelisih)}
                  </span>
                </div>
              )}
              {previewSetoran != null && (
                <div className="pay-line" style={{ fontWeight: 700 }}>
                  <span>Setoran (float tersisa)</span>
                  <span>{formatRupiah(previewSetoran)}</span>
                </div>
              )}
              <button
                className="primary"
                style={{ marginTop: 10, width: '100%' }}
                disabled={sibuk !== '' || fisik === ''}
                onClick={() => void simpanTutup()}
              >
                {sibuk === 'tutup' ? 'Mengakhiri shift…' : 'Akhiri Shift'}
              </button>
            </div>

            <div className="km-buttons">
              <button className="ghost" onClick={onTutup} disabled={sibuk !== ''}>
                Tutup dialog
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="km-ic" aria-hidden="true">
              <Icon name="kas" size={24} />
            </div>
            <h3>Belum ada shift aktif</h3>
            <p className="sub">
              Buka kas diartikan sebagai              <b>mulai shift</b>: isi uang awal yang ditaruh di laci. Saat
              mengakhiri shift, float <b>{formatRupiah(floatTarget)}</b> otomatis tersisa di laci dan sisanya
              menjadi setoran (omzet tunai − kas keluar). Shift berikutnya boleh langsung dimulai setelahnya.
            </p>

            {shiftTerakhir && (
              <div className="warn-banner" style={{ marginTop: 10 }}>
                ⚠ <b>Ingat — satu shift aktif saja:</b> shift terakhir diakhiri{' '}
                <b>{(shiftTerakhir.tutupWaktu ?? '').replace('T', ' ').slice(0, 16)}</b>
                {shiftTerakhir.catatan ? ` (${shiftTerakhir.catatan})` : ''}. Pastikan tidak ada kasir lain yang
                masih membuka laci sebelum mulai.
              </div>
            )}

            <div className="km-float">
              <div className="f">
                <span>Float saat akhiri shift</span>
                <b>{formatRupiah(floatTarget)}</b>
                <small>otomatis tersisa di laci</small>
              </div>
              <div className="f">
                <span>Saldo awal ini</span>
                <b className={saldoN > 0 ? '' : 'kosong'}>{saldoN > 0 ? formatRupiah(saldoN) : '—'}</b>
                <small>uang yang ditaruh ke laci sekarang</small>
              </div>
            </div>

            {pesan && <div className={`form-note ${pesan.err ? 'err' : 'ok'}`}>{pesan.text}</div>}

            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="km-saldo">Uang awal di laci (Rp)</label>
              <div className="km-amount">
                <span className="cur" aria-hidden="true">
                  Rp
                </span>
                <input
                  ref={focusRef}
                  id="km-saldo"
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  min={0}
                  placeholder="0"
                  value={saldoAwal}
                  onChange={(e) => setSaldoAwal(e.target.value)}
                />
              </div>
              <div className="cashquick" role="group" aria-label="Pilihan uang awal">
                {opsiSaldo.map((o) => (
                  <button type="button" key={o.value} onClick={() => setSaldoAwal(String(o.value))}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="km-catatan">Nama shift / kasir (opsional)</label>
              <input id="km-catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. Shift pagi · kasir Ani" />
            </div>

            <div className="km-buttons">
              <button
                className="primary"
                onClick={() => void simpanBuka()}
                disabled={sibuk !== '' || saldoN <= 0}
              >
                {sibuk === 'buka' ? 'Memulai shift…' : `Mulai Shift — float ${formatRupiah(floatTarget)}`}
              </button>
              <button
                className="ghost"
                onClick={() => (buka === 'buka' && onBatal ? onBatal() : onTutup())}
                disabled={sibuk !== ''}
              >
                {batalLabel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
