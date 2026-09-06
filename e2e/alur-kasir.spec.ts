import { expect, test } from '@playwright/test'

const DEV_URL = 'http://localhost:5173'
const PREVIEW_URL = 'http://localhost:4173'
const HASH = (rute: string) => `${DEV_URL}/#${rute}`

/** DB seed sengaja tanpa stok — beli bahan secukupnya agar produksi bisa jalan. */
async function beliSatu(page: import('@playwright/test').Page, nama: string, qty: string, harga: string) {
  await page.goto(HASH('/beli'))
  await expect(page.getByRole('heading', { name: 'Beli Bahan' })).toBeVisible()
  // baris nota diisi lewat pop-up (pola ringkasan + pop-up)
  await page.getByRole('button', { name: '+ Tambah baris' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox').selectOption({ label: nama })
  await dialog.locator('input[name^="beli-qty"]').fill(qty)
  const hargaInput = dialog.locator('input[name^="beli-harga"]')
  if ((await hargaInput.inputValue()) === '') await hargaInput.fill(harga)
  await dialog.getByRole('button', { name: 'Simpan baris' }).click()
  await page.getByRole('button', { name: 'Simpan Beli' }).click()
  await expect(page.getByText(/Beli #\d+ tersimpan/)).toBeVisible()
}

async function siapkanStok(page: import('@playwright/test').Page) {
  await beliSatu(page, 'AYAM POTONG 9', '2', '48000')
  await beliSatu(page, 'TEPUNG FRIED CHICKEN', '2', '23500')
  await beliSatu(page, 'SUNCO MINYAK GORENG 2 LITER', '1', '21700')

  // Produksi 1 ekor → stok jadi (dada/sayap/dll) siap dijual
  await page.goto(HASH('/produksi'))
  await expect(page.getByRole('heading', { name: 'Catat Produksi' })).toBeVisible()
  // pilihan ayam/tepung/minyak diisi lewat pop-up "Ubah →"
  await page.getByRole('button', { name: /Ubah/ }).click()
  const dialog = page.getByRole('dialog')
  for (const label of ['Ayam mentah', 'Tepung', 'Minyak']) {
    const sel = dialog.locator('.field', { hasText: label }).locator('select')
    if ((await sel.inputValue()) === '') await sel.selectOption({ index: 1 })
  }
  await dialog.locator('.field', { hasText: 'Jumlah ekor' }).locator('input').fill('1')
  await dialog.getByRole('button', { name: 'Simpan', exact: true }).click()
  await page.getByRole('button', { name: 'Catat produksi ayam' }).click()
  await expect(page.getByText(/Produksi #\d+ tersimpan/)).toBeVisible()
}

/**
 * Gate operasional: halaman kasir terkunci sampai kas dibuka. Saat dibuka dari
 * pop-up (float default Rp 350.000), grid menu baru tampil.
 */
async function bukaKasDariGate(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Belum ada shift aktif' })).toBeVisible()
  await dialog.getByLabel('Uang awal di laci (Rp)').fill('350000')
  await dialog.getByRole('button', { name: /^Mulai Shift/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Dada/ }).first()).toBeVisible()
}

async function tambahDada(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /Dada/ }).first().click()
  await expect(page.locator('.cart')).toContainText('Dada')
  await expect(page.locator('.pay-line.total')).toContainText('11.000')
}

test.describe('Alur kasir', () => {
  test('kasir terkunci tanpa kas buka; setelah buka kas, jual QRIS menuntaskan transaksi & struk tampil', async ({ page }) => {
    await siapkanStok(page)

    // Gate: halaman kasir tidak terbuka — dialog buka kas muncul otomatis, grid belum tampil
    await page.goto(HASH('/kasir'))
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Belum ada shift aktif' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Dada/ })).toHaveCount(0)

    // Buka kas → grid menu terbuka
    await bukaKasDariGate(page)
    await tambahDada(page)

    // Checkout → pop-up berisi ringkasan, sumber, & metode bayar
    await page.locator('.cart').getByRole('button', { name: 'Checkout' }).click()
    const co = page.getByRole('dialog', { name: /Checkout/ })
    await expect(co.getByText('Total')).toBeVisible()

    // QRIS
    await co.getByRole('radio', { name: 'QRIS' }).click()
    await co.getByRole('button', { name: /^Bayar Rp/ }).click()
    await expect(page.getByRole('heading', { name: /Transaksi #\d+ selesai/ })).toBeVisible()
    await expect(page.getByText('11.000').first()).toBeVisible()
    await expect(page.getByText(/SABANA FRIED CHICKEN/).first()).toBeVisible()
    await expect(page.getByText(/QRIS/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Pesanan baru' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('buka kas dari gate → jual tunai → uang Rp 11.000 masuk laci (pop-up kelola)', async ({ page }) => {
    await siapkanStok(page)
    await page.goto(HASH('/kasir'))
    await bukaKasDariGate(page)

    // Jual tunai — uang pas (lewat pop-up checkout)
    await tambahDada(page)
    await page.locator('.cart').getByRole('button', { name: 'Checkout' }).click()
    const co = page.getByRole('dialog', { name: /Checkout/ })
    await expect(co.getByRole('radio', { name: 'Tunai' })).toBeChecked()
    await co.getByRole('button', { name: 'Uang pas' }).click()
    await expect(co.getByText(/Kembalian: Rp 0/)).toBeVisible()
    await co.getByRole('button', { name: /^Bayar Rp/ }).click()
    await expect(page.getByRole('heading', { name: /Transaksi #\d+ selesai/ })).toBeVisible()
    await page.getByRole('button', { name: 'Pesanan baru' }).click()

    // Laci bertambah lewat pop-up kelola — dipanggil dari bar shift di halaman kasir (agregasi butuh sesaat)
    await page.getByRole('button', { name: 'Kelola / Tutup shift' }).click()
    const kelola = page.getByRole('dialog')
    await expect(kelola.getByText('Penjualan tunai')).toBeVisible({ timeout: 15_000 })
    await expect(kelola.getByText('11.000').first()).toBeVisible({ timeout: 15_000 })
  })

  test('tablet portrait: tombol Checkout terlihat & bisa dipakai tanpa scroll setelah pilih item', async ({ page }) => {
    await siapkanStok(page)
    await page.goto(HASH('/kasir'))
    await bukaKasDariGate(page)

    // Simulasikan tablet portrait
    await page.setViewportSize({ width: 768, height: 1024 })
    await tambahDada(page)

    // Dock checkout (bar bawah) tampil utuh di dalam viewport — tanpa perlu scroll ke bawah
    const dock = page.locator('.kasir-dock')
    await expect(dock).toBeVisible()
    const kotak = await dock.boundingBox()
    expect(kotak).not.toBeNull()
    expect(kotak!.y).toBeGreaterThanOrEqual(0)
    expect(kotak!.y + kotak!.height).toBeLessThanOrEqual(1024)

    // Checkout langsung terbuka dari dock
    await dock.getByRole('button', { name: 'Checkout' }).click()
    await expect(page.getByRole('dialog', { name: /Checkout/ })).toBeVisible()
    await page.getByRole('button', { name: 'Kembali — lanjut pilih menu' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('tutup kas dari kasir: konfirmasi selisih tampil dulu, baru halaman terkunci setelah Selesai', async ({ page }) => {
    await page.goto(HASH('/kasir'))
    await bukaKasDariGate(page)

    // Kelola → tutup kas dengan fisik pas (selisih 0)
    await page.getByRole('button', { name: /Kelola/ }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Uang fisik di laci (Rp)').fill('350000')
    await dlg.getByRole('button', { name: 'Akhiri Shift' }).click()

    // Konfirmasi selisih & setoran tampil — halaman BELUM terkunci
    const confirm = page.getByRole('dialog')
    await expect(confirm.getByRole('heading', { name: 'Shift selesai' })).toBeVisible()
    await expect(confirm.getByText('Selisih pas — tidak ada')).toBeVisible()

    // Setelah Selesai → halaman kasir terkunci kembali (gate operasional)
    await confirm.getByRole('button', { name: 'Selesai' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Belum ada shift aktif' })).toBeVisible()
  })
})

test.describe('PWA offline (build produksi)', () => {
  test('aplikasi tetap terbuka & dipakai setelah koneksi diputus', async ({ page, context }) => {
    // Kunjungan pertama: muat, tunggu service worker siap & mengontrol halaman
    await page.goto(`${PREVIEW_URL}/`)
    await expect(page.getByRole('heading', { name: 'Kasir SABANA' })).toBeVisible()
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((res) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => res(), { once: true })
        })
      }
    })
    // Muat ulang sekali online: pre-cache & runtime-cache (font) terisi penuh
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Kasir SABANA' })).toBeVisible()

    // Putuskan koneksi lalu buka ulang
    await context.setOffline(true)
    await page.reload()

    // Shell + navigasi tetap jalan dari cache; kasir offline juga tersedia
    await expect(page.getByRole('heading', { name: 'Kasir SABANA' })).toBeVisible()
    await page.goto(`${PREVIEW_URL}/#/kasir`)
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Belum ada shift aktif' })).toBeVisible()
  })
})