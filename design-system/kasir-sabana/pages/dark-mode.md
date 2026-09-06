# Kasir SABANA — Dark Mode (Mode Gelap)

Overrides MASTER.md for the dark palette. Applied via `data-theme="gelap"` on `<html>`.
Storage: Pengaturan → `tema` (`auto | terang | gelap`, default `auto`). `auto` resolves
`prefers-color-scheme` and reacts live to system changes (`src/data/tema.ts`).

Update v3 (2026-09-04): palet gelap kini **netral** (bukan cokelat-merah hangat), mengikuti
arah "netral bersih + aksen SABANA red". Sumber kebenaran: blok `html[data-theme='gelap']`
di `src/App.css`.

## Token mapping (light → dark)

| Token            | Terang      | Gelap      | Peran                                        |
| ---------------- | ----------- | ---------- | -------------------------------------------- |
| `--bg`           | `#eef0f3`   | `#16181d`  | Latar aplikasi                               |
| `--soft`         | `#f4f5f7`   | `#1c1f25`  | Permukaan sekunder / hover dasar             |
| `--card`         | `#ffffff`   | `#20242b`  | Kartu, panel, input, header                  |
| `--hover`        | `#f7f8fa`   | `#262b33`  | Hover kartu/baris                            |
| `--ink`          | `#191d23`   | `#eceef2`  | Teks utama & angka                           |
| `--ink-soft`     | `#414a55`   | `#c3cad4`  | Teks sekunder                                |
| `--muted`        | `#79828d`   | `#9aa4b1`  | Label/keterangan                             |
| `--line` / `--line-strong` | `#e6e9ee` / `#d3d8e0` | `#2c313a` / `#3b424d` | Batas kartu / batas tegas & tombol outline |
| `--brand`        | `#dc2626`   | `#e03535`  | Aksen (mark, aksi utama, segmen aktif)       |
| `--brand-ink`    | `#c21c1c`   | `#fda4af`  | Teks/ikon merah di atas permukaan            |
| `--brand-soft`   | `#fdecec`   | `#3a1d1d`  | Latar tint aksen                              |
| `--ok`           | `#177245`   | `#4ade80`  | Sukses/kembalian                             |
| `--danger`       | `#b3261e`   | `#f87171`  | Bahaya/hapus                                 |
| `--gold`         | `#b45309`   | `#fbbf24`  | Stok menipis (amber)                         |
| `--nav-bg`       | `rgba(255,255,255,.9)` | `rgba(22,24,29,.9)` | Bar navigasi blur            |

## Aturan pakai

- Permukaan memakai `var(--card)`; aksen hanya pada **mark, tombol utama, segmen/status aktif,
  badge** — bukan teks biasa (teks merah memakai `--brand-ink` agar kontras di kartu gelap).
- Angka tabular (`font-variant-numeric: tabular-nums`) pada harga/total/statistik/rpt.
- Header (`.topbar`) memakai `var(--card)` di **kedua mode** — bedanya hanya warna token.
- Ukur kontras bila mengubah: teks ≥4.5:1 (terang & gelap terverifikasi ≥4.5:1 saat v3).
