#!/usr/bin/env node
/**
 * Store Supabase (Postgres) untuk server order & server sync — implementasi
 * antarmuka store ({ muatStore, simpanStore }) yang sama dengan store JSON.
 *
 * Strategi (sesuai docs/BACKEND-SUPABASE-VERCEL.md P2 — volume UMKM kecil):
 *   muatStore()   — baca SEMUA baris tabel → bentuk store in-memory yang sama
 *                   persis dengan bentuk JSON (camelCase, orders/pelanggan/…).
 *   simpanStore() — diff store in-memory vs snapshot saat muat, lalu tulis
 *                   HANYA baris yang berubah/baru (upsert) & hapus yang hilang.
 *
 * Akses memakai service role (klien dibuat server-side di Vercel Function).
 * Mutasi antar request bersifat LWW per baris; bila dua permintaan menyentuh
 * baris SAMA secara bersamaan, penulis terakhir menang (catatan: sinkronisasi
 * lintas-perangkat memakai versi naik global — rawan tabrakan hanya bila dua
 * perangkat push baris berbeda pada detik yang sama; utk UMKM diterima).
 */
import { createClient } from '@supabase/supabase-js'

export function buatKlienSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Env SUPABASE_URL dan/atau SUPABASE_SERVICE_ROLE_KEY belum diset (lihat docs/BACKEND-SUPABASE-VERCEL.md P4).')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

const klon = (o) => JSON.parse(JSON.stringify(o ?? null))
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const nowISO = () => new Date().toISOString().slice(0, 19)
const undef = (v) => (v == null ? undefined : v)
const num = (v) => (v == null ? undefined : Number(v))

/* ============================ DOMAIN ORDER ================================ */

function barisKeOrder(r) {
  return {
    id: r.id,
    no: r.no,
    waktuBuat: r.waktu_buat,
    nama: r.nama,
    hp: r.hp,
    alamat: r.alamat,
    catatan: undef(r.catatan),
    jarakKm: num(r.jarak_km),
    ongkir: r.ongkir ?? 0,
    gratis: !!r.gratis,
    subtotal: r.subtotal ?? 0,
    total: r.total ?? 0,
    metode: undef(r.metode),
    statusPembayaran: r.status_pembayaran,
    status: r.status,
    buktiNama: undef(r.bukti_nama),
    nominalUnik: undef(r.nominal_unik),
    transaksiId: undef(r.transaksi_id),
    issuer: undef(r.issuer),
    verifikasiOtomatis: !!r.verifikasi_otomatis,
    sumberVerifikasi: undef(r.sumber_verifikasi),
    alasanBatal: undef(r.alasan_batal),
    rentangBayar: undef(r.rentang_bayar),
    bridgeEventId: undef(r.bridge_event_id),
    items: Array.isArray(r.items) ? r.items : [],
    pesan: Array.isArray(r.pesan) ? r.pesan : [],
    riwayat: Array.isArray(r.riwayat) ? r.riwayat : [],
    refund: undef(r.refund),
    penilaian: undef(r.penilaian),
  }
}

function orderKeBaris(o) {
  return {
    id: o.id,
    no: o.no,
    waktu_buat: o.waktuBuat || nowISO(),
    nama: o.nama || '',
    hp: o.hp || '',
    alamat: o.alamat || '',
    catatan: o.catatan ?? null,
    jarak_km: o.jarakKm ?? 0,
    ongkir: o.ongkir ?? 0,
    gratis: !!o.gratis,
    subtotal: o.subtotal ?? 0,
    total: o.total ?? 0,
    metode: o.metode ?? null,
    status_pembayaran: o.statusPembayaran ?? 'belum',
    status: o.status ?? 'cek',
    bukti_nama: o.buktiNama ?? null,
    nominal_unik: o.nominalUnik ?? null,
    transaksi_id: o.transaksiId ?? null,
    issuer: o.issuer ?? null,
    verifikasi_otomatis: !!o.verifikasiOtomatis,
    sumber_verifikasi: o.sumberVerifikasi ?? null,
    alasan_batal: o.alasanBatal ?? null,
    rentang_bayar: o.rentangBayar ?? null,
    bridge_event_id: o.bridgeEventId ?? null,
    items: o.items || [],
    pesan: o.pesan || [],
    riwayat: o.riwayat || [],
    refund: o.refund ?? null,
    penilaian: o.penilaian ?? null,
  }
}

