import { useEffect, useRef, type ReactNode } from 'react'

interface ConfirmDialogProps {
  buka: boolean
  judul: string
  pesan: ReactNode
  /** Label tombol konfirmasi. Default: 'Ya, lanjutkan'. */
  labelKonfirmasi?: string
  /** Label tombol batal. Default: 'Batal'. */
  labelBatal?: string
  /** Gaya tombol konfirmasi (merah = destruktif). Default: true. */
  danger?: boolean
  sibuk?: boolean
  onKonfirmasi: () => void
  onBatal: () => void
}

/** Dialog konfirmasi konsisten untuk aksi destruktif/sensitif (hapus, batal, reset). */
export function ConfirmDialog({
  buka,
  judul,
  pesan,
  labelKonfirmasi = 'Ya, lanjutkan',
  labelBatal = 'Batal',
  danger = true,
  sibuk = false,
  onKonfirmasi,
  onBatal,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!buka) return
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sibuk) onBatal()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [buka, onBatal, sibuk])

  useEffect(() => {
    if (buka && !sibuk) ref.current?.focus()
  }, [buka, sibuk])

  if (!buka) return null

  return (
    <div className="km-overlay">
      <div ref={ref} className="km" role="alertdialog" aria-modal="true" aria-label={judul} tabIndex={-1} style={{ maxWidth: 420 }}>
        <h3>{judul}</h3>
        <div className="sub" style={{ marginBottom: 16 }}>
          {pesan}
        </div>
        <div className="km-buttons">
          <button className={danger ? 'danger' : 'primary'} disabled={sibuk} onClick={onKonfirmasi}>
            {sibuk ? 'Memproses…' : labelKonfirmasi}
          </button>
          <button className="ghost" disabled={sibuk} onClick={onBatal}>
            {labelBatal}
          </button>
        </div>
      </div>
    </div>
  )
}
