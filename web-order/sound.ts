/** Bunyi notifikasi pesanan masuk — Web Audio, tanpa aset. */
export function chime() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    const ac = new AC()
    const t = ac.currentTime
    ;[[880, 0], [1174.7, 0.16], [880, 0.34]].forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain()
      o.type = 'sine'; o.frequency.value = f as number
      g.gain.setValueAtTime(0.0001, t + (d as number))
      g.gain.exponentialRampToValueAtTime(0.4, t + (d as number) + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + (d as number) + 0.5)
      o.connect(g); g.connect(ac.destination)
      o.start(t + (d as number)); o.stop(t + (d as number) + 0.55)
    })
  } catch { /* audio diblokir — diam */ }
}