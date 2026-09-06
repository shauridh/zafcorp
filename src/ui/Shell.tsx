import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { liveQuery } from 'dexie'
import { ensureSeedLoaded } from '../data/seed'
import { getSesiAktif, nomorShiftSesi, ringkasanSesi } from '../data/kas'
import { uangSeharusnya } from '../domain/kas'
import { formatRupiah } from '../domain/conversions'
import { berlanggananSistem, muatTemaAktif, simpanTema, type ModeTampil } from '../data/tema'
import { cekDanKirimNotifFryer, notifFryerDiaktifkan } from '../data/notifikasi'
import { cekDanKirimNotifCadangan } from '../data/cadanganNotif'
import { berlanggananZona, zonaPemilikTerbuka } from '../data/keamanan'
import { db } from '../data/db'
import { Icon, type IconName } from './Icons'
import { PemilikGate } from './PinGate'

/** Halaman yang hanya boleh dibuka pemilik (saat PIN aktif). */
const ZONA_PEMILIK = ['/pengaturan', '/finansial', '/shift', '/bahan', '/produk']

const seedPromise = ensureSeedLoaded()

function SeedGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'memuat' | 'siap' | 'gagal'>('memuat')
  useEffect(() => {
    seedPromise
      .then(() => setState('siap'))
      .catch((e) => {
        console.error('gagal memuat seed:', e)
        setState('gagal')
      })
  }, [])
  if (state === 'memuat') return <div className="screen-center">Menyiapkan data awal…</div>
  if (state === 'gagal')
    return (
      <div className="screen-center">
        <p className="error">Gagal membuka database.</p>
        <button onClick={() => location.reload()}>Muat ulang</button>
      </div>
    )
  return <>{children}</>
}

interface NavItem {
  to: string
  label: string
  icon: IconName
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Harian',
    items: [
      { to: '/', label: 'Dashboard', icon: 'beranda' },
      { to: '/kasir', label: 'Kasir', icon: 'kasir' },
    ],
  },
  {
    label: 'Operasi',
    items: [
      { to: '/beli', label: 'Beli Bahan', icon: 'beli' },
      { to: '/produksi', label: 'Produksi', icon: 'produksi' },
      { to: '/fryer', label: 'Deep Fryer', icon: 'fryer' },
      { to: '/belanja', label: 'List Belanja', icon: 'belanja' },
      { to: '/bahan', label: 'Bahan & Stok', icon: 'bahan' },
      { to: '/produk', label: 'Produk & Menu', icon: 'produk' },
      { to: '/papan-antar', label: 'Pesanan Antar', icon: 'beli' },
      { to: '/mutasi', label: 'Riwayat Stok', icon: 'mutasi' },
    ],
  },
  {
    label: 'Keuangan',
    items: [
      { to: '/finansial', label: 'Finansial', icon: 'penjualan' },
      { to: '/shift', label: 'Riwayat Shift', icon: 'kas' },
    ],
  },
  {
    label: 'Pengaturan',
    items: [{ to: '/pengaturan', label: 'Pengaturan', icon: 'pengaturan' }],
  },
]

const BOTTOM_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'beranda' },
  { to: '/kasir', label: 'Kasir', icon: 'kasir' },
]

interface KasPill {
  buka: boolean
  uang: number
  bukaWaktu: string
  nomor: number
  nama?: string
}