function barisKePelanggan(r) {
  return {
    hp: r.hp,
    nama: r.nama || '',
    alamatTerakhir: undef(r.alamat_terakhir),
    jumlahPesanan: r.jumlah_pesanan ?? 0,
    total: r.total ?? 0,
    terakhirPesan: undef(r.terakhir_pesan),
    ratingRata: r.rating_rata == null ? null : Number(r.rating_rata),
    pinHash: undef(r.pin_hash),
    dibuat: undef(r.dibuat),
  }
}

function pelangganKeBaris(p) {
  return {
    hp: p.hp,
    nama: p.nama || '',
    alamat_terakhir: p.alamatTerakhir ?? null,
    jumlah_pesanan: p.jumlahPesanan ?? 0,
    total: p.total ?? 0,
    terakhir_pesan: p.terakhirPesan ?? null,
    rating_rata: p.ratingRata ?? null,
    pin_hash: p.pinHash ?? null,
    dibuat: p.dibuat || nowISO(),
  }
}

export function buatStoreSupabaseOrder(client) {
  const snap = new WeakMap()
  const ambil = async (tabel) => {
    const { data, error } = await client.from(tabel).select('*')
    if (error) throw new Error(`supabase:${tabel} ${error.message}`)
    return data || []
  }
  const eksekusi = async (nama, p) => {
    const { error } = await p
    if (error) throw new Error(`supabase:${nama} ${error.message}`)
  }

  async function muatStore() {
    const [pesananRows, plgRows, sesiRows, pgtRows, subRows, vapidRows, whRows] = await Promise.all([
      ambil('pesanan'), ambil('pelanggan'), ambil('sesi'), ambil('pengaturan'),
      ambil('push_sub'), ambil('vapid'), ambil('webhook_event'),
    ])
    const store = {
      orders: pesananRows.map(barisKeOrder).sort((a, b) => a.no - b.no),
      pengaturan: (pgtRows[0] && pgtRows[0].data) || {},
      pelanggan: {},
      otp: {}, // legacy — tidak dipakai lagi (login via HP + PIN)
      sesi: {},
      subs: {},
      vapid: {},
      webhook: {},
    }
    for (const r of plgRows) store.pelanggan[r.hp] = barisKePelanggan(r)
    for (const r of sesiRows) store.sesi[r.token] = { token: r.token, hp: r.hp, nama: r.nama || '', dibuat: r.dibuat }
    for (const r of subRows) {
      store.subs[r.hp] = store.subs[r.hp] || []
      store.subs[r.hp].push(r.data)
    }
    const v = vapidRows[0]
    if (v && v.public_key && v.private_key) store.vapid = { publicKey: v.public_key, privateKey: v.private_key }
    for (const r of whRows) store.webhook[r.event_id] = undef(r.pesanan_id)
    snap.set(store, klon(store))
    return store
  }

  async function simpanStore(store) {
    const sebelum = snap.get(store) || { orders: [], pengaturan: {}, pelanggan: {}, sesi: {}, subs: {}, vapid: {}, webhook: {} }
    const sesudah = store

    /* pesanan — diff per id */
    {
      const sebelumMap = new Map((sebelum.orders || []).map((o) => [o.id, o]))
      const sesudahMap = new Map((sesudah.orders || []).map((o) => [o.id, o]))
      const tulis = [], hapus = []
      for (const [id, o] of sesudahMap) if (!sebelumMap.has(id) || !eq(sebelumMap.get(id), o)) tulis.push(orderKeBaris(o))
      for (const id of sebelumMap.keys()) if (!sesudahMap.has(id)) hapus.push(id)
      if (tulis.length) await eksekusi('pesanan.upsert', client.from('pesanan').upsert(tulis, { onConflict: 'id' }))
      if (hapus.length) await eksekusi('pesanan.hapus', client.from('pesanan').delete().in('id', hapus))
    }

    /* pelanggan — diff per hp */
    {
      const sebelumMap = new Map(Object.entries(sebelum.pelanggan || {}))
      const sesudahMap = new Map(Object.entries(sesudah.pelanggan || {}))
      const tulis = []
      for (const [hp, p] of sesudahMap) if (!sebelumMap.has(hp) || !eq(sebelumMap.get(hp), p)) tulis.push(pelangganKeBaris(p))
      for (const hp of sebelumMap.keys()) if (!sesudahMap.has(hp)) await eksekusi('pelanggan.hapus', client.from('pelanggan').delete().eq('hp', hp))
      if (tulis.length) await eksekusi('pelanggan.upsert', client.from('pelanggan').upsert(tulis, { onConflict: 'hp' }))
    }

    /* sesi — diff per token */
    {
      const sebelumMap = new Map(Object.entries(sebelum.sesi || {}))
      const sesudahMap = new Map(Object.entries(sesudah.sesi || {}))
      const tulis = []
      for (const [token, s] of sesudahMap) if (!sebelumMap.has(token) || !eq(sebelumMap.get(token), s)) tulis.push({ token, hp: s.hp, nama: s.nama || '', dibuat: s.dibuat || nowISO() })
      for (const token of sebelumMap.keys()) if (!sesudahMap.has(token)) await eksekusi('sesi.hapus', client.from('sesi').delete().eq('token', token))
      if (tulis.length) await eksekusi('sesi.upsert', client.from('sesi').upsert(tulis, { onConflict: 'token' }))
    }

    /* pengaturan — satu baris jsonb (id = 1) */
    if (!eq(sebelum.pengaturan || {}, sesudah.pengaturan || {})) {
      await eksekusi('pengaturan.upsert', client.from('pengaturan').upsert({ id: 1, data: sesudah.pengaturan || {} }, { onConflict: 'id' }))
    }

    /* vapid — satu baris (id = 1) */
    const sv = sesudah.vapid || {}, bv = sebelum.vapid || {}
    if (!eq(bv, sv) && sv.publicKey && sv.privateKey) {
      await eksekusi('vapid.upsert', client.from('vapid').upsert({ id: 1, public_key: sv.publicKey, private_key: sv.privateKey }, { onConflict: 'id' }))
    }

    /* subs — per HP: hapus baris HP yg berubah lalu sisipkan ulang */
    {
      const seb = sebelum.subs || {}, sesd = sesudah.subs || {}
      const hps = new Set([...Object.keys(seb), ...Object.keys(sesd)])
      for (const hp of hps) {
        if (eq(seb[hp] || [], sesd[hp] || [])) continue
        await eksekusi('push_sub.hapus', client.from('push_sub').delete().eq('hp', hp))
        const arr = sesd[hp] || []
        if (arr.length) {
          const rows = arr.slice(-3).map((sub) => ({ hp, endpoint: sub.endpoint, data: sub }))
          await eksekusi('push_sub.upsert', client.from('push_sub').upsert(rows, { onConflict: 'hp,endpoint' }))
        }
      }
    }

    /* webhook dedup — diff per event_id */
    {
      const seb = sebelum.webhook || {}, sesd = sesudah.webhook || {}
      const ids = new Set([...Object.keys(seb), ...Object.keys(sesd)])
      const tulis = []
      for (const ev of ids) {
        const baru = sesd[ev]
        if (eq(seb[ev], baru)) continue
        if (baru === undefined) await eksekusi('webhook_event.hapus', client.from('webhook_event').delete().eq('event_id', ev))
        else tulis.push({ event_id: ev, pesanan_id: baru ?? null })
      }
      if (tulis.length) await eksekusi('webhook_event.upsert', client.from('webhook_event').upsert(tulis, { onConflict: 'event_id' }))
    }

    snap.set(store, klon(store))
  }

  return { muatStore, simpanStore }
}

