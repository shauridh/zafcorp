import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, type Fryer, type MetodeBayar, type SumberPesanan } from '../data/db'
import { laporanBulanan, laporanHarian, type BarisProdukLaporan, type Laporan } from '../data/laporan'
import { getSesiAktif, nomorShiftSesi, ringkasanSesi, type RingkasanSesi } from '../data/kas'
import { daftarTransaksi, LABEL_METODE, labelSumber, URUTAN_METODE, type BarisTransaksi } from '../data/sales'
import { hitungBelanja, type HasilBelanja } from '../data/belanja'
import { daftarFryer, statusFryer } from '../data/fryer'
import type { JadwalFryer } from '../domain/fryer'
import { formatRupiah } from '../domain/conversions'
import { uangSeharusnya } from '../domain/kas'
import { bulanDariTanggal, formatQty } from '../domain/laporan'
import { hariIniISO } from '../data/waktu'
import { Icon } from './Icons'
import { KasModal } from './KasModal'
import { StrukPanel } from './StrukPanel'

type Rentang = 'hari' | 'kemarin' | '7hari' | 'bulan'

const LABEL_RENTANG: Record<Rentang, string> = { hari: 'Hari ini', kemarin: 'Kemarin', '7hari': '7 hari', bulan: 'Bulan ini' }
const WARN_AMBANG_STOK = 5

const WARNA_METODE: Record<MetodeBayar, string> = { tunai: '#dc2626', qris: '#7c3aed', transfer: '#2563eb', online: '#9aa3ad' }
const WARNA_SUMBER: Record<SumberPesanan, string> = {
  takeaway: '#3f4854',
  dinein: '#b45309',
  gofood: '#16a34a',
  grabfood: '#0e9f8f',
  shopee: '#ee4d2d',
}

interface HariSeri {
  tanggal: string
  l: Laporan
}

/** Gabungkan laporan beberapa hari (KPI periode, tanpa menghitung ulang DB). */
function gabungSeri(l: Laporan[]): Laporan {
  const out: Laporan = {
    label: '7 hari terakhir',
    nTransaksi: 0,
    qty: 0,
    omzet: 0,
    rataTransaksi: 0,
    perMetode: { tunai: 0, qris: 0, transfer: 0, online: 0 },
    perSumber: { takeaway: 0, dinein: 0, gofood: 0, grabfood: 0, shopee: 0 },
    produk: [],
    tanpaHpp: [],
    hppTotal: 0,
    labaKotor: 0,
    pengeluaran: [],
    totalPengeluaran: 0,
    labaBersih: 0,
    kas: [],
    setoranTotal: 0,
    selisihTotal: 0,
  }
  const by = new Map<number, BarisProdukLaporan>()
  for (const d of l) {
    out.nTransaksi += d.nTransaksi
    out.qty += d.qty
    out.omzet += d.omzet
    for (const k of Object.keys(out.perMetode) as MetodeBayar[]) out.perMetode[k] += d.perMetode[k]
    for (const k of Object.keys(out.perSumber) as SumberPesanan[]) out.perSumber[k] += d.perSumber[k]
    for (const p of d.produk) {
      const ada = by.get(p.produkId)
      if (ada) {
        ada.qty += p.qty
        ada.omzet += p.omzet
        ada.hpp += p.hpp
      } else by.set(p.produkId, { ...p })
    }
    for (const n of d.tanpaHpp) if (!out.tanpaHpp.includes(n)) out.tanpaHpp.push(n)
    out.hppTotal += d.hppTotal
    out.labaKotor += d.labaKotor
    out.pengeluaran.push(...d.pengeluaran)
    out.totalPengeluaran += d.totalPengeluaran
    out.labaBersih += d.labaBersih
    out.kas.push(...d.kas)
    out.setoranTotal += d.setoranTotal
    out.selisihTotal += d.selisihTotal
  }
  out.produk = [...by.values()]
    .map((p) => ({ ...p, laba: p.omzet - p.hpp }))
    .sort((a, b) => b.qty - a.qty || b.omzet - a.omzet)
  out.rataTransaksi = out.nTransaksi ? out.omzet / out.nTransaksi : 0
  return out
}

