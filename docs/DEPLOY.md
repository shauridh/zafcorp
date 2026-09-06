# Deploy Kasir SABANA (PWA)

Aplikasi ini **PWA statis offline-first**: semua data tersimpan di perangkat
(IndexedDB), tidak ada server backend. Yang perlu di-deploy hanyalah folder
`dist/` hasil build di atas hosting HTTPS apa pun.

## Prasyarat: HTTPS

Service worker (mode offline) hanya berjalan di **HTTPS** (atau `localhost`
saat pengembangan). Semua hosting statis di bawah sudah menyediakan HTTPS
gratis + otomatis — tidak perlu konfigurasi sertifikat.

## Build

```bash
npm install
npm run build        # menghasilkan folder dist/
```

## Opsi hosting (gratis, HTTPS otomatis)

| Hosting | Cara | Catatan |
|---|---|---|
| **Vercel** | `npm i -g vercel` lalu `vercel` dari folder proyek | Deteksi otomatis Vite; tiap `git push` ke main bisa auto-deploy |
| **Netlify** | Drag & drop folder `dist/` ke app.netlify.com | Publish directory: `dist` |
| **Cloudflare Pages** | Dashboard → Pages → upload `dist/` | Cepat di Indonesia, HTTPS otomatis |
| **GitHub Pages** | Repo → Settings → Pages → folder `dist` (butuh build di CI) | Tidak ada HTTPS otomatis untuk custom domain lama |

URL hasil deploy akan terlihat seperti `https://kasir-sabana.vercel.app`.

## Uji di HP sungguhan

1. Buka URL HTTPS di Chrome Android / Safari iOS.
2. **Tambah ke layar utama**: Chrome → ⋮ → *Tambahkan ke layar utama* /
   *Install aplikasi*. Aplikasi terbuka `standalone` (tanpa bar browser).
3. **Uji offline**: buka aplikasi sekali (biarkan data termuat) → aktifkan
   mode pesawat → buka lagi dari ikon layar utama. Menu kasir & seluruh data
   tetap bisa dipakai.
4. Catatan: pembayaran *share WhatsApp* & *cetak Bluetooth* hanya bisa
   diverifikasi dari perangkat nyata (fitur browser), bukan dari komputer.

## Update aplikasi

- Deploy ulang build baru di hosting yang sama (URL tetap).
- Service worker memakai `autoUpdate` — pengguna yang sudah pernah buka akan
  otomatis mendapat versi baru pada kunjungan/relaunch berikutnya.

## Perhatian data

- **Data tersimpan per perangkat** (IndexedDB browser). Pindah perangkat =
  data tidak ikut. Sebelum mengganti/mereset HP, pastikan data yang penting
  sudah dicatat/diekspor manual (fitur ekspor otomatis belum tersedia).
- Jangan hapus data situs (Chrome → Pengaturan situs) tanpa sadar — itu
  menghapus seluruh catatan kasir.
- Halaman ini sengaja memblokir crawler (`robots.txt: Disallow: /`) karena
  berisi data usaha — jangan beri tahu Google.

## Verifikasi PWA lokal

```bash
npm run build
npm run preview              # sajikan dist/ di http://localhost:4173
# lalu di Chrome: DevTools → Application → Service Workers & Manifest
npm run test:e2e             # termasuk tes offline otomatis (mode pesawat simulasi)
```
