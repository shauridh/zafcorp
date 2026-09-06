import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  hapusCatatanFinansial,
  kategoriUntuk,
  listCatatanFinansial,
  rekapCatatan,
  tambahCatatanFinansial,
  type RekapFinansial,
} from '../data/finansial'
import { rekapShiftAntara, type BarisShiftRekap } from '../data/kas'
import { laporanHarian } from '../data/laporan'
import { catatAudit } from '../data/keamanan'
import { LABEL_METODE, LABEL_SUMBER, URUTAN_SUMBER } from '../data/sales'
import type { CatatanFinansial, MetodeBayar, SumberPesanan } from '../data/db'
import { hariIniISO } from '../data/waktu'
import { headerKasir, orderUrl } from '../data/orderKonfig'
import { formatRupiah } from '../domain/conversions'
import { garis, garisTipis, potong } from '../domain/struk'
import type { StrukBaris } from '../domain/struk'
import { bagikanFile, renderPdf, renderPng, unduhFile } from '../services/struk'
import { ConfirmDialog } from './ConfirmDialog'

type Rentang = 'hari' | '7hari' | 'bulan'
const LABEL_RENTANG: Record<Rentang, string> = { hari: 'Hari ini', '7hari': '7 hari', bulan: 'Bulan ini' }

// donat beban per kategori — konstanta geometri & palet
const RK = 40
const CK = 2 * Math.PI * RK
const WARNA_KAT = ['#dc2626', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b', '#a855f7']

interface ProdukTerjual {
  produkId: number
  nama: string
  qty: number
  omzet: number
  hpp: number
  laba: number
}

interface HariRow {
  tanggal: string
  omzet: number
  hpp: number
  labaKotor: number
  pengeluaran: number
  labaBersih: number
  nTransaksi: number
  perSumber: Record<SumberPesanan, number>
  perMetode: Record<MetodeBayar, number>
  produk: ProdukTerjual[]
  tanpaHpp: string[]
}

function tambahTanggal(tanggal: string, nHari: number): string {
  const d = new Date(`${tanggal}T12:00:00`)
  d.setDate(d.getDate() + nHari)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function rentangTanggal(r: Rentang, hariIni: string): { from: string; to: string } {
  if (r === 'hari') return { from: hariIni, to: hariIni }
  if (r === '7hari') return { from: tambahTanggal(hariIni, -6), to: hariIni }
  const d = new Date(`${hariIni}T12:00:00`)
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  return { from, to: hariIni }
}

function tglHari(tanggal: string): string {
  const d = new Date(`${tanggal}T12:00:00`)
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })
}

function labelBaris(tanggal: string): string {
  return tglHari(tanggal)
}

