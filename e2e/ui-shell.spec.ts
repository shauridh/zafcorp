import { expect, test } from '@playwright/test'

const HASH = (rute: string) => `http://localhost:5173/#${rute}`

test.describe('Navigasi v4 (sidebar kiri + rail)', () => {
  test('desktop: hamburger paling kiri, collapse menjadi rail ikon (label hilang, ikon tetap)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(HASH(''))
    await expect(page.locator('.topbar')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // Hamburger ada di sisi kiri header, sebelum merek
    const header = page.locator('.topbar')
    const toggle = header.locator('.menu-toggle')
    await expect(toggle).toBeVisible()
    const pos = (await toggle.boundingBox())!
    const brand = (await header.locator('.brand').boundingBox())!
    expect(pos.x).toBeLessThan(brand.x)

    // Default desktop: sidebar terbuka penuh berlabel
    await expect(header.locator('.menu-toggle')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.layout')).toHaveClass(/nav-open/)
    await expect(page.locator('.side-item span').first()).toBeVisible()

    // Tutup (kolaps) → rail ikon: lebar menyempit, label item hilang, judul grup jadi titik
    await toggle.click()
    await expect(header.locator('.menu-toggle')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.layout')).not.toHaveClass(/nav-open/)
    const rail = (await page.locator('.sidebar').boundingBox())!
    expect(rail.width).toBeLessThan(120)
    await expect(page.locator('.side-item span').first()).toBeHidden()
    await expect(page.locator('.side-label').first()).toHaveCSS('font-size', '0px')
    // Ikon tetap ada, toggle tema tetap di kaki sidebar, & menu bisa dipakai dari rail
    await expect(page.locator('.sidebar .side-item').first().locator('svg')).toBeVisible()
    await expect(page.locator('.sidebar .side-theme svg')).toBeVisible()

    // Buka lagi → label kembali
    await header.locator('.menu-toggle').click()
    await expect(page.locator('.side-item span').first()).toBeVisible()
    await expect(page.locator('.sidebar .side-theme')).toContainText('Mode')
  })

  test('mobile: hamburger kiri membuka drawer; bottom nav tetap tampil', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 })
    await page.goto(HASH(''))
    await expect(page.locator('.topbar')).toBeVisible()

    // Bottom nav tampil di layar sempit
    const bottomNav = page.locator('.bottom-nav')
    await expect(bottomNav).toBeVisible()

    // Hamburger di header kiri membuka drawer menu
    const toggle = page.locator('.topbar .menu-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.sidebar.open')).toBeVisible()

    // Tutup via tombol backdrop (bukan link keluar)
    await page.locator('.backdrop').click()
    await expect(page.locator('.sidebar.open')).toHaveCount(0)
  })
})
