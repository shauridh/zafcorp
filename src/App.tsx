import './App.css'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './ui/Shell'
import { DashboardPage } from './ui/DashboardPage'
import { BahanPage } from './ui/BahanPage'
import { BahanFormPage } from './ui/BahanFormPage'
import { ProdukPage } from './ui/ProdukPage'
import { ProdukFormPage } from './ui/ProdukFormPage'
import { BeliPage } from './ui/BeliPage'
import { ProduksiPage } from './ui/ProduksiPage'
import { KoreksiPage } from './ui/KoreksiPage'
import { MutasiPage } from './ui/MutasiPage'
import { KasirPage } from './ui/KasirPage'
import { TransaksiPage } from './ui/TransaksiPage'
import { PengaturanPage } from './ui/PengaturanPage'
import { FryerPage } from './ui/FryerPage'
import { BelanjaPage } from './ui/BelanjaPage'
import PapanPesananPage from './ui/PapanPesananPage'
import { RiwayatShiftPage } from './ui/RiwayatShiftPage'
import { FinansialPage } from './ui/FinansialPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/bahan" element={<BahanPage />} />
          <Route path="/bahan/baru" element={<BahanFormPage />} />
          <Route path="/bahan/:id" element={<BahanFormPage />} />
          <Route path="/produk" element={<ProdukPage />} />
          <Route path="/produk/baru" element={<ProdukFormPage />} />
          <Route path="/produk/:id" element={<ProdukFormPage />} />
          <Route path="/beli" element={<BeliPage />} />
          <Route path="/produksi" element={<ProduksiPage />} />
          <Route path="/koreksi" element={<KoreksiPage />} />
          <Route path="/mutasi" element={<MutasiPage />} />
          <Route path="/kasir" element={<KasirPage />} />
          <Route path="/transaksi" element={<TransaksiPage />} />
          <Route path="/pengaturan" element={<PengaturanPage />} />
          <Route path="/kas" element={<Navigate to="/kasir" replace />} />
          <Route path="/laporan" element={<Navigate to="/" replace />} />
          <Route path="/pengeluaran" element={<Navigate to="/finansial" replace />} />
          <Route path="/fryer" element={<FryerPage />} />
          <Route path="/belanja" element={<BelanjaPage />} />
          <Route path="/papan-antar" element={<PapanPesananPage />} />
          <Route path="/shift" element={<RiwayatShiftPage />} />
          <Route path="/finansial" element={<FinansialPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
