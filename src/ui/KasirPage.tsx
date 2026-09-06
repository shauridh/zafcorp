import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { db } from '../data/db'
import { getSesiAktif, nomorShiftSesi } from '../data/kas'
import { jualProduk,
  LABEL_METODE,
  labelSumber,
  rinciTransaksi,
  URUTAN_METODE,
  URUTAN_SUMBER,
  type BarisTransaksi,
} from '../data/sales'
import { barisStruk as susunBarisStruk } from '../domain/struk'
import { nowISO } from '../data/waktu'
import { getPengaturan, type Pengaturan } from '../data/pengaturan'
import { formatRupiah } from '../domain/conversions'
import { kembalian } from '../domain/kasir'
import type { MetodeBayar, ProdukMenu, SumberPesanan } from '../data/db'
import type { Kekurangan } from '../data/sales'
import { Icon } from './Icons'
import { KasModal } from './KasModal'
import { StrukPanel } from './StrukPanel'

interface CartLine {
  produkId: number
  qty: number
}

interface Receipt {
  id: number
  total: number
  kembalian: number
  metode: MetodeBayar
  sumber: SumberPesanan
}

export function KasirPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [produk, setProduk] = useState<ProdukMenu[]>([])
  const kat = params.get('kat') ?? 'Semua'
  const term = params.get('q') ?? ''
  const [cart, setCart] = useState<CartLine[]>([])
  const [reload, setReload] = useState(0)

  const [sumber, setSumber] = useState<SumberPesanan>('takeaway')
  const [metode, setMetode] = useState<MetodeBayar>('tunai')
  const [dibayar, setDibayar] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [err, setErr] = useState('')
  const [kekurangan, setKekurangan] = useState<Kekurangan[]>([])
  const [kasBuka, setKasBuka] = useState<boolean | null>(null)
  // sesi kas sungguhan (bukan asumsi metode non-tunai) — untuk tombol Kelola/Tutup
  const [sesiKas, setSesiKas] = useState(false)
  const [shiftNo, setShiftNo] = useState(0)
  const [sesiDimuat, setSesiDimuat] = useState(false)
  const [kasDialog, setKasDialog] = useState<'buka' | 'kelola' | null>(null)
  const pindahAuto = useRef(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [rinci, setRinci] = useState<BarisTransaksi | null>(null)
  const [checkout, setCheckout] = useState(false)
  // Nomor transaksi berikutnya (id auto-increment berikutnya) untuk pratinjau struk.
  const [noBerikut, setNoBerikut] = useState('—')
  const [pengaturan, setPengaturan] = useState<Pengaturan | null>(null)
  // Asal nominal terakhir: preset (chip) vs ketikan digit numpad — menekan angka
  // setelah preset harus MEMULAI angka baru, bukan menambah ke nilai preset.
  const asalNominal = useRef<'ketik' | 'preset'>('ketik')
  const [kolom, setKolom] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem('kasir.kolom'))
      return v === 3 || v === 4 || v === 5 || v === 6 ? v : 4
    } catch {
      return 4
    }
  })

  useEffect(() => {
    void (async () => {
      const all = await db.produk.toArray()
      setProduk(all.filter((p) => p.aktif).sort((a, b) => a.kategori.localeCompare(b.kategori) || a.nama.localeCompare(b.nama)))
    })()
  }, [reload])

  useEffect(() => {
    void getPengaturan().then(setPengaturan)
  }, [])

  // Saat checkout dibuka, cari id transaksi terbesar → nomor pratinjau struk = id + 1.
  useEffect(() => {
    if (!checkout || receipt) return
    let batal = false
    void (async () => {
      const terakhir = await db.transaksi.orderBy('id').last()
      const nomor = ((terakhir?.id as number | undefined) ?? 0) + 1
      if (!batal) setNoBerikut(String(nomor))
    })()
    return () => {
      batal = true
    }
  }, [checkout, receipt])

  useEffect(() => {
    if (metode !== 'tunai') {
      setKasBuka(true)
      return
    }
    void getSesiAktif().then((s) => setKasBuka(s != null))
  }, [metode, reload])

  // status sesi kas nyata, terlepas dari metode terpilih
  useEffect(() => {
    void getSesiAktif().then((s) => {
      setSesiKas(s != null)
      if (s) void nomorShiftSesi(s).then(setShiftNo)
      else setShiftNo(0)
      setSesiDimuat(true)
    })
  }, [reload])

  const kategori = useMemo(() => {
    const s = new Set(produk.map((p) => p.kategori))
    return ['Semua', ...[...s].sort()]
  }, [produk])

  const jmlPerKategori = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of produk) m.set(p.kategori, (m.get(p.kategori) ?? 0) + 1)
    return m
  }, [produk])

  const shown = useMemo(() => {
    const t = term.toLowerCase()
    return produk.filter(
      (p) => (kat === 'Semua' || p.kategori === kat) && (!t || p.nama.toLowerCase().includes(t)),
    )
  }, [produk, kat, term])

  const map = useMemo(() => new Map(produk.map((p) => [p.id as number, p])), [produk])

  /** Simpan filter kategori/pencarian ke URL (deep-link, tanpa menumpuk riwayat). */
  function aturParam(key: 'kat' | 'q', nilai: string) {
    const n = new URLSearchParams(params)
    if (nilai === '' || (key === 'kat' && nilai === 'Semua')) n.delete(key)
    else n.set(key, nilai)
    setParams(n, { replace: true })
  }

  function qtyDiKeranjang(pid: number): number {
    return cart.find((c) => c.produkId === pid)?.qty ?? 0
  }

  function tambah(pid: number) {
    const p = map.get(pid)
    if (!p) return
    const ada = qtyDiKeranjang(pid)
    if (ada >= (p.stok ?? 0)) return
    setCart((prev) => {
      const hit = prev.find((c) => c.produkId === pid)
      if (hit) return prev.map((c) => (c.produkId === pid ? { ...c, qty: c.qty + 1 } : c))
      return [...prev, { produkId: pid, qty: 1 }]
    })
  }

  function kurangi(pid: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.produkId === pid ? { ...c, qty: c.qty - 1 } : c))
        .filter((c) => c.qty > 0),
    )
  }

  function subtotal(): number {
    return cart.reduce((s, c) => s + (map.get(c.produkId)?.hargaJual ?? 0) * c.qty, 0)
  }

  const total = subtotal()
  const nItem = cart.reduce((s, c) => s + c.qty, 0)
  // Pesanan online dibayar lewat platform — tidak perlu pilih metode & tidak menyentuh laci.
  const sumberOnline = sumber === 'gofood' || sumber === 'grabfood' || sumber === 'shopee'
  const metodeKirim: MetodeBayar = sumberOnline ? 'online' : metode
  const tunaiAktif = metodeKirim === 'tunai'
  const kembalianPreview = kembalian(Number(dibayar) || 0, total)
  const dibayarKurang = tunaiAktif && kembalianPreview < 0
  const kasTerkunci = tunaiAktif && kasBuka === false

  // Preset nominal uang pas + denominasi umum
  const uangCepat = useMemo(() => {
    if (total <= 0) return []
    const preset: { label: string; value: number }[] = [{ label: 'Uang pas', value: total }]
    for (const n of [10000, 20000, 50000, 100000]) preset.push({ label: formatRupiah(n), value: n })
    return preset
  }, [total])

  // Baris struk pratinjau (sisi kiri checkout) — mengikuti isi keranjang & pilihan saat ini.
  const barisPratinjau = useMemo(() => {
    const items = cart
      .map((c) => {
        const p = map.get(c.produkId)
        return p ? { nama: p.nama, hargaSatuan: p.hargaJual, qty: c.qty } : null
      })
      .filter((x): x is { nama: string; hargaSatuan: number; qty: number } => x != null)
    const tunaiBerisi = metodeKirim === 'tunai' && Number(dibayar || 0) > 0
    return susunBarisStruk({
      outlet: pengaturan?.namaOutlet || 'Kasir SABANA',
      no: noBerikut,
      waktu: nowISO().replace('T', ' '),
      sumber: labelSumber(sumber),
      metode: LABEL_METODE[metodeKirim],
      items,
      total,
      dibayar: tunaiBerisi ? Number(dibayar || 0) : undefined,
      kembalian: tunaiBerisi ? kembalianPreview : undefined,
      sambutan: pengaturan?.strukSambutan || undefined,
      penutup: pengaturan?.strukPenutup || undefined,
    })
  }, [cart, map, pengaturan, sumber, metodeKirim, total, dibayar, kembalianPreview, noBerikut])

  /** Isi nominal dari preset/chip — digit berikutnya dianggap angka BARU. */
  function setPreset(v: number) {
    asalNominal.current = 'preset'
    setDibayar(String(v))
  }

  /** Numpad manual — ketik digit nominal tanpa keyboard virtual perangkat. */
  function tekanDigit(d: string) {
    if (asalNominal.current === 'preset') {
      // Nilai dari preset diganti penuh — mulai ketik baru.
      asalNominal.current = 'ketik'
      setDibayar(d)
      return
    }
    setDibayar((prev) => {
      const bersih = prev.replace(/\D/g, '')
      if (bersih.length >= 9) return prev
      const gabung = bersih === '0' || bersih === '' ? d : bersih + d
      return gabung.slice(0, 9)
    })
  }

  function hapusDigit() {
    asalNominal.current = 'ketik'
    setDibayar((prev) => prev.replace(/\D/g, '').slice(0, -1))
  }

  function bersihkanNominal() {
    asalNominal.current = 'ketik'
    setDibayar('')
  }

  async function bayar() {
    const items = cart
      .map((c) => ({ produkId: c.produkId, qty: c.qty }))
      .filter((c) => (map.get(c.produkId)?.stok ?? 0) >= c.qty)
    if (items.length === 0) {
      setErr('Keranjang kosong atau melebihi stok.')
      return
    }
    setSibuk(true)
    setErr('')
    setKekurangan([])
    try {
      const hasil = await jualProduk({
        sumber,
        metode: metodeKirim,
        dibayar: Number(dibayar) || 0,
        items,
      })
      if (!hasil.ok) {
        setErr(hasil.alasan ?? '')
        setKekurangan(hasil.kekurangan)
        return
      }
      const rinci = await rinciTransaksi(hasil.id)
      setRinci(rinci ?? null)
      setReceipt({ id: hasil.id, total: hasil.total, kembalian: hasil.kembalian, metode: hasil.metode, sumber })
      setCart([])
      setDibayar('')
      setReload((r) => r + 1)
    } catch (e) {
      setErr(String(e))
    } finally {
      setSibuk(false)
    }
  }

  function aturKolom(n: number) {
    setKolom(n)
    try {
      localStorage.setItem('kasir.kolom', String(n))
    } catch {
      /* abaikan */
    }
  }

  function tutupCheckout() {
    if (sibuk) return
    setCheckout(false)
    setErr('')
    setKekurangan([])
    if (receipt) {
      setReceipt(null)
      setRinci(null)
    }
  }

  // Escape menutup popup checkout (kecuali sedang memproses)
  useEffect(() => {
    if (!checkout) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') tutupCheckout()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout, sibuk])

  /** Pilih metode; bila kasir memilih Tunai saat shift belum mulai, pop-up mulai shift muncul. */
  function pilihMetode(m: MetodeBayar) {
    setMetode(m)
    if (m === 'tunai' && kasBuka === false) setKasDialog('buka')
  }

  // Gate operasional: halaman kasir baru terbuka bila sesi kas aktif
  // (buka kas = mulai operasional; tutup kas = selesai operasional).
  if (!sesiDimuat) {
    return (
      <main className="screen-center">
        <p className="muted">Memeriksa status shift kas…</p>
      </main>
    )
  }

  // Kelola kas yang masih terbuka (mis. setelah Tutup Kas) tetap tampil sampai dialog ditutup,
  // agar konfirmasi selisih & setoran tidak hilang; baru halaman dikunci setelahnya.
  if (!sesiKas && kasDialog !== 'kelola') {
    return (
      <>
        <main className="screen-center kasir-gate">
          <div className="panel gate-card">
            <span className="gate-icon" aria-hidden="true"><Icon name="kas" size={26} /></span>
            <h2 style={{ margin: 0, fontSize: 19 }}>Belum ada shift aktif</h2>
            <p className="muted" style={{ margin: '6px 0 14px' }}>
              Mulai shift untuk memulai operasional (isi uang awal laci, float <b>Rp 350.000</b>) — selama
              shift aktif layar kasir langsung bisa dipakai. Akhiri shift saat operasional selesai; shift
              berikutnya boleh langsung dimulai.
            </p>
            <button className="outline" onClick={() => navigate('/')}>
              Kembali ke Dashboard
            </button>
          </div>
        </main>
        <KasModal
          buka="buka"
          batalLabel="Kembali ke Dashboard"
          onKasBerubah={(aktif) => {
            pindahAuto.current = true
            setSesiKas(aktif)
            setReload((r) => r + 1)
          }}
          onBatal={() => navigate('/')}
          onTutup={() => {
            if (!pindahAuto.current) navigate('/')
            pindahAuto.current = false
          }}
        />
      </>
    )
  }

  return (
    <>
      <main className="kasir-wrap">
        {sesiKas && (
          <div className="kasir-kasbar">
            <span className="kb-stat">
              <span className="kb-dot" aria-hidden="true" />
              Shift {shiftNo > 0 ? `#${shiftNo} ` : ''}aktif
            </span>
            <button className="outline small" onClick={() => setKasDialog('kelola')}>
              Kelola / Tutup shift
            </button>
          </div>
        )}
        <section className="panel" style={{ marginTop: 12 }}>
          <div className="kasir-tool">
            <input
              className="search"
              type="search"
              aria-label="Cari menu"
              autoComplete="off"
              placeholder="Cari menu…"
              value={term}
              onChange={(e) => aturParam('q', e.target.value)}
            />
            <div className="kolseg" role="group" aria-label="Jumlah kolom menu">
              {[3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  className={kolom === n ? 'on' : ''}
                  onClick={() => aturKolom(n)}
                  aria-pressed={kolom === n}
                  title={`${n} kolom`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="kasir-cats" role="tablist" aria-label="Kategori menu">
            {kategori.map((k) => {
              const jml = k === 'Semua' ? produk.length : (jmlPerKategori.get(k) ?? 0)
              return (
                <button key={k} className={`chip ${kat === k ? 'on' : ''}`} onClick={() => aturParam('kat', k)}>
                  {k}
                  {jml > 0 && (
                    <small style={{ opacity: 0.62, fontWeight: 700, marginLeft: 2 }}>{jml}</small>
                  )}
                </button>
              )
            })}
          </div>
          <div className="menu-grid" style={{ gridTemplateColumns: `repeat(${kolom}, minmax(0, 1fr))` }}>
            {shown.map((p) => {
              const stok = p.stok ?? 0
              const habis = stok <= 0
              // Ambang "menipis" diatur di Pengaturan → Kasir (default 3).
              const low = !habis && stok <= (pengaturan?.ambangStokKasir ?? 3)
              const diKeranjang = qtyDiKeranjang(p.id as number)
              return (
                <button
                  className={`ptile${low ? ' low' : ''}`}
                  key={p.id}
                  disabled={habis}
                  onClick={() => tambah(p.id as number)}
                >
                  {diKeranjang > 0 && (
                    <span className="ptile-qty" aria-label={`${diKeranjang} di keranjang`}>
                      {diKeranjang}
                    </span>
                  )}
                  <span className="pname">{p.nama}</span>
                  <span className="pprice">{formatRupiah(p.hargaJual)}</span>
                  <span className="pstock">{habis ? 'Habis' : low ? `Sisa ${stok}` : `Stok ${stok}`}</span>
                </button>
              )
            })}
            {shown.length === 0 && <p className="empty" style={{ gridColumn: '1 / -1' }}>Tidak ada menu ditemukan.</p>}
          </div>
        </section>

        <aside className="cart">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Pesanan</h2>
            {nItem > 0 && <span className="badge stock" style={{ fontSize: 13 }}>{nItem} item</span>}
          </div>
          {cart.length === 0 ? (
            <p className="muted">Ketuk menu untuk menambah.</p>
          ) : (
            cart.map((c) => {
              const p = map.get(c.produkId)
              if (!p) return null
              return (
                <div className="cart-item" key={c.produkId}>
                  <div className="ci-name">
                    <b>{p.nama}</b>
                    <div className="row-meta">{formatRupiah(p.hargaJual)} × {c.qty}</div>
                  </div>
                  <div className="qtyctl">
                    <button onClick={() => kurangi(c.produkId)} aria-label={`Kurangi ${p.nama}`}>−</button>
                    <button onClick={() => tambah(c.produkId)} disabled={c.qty >= (p.stok ?? 0)} aria-label={`Tambah ${p.nama}`}>+</button>
                  </div>
                </div>
              )
            })
          )}
          <div className="pay-line total">
            <span>Total</span>
            <span>{formatRupiah(total)}</span>
          </div>

          <button
            className="pay-action"
            disabled={sibuk || cart.length === 0}
            onClick={() => setCheckout(true)}
          >
            {sibuk ? 'Memproses…' : 'Checkout'}
          </button>
          {cart.length > 0 && (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0', textAlign: 'center' }}>
              Ringkasan pesanan & pilihan bayar dibuka lewat jendela Checkout.
            </p>
          )}
        </aside>
      </main>

      {cart.length > 0 && !checkout && (
        <div className="kasir-dock">
          <div className="dock-row">
            <div className="dock-info">
              <div className="dcount">{nItem} item · {LABEL_METODE[metodeKirim]}</div>
              <div className="dtotal">{formatRupiah(total)}</div>
            </div>
            <button onClick={() => setCheckout(true)}>Checkout</button>
          </div>
        </div>
      )}

      {checkout && (
        <div className="km-overlay">
          <div
            className="km km-checkout"
            role="dialog"
            aria-modal="true"
            aria-label={receipt ? 'Transaksi selesai' : 'Checkout — bayar pesanan'}
            tabIndex={-1}
          >
            {receipt ? (
              <>
                <div className="km-ic" aria-hidden="true">
                  <Icon name="check" size={24} />
                </div>
                <h3>Transaksi #{receipt.id} selesai</h3>
                <div className="pay-line total" style={{ marginTop: 8 }}>
                  <span>Total</span>
                  <span>{formatRupiah(receipt.total)}</span>
                </div>
                <div className="pay-line">
                  <span>Metode</span>
                  <span>{LABEL_METODE[receipt.metode]}</span>
                </div>
                <div className="pay-line">
                  <span>Sumber</span>
                  <span>{labelSumber(receipt.sumber)}</span>
                </div>
                {receipt.metode === 'tunai' && (
                  <div className="pay-line">
                    <span>Kembalian</span>
                    <span>{formatRupiah(receipt.kembalian)}</span>
                  </div>
                )}
                {rinci && (
                  <div style={{ marginTop: 10 }}>
                    <StrukPanel header={rinci.header} items={rinci.items} />
                  </div>
                )}
                <div className="km-buttons">
                  <button className="primary" onClick={tutupCheckout}>
                    Pesanan baru
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <h3 style={{ margin: 0 }}>Checkout</h3>
                  <span className="badge stock">{nItem} item</span>
                </div>

                <div className="co-cols">
                  {/* Kanan — kontrol bayar (lebih dulu di DOM → tampil pertama saat layar sempit) */}
                  <div className="co-pay">
                    {sumberOnline ? (
                      <p className="muted" style={{ fontSize: 12.5 }}>
                        Pesanan {labelSumber(sumber)} dibayar lewat platform — hanya dicatat sebagai estimasi pendapatan.
                      </p>
                    ) : (
                      <div>
                        <div className="row-meta" style={{ marginBottom: 6, fontWeight: 700 }}>Metode bayar</div>
                        <div className="seg" role="radiogroup" aria-label="Metode bayar">
                          {URUTAN_METODE.map((m) => (
                            <button
                              key={m}
                              role="radio"
                              aria-checked={metode === m}
                              className={metode === m ? 'on' : ''}
                              onClick={() => pilihMetode(m)}
                            >
                              {LABEL_METODE[m]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="row-meta" style={{ marginBottom: 6, fontWeight: 700 }}>Sumber pesanan</div>
                      <div className="chips">
                        {URUTAN_SUMBER.map((s) => (
                          <button key={s} className={`chip ${sumber === s ? 'on' : ''}`} onClick={() => setSumber(s)}>
                            {labelSumber(s)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {tunaiAktif && kasBuka !== false && (
                      <div>
                        <div className="row-meta" style={{ marginBottom: 6, fontWeight: 700 }}>Uang diterima</div>
                        <div className="np-display" aria-live="polite">
                          <span aria-hidden="true">Rp</span>
                          <b>{dibayar ? formatRupiah(Math.floor(Number(dibayar) || 0)) : '0'}</b>
                        </div>
                        {uangCepat.length > 0 && (
                          <div className="cashquick" role="group" aria-label="Uang cepat">
                            {uangCepat.map((u) => (
                              <button key={u.label} onClick={() => setPreset(u.value)} disabled={sibuk}>
                                {u.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="numpad" role="group" aria-label="Numpad nominal uang diterima">
                          {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['C', '0', '⌫']].map((row) => (
                            <div className="np-row" key={row[0]}>
                              {row.map((k) => (
                                <button
                                  key={k}
                                  type="button"
                                  className={`np-key${k === 'C' ? ' np-clr' : ''}${k === '⌫' ? ' np-bks' : ''}`}
                                  disabled={sibuk}
                                  aria-label={k === '⌫' ? 'Hapus satu digit' : k === 'C' ? 'Bersihkan nominal' : `Angka ${k}`}
                                  onClick={() => {
                                    if (k === 'C') bersihkanNominal()
                                    else if (k === '⌫') hapusDigit()
                                    else tekanDigit(k)
                                  }}
                                >
                                  {k === '⌫' ? '⌫' : k}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {kasTerkunci && (
                      <div className="warn-banner" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>Belum ada shift aktif — pembayaran tunai diblokir.</span>
                        <button className="outline small" style={{ margin: 0 }} onClick={() => setKasDialog('buka')}>
                          Mulai shift untuk tunai
                        </button>
                      </div>
                    )}

                    {err && <div className="warn-banner">{err}</div>}
                    {kekurangan.length > 0 && (
                      <div className="warn-banner">
                        <b>Stok tidak cukup:</b>
                        <ul style={{ margin: '6px 0 0' }}>
                          {kekurangan.map((k) => (
                            <li key={k.nama}>{k.nama} kurang {k.kurang}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {tunaiAktif && kasBuka !== false && dibayar !== '' && !dibayarKurang && (
                      <div className="ok-banner" aria-live="polite">
                        Kembalian: <b>{formatRupiah(kembalianPreview)}</b>
                      </div>
                    )}
                    {tunaiAktif && kasBuka !== false && dibayar !== '' && dibayarKurang && (
                      <div className="warn-banner" aria-live="polite">
                        Uang kurang {formatRupiah(-kembalianPreview)}
                      </div>
                    )}

                    <button
                      className="pay-action"
                      disabled={sibuk || cart.length === 0 || dibayarKurang || kasTerkunci}
                      onClick={() => void bayar()}
                    >
                      {sibuk ? 'Memproses…' : `Bayar ${formatRupiah(total)}`}
                    </button>

                    <button className="ghost" style={{ width: '100%' }} onClick={tutupCheckout} disabled={sibuk}>
                      Kembali — lanjut pilih menu
                    </button>
                  </div>

                  {/* Kiri — pratinjau struk seperti hasil cetak (pindah ke kiri saat layar lebar) */}
                  <div className="co-main">
                    {cart.length === 0 ? (
                      <p className="muted" style={{ marginTop: 10 }}>Keranjang kosong — tutup lalu pilih menu dulu.</p>
                    ) : (
                      <div className="ck-struk-wrap">
                        <div className="row-meta" style={{ marginBottom: 6, fontWeight: 700 }}>Pratinjau struk</div>
                        <pre className="ck-struk">
                          {barisPratinjau.map((b) => (b.center ? b.text.trim() : b.text)).join('\n')}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <KasModal
        buka={kasDialog}
        batalLabel="Pakai QRIS saja"
        onKasBerubah={(aktif) => {
          setKasBuka(aktif)
          setSesiKas(aktif)
          setReload((r) => r + 1)
        }}
        onBatal={() => {
          setKasDialog(null)
          setMetode('qris')
          setDibayar('')
        }}
        onTutup={() => setKasDialog(null)}
      />
    </>
  )
}
