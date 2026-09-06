/** Saran nilai kategori untuk form — hanya pelengkap input, data tetap bebas. */

export const KATEGORI_BAHAN = [
  'Ayam',
  'Tepung & Bumbu',
  'Minyak',
  'Saus & Sambal',
  'Kemasan & Lainnya',
  'Nasi & Beras',
  'Kentang & Gorengan',
  'Minuman',
  'Aneka Bahan',
  'Lainnya',
];

export const KATEGORI_PRODUK = [
  'Ayam Goreng',
  'Aneka Goreng',
  'Paket',
  'Nasi',
  'Sambal',
  'Minuman',
  'Lainnya',
];

export const SATUAN_DASAR = ['pcs', 'potong', 'liter', 'gram', 'kg', 'ml'];

export const BAGIAN_AYAM_LABEL = [
  { key: 'dada', label: 'Dada' },
  { key: 'pahaAtas', label: 'Paha Atas' },
  { key: 'pahaBawah', label: 'Paha Bawah' },
  { key: 'sayap', label: 'Sayap' },
] as const;