export function Shell() {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const [open, setOpen] = useState(isDesktop)
  const [mode, setMode] = useState<ModeTampil>('terang')
  const [kasPill, setKasPill] = useState<KasPill | null>(null)
  const [pinAda, setPinAda] = useState(false)
  const [zona, setZona] = useState(() => zonaPemilikTerbuka())
  const location = useLocation()

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches)
      if (!e.matches) setOpen(false)
    }
    setIsDesktop(mq.matches)
    setOpen(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // terapkan tema tersimpan (auto/terang/gelap) sejak awal
  useEffect(() => {
    void muatTemaAktif().then(setMode)
    return berlanggananSistem(setMode)
  }, [])

  // pengingat (deep fryer + cadangan data) — jalan di semua layar & tab background;
  // masing-masing punya anti-spam internal dan toggle-nya sendiri.
  useEffect(() => {
    if (typeof Notification === 'undefined') return
    const cek = () => {
      if (notifFryerDiaktifkan()) void cekDanKirimNotifFryer().catch((e) => console.error('gagal kirim notifikasi fryer:', e))
      void cekDanKirimNotifCadangan().catch((e) => console.error('gagal kirim notifikasi cadangan:', e))
    }
    cek()
    const iv = window.setInterval(cek, 60_000)
    return () => window.clearInterval(iv)
  }, [])

  // gerbang zona pemilik: PIN aktif? sesi pemilik terbuka?
  useEffect(() => {
    const sub = liveQuery(async () => (await db.meta.get('pin-owner')) != null).subscribe({
      next: (v) => setPinAda(v),
      error: () => setPinAda(false),
    })
    return () => sub.unsubscribe()
  }, [])
  useEffect(() => berlanggananZona(() => setZona(zonaPemilikTerbuka())), [])

  // pill status shift kas di topbar — sinkron otomatis setiap sesi/laci berubah
  useEffect(() => {
    const sub = liveQuery(async () => {
      const sesi = await getSesiAktif()
      if (!sesi) return null
      const r = sesi.id != null ? await ringkasanSesi(sesi.id) : undefined
      const nomor = sesi.id != null ? await nomorShiftSesi(sesi) : 1
      return { bukaWaktu: sesi.bukaWaktu, uang: r ? uangSeharusnya(r.ledger) : sesi.saldoAwal, nomor, nama: sesi.catatan }
    }).subscribe({
      next: (v) =>
        setKasPill(v ? { buka: true, uang: v.uang, bukaWaktu: v.bukaWaktu, nomor: v.nomor, nama: v.nama } : null),
      error: (e) => console.error('gagal memantau status shift kas di topbar:', e),
    })
    return () => sub.unsubscribe()
  }, [])

  async function gantiTema() {
    const tujuan: 'terang' | 'gelap' = mode === 'gelap' ? 'terang' : 'gelap'
    setMode(await simpanTema(tujuan))
  }

  // tutup drawer saat berpindah halaman (mobile); desktop biarkan pilihan pengguna
  useEffect(() => {
    if (!isDesktop) setOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Escape menutup drawer / sidebar
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])

  function toggleMenu() {
    setOpen((v) => !v)
  }

  const daftarMenu = (
    <nav className="side-nav" aria-label="Menu utama">
      {NAV_GROUPS.map((g) => (
        <div className="side-group" key={g.label}>
          <p className="side-label">{g.label}</p>
          {g.items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === '/'}
              aria-label={it.label}
              title={it.label}
              className={({ isActive }) => `side-item${isActive ? ' active' : ''}`}
            >
              <Icon name={it.icon} size={19} />
              <span>{it.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )

  return (
    <SeedGate>
      <div className="app">
        <a className="skip-link" href="#konten">Langsung ke konten</a>
        <header className="topbar">
          <div className="tb-left">
            <button
              className="menu-toggle"
              aria-expanded={open}
              aria-controls="menu-sidebar"
              aria-label={isDesktop ? (open ? 'Sempitkan menu (rail ikon)' : 'Lebarkan menu') : 'Buka menu'}
              title={isDesktop ? (open ? 'Sempitkan sidebar jadi ikon' : 'Lebarkan sidebar') : 'Buka menu'}
              onClick={toggleMenu}
            >
              <Icon name={open ? 'tutup' : 'menu'} size={20} />
            </button>
            <div className="brand">
              <span className="logo-mark" aria-hidden="true">S</span>
              <div>
                <h1>Kasir SABANA</h1>
                <p className="sub">Fried Chicken — data tersimpan di perangkat ini</p>
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            {kasPill && (
              <div
                className={`pill kas${kasPill.buka ? ' on' : ''}`}
                title={
                  kasPill.buka
                    ? `Shift #${kasPill.nomor} aktif sejak ${kasPill.bukaWaktu.slice(11, 16)}${kasPill.nama ? ` — ${kasPill.nama}` : ''} — uang di laci ${formatRupiah(kasPill.uang)}`
                    : 'Belum ada shift kas aktif'
                }
              >
                <span className="live" aria-hidden="true" />
                <span>Shift</span>
                <span className="amt">{kasPill.buka ? formatRupiah(kasPill.uang) : 'tutup'}</span>
              </div>
            )}
          </div>
        </header>

        <div className={`layout${open ? ' nav-open' : ''}`}>
          <aside id="menu-sidebar" className={`sidebar${open ? ' open' : ''}`}>
            {daftarMenu}
            <button
              type="button"
              className="side-theme"
              onClick={() => void gantiTema()}
              aria-label={mode === 'gelap' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
              title={mode === 'gelap' ? 'Mode gelap aktif — ketuk untuk terang' : 'Mode terang aktif — ketuk untuk gelap'}
            >
              <Icon name={mode === 'gelap' ? 'matahari' : 'bulan'} size={19} />
              <span>{mode === 'gelap' ? 'Mode terang' : 'Mode gelap'}</span>
            </button>
          </aside>
          {open && (
            <button type="button" className="backdrop" aria-label="Tutup menu" tabIndex={-1} onClick={() => setOpen(false)} />
          )}
          <div className="page" id="konten" tabIndex={-1}>
            {pinAda && !zona && ZONA_PEMILIK.some((p) => location.pathname === p || location.pathname.startsWith(p + '/')) ? (
              <PemilikGate tujuan={location.pathname} />
            ) : (
              <Outlet />
            )}
          </div>
        </div>

        <nav className="bottom-nav" aria-label="Menu cepat">
          {BOTTOM_NAV.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) => `bn-item${isActive ? ' active' : ''}`}
            >
              <Icon name={it.icon} size={22} />
              <span>{it.label}</span>
            </NavLink>
          ))}
          <button className={`bn-item${open ? ' active' : ''}`} onClick={toggleMenu} aria-expanded={open} aria-haspopup="dialog">
            <Icon name="menu" size={22} />
            <span>Menu</span>
          </button>
        </nav>
      </div>
    </SeedGate>
  )
}