export function FinansialPage() {
  const hariIni = hariIniISO()
  const [rentang, setRentang] = useState<Rentang>('bulan')
  const [rel, setRel] = useState(0)

  const [hariRows, setHariRows] = useState<HariRow[]>([])
  const [shifts, setShifts] = useState<BarisShiftRekap[]>([])
  const [manRows, setManRows] = useState<CatatanFinansial[]>([])
  // tren 30 hari — bebas rentang pilihan (indikator performa)
  const [tren, setTren] = useState<{ t: string; omzet: number; laba: number }[]>([])
  const [memuat, setMemuat] = useState(true)

  // form catatan manual
  const [bukaTambah, setBukaTambah] = useState(false)
  const [mJenis, setMJenis] = useState<'masuk' | 'keluar'>('keluar')
  const [mTanggal, setMTanggal] = useState(hariIni)
  const [mJumlah, setMJumlah] = useState('')
  const [mKategori, setMKategori] = useState('')
  const [mKet, setMKet] = useState('')
  const [mErr, setMErr] = useState('')
  const [mSibuk, setMSibuk] = useState(false)
  const [hapusId, setHapusId] = useState<number | null>(null)
  const [bukaKat, setBukaKat] = useState(false)
  const [pesan, setPesan] = useState<{ text: string; err: boolean } | null>(null)

  useEffect(() => {
    void (async () => {
      setMemuat(true)
      const { from, to } = rentangTanggal(rentang, hariIni)
      // rekap operasional per hari
      const rows: HariRow[] = []
      let t = from
      let guard = 0
      while (t <= to && guard < 40) {
        const l = await laporanHarian(t)
        rows.push({
          tanggal: t,
          omzet: l.omzet,
          hpp: l.hppTotal,
          labaKotor: l.labaKotor,
          pengeluaran: l.totalPengeluaran,
          labaBersih: l.labaBersih,
          nTransaksi: l.nTransaksi,
          perSumber: l.perSumber,
          perMetode: l.perMetode,
          produk: l.produk.map((p) => ({ produkId: p.produkId, nama: p.nama, qty: p.qty, omzet: p.omzet, hpp: p.hpp, laba: p.laba })),
          tanpaHpp: l.tanpaHpp,
        })
        t = tambahTanggal(t, 1)
        guard++
      }
      setHariRows(rows)
      setShifts(await rekapShiftAntara(from, to))
      setManRows(await listCatatanFinansial(from, to))
      // tren 30 hari terakhir
      const tr: { t: string; omzet: number; laba: number }[] = []
      let t2 = tambahTanggal(hariIni, -29)
      for (let i = 0; i < 30; i++) {
        const l2 = await laporanHarian(t2)
        tr.push({ t: t2, omzet: l2.omzet, laba: l2.labaBersih })
        t2 = tambahTanggal(t2, 1)
      }
      setTren(tr)
      setMemuat(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentang, rel])

  const sum = hariRows.reduce(
    (s, r) => ({
      omzet: s.omzet + r.omzet,
      hpp: s.hpp + r.hpp,
      labaKotor: s.labaKotor + r.labaKotor,
      pengeluaran: s.pengeluaran + r.pengeluaran,
      labaBersih: s.labaBersih + r.labaBersih,
      nTransaksi: s.nTransaksi + r.nTransaksi,
    }),
    { omzet: 0, hpp: 0, labaKotor: 0, pengeluaran: 0, labaBersih: 0, nTransaksi: 0 },
  )
  const shiftSetoran = shifts.reduce((s, x) => s + (x.sesi.setoran ?? 0), 0)
  const shiftSelisih = shifts.reduce((s, x) => s + (x.sesi.selisih ?? 0), 0)
  const manual: RekapFinansial = rekapCatatan(manRows)

  // rincian beban operasional per kategori (semua catatan 'keluar' rentang ini)
  const perKategori = useMemo(() => {
    const peta = new Map<string, number>()
    for (const r of manRows) {
      if (r.jenis !== 'keluar') continue
      peta.set(r.kategori, (peta.get(r.kategori) ?? 0) + r.jumlah)
    }
    return [...peta.entries()].sort((a, b) => b[1] - a[1])
  }, [manRows])
  const totalBeban = sum.hpp + manual.keluar
  const labaCover = sum.omzet - totalBeban
  const marginCover = sum.omzet > 0 ? (labaCover / sum.omzet) * 100 : null

  // geometri donat beban operasional (catatan 'keluar' per kategori)
  const segKat = useMemo(() => {
    const total = perKategori.reduce((s, [, v]) => s + v, 0)
    let off = 0
    const segs = perKategori.map(([kat, v], i) => {
      const frac = total > 0 ? v / total : 0
      const s = { label: kat, nilai: v, warna: WARNA_KAT[i % WARNA_KAT.length], dash: frac * CK, offset: off, frac }
      off += frac
      return s
    })
    return { total, segs }
  }, [perKategori])
  // catatan 'keluar' diurutkan per kategori (untuk modal rincian)
  const rincianKat = useMemo(
    () =>
      manRows
        .filter((r) => r.jenis === 'keluar')
        .sort((a, b) => a.kategori.localeCompare(b.kategori) || b.tanggal.localeCompare(a.tanggal)),
    [manRows],
  )

  // penjualan per platform & metode + produk terlaris (rentang ini)
  const { perSumber, perMetode } = useMemo(() => {
    const s = {} as Record<SumberPesanan, number>
    const m = {} as Record<MetodeBayar, number>
    for (const r of hariRows) {
      for (const k of Object.keys(r.perSumber) as SumberPesanan[]) s[k] = (s[k] ?? 0) + r.perSumber[k]
      for (const k of Object.keys(r.perMetode) as MetodeBayar[]) m[k] = (m[k] ?? 0) + r.perMetode[k]
    }
    return { perSumber: s, perMetode: m }
  }, [hariRows])
  const produkAgg = useMemo(() => {
    const peta = new Map<number, ProdukTerjual>()
    const tanpa = new Set<string>()
    for (const r of hariRows) {
      for (const p of r.produk) {
        const ada = peta.get(p.produkId) ?? { produkId: p.produkId, nama: p.nama, qty: 0, omzet: 0, hpp: 0, laba: 0 }
        ada.qty += p.qty
        ada.omzet += p.omzet
        ada.hpp += p.hpp
        ada.laba += p.laba
        peta.set(p.produkId, ada)
      }
      for (const n of r.tanpaHpp) tanpa.add(n)
    }
    return { list: [...peta.values()].sort((a, b) => b.omzet - a.omzet || b.qty - a.qty), tanpaHpp: [...tanpa] }
  }, [hariRows])
  const omzetSumber = URUTAN_SUMBER.reduce((s, k) => s + (perSumber[k] ?? 0), 0)
  const barSumber = (k: SumberPesanan) => {
    const v = perSumber[k] ?? 0
    const max = Math.max(1, ...URUTAN_SUMBER.map((x) => perSumber[x] ?? 0))
    return { v, pctBar: (v / max) * 100, share: omzetSumber > 0 ? (v / omzetSumber) * 100 : 0 }
  }

  // geometri grafik tren (SVG murni, tanpa pustaka)
  const YT = 14 // atas area plot
  const YB = 108 // garis dasar (nol)
  const XL = 6
  const XR = 314
  const trenMax = Math.max(1, ...tren.map((x) => Math.max(x.omzet, Math.abs(x.laba))))
  const yTitik = (v: number) => YB - (Math.max(0, v) / trenMax) * (YB - YT)
  const xTitik = (i: number) => tren.length > 1 ? XL + (i * (XR - XL)) / (tren.length - 1) : XL
  const jalurOmzet = tren.map((x, i) => `${i === 0 ? 'M' : 'L'}${xTitik(i).toFixed(1)},${yTitik(x.omzet).toFixed(1)}`).join(' ')
  const jalurLaba = tren.map((x, i) => `${i === 0 ? 'M' : 'L'}${xTitik(i).toFixed(1)},${yTitik(x.laba).toFixed(1)}`).join(' ')
  const areaOmzet = jalurOmzet ? `M${XL},${YB} ${jalurOmzet} L${xTitik(tren.length - 1).toFixed(1)},${YB} Z` : ''
  const trenTotal = tren.reduce((s, x) => s + x.omzet, 0)
  const terbaik = tren.reduce<{ t: string; omzet: number } | null>((a, x) => (!a || x.omzet > a.omzet ? { t: x.t, omzet: x.omzet } : a), null)

  async function simpanManual() {
    const jumlah = Math.floor(Number(mJumlah) || 0)
    setMErr('')
    setMSibuk(true)
    try {
      const h = await tambahCatatanFinansial({ tanggal: mTanggal, jenis: mJenis, jumlah, kategori: mKategori, keterangan: mKet })
      if (!h.ok) {
        setMErr(h.alasan ?? 'Gagal menyimpan')
        return
      }
      setBukaTambah(false)
      setMJumlah('')
      setMKet('')
      setMErr('')
      setPesan({ text: `✓ Catatan ${mJenis === 'masuk' ? 'pemasukan' : 'pengeluaran'} tersimpan.`, err: false })
      await catatAudit('finansial-tambah', `${mJenis === 'masuk' ? '+' : '−'}${formatRupiah(jumlah)} · ${mKategori || 'tanpa kategori'}`)
      setRel((r) => r + 1)
    } finally {
      setMSibuk(false)
    }
  }

  async function konfirmasiHapus() {
    if (hapusId == null) return
    const yangDihapus = manRows.find((r) => r.id === hapusId)
    await hapusCatatanFinansial(hapusId)
    setHapusId(null)
    setPesan({ text: '✓ Catatan dihapus.', err: false })
    await catatAudit('finansial-hapus', yangDihapus ? `${yangDihapus.jenis === 'masuk' ? '+' : '−'}${formatRupiah(yangDihapus.jumlah)} · ${yangDihapus.kategori}` : String(hapusId))
    setRel((r) => r + 1)
  }

  const gantiJenis = (j: 'masuk' | 'keluar') => {
    setMJenis(j)
    setMKategori('')
  }

  const ringkasan = useMemo(() => {
    const { from, to } = rentangTanggal(rentang, hariIni)
    const lab = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`
    const baris: StrukBaris[] = []
    baris.push({ text: potong('RINGKASAN FINANSIAL', 44).toUpperCase(), bold: true, center: true })
    baris.push({ text: `${tglHari(from)} — ${tglHari(to)}`, center: true })
    baris.push({ text: garis() })
    baris.push({ text: `Omzet kasir          ${lab(sum.omzet).padStart(13)}` })
    baris.push({ text: `HPP                  ${('−' + lab(sum.hpp)).padStart(13)}` })
    baris.push({ text: `Laba kotor           ${lab(sum.labaKotor).padStart(13)}` })
    baris.push({ text: `Pengeluaran operasi  ${('−' + lab(sum.pengeluaran)).padStart(13)}` })
    baris.push({ text: `Laba bersih operasi  ${lab(sum.labaBersih).padStart(13)}`, bold: true })
    baris.push({ text: garisTipis() })
    baris.push({ text: `Setoran shift (${shifts.length})      ${lab(shiftSetoran).padStart(13)}` })
    baris.push({ text: `Selisih shift        ${lab(shiftSelisih).padStart(13)}` })
    baris.push({ text: garisTipis() })
    baris.push({ text: `Pemasukan non-kasir   ${lab(manual.masuk).padStart(13)}` })
    baris.push({ text: garis() })
    return { baris, from, to }
  }, [rentang, hariIni, sum, shifts, manual, shiftSetoran, shiftSelisih])

  const [eksporBusy, setEksporBusy] = useState<'png' | 'pdf' | 'bagi' | ''>('')

  async function klikEkspor(jenis: 'png' | 'pdf' | 'bagi') {
    setEksporBusy(jenis)
    setPesan(null)
    try {
      const { baris, from, to } = ringkasan
      if (jenis === 'bagi') {
        const blob = await renderPng(baris)
        const hasil = await bagikanFile(blob, `finansial-${from}-${to}.png`, `Ringkasan Finansial ${labelBaris(from)} s/d ${labelBaris(to)}`)
        if (hasil === 'shared') setPesan({ text: '✓ Ringkasan finansial dibagikan.', err: false })
        else if (hasil === 'download') setPesan({ text: '✓ Ringkasan terunduh (bagikan lewat WhatsApp dari galeri/file).', err: false })
        else setPesan({ text: 'Gagal berbagi.', err: true })
        return
      }
      const blob = jenis === 'png' ? await renderPng(baris) : await renderPdf(baris)
      unduhFile(blob, `finansial-${from}-${to}.${jenis === 'png' ? 'png' : 'pdf'}`)
      setPesan({ text: `✓ Ringkasan finansial terunduh (${jenis.toUpperCase()}).`, err: false })
    } catch (e) {
      setPesan({ text: String(e instanceof Error ? e.message : e), err: true })
    } finally {
      setEksporBusy('')
    }
  }

  return (
    <main>
      <section className="panel" style={{ marginTop: 0 }}>
        <div className="dhead">
          <div>
            <h2 style={{ margin: 0 }}>Finansial Bisnis</h2>
            <p className="db-sub">
              Laba dihitung otomatis: omzet kasir − HPP − beban operasional dari catatan pengeluaran di bawah
              (listrik, gas, gaji, sewa, dll.) — di sini bisa terlihat apakah omzet menutup seluruh beban.
            </p>
          </div>
          <button className="outline small" onClick={() => setBukaTambah(true)}>+ Catat finansial</button>
        </div>

        <div className="chips" role="radiogroup" aria-label="Rentang finansial" style={{ marginTop: 12 }}>
          {(Object.keys(LABEL_RENTANG) as Rentang[]).map((r) => (
            <button key={r} role="radio" aria-checked={rentang === r} className={`chip ${rentang === r ? 'on' : ''}`} onClick={() => setRentang(r)}>
              {LABEL_RENTANG[r]}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="pab ink" disabled={eksporBusy !== ''} onClick={() => void klikEkspor('bagi')}>
            {eksporBusy === 'bagi' ? '…' : 'Kirim rekap (WhatsApp)'}
          </button>
          <button className="pab" disabled={eksporBusy !== ''} onClick={() => void klikEkspor('png')}>
            {eksporBusy === 'png' ? '…' : 'Unduh PNG'}
          </button>
          <button className="pab" disabled={eksporBusy !== ''} onClick={() => void klikEkspor('pdf')}>
            {eksporBusy === 'pdf' ? '…' : 'Unduh PDF'}
          </button>
        </div>
      </section>

      <div className="db-kpis" style={{ marginTop: 12 }}>
        <div className="db-kpi hero">
          <div className="l"><span>Omzet kasir</span></div>
          <div className="v">{formatRupiah(sum.omzet)}</div>
          <div className="d">{sum.nTransaksi} transaksi · {hariRows.length} hari</div>
        </div>
        <div className="db-kpi">
          <div className="l"><span>Laba bersih operasional</span></div>
          <div className="v" style={{ color: sum.labaBersih < 0 ? 'var(--danger)' : undefined }}>{formatRupiah(sum.labaBersih)}</div>
          <div className="d">omzet − HPP − pengeluaran</div>
        </div>
        <div className="db-kpi">
          <div className="l"><span>Setoran shift</span></div>
          <div className="v">{formatRupiah(shiftSetoran)}</div>
          <div className="d">{shifts.length} shift ditutup · selisih {formatRupiah(shiftSelisih)}</div>
        </div>
        <div className="db-kpi">
          <div className="l"><span>Catatan manual (net)</span></div>
          <div className="v" style={{ color: manual.net < 0 ? 'var(--danger)' : 'var(--ok)' }}>{manual.net >= 0 ? '' : '−'}{formatRupiah(Math.abs(manual.net))}</div>
          <div className="d">pemasukan {formatRupiah(manual.masuk)} · pengeluaran {formatRupiah(manual.keluar)}</div>
        </div>
      </div>

      {pesan && <div className={`form-note ${pesan.err ? 'err' : 'ok'}`} style={{ marginTop: 10 }}>{pesan.text}</div>}

      <PanelPesananPortal {...rentangTanggal(rentang, hariIni)} />

      <section className="panel">
        <div className="dhead" style={{ marginTop: 0 }}>
          <div>
            <h2 style={{ margin: 0 }}>Tren 30 hari</h2>
            <p className="db-sub">
              Omzet <span style={{ color: 'var(--brand)' }}>■</span> &amp; laba bersih{' '}
              <span style={{ color: 'var(--ok)' }}>■</span> per hari — arah performa outlet. Total 30 hari{' '}
              <b>{formatRupiah(trenTotal)}</b>
              {terbaik ? ` · hari terbaik ${labelBaris(terbaik.t)} (${formatRupiah(terbaik.omzet)})` : ''}.
            </p>
          </div>
        </div>
        <svg
          viewBox="0 0 320 120"
          style={{ display: 'block', width: '100%', height: 'auto', marginTop: 4 }}
          role="img"
          aria-label="Grafik omzet dan laba bersih 30 hari terakhir"
        >
          {[0.25, 0.5, 0.75, 1].map((f) => {
            const y = YB - f * (YB - YT)
            return (
              <line key={f} x1={XL} x2={XR} y1={y} y2={y} style={{ stroke: 'var(--line)' }} strokeWidth={1} strokeDasharray="2 4" />
            )
          })}
          <path d={areaOmzet} style={{ fill: 'var(--brand)' }} opacity={0.12} />
          {jalurLaba && <path d={jalurLaba} fill="none" style={{ stroke: 'var(--ok)' }} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
          {jalurOmzet && <path d={jalurOmzet} fill="none" style={{ stroke: 'var(--brand)' }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {tren.length > 0 && (
            <circle cx={xTitik(tren.length - 1)} cy={yTitik(tren[tren.length - 1].omzet)} r={3.4} style={{ fill: 'var(--brand)' }} />
          )}
        </svg>
      </section>

      {memuat ? (
        <p className="muted">Menghitung…</p>
      ) : (
        <>
          <section className="panel">
            <div className="dhead" style={{ marginTop: 0 }}>
              <div>
                <h2 style={{ margin: 0 }}>Omzet vs beban — nutup atau tidak?</h2>
                <p className="db-sub">
                  Total beban {formatRupiah(totalBeban)} = HPP {formatRupiah(sum.hpp)} + pengeluaran operasional{' '}
                  {formatRupiah(manual.keluar)} dari catatan di panel bawah (listrik, gas, gaji, sewa, dll.).
                </p>
              </div>
              <button className="outline small" onClick={() => setBukaKat(true)} disabled={rincianKat.length === 0}>
                Rincian per kategori →
              </button>
            </div>
            <div className={`form-note ${totalBeban === 0 || labaCover >= 0 ? 'ok' : 'err'}`} style={{ marginTop: 10 }}>
              {totalBeban === 0 ? (
                <span>
                  Belum ada beban tercatat pada rentang ini — omzet {formatRupiah(sum.omzet)} belum dikurangi HPP maupun
                  pengeluaran operasional.
                </span>
              ) : labaCover >= 0 ? (
                <span>
                  ✓ Omzet {formatRupiah(sum.omzet)} <b>menutup seluruh beban</b> {formatRupiah(totalBeban)} — sisa laba{' '}
                  <b>{formatRupiah(labaCover)}</b>{marginCover != null ? ` (margin ${marginCover.toFixed(0)}%)` : ''}.
                </span>
              ) : (
                <span>
                  ✗ Omzet {formatRupiah(sum.omzet)}                  <b>belum menutup beban</b> {formatRupiah(totalBeban)} — defisit{' '}
                  <b>{formatRupiah(-labaCover)}</b>{marginCover != null ? ` (margin ${marginCover.toFixed(0)}%)` : ''}. Catat
                  pemasukan lain atau pangkas beban agar omzet menutup biaya.
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
              <div style={{ textAlign: 'center' }}>
                <svg viewBox="0 0 100 100" width={118} height={118} role="img" aria-label="Proporsi pengeluaran operasional per kategori">
                  {segKat.total === 0 && (
                    <circle cx={50} cy={50} r={RK} fill="none" stroke="var(--line)" strokeWidth={13} />
                  )}
                  {segKat.segs.map((s) => (
                    <circle
                      key={s.label}
                      cx={50}
                      cy={50}
                      r={RK}
                      fill="none"
                      stroke={s.warna}
                      strokeWidth={13}
                      strokeDasharray={`${Math.max(0, Math.min(CK, s.dash - 1.2))} ${CK}`}
                      strokeDashoffset={-s.offset * CK}
                      transform="rotate(-90 50 50)"
                    />
                  ))}
                </svg>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.35 }}>
                  pengeluaran operasional
                  <br />
                  <b style={{ color: 'var(--ink)' }}>{formatRupiah(segKat.total)}</b>
                </div>
              </div>
              <div style={{ flex: '1 1 250px', minWidth: 230, display: 'grid', gap: 6, alignContent: 'start' }}>
                {segKat.total === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    Belum ada catatan pengeluaran ({LABEL_RENTANG[rentang]}). Tambahkan lewat "+ Catat finansial" agar beban
                    operasional ikut terhitung.
                  </p>
                ) : (
                  segKat.segs.slice(0, 6).map((s) => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: s.warna, flex: '0 0 auto' }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, minWidth: 0 }}>
                        {s.label}
                      </span>
                      <span style={{ color: 'var(--muted)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(s.frac * 100)}%
                      </span>
                      <b style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatRupiah(s.nilai)}</b>
                    </div>
                  ))
                )}
                {segKat.total > 0 && segKat.segs.length > 6 && (
                  <button className="outline small" onClick={() => setBukaKat(true)} style={{ justifySelf: 'start' }}>
                    + {segKat.segs.length - 6} kategori lain — lihat rincian
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="dhead" style={{ marginTop: 0 }}>
              <div>
                <h2 style={{ margin: 0 }}>Rekap per hari</h2>
                <p className="db-sub">Laba bersih = omzet − HPP − pengeluaran; pengeluaran berasal dari catatan "Pengeluaran" di panel bawah.</p>
              </div>
            </div>
            {hariRows.length === 0 ? (
              <p className="empty">Tidak ada hari dengan penjualan pada rentang ini.</p>
            ) : (
              <div>
                {hariRows.map((r) => (
                  <div className="fin-row" key={r.tanggal}>
                    <span className="tgl">{labelBaris(r.tanggal)}</span>
                    <span className="num">{formatRupiah(r.omzet)}</span>
                    <span className="num dim">−{formatRupiah(r.pengeluaran)}</span>
                    <span className="num" style={{ color: r.labaBersih < 0 ? 'var(--danger)' : 'var(--ok)', fontWeight: 800 }}>{formatRupiah(r.labaBersih)}</span>
                  </div>
                ))}
                <div className="fin-row total">
                  <span className="tgl">Total</span>
                  <span className="num">{formatRupiah(sum.omzet)}</span>
                  <span className="num dim">−{formatRupiah(sum.pengeluaran)}</span>
                  <span className="num" style={{ color: sum.labaBersih < 0 ? 'var(--danger)' : 'var(--ok)', fontWeight: 800 }}>{formatRupiah(sum.labaBersih)}</span>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="dhead" style={{ marginTop: 0 }}>
              <div>
                <h2 style={{ margin: 0 }}>Penjualan per platform & metode</h2>
                <p className="db-sub">
                  Sumber pesanan &amp; cara bayar pada rentang ini — terlihat proporsi GoFood/Grab/Shopee vs penjualan
                  langsung, dan berapa yang masuk tunai/QRIS.
                </p>
              </div>
            </div>
            {omzetSumber === 0 ? (
              <p className="empty">Belum ada penjualan pada rentang ini.</p>
            ) : (
              <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                <div>
                  <p className="muted" style={{ fontSize: 12.5, fontWeight: 700, margin: '0 0 4px' }}>Sumber pesanan</p>
                  {URUTAN_SUMBER.map((k) => {
                    const { v, pctBar, share } = barSumber(k)
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, margin: '6px 0' }}>
                        <span style={{ width: 84, fontWeight: 600, whiteSpace: 'nowrap' }}>{LABEL_SUMBER[k]}</span>
                        <div style={{ flex: 1, height: 14, background: 'var(--soft)', borderRadius: 7, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max(pctBar, v > 0 ? 3 : 0)}%`, height: '100%', background: 'var(--brand)', borderRadius: 7 }} />
                        </div>
                        <b style={{ width: 88, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatRupiah(v)}</b>
                        <span style={{ width: 42, textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{share.toFixed(0)}%</span>
                      </div>
                    )
                  })}
                </div>
                <div>
                  <p className="muted" style={{ fontSize: 12.5, fontWeight: 700, margin: '0 0 4px' }}>Metode bayar</p>
                  {(Object.keys(LABEL_METODE) as MetodeBayar[]).map((k) => {
                    const v = perMetode[k] ?? 0
                    const max = Math.max(1, ...(Object.keys(LABEL_METODE) as MetodeBayar[]).map((x) => perMetode[x] ?? 0))
                    const share = omzetSumber > 0 ? (v / omzetSumber) * 100 : 0
                    return (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, margin: '6px 0' }}>
                        <span style={{ width: 84, fontWeight: 600, whiteSpace: 'nowrap' }}>{LABEL_METODE[k]}</span>
                        <div style={{ flex: 1, height: 14, background: 'var(--soft)', borderRadius: 7, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.max((v / max) * 100, v > 0 ? 3 : 0)}%`, height: '100%', background: k === 'tunai' ? 'var(--ok)' : k === 'qris' ? 'var(--brand)' : 'var(--gold)', borderRadius: 7 }} />
                        </div>
                        <b style={{ width: 88, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatRupiah(v)}</b>
                        <span style={{ width: 42, textAlign: 'right', color: 'var(--muted)', fontSize: 11 }}>{share.toFixed(0)}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="dhead" style={{ marginTop: 0 }}>
              <div>
                <h2 style={{ margin: 0 }}>Produk terlaris</h2>
                <p className="db-sub">
                  Urutan omzet {LABEL_RENTANG[rentang]} — qty, omzet &amp; laba (omzet − HPP).
                  {produkAgg.tanpaHpp.length > 0 && ` ${produkAgg.tanpaHpp.length} produk belum punya HPP (resep kosong).`}
                </p>
              </div>
            </div>
            {produkAgg.list.length === 0 ? (
              <p className="empty">Belum ada penjualan pada rentang ini.</p>
            ) : (
              <div>
                {produkAgg.list.slice(0, 8).map((p, i) => (
                  <div className="fin-row" key={p.produkId}>
                    <span className="tgl">
                      {i + 1}. {p.nama}
                      <small style={{ display: 'block', color: 'var(--muted)', fontWeight: 400 }}>
                        ×{p.qty} terjual · margin {p.omzet > 0 ? ((p.laba / p.omzet) * 100).toFixed(0) : 0}%
                      </small>
                    </span>
                    <span className="num dim">{formatRupiah(p.omzet)}</span>
                    <span className="num" style={{ fontWeight: 800 }}>{formatRupiah(p.laba)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="dhead" style={{ marginTop: 0 }}>
              <div>
                <h2 style={{ margin: 0 }}>Setoran & selisih shift</h2>
                <p className="db-sub">Shift yang ditutup dalam rentang — detail lengkap di halaman Riwayat Shift.</p>
              </div>
              <Link to="/shift" style={{ textDecoration: 'none' }}><button className="outline small">Riwayat Shift →</button></Link>
            </div>
            {shifts.length === 0 ? (
              <p className="empty">Belum ada shift ditutup pada rentang ini.</p>
            ) : (
              <div>
                {shifts.map(({ sesi: s, ledger, nomor }) => (
                  <div className="fin-row" key={s.id}>
                    <span className="tgl">
                      Shift #{nomor}
                      {s.catatan ? ` · ${s.catatan}` : ''}
                      <small style={{ display: 'block', color: 'var(--muted)', fontWeight: 400 }}>{(s.tutupWaktu ?? '').replace('T', ' ').slice(0, 16)}</small>
                    </span>
                    <span className="num dim">kas keluar −{formatRupiah(ledger.keluar)}</span>
                    <span className="num" style={{ color: (s.selisih ?? 0) === 0 ? 'var(--ok)' : (s.selisih ?? 0) > 0 ? 'var(--gold)' : 'var(--danger)', fontWeight: 700 }}>{s.selisih === 0 ? 'pas' : `${(s.selisih ?? 0) > 0 ? '+' : '−'}${formatRupiah(Math.abs(s.selisih ?? 0))}`}</span>
                    <span className="num" style={{ fontWeight: 800 }}>{formatRupiah(s.setoran ?? 0)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="dhead" style={{ marginTop: 0 }}>
              <div>
                <h2 style={{ margin: 0 }}>Catatan finansial</h2>
                <p className="db-sub">
                  Satu tempat mencatat pemasukan &amp; pengeluaran bisnis (menggantikan halaman Pengeluaran).
                  Pengeluaran di sini otomatis mengurangi laba operasional.
                </p>
              </div>
              <button className="outline small" onClick={() => setBukaTambah(true)}>+ Catat finansial</button>
            </div>
            {manRows.length === 0 ? (
              <p className="empty">Belum ada catatan finansial pada rentang ini.</p>
            ) : (
              <div>
                {manRows.map((c) => (
                  <div className="fin-row" key={c.id}>
                    <span className="tgl">
                      <span className={`badge ${c.jenis === 'masuk' ? 'stock' : 'off'}`} style={{ marginRight: 6 }}>{c.jenis === 'masuk' ? 'MASUK' : 'KELUAR'}</span>
                      {c.kategori}
                      {c.keterangan ? <small style={{ display: 'block', color: 'var(--muted)', fontWeight: 400 }}>{c.keterangan}</small> : null}
                      <small style={{ display: 'block', color: 'var(--muted-light)', fontWeight: 400 }}>{labelBaris(c.tanggal)}</small>
                    </span>
                    <span className="num dim" />
                    <span className="num" style={{ color: c.jenis === 'masuk' ? 'var(--ok)' : 'var(--danger)', fontWeight: 700 }}>
                      {c.jenis === 'masuk' ? '+' : '−'}{formatRupiah(c.jumlah)}
                    </span>
                    <button className="pab icon" aria-label="Hapus catatan" title="Hapus" onClick={() => setHapusId(c.id as number)} style={{ width: 26, height: 26, minHeight: 0, padding: 0 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* pop-up: catat manual */}
      {bukaTambah && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setBukaTambah(false) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Catat finansial manual">
            <h3>Catat pemasukan / pengeluaran</h3>
            <p className="sub">Pemasukan &amp; pengeluaran bisnis. Pengeluaran otomatis menjadi biaya pada laporan laba.</p>
            <div className="seg" role="radiogroup" aria-label="Jenis catatan" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 4 }}>
              {(['keluar', 'masuk'] as const).map((j) => (
                <button key={j} role="radio" aria-checked={mJenis === j} className={mJenis === j ? 'on' : ''} onClick={() => gantiJenis(j)}>
                  {j === 'masuk' ? '+ Pemasukan' : '− Pengeluaran'}
                </button>
              ))}
            </div>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="fm-tanggal">Tanggal</label>
                <input id="fm-tanggal" type="date" value={mTanggal} max={hariIni} onChange={(e) => setMTanggal(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="fm-jumlah">Jumlah (Rp) *</label>
                <input id="fm-jumlah" type="number" inputMode="numeric" autoComplete="off" min={1} value={mJumlah} onChange={(e) => setMJumlah(e.target.value)} placeholder="0" />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="fm-kategori">Kategori *</label>
                <input id="fm-kategori" list="fm-kat" autoComplete="off" value={mKategori} onChange={(e) => setMKategori(e.target.value)} placeholder="pilih atau ketik kategori" />
                <datalist id="fm-kat">
                  {kategoriUntuk(mJenis).map((k) => <option key={k} value={k} />)}
                </datalist>
                {mErr && <span className="err-inline">{mErr}</span>}
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="fm-ket">Keterangan (opsional)</label>
                <input id="fm-ket" autoComplete="off" value={mKet} onChange={(e) => setMKet(e.target.value)} placeholder="mis. setoran tunai di luar kasir / sewa bulan ini" />
              </div>
            </div>
            <div className="km-buttons">
              <button className="ghost" onClick={() => setBukaTambah(false)} disabled={mSibuk}>Batal</button>
              <button className="primary" onClick={() => void simpanManual()} disabled={mSibuk}>{mSibuk ? 'Menyimpan…' : 'Simpan catatan'}</button>
            </div>
          </div>
        </div>
      )}

      {/* pop-up: rincian pengeluaran per kategori */}
      {bukaKat && segKat.segs.length > 0 && (
        <div className="km-overlay" onClick={(e) => { if (e.target === e.currentTarget) setBukaKat(false) }}>
          <div className="km" role="dialog" aria-modal="true" aria-label="Rincian pengeluaran per kategori">
            <h3>Rincian pengeluaran per kategori</h3>
            <p className="sub">
              {LABEL_RENTANG[rentang]} — total <b>{formatRupiah(segKat.total)}</b> dari {rincianKat.length} catatan
              pengeluaran (listrik, gas, gaji, sewa, dll.).
            </p>
            <div style={{ display: 'grid', gap: 2, maxHeight: 360, overflowY: 'auto' }}>
              {segKat.segs.map((s) => (
                <div key={s.label} style={{ borderTop: '1px dashed var(--line)', padding: '8px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: s.warna, flex: '0 0 auto' }} />
                    <span style={{ flex: 1, fontWeight: 700, minWidth: 0 }}>{s.label}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(s.frac * 100)}%
                    </span>
                    <b style={{ fontVariantNumeric: 'tabular-nums' }}>{formatRupiah(s.nilai)}</b>
                  </div>
                  {rincianKat.filter((r) => r.kategori === s.label).map((r) => (
                    <div key={r.id} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '2px 0 2px 18px', color: 'var(--muted)' }}>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.keterangan || r.kategori} · {labelBaris(r.tanggal)}
                      </span>
                      <b style={{ color: 'var(--danger)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        −{formatRupiah(r.jumlah)}
                      </b>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="km-buttons">
              <button className="primary" onClick={() => setBukaKat(false)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        buka={hapusId != null}
        judul="Hapus catatan finansial?"
        pesan="Catatan ini akan dihapus permanen dari riwayat finansial."
        labelKonfirmasi="Hapus"
        onKonfirmasi={() => void konfirmasiHapus()}
        onBatal={() => setHapusId(null)}
      />
    </main>
  )
}

/** Pesanan antar dari portal customer (server order) — omzet & ongkir + segmen pelanggan. */
interface BarisPortal {
  omzet: number; ongkir: number; n: number; selesai: number; batal: number
  refundN: number; refundNominal: number; refundPerMetode: { qris: number; transfer: number }
  pelanggan: { hp: string; nama?: string; jumlahPesanan: number; total: number; ratingRata: number | null }[]
}

function PanelPesananPortal({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<BarisPortal | null>(null)
  const [gagal, setGagal] = useState('')

  useEffect(() => {
    let stop = false
    const url = orderUrl()
    const h = headerKasir()
    Promise.all([fetch(url + '/api/pesan', { headers: h }).then((r) => r.json()), fetch(url + '/api/pelanggan', { headers: h }).then((r) => r.json())])
      .then(([o, pl]) => {
        if (stop) return
        type OrderL = { waktuBuat?: string; status: string; total?: number; ongkir?: number; refund?: { nominal?: number; metode?: string; waktu?: string } }
        const orders = (o?.pesanan || []) as OrderL[]
        const dalam = orders.filter((p) => (p.waktuBuat || '').slice(0, 10) >= from && (p.waktuBuat || '').slice(0, 10) <= to)
        const aktif = dalam.filter((p) => p.status !== 'batal')
        // refund yang tercatat pada rentang ini (pakai tanggal refund, bukan tanggal pesanan)
        const refs = orders.filter((p) => {
          const rw = (p.refund && p.refund.waktu) || ''
          return rw && rw.slice(0, 10) >= from && rw.slice(0, 10) <= to
        })
        const refundPerMetode = { qris: 0, transfer: 0 }
        for (const r of refs) {
          const k = r.refund?.metode === 'transfer' ? 'transfer' : 'qris'
          refundPerMetode[k] += r.refund?.nominal || 0
        }
        const pelanggan = ((pl?.pelanggan || []) as BarisPortal['pelanggan'])
          .slice().sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 6)
        setData({
          // omzet net: total pesanan dikurangi dana yang sudah dikembalikan (refund keluar dari omzet)
          omzet: aktif.reduce((s, p) => s + (p.total || 0) - ((p.refund && p.refund.nominal) || 0), 0),
          ongkir: aktif.reduce((s, p) => s + (p.ongkir || 0), 0),
          n: aktif.length,
          selesai: aktif.filter((p) => p.status === 'selesai').length,
          batal: dalam.filter((p) => p.status === 'batal').length,
          refundN: refs.length,
          refundNominal: refs.reduce((s, p) => s + (p.refund?.nominal || 0), 0),
          refundPerMetode,
          pelanggan,
        })
      })
      .catch((e) => { if (!stop) setGagal(String((e as Error).message || 'server order tak terjangkau')) })
    return () => { stop = true }
  }, [from, to])

  return (
    <section className="panel">
      <div className="dhead" style={{ marginTop: 0 }}>
        <div>
          <h2 style={{ margin: 0 }}>Pesanan antar (portal delivery)</h2>
          <p className="db-sub">
            Pesanan dari portal customer (server order) pada rentang ini — omzet produk + pendapatan ongkir,
            segmen pelanggan (total belanja &amp; rating rata-rata), dan ringkasan refund per metode.
            Refund otomatis memangkas omzet &amp; total belanja pelanggan.
          </p>
        </div>
      </div>
      {gagal && (
        <div className="form-note err" style={{ marginTop: 6 }}>
          Server order nonaktif — nyalakan <b>npm run server:order</b> dan atur URL di Papan Pesanan Antar.
        </div>
      )}
      {data && (
        <div className="db-kpis" style={{ marginTop: 8 }}>
          <div className="db-kpi">
            <div className="l"><span>Omzet pesanan antar</span></div>
            <div className="v">{formatRupiah(data.omzet)}</div>
            <div className="d">{data.n} pesanan · {data.selesai} selesai · {data.batal} batal</div>
          </div>
          <div className="db-kpi">
            <div className="l"><span>Pendapatan ongkir</span></div>
            <div className="v">{formatRupiah(data.ongkir)}</div>
            <div className="d">dari biaya kirim radius/kirim</div>
          </div>
          <div className="db-kpi">
            <div className="l"><span>↩️ Refund QRIS/transfer</span></div>
            <div className="v" style={{ color: 'var(--danger)' }}>{data.refundNominal > 0 ? formatRupiah(data.refundNominal) : '—'}</div>
            <div className="d">{data.refundN} transaksi{from.endsWith('-01') ? ' bulan ini' : ' · periode dipilih'}
              {data.refundN > 0 && <> · QRIS {formatRupiah(data.refundPerMetode.qris)} · transfer {formatRupiah(data.refundPerMetode.transfer)}</>}</div>
          </div>
        </div>
      )}
      {data && data.pelanggan.length > 0 && (
        <div className="db-tr" style={{ marginTop: 10 }}>
          {data.pelanggan.map((p, i) => (
            <div key={p.hp} className="db-tr-row">
              <span className="db-tr-pos">{i + 1}</span>
              <span className="db-tr-nama">{p.nama || '(tanpa nama)'}</span>
              <span className="db-tr-sub">{p.hp} · {p.jumlahPesanan} pesanan</span>
              <span className="db-tr-amt">{formatRupiah(p.total || 0)}</span>
              <span className="tag">{p.ratingRata ? `⭐ ${p.ratingRata}` : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
