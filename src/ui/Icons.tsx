/** Ikon SVG stroke (24×24, currentColor) — dekoratif; label disediakan oleh pemakai. */
export type IconName =
  | 'beranda'
  | 'kasir'
  | 'kas'
  | 'penjualan'
  | 'laporan'
  | 'pengeluaran'
  | 'belanja'
  | 'beli'
  | 'produksi'
  | 'fryer'
  | 'bahan'
  | 'produk'
  | 'mutasi'
  | 'pengaturan'
  | 'menu'
  | 'tutup'
  | 'plus'
  | 'cari'
  | 'check'
  | 'bagikan'
  | 'unduh'
  | 'salin'
  | 'matahari'
  | 'bulan'

const P: Record<IconName, string> = {
  beranda: 'M4 11.5 12 4l8 7.5M6.5 10v8.5A1.5 1.5 0 0 0 8 20h8a1.5 1.5 0 0 0 1.5-1.5V10',
  kasir:
    'M2.5 3.5h2l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.56-1.24L20.5 7H5.7M9.5 19.5h.01M17.5 19.5h.01M9 19.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0M18 19.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0',
  kas: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v2M4 6.5V17.5A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-9M4 9.5h16M9 13.5h6',
  penjualan:
    'M6 2.5h12A1.5 1.5 0 0 1 19.5 4v16a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5ZM8 8h8M8 12h5M8 16h8',
  laporan: 'M4 4v15a1.5 1.5 0 0 0 1.5 1.5H20M8 15v-4M12 15V7M16 15v-2',
  pengeluaran:
    'M3.5 6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5ZM3.5 10h17M15 14.5h2.5',
  belanja:
    'M6 8.5A1.5 1.5 0 0 1 7.5 7h9A1.5 1.5 0 0 1 18 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 17.5ZM8.5 11h7M10 15h4M14.5 4.5v5M9.5 7v-1a1.5 1.5 0 0 1 3 0',
  beli: 'M12 3.5 4.5 7.25v9.5L12 20.5l7.5-3.75v-9.5ZM4.8 7.4 12 11l7.2-3.6M12 11v9.4M12 3.5v7.5',
  produksi: 'M9 4h6M10 4v3a2 2 0 0 1-2 2H7a1 1 0 0 0-1 1v2a8 8 0 0 0 16 0v-2a1 1 0 0 0-1-1h-1a2 2 0 0 1-2-2V4M12 14a5 5 0 0 0 5 5',
  fryer: 'M12 3.5 7.5 11a5.5 5.5 0 1 0 9 0ZM12 13v4',
  bahan: 'M3.5 4.5h17v5h-17zM4.5 9.5V19a1.5 1.5 0 0 0 1.5 1.5h12A1.5 1.5 0 0 0 19.5 19V9.5M10 13h4',
  produk: 'M12 2.5 21 7v10l-9 4.5L3 17V7ZM3 7.2l9 4.3 9-4.3M12 11.5V21.5',
  mutasi: 'M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 3.5v5h5M12 7.5V12l3 2',
  pengaturan: 'M4 19V9M4 5v1.5M10 19v-5.5M10 10V5M16 19v-2.5M16 13V5M1 10.5h6M7 15.5h6M13 19.5h6',
  menu: 'M3.5 6.5h17M3.5 12h17M3.5 17.5h17',
  tutup: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  cari: 'M10.5 4a6.5 6.5 0 1 0 4.6 11.1L20 20M10.5 4a6.5 6.5 0 0 1 0 13',
  check: 'M4.5 12.5l5 5L19.5 7',
  bagikan: 'M12 3.5v12M7.5 8 12 3.5 16.5 8M4.5 13.5v5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-5',
  unduh: 'M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4.5 18.5h15',
  salin: 'M8.5 8.5v-2A1.5 1.5 0 0 1 10 5h9a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-2M4.5 9.5v10A1.5 1.5 0 0 0 6 21h9a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 15 9H6a1.5 1.5 0 0 0-1.5 1.5Z',
  matahari: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  bulan: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
}

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={P[name]} />
    </svg>
  )
}