function tanggalHariIni(): string {
  return hariIniISO()
}

function labelTanggal(tanggal: string): string {
  const d = new Date(`${tanggal}T12:00:00`)
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })
}

function fmtRingkas(n: number): string {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} jt`
  if (n >= 1_000) return `Rp ${(n / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`
  return `Rp ${n}`
}

function fmtKecil(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} jt`
  if (n >= 1_000) return `${(n / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`
  return String(Math.round(n))
}

function fmtSigned(v: number): string {
  return v < 0 ? '-' + formatRupiah(-v) : formatRupiah(v)
}

export function DashboardPage() {
  const [rentang, setRentang] = useState<Rentang>('hari')
  const [seri, setSeri] = useState<HariSeri[] | null>(null)
  const [bulan, setBulan] = useState<Laporan | null>(null)
  const [transaksi, setTransaksi] = useState<BarisTransaksi[]>([])
  const [tglPilih, setTglPilih] = useState<string | null>(null)
  const [bukaStruk, setBukaStruk] = useState<number | null>(null)
  const [rel, setRel] = useState(0)
  const [memuat, setMemuat] = useState(true)

  // operasional: fryer, stok menipis, estimasi belanja
  const [fryerViews, setFryerViews] = useState<{ fryer: Fryer; status: JadwalFryer }[]>([])
  const [stokMenipis, setStokMenipis] = useState<{ id: number; nama: string; sisa: number; kategori: string }[]>([])
  const [belanjaAlert, setBelanjaAlert] = useState<string[]>([])
  const [stokJual, setStokJual] = useState<Map<number, number>>(new Map())

  // kas
  const [kasDialog, setKasDialog] = useState<'buka' | 'kelola' | null>(null)
  const [kasRinci, setKasRinci] = useState<{ bukaWaktu: string; floatTarget: number; rinci: RingkasanSesi; nomor: number; nama?: string } | null>(null)
  const [kasTutup, setKasTutup] = useState(false)

  const hariIni = tanggalHariIni()

  useEffect(() => {
    void (async () => {
      setMemuat(true)
      const hari = new Date(`${hariIni}T12:00:00`)
      const daftar: HariSeri[] = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date(hari)
        d.setDate(hari.getDate() - i)
        const tgl = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        daftar.push({ tanggal: tgl, l: await laporanHarian(tgl) })
      }
      const [bln, tx, belanja, produkAll, sesi] = await Promise.all([
        laporanBulanan(bulanDariTanggal(hariIni)),
        daftarTransaksi(60),
        hitungBelanja({ targetHari: 3, riwayatHari: 7 }),
        db.produk.toArray(),
        getSesiAktif(),
      ])
      setSeri(daftar)
      setBulan(bln)
      setTransaksi(tx)
      const fs = (await daftarFryer()).filter((x) => x.aktif)
      const fv: { fryer: Fryer; status: JadwalFryer }[] = []
      for (const f of fs) fv.push({ fryer: f, status: await statusFryer(f) })
      setFryerViews(fv)

      const menipis = produkAll
        .filter((p) => p.aktif && (p.stok ?? 0) > 0 && (p.stok ?? 0) <= WARN_AMBANG_STOK)
        .sort((a, b) => (a.stok ?? 0) - (b.stok ?? 0))
        .slice(0, 3)
        .map((p) => ({ id: p.id as number, nama: p.nama, sisa: p.stok ?? 0, kategori: p.kategori }))
      setStokMenipis(menipis)
      setStokJual(new Map(produkAll.map((p) => [p.id as number, p.stok ?? 0])))

      const alertBelanja = susunAlertBelanja(belanja)
      setBelanjaAlert(alertBelanja)

      if (sesi) {
        const r = await ringkasanSesi(sesi.id as number)
        if (r) {
          const nomor = await nomorShiftSesi(sesi)
          setKasRinci({ bukaWaktu: sesi.bukaWaktu, floatTarget: sesi.floatTarget, rinci: r, nomor, nama: sesi.catatan })
        } else {
          setKasRinci(null)
        }
      } else {
        setKasRinci(null)
      }
      setKasTutup(!sesi)
      setMemuat(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rel])

  const laporan = useMemo<Laporan | null>(() => {
    if (!seri) return null
    if (rentang === 'hari') return seri[6]?.l ?? null
    if (rentang === 'kemarin') return seri[5]?.l ?? null
    if (rentang === '7hari') return gabungSeri(seri.map((s) => s.l))
    return bulan
  }, [seri, bulan, rentang])

  const labelAktif = rentang === 'hari' ? 'hari ini' : rentang === 'kemarin' ? 'kemarin' : rentang === '7hari' ? '7 hari terakhir' : 'bulan ini'
  const pembanding = useMemo(() => {
    if (!seri || (rentang !== 'hari' && rentang !== 'kemarin')) return null
    const idx = rentang === 'hari' ? 6 : 5
    const sebelum = seri[idx - 1]?.l.omzet ?? 0
    const sekarang = seri[idx]?.l.omzet ?? 0
    if (!sebelum) return null
    const selisih = ((sekarang - sebelum) / sebelum) * 100
    const vs = rentang === 'hari' ? 'vs kemarin' : 'vs 2 hari lalu'
    return { pct: selisih, teks: `${selisih >= 0 ? 'naik' : 'turun'} ${Math.abs(selisih).toFixed(0)}% ${vs}` }
  }, [seri, rentang])

  const maxOmzetHari = useMemo(() => Math.max(1, ...(seri ?? []).map((s) => s.l.omzet)), [seri])
  const omzetMetodeLangsung = laporan
    ? laporan.perMetode.tunai + laporan.perMetode.qris + laporan.perMetode.transfer
    : 0
  // Donat metode hanya menghitung bayar langsung (Tunai/QRIS/Transfer) — pesanan
  // online dibayar platform & tidak tercatat sebagai metode kasir.
  const ringDonut = useMemo(() => {
    if (!laporan) return null
    const total = laporan.perMetode.tunai + laporan.perMetode.qris + laporan.perMetode.transfer
    const urut: MetodeBayar[] = ['tunai', 'qris', 'transfer']
    let akum = 0
    const segmen: string[] = []
    for (const m of urut) {
      const v = laporan.perMetode[m]
      if (v <= 0) continue
      const dari = total ? (akum / total) * 360 : 0
      akum += v
      const sampai = total ? (akum / total) * 360 : 360
      segmen.push(`${WARNA_METODE[m]} ${dari} ${sampai}`)
    }
    return { total, segmen }
  }, [laporan])

  const transaksiHari = useMemo(() => {
    if (!tglPilih) return transaksi.slice(0, 8)
    return transaksi.filter((t) => t.header.waktu.slice(0, 10) === tglPilih).slice(0, 8)
  }, [transaksi, tglPilih])

  const topProduk = useMemo(() => (laporan ? laporan.produk.slice(0, 5) : []), [laporan])
  const maxOmzetProduk = Math.max(1, ...topProduk.map((p) => p.omzet))

  // checklist operasional — status dari data nyata
  const dueFryer = fryerViews.filter((v) => v.status.dueGanti || v.status.dueTopUp)
  const sehatFryer = fryerViews.filter((v) => !v.status.dueGanti && !v.status.dueTopUp)
  const minSisaTopUp = sehatFryer.length ? Math.min(...sehatFryer.map((v) => v.status.sisaTopUp)) : null
  const minSisaHari = sehatFryer.length ? Math.min(...sehatFryer.map((v) => v.status.sisaHariGanti)) : null

  if (!laporan) {
    return <main className="db"><p className="muted">Menyiapkan dashboard…</p></main>
  }

  const pemakaian = (Object.keys(laporan.perSumber) as SumberPesanan[]).reduce((s, k) => s + laporan.perSumber[k], 0)
  const kosong = laporan.omzet === 0

  return (
    <main className="db">
      <div className="db-head">
        <div>
          <h2 style={{ margin: 0 }}>Dashboard</h2>
          <p className="db-sub">
            {new Date(`${hariIni}T12:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {kasRinci
              ? ` · shift #${kasRinci.nomor} mulai ${kasRinci.bukaWaktu.slice(11, 16)}${kasRinci.nama ? ` — ${kasRinci.nama}` : ''}`
              : kasTutup
                ? ' · belum ada shift aktif'
                : ''}
          </p>
        </div>
        <div className="db-range" role="radiogroup" aria-label="Rentang laporan">
          {(Object.keys(LABEL_RENTANG) as Rentang[]).map((r) => (
            <button key={r} role="radio" aria-checked={rentang === r} className={rentang === r ? 'on' : ''} onClick={() => setRentang(r)}>
              {LABEL_RENTANG[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="db-kpis">
        <div className="db-kpi hero">
          <div className="l"><span>Omzet {labelAktif}</span></div>
          <div className="v">{formatRupiah(laporan.omzet)}</div>
          <div className="d">{kosong ? 'Belum ada penjualan' : pembanding ? (pembanding.pct >= 0 ? '▲ ' : '▼ ') + pembanding.teks : `${laporan.nTransaksi} transaksi`}</div>
        </div>
        <div className="db-kpi">
          <div className="l"><span>Transaksi</span></div>
          <div className="v">{laporan.nTransaksi}</div>
          <div className="d">{formatQty(laporan.qty)} item terjual</div>
        </div>
        <div className="db-kpi">
          <div className="l"><span>Rata-rata / nota</span></div>
          <div className="v">{formatRupiah(laporan.rataTransaksi)}</div>
          <div className="d">total / jumlah nota</div>
        </div>
        <div className="db-kpi">
          <div className="l"><span>Laba bersih {labelAktif}</span></div>
          <div className="v" style={{ color: laporan.labaBersih < 0 ? 'var(--danger)' : undefined }}>{fmtSigned(laporan.labaBersih)}</div>
          <div className="d">omzet − HPP − pengeluaran</div>
        </div>
      </div>

      <div className="chk-grid">
        <div className="chk-cell">
          <div className="chk-top">
            <span className={`chk-ic ${kasRinci ? 'ok' : 'warn'}`}><Icon name="kas" size={15} /></span>
            <div className="chk-t">
              <b>Mulai shift</b>
              <span>
                {kasRinci
                  ? `shift #${kasRinci.nomor} mulai ${kasRinci.bukaWaktu.slice(11, 16)}${kasRinci.nama ? ` — ${kasRinci.nama}` : ''}`
                  : 'belum mulai — transaksi tunai/QRIS menunggu'}
              </span>
            </div>
            <span className={`pstat ${kasRinci ? 'on' : 'low'}`}>{kasRinci ? '● Siap' : '● Aksi'}</span>
          </div>
          <div className="chk-act">
            {kasRinci ? (
              <button type="button" className="pab" onClick={() => setKasDialog('kelola')}>Kelola shift</button>
            ) : (
              <button type="button" className="pab ink" onClick={() => setKasDialog('buka')}>Mulai Shift</button>
            )}
          </div>
        </div>

        <div className="chk-cell">
          <div className="chk-top">
            <span className={`chk-ic ${dueFryer.length ? 'bad' : fryerViews.length ? 'ok' : 'off'}`}><Icon name="produksi" size={15} /></span>
            <div className="chk-t">
              <b>Deep fryer</b>
              <span>
                {fryerViews.length === 0
                  ? 'belum ada fryer terdaftar'
                  : dueFryer.length
                    ? `${dueFryer.slice(0, 2).map((v) => v.fryer.nama).join(', ')} — ${dueFryer.some((v) => v.status.dueGanti) ? 'ganti minyak' : 'top-up minyak'}`
                    : `${fryerViews.length} fryer sehat · top-up ${minSisaTopUp} ekor · ganti ${minSisaHari} hr`}
              </span>
            </div>
            <span className={`pstat ${dueFryer.length ? 'hab' : fryerViews.length ? 'on' : 'na'}`}>
              {dueFryer.length ? '● Aksi' : fryerViews.length ? '● Aman' : '● Kosong'}
            </span>
          </div>
          <div className="chk-act">
            {fryerViews.length === 0 ? (
              <Link to="/fryer" style={{ textDecoration: 'none' }}><button type="button" className="pab">Daftarkan fryer</button></Link>
            ) : dueFryer.length ? (
              <Link to="/produksi" style={{ textDecoration: 'none' }}><button type="button" className="pab ink">Cek meter →</button></Link>
            ) : (
              <Link to="/produksi" style={{ textDecoration: 'none' }}><button type="button" className="pab">Lihat meter</button></Link>
            )}
          </div>
        </div>

        <div className="chk-cell">
          <div className="chk-top">
            <span className={`chk-ic ${stokMenipis.length ? 'warn' : 'ok'}`}><Icon name="produk" size={15} /></span>
            <div className="chk-t">
              <b>Stok produk jadi</b>
              <span>
                {stokMenipis.length
                  ? `${stokMenipis.length} produk sisa ≤ ${WARN_AMBANG_STOK}: ${stokMenipis.slice(0, 2).map((s) => s.nama).join(', ')}`
                  : 'semua produk di atas ambang menipis'}
              </span>
            </div>
            <span className={`pstat ${stokMenipis.length ? 'low' : 'on'}`}>{stokMenipis.length ? '● Cek' : '● Aman'}</span>
          </div>
          <div className="chk-act">
            {stokMenipis.length ? (
              <Link to={`/produk?q=${encodeURIComponent(stokMenipis[0].nama)}`} style={{ textDecoration: 'none' }}><button type="button" className="pab">Lihat produk →</button></Link>
            ) : (
              <Link to="/produk" style={{ textDecoration: 'none' }}><button type="button" className="pab">Buka Produk & Menu</button></Link>
            )}
          </div>
        </div>
      </div>

      {kosong && !memuat && (
        <div className="db-empty panel">
          <p className="muted" style={{ margin: 0 }}>
            Belum ada penjualan {rentang === 'kemarin' ? 'kemarin' : `pada ${labelAktif}`}. Mulai dari <Link to="/kasir"><b>Kasir</b></Link> — angka, grafik, dan laba mengisi otomatis di sini.
          </p>
        </div>
      )}

      <div className="db-grid a">
        <section className="db-card">
          <div className="db-ct"><span>Omzet 7 hari terakhir</span><span className="go">{fmtRingkas(seri?.[6]?.l.omzet ?? 0)} hari ini</span></div>
          {seri ? (
            <div className="db-bars" role="group" aria-label="Omzet 7 hari terakhir">
              {seri.map((s, i) => {
                const pct = s.l.omzet > 0 ? Math.max(3, (s.l.omzet / maxOmzetHari) * 100) : 0
                return (
                  <button
                    type="button"
                    key={s.tanggal}
                    className={`db-bcol${i === 6 ? ' today' : ''}`}
                    aria-label={`${labelTanggal(s.tanggal)}: omzet ${formatRupiah(s.l.omzet)} — tampilkan transaksi hari itu`}
                    aria-pressed={tglPilih === s.tanggal}
                    onClick={() => setTglPilih(tglPilih === s.tanggal ? null : s.tanggal)}
                  >
                    <span className="amt">{fmtKecil(s.l.omzet)}</span>
                    <span className="bar" style={{ height: `${pct}%` }} />
                    <span className="lab">{i === 6 ? 'Hari ini' : labelTanggal(s.tanggal)}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="muted">Menghitung…</p>
          )}
        </section>

        <section className="db-card">
          <div className="db-ct"><span>Metode bayar</span><span className="go">{kosong ? '' : `${Math.round((omzetMetodeLangsung / Math.max(1, laporan.omzet)) * 100)}% ${laporan.perMetode.online > 0 ? 'langsung' : 'tercatat'}`}</span></div>
          {ringDonut && (
            <div className="db-donutwrap">
              <div className="db-donut" role="img" aria-label={`Metode bayar ${labelAktif}`} style={{ background: ringDonut.total > 0 ? `conic-gradient(${ringDonut.segmen.join(',')})` : 'var(--soft)' }}>
                <div className="mid"><span>omzet</span><b>{fmtRingkas(ringDonut.total)}</b><span>{labelAktif}</span></div>
              </div>
              <div className="db-legend">
                {URUTAN_METODE.map((m) => (
                  <div className="li" key={m}>
                    <span className="sw" style={{ background: WARNA_METODE[m], opacity: laporan.perMetode[m] > 0 ? 1 : 0.3 }} />
                    <span className="nm">{LABEL_METODE[m]}</span>
                    <span className="va">{laporan.perMetode[m] > 0 ? formatRupiah(laporan.perMetode[m]) : '—'}</span>
                    <span className="pc">{omzetMetodeLangsung > 0 && laporan.perMetode[m] > 0 ? `${Math.round((laporan.perMetode[m] / omzetMetodeLangsung) * 100)}%` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="db-grid b">
        <section className="db-card">
          <div className="db-ct"><span>Sumber pesanan</span>{pemakaian > 0 && <span className="go">{kosong ? '' : `${Math.round((pemakaian / laporan.omzet) * 100)}%`} dari omzet</span>}</div>
          <div className="db-legend">
            {(Object.keys(WARNA_SUMBER) as SumberPesanan[]).map((s) => (
              <div className="li" key={s}>
                <span className="sw" style={{ background: WARNA_SUMBER[s], opacity: laporan.perSumber[s] > 0 ? 1 : 0.3 }} />
                <span className="nm">{labelSumber(s)}</span>
                <span className="va">{laporan.perSumber[s] > 0 ? formatRupiah(laporan.perSumber[s]) : '—'}</span>
                <span className="pc">{laporan.omzet > 0 && laporan.perSumber[s] > 0 ? `${Math.round((laporan.perSumber[s] / laporan.omzet) * 100)}%` : ''}</span>
              </div>
            ))}
          </div>
          <p className="db-note">Omzet online belum dikurangi komisi platform — estimasi pendapatan.</p>
        </section>

        <section className="db-card">
          <div className="db-ct"><span>Produk terlaris</span><span className="go">{topProduk.length} menu</span></div>
          {topProduk.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>Belum ada produk terjual pada periode ini.</p>
          ) : (
            <div className="db-tp">
              {topProduk.map((p, i) => {
                const sisa = stokJual.get(p.produkId)
                return (
                  <div className="row2" key={p.produkId}>
                    <span className="rank">{i + 1}</span>
                    <div className="info">
                      <b>{p.nama}</b>
                      <span>{formatQty(p.qty)} terjual{sisa != null ? ` · sisa ${sisa}` : ''}</span>
                    </div>
                    <div className="bar2"><i style={{ width: `${(p.omzet / maxOmzetProduk) * 100}%` }} /></div>
                    <span className="va2">{fmtRingkas(p.omzet)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="db-card">
          <div className="db-ct"><span>Shift kas{kasRinci ? ` #${kasRinci.nomor}` : ''}</span></div>
          {kasRinci ? (
            <>
              <div className="db-kas">
                <div className="g1"><Icon name="kas" size={22} /></div>
                <div className="g2">
                  <span className="stat on">● Aktif · mulai {kasRinci.bukaWaktu.slice(11, 16)}</span>
                  <b>Uang di laci {formatRupiah(uangSeharusnya(kasRinci.rinci.ledger))}</b>
                  <div className="row3">
                    <span>float {formatRupiah(kasRinci.floatTarget)}</span>
                    <span>kas keluar {formatRupiah(kasRinci.rinci.ledger.keluar)}</span>
                  </div>
                </div>
                <button className="btn" onClick={() => setKasDialog('kelola')}>Kelola / Akhiri</button>
              </div>
              <div className="db-kasmini">
                <div className="m"><span>Omzet tunai</span><b>{formatRupiah(kasRinci.rinci.ledger.jualTunai)}</b></div>
                <div className="m"><span>Kas keluar (petty)</span><b style={{ color: 'var(--danger)' }}>−{formatRupiah(kasRinci.rinci.ledger.keluar)}</b></div>
                <div className="m"><span>Seharusnya di laci</span><b>{formatRupiah(uangSeharusnya(kasRinci.rinci.ledger))}</b></div>
              </div>
            </>
          ) : (
            <>
              <div className="db-kas">
                <div className="g1"><Icon name="kas" size={22} /></div>
                <div className="g2">
                  <span className="stat off">Belum ada shift</span>
                  <b>Shift belum dimulai</b>
                  <div className="row3">penjualan tunai baru bisa dicatat setelah shift dimulai</div>
                </div>
                <button className="btn" onClick={() => setKasDialog('buka')}>Mulai Shift</button>
              </div>
              <div className="db-kasmini">
                <div className="m"><span>Float default</span><b>Rp 350.000</b></div>
                <div className="m"><span>Omzet tunai</span><b>Rp 0</b></div>
                <div className="m"><span>Seharusnya di laci</span><b>Rp 0</b></div>
              </div>
            </>
          )}
        </section>
      </div>

      <div className="db-grid c">
        <div className="db-col">
        <section className="db-card db-fryer">
          <div className="db-ct">
            <span>Deep fryer · meter minyak</span>
            <span className="go">
              <Link to="/fryer" style={{ color: 'var(--muted)', marginRight: 10, fontWeight: 700 }}>Kelola</Link>
              <Link to="/produksi">Catat produksi →</Link>
            </span>
          </div>
          {fryerViews.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              Belum ada deep fryer terdaftar —{' '}
              <Link to="/fryer" className="go">daftarkan dulu →</Link> lalu pilih saat catat produksi ayam.
            </p>
          ) : (
            <div className="fryer-minis">
              {fryerViews.map(({ fryer: f, status: st }) => {
                const pct = Math.min(100, Math.round((st.ekorSejakTopUp / Math.max(1, f.topUpPak)) * 100))
                const meterCls = st.dueGanti || st.dueTopUp ? 'bad' : pct >= 80 ? 'warn' : ''
                const sub = st.dueGanti
                  ? `wajib ganti — sudah ${st.hariSejakGanti} hari`
                  : st.dueTopUp
                    ? `wajib top-up — sudah ${st.ekorSejakTopUp} ekor`
                    : `top-up dalam ${st.sisaTopUp} ekor · ganti ${st.sisaHariGanti} hari`
                return (
                  <Link
                    key={f.id}
                    to="/produksi"
                    className={`fmini${st.dueGanti || st.dueTopUp ? ' due' : ''}`}
                    title="Cek meter & catat produksi di halaman Produksi"
                  >
                    <div className="fm-top">
                      <b>{f.nama}</b>
                      <span className={`pstat ${st.dueGanti ? 'hab' : st.dueTopUp ? 'low' : 'on'}`}>
                        {st.dueGanti ? '● Ganti' : st.dueTopUp ? '● Top-up' : '● Sehat'}
                      </span>
                    </div>
                    <div className={`fm-sub${st.dueGanti ? ' bad' : st.dueTopUp ? ' warn' : ''}`}>{sub}</div>
                    <div className="meter">
                      <i className={meterCls} style={{ width: `${st.dueGanti ? 100 : pct}%` }} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        <section className="db-card">
          <div className="db-ct"><span>Aksi cepat</span></div>
          <div className="db-acts">
            <Link className="act on" to="/kasir"><span className="ai"><Icon name="kasir" size={17} /></span>Buka Kasir</Link>
            <Link className="act" to="/beli"><span className="ai"><Icon name="beli" size={17} /></span>Beli Bahan</Link>
            <Link className="act" to="/produksi"><span className="ai"><Icon name="produksi" size={17} /></span>Produksi</Link>
            <Link className="act" to="/belanja"><span className="ai"><Icon name="belanja" size={17} /></span>List Belanja</Link>
          </div>
          {belanjaAlert.length > 0 && (
            <>
              <div className="db-ct" style={{ marginTop: 12 }}><span>Perlu perhatian</span></div>
              <div className="db-alerts">
                <div className="al">
                  <b>Belanja:</b> {belanjaAlert.join(' · ')} <Link className="go" to="/belanja">Buat list →</Link>
                </div>
              </div>
            </>
          )}
        </section>
        </div>

        <section className="db-card">
          <div className="db-ct">
            <span>{tglPilih ? `Transaksi · ${labelTanggal(tglPilih)}` : 'Transaksi terbaru'}</span>
            <span className="go">
              {tglPilih ? (
                <button type="button" className="db-clear" onClick={() => setTglPilih(null)}>Semua →</button>
              ) : (
                <Link to="/transaksi">Semua →</Link>
              )}
            </span>
          </div>
          {transaksiHari.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{tglPilih ? 'Tidak ada transaksi hari itu.' : 'Belum ada transaksi hari ini.'}</p>
          ) : (
            <div className="db-trlist">
              {transaksiHari.map(({ header: h, items }) => (
                <div key={h.id}>
                  <div className="db-tr">
                    <span className="w">{h.waktu.slice(11, 16)}</span>
                    <span className="no">#{h.id}</span>
                    <span className="it2" title={items.map((i) => `${i.nama} ×${i.qty}`).join(', ')}>
                      {items.map((i) => `${i.nama} ×${i.qty}`).join(', ')}
                    </span>
                    <span className={`tag ${h.metode}`}>{LABEL_METODE[h.metode]}</span>
                    <span className="src">{labelSumber(h.sumber)}</span>
                    <span className="tot">{formatRupiah(h.total)}</span>
                    <button
                      type="button"
                      className="rp"
                      aria-label={`Struk transaksi #${h.id}`}
                      aria-expanded={bukaStruk === h.id}
                      onClick={() => setBukaStruk(bukaStruk === h.id ? null : (h.id as number))}
                    >
                      <Icon name="produk" size={15} />
                    </button>
                  </div>
                  {bukaStruk === h.id && (
                    <div style={{ maxWidth: 420, margin: '4px 0 10px' }}>
                      <StrukPanel header={h} items={items} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="db-card">
        <div className="db-ct"><span>Laba {labelAktif} (Rp)</span><span className="go">{kosong ? '' : `margin ${((laporan.labaKotor / laporan.omzet) * 100).toFixed(0)}%`}</span></div>
        <div className="db-labastrip">
          <div className="m"><span>Omzet</span><b>{formatRupiah(laporan.omzet)}</b></div>
          <div className="m"><span>HPP produk terjual</span><b style={{ color: 'var(--danger)' }}>−{formatRupiah(laporan.hppTotal)}</b></div>
          <div className="m"><span>Pengeluaran operasional</span><b style={{ color: 'var(--danger)' }}>−{formatRupiah(laporan.totalPengeluaran)}</b></div>
          <div className="m laba"><span>Laba bersih</span><b style={{ color: laporan.labaBersih < 0 ? 'var(--danger)' : 'var(--ok)' }}>{fmtSigned(laporan.labaBersih)}</b></div>
        </div>
        {laporan.tanpaHpp.length > 0 && (
          <p className="db-note" style={{ marginTop: 10, color: 'var(--warn)' }}>
            {laporan.tanpaHpp.length} produk tanpa dasar biaya (resep belum diisi): {laporan.tanpaHpp.slice(0, 3).join(', ')}
            {laporan.tanpaHpp.length > 3 ? ` +${laporan.tanpaHpp.length - 3} lainnya` : ''} — HPP dihitung Rp 0, isi resep di Produk & Menu agar laba akurat.
          </p>
        )}
      </section>

      <KasModal
        buka={kasDialog}
        batalLabel="Nanti dulu"
        onKasBerubah={(aktif) => {
          setKasTutup(!aktif)
          if (!aktif) setKasRinci(null)
          setRel((r) => r + 1)
        }}
        onTutup={() => setKasDialog(null)}
      />
    </main>
  )
}

function susunAlertBelanja(h: HasilBelanja | null): string[] {
  if (!h) return []
  return h.baris
    .filter((b) => !b.cukup && b.estHari != null && b.beli > 0)
    .sort((a, b) => (a.estHari ?? 999) - (b.estHari ?? 999))
    .slice(0, 3)
    .map((b) => {
      const est = b.estHari ?? 999
      return `${b.nama} ${est <= 0.01 ? 'sudah habis' : `habis ±${Math.max(1, Math.ceil(est))} hari`}`
    })
}