/* ========================= DOMAIN SINKRONISASI ============================ */

export function buatStoreSupabaseSync(client) {
  const snap = new WeakMap()
  const ambil = async (tabel) => {
    const { data, error } = await client.from(tabel).select('*')
    if (error) throw new Error(`supabase:${tabel} ${error.message}`)
    return data || []
  }
  const eksekusi = async (nama, p) => {
    const { error } = await p
    if (error) throw new Error(`supabase:${nama} ${error.message}`)
  }

  async function muatStore() {
    const [devRows, barisRows] = await Promise.all([ambil('perangkat'), ambil('baris_sync')])
    const store = { perangkat: {}, baris: {}, versi: 0 }
    for (const r of devRows) {
      store.perangkat[r.id] = {
        id: r.id,
        secret: r.secret,
        nama: r.nama || 'Perangkat',
        terakhirVersi: Number(r.terakhir_versi) || 0,
        terakhirSync: undef(r.terakhir_sync),
        dibuat: r.dibuat,
      }
    }
    for (const r of barisRows) {
      const versi = Number(r.versi) || 0
      store.baris[r.tabel] = store.baris[r.tabel] || {}
      store.baris[r.tabel][r.baris_id] = { ...(r.data || {}), id: r.baris_id, versi, perangkatId: r.perangkat_id }
      if (versi > store.versi) store.versi = versi
    }
    snap.set(store, klon(store))
    return store
  }

  async function simpanStore(store) {
    const sebelum = snap.get(store) || { perangkat: {}, baris: {} }

    /* perangkat */
    {
      const seb = sebelum.perangkat || {}, sesd = store.perangkat || {}
      const tulis = []
      for (const [id, d] of Object.entries(sesd)) {
        if (!eq(seb[id], d)) tulis.push({
          id,
          secret: d.secret,
          nama: d.nama || 'Perangkat',
          terakhir_versi: Number(d.terakhirVersi) || 0,
          terakhir_sync: d.terakhirSync ?? null,
          dibuat: d.dibuat || nowISO(),
        })
      }
      if (tulis.length) await eksekusi('perangkat.upsert', client.from('perangkat').upsert(tulis, { onConflict: 'id' }))
    }

    /* baris_sync — diff per (tabel, baris_id) */
    {
      const seb = sebelum.baris || {}, sesd = store.baris || {}
      const tabel = new Set([...Object.keys(seb), ...Object.keys(sesd)])
      const tulis = []
      for (const t of tabel) {
        const sebT = seb[t] || {}, sesdT = sesd[t] || {}
        const ids = new Set([...Object.keys(sebT), ...Object.keys(sesdT)])
        for (const id of ids) {
          const baru = sesdT[id]
          if (eq(sebT[id], baru)) continue
          if (baru === undefined) {
            await eksekusi('baris_sync.hapus', client.from('baris_sync').delete().eq('tabel', t).eq('baris_id', id))
            continue
          }
          const data = { ...baru }
          delete data.versi
          delete data.perangkatId
          tulis.push({
            tabel: t,
            baris_id: String(id),
            data,
            versi: Number(baru.versi) || 0,
            perangkat_id: baru.perangkatId ?? null,
          })
        }
      }
      if (tulis.length) await eksekusi('baris_sync.upsert', client.from('baris_sync').upsert(tulis, { onConflict: 'tabel,baris_id' }))
    }

    snap.set(store, klon(store))
  }

  return { muatStore, simpanStore }
}
