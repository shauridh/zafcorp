-- ============================================================================
-- Kasir SABANA — skema Supabase (Postgres)
-- Domain: (1) order/portal delivery, (2) sinkronisasi multi-perangkat.
--
-- Model akses:
--   * SEMUA baca/tulis API lewat service role (dipakai Vercel Functions).
--     Service role melewati RLS — jangan pernah dipakai di klien.
--   * Klien (papan kasir / portal) TIDAK membaca tabel langsung. Event realtime
--     memakai Realtime *broadcast* (ephemeral, tanpa baca baris), jadi tabel
--     berisi PII pelanggan aman dari akses anon.
--   * RLS: enable di semua tabel, tanpa policy untuk anon/authenticated →
--     deny by default. (Tabel hanya diakses service role.)
--
-- Waktu disimpan sebagai TEXT ISO UTC 'YYYY-MM-DDTHH:MM:SS' (tanpa akhiran Z),
-- persis format yang dipakai aplikasi (penampil mengonversi ke WIB).
-- ============================================================================

-- Urutan global untuk sinkronisasi (LWW: penulis terakhir menang per id)
create sequence if not exists global_versi_seq;

-- Nomor pesanan berurutan (mulai 101, sesuai pola lama: 100 + urutan)
create sequence if not exists no_pesanan_seq start 101;

-- ============================ DOMAIN ORDER ==================================

-- Profil & PIN pelanggan (register wajib PIN; scrypt di sisi aplikasi)
create table if not exists pelanggan (
  hp                text primary key,          -- digit-only (sanitasi di aplikasi)
  nama              text not null default '',
  alamat_terakhir   text,
  jumlah_pesanan    integer not null default 0,
  total             bigint  not null default 0,
  terakhir_pesan    text,                       -- ISO UTC
  rating_rata       numeric(3,1),
  pin_hash          text,                       -- 'scrypt$salt$hash'
  dibuat            text not null default to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
);

-- Sesi pelanggan (token acak UUIDv4)
create table if not exists sesi (
  token   text primary key,
  hp      text not null references pelanggan(hp) on delete cascade,
  nama    text not null default '',
  dibuat  text not null default to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
);
create index if not exists idx_sesi_hp on sesi (hp);

-- Pesanan (kolom kompleks sebagai jsonb — bentuk asli dari aplikasi)
create table if not exists pesanan (
  id                 uuid primary key default gen_random_uuid(),
  no                 integer not null default nextval('no_pesanan_seq') unique,
  waktu_buat         text not null default to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
  nama               text not null,
  hp                 text not null,
  alamat             text not null,
  catatan            text,
  jarak_km           numeric(5,1) not null default 0,
  ongkir             integer not null default 0,
  gratis             boolean not null default false,
  subtotal           integer not null default 0,
  total              integer not null default 0,
  metode             text,                      -- null | qris | transfer | cod
  status_pembayaran  text not null default 'belum',  -- belum|menunggu-verifikasi|lunas|refund|cod
  status             text not null default 'cek',    -- cek|menunggu-bayar|baru|dibuat|siap|diantar|selesai|batal
  bukti_nama         text,
  nominal_unik       integer,
  transaksi_id       text,
  issuer             text,
  verifikasi_otomatis boolean not null default false,
  sumber_verifikasi  text,                      -- qris-bridge | gateway
  alasan_batal       text,
  rentang_bayar      text,                      -- ISO UTC (jendela pencocokan)
  items              jsonb not null default '[]'::jsonb,
  pesan              jsonb not null default '[]'::jsonb,   -- thread chat
  riwayat            jsonb not null default '[]'::jsonb,
  refund             jsonb,
  penilaian          jsonb
);
create index if not exists idx_pesanan_hp    on pesanan (hp);
create index if not exists idx_pesanan_status on pesanan (status);
create index if not exists idx_pesanan_nominal on pesanan (nominal_unik);

-- Pengaturan kasir (satu baris jsonb) — tarif, QRIS, gateway, bridge
create table if not exists pengaturan (
  id   integer primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb
);

-- Langganan push notification pelanggan (web-push)
create table if not exists push_sub (
  hp        text not null,
  endpoint  text not null,
  data      jsonb not null,       -- { endpoint, keys: {p256dh, auth} }
  dibuat    text not null default to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
  primary key (hp, endpoint)
);

-- Dedup event webhook QRIS Bridge (event_id dari qrishook)
create table if not exists webhook_event (
  event_id    text primary key,
  pesanan_id  uuid,
  diterima    text not null default to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
);

-- Kunci VAPID (di-generate sekali oleh aplikasi; dipakai web-push)
create table if not exists vapid (
  id          integer primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null
);

-- ===================== DOMAIN SINKRONISASI (LWW) ============================

-- Perangkat kasir terdaftar (id + secret wajib utk /api/sync)
create table if not exists perangkat (
  id             uuid primary key default gen_random_uuid(),
  secret         uuid not null default gen_random_uuid(),
  nama           text not null default 'Perangkat',
  terakhir_versi bigint not null default 0,
  terakhir_sync  text,
  dibuat         text not null default to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
);

-- Baris tersinkron — satu baris per (tabel, id baris lokal). versi = counter
-- global; perangkat menarik baris dengan versi > terakhir_versi miliknya.
create table if not exists baris_sync (
  tabel        text not null,          -- bahan|produk|transaksi|… (15 tabel inti)
  baris_id     text not null,
  data         jsonb not null,
  versi        bigint not null default nextval('global_versi_seq'),
  perangkat_id uuid not null,
  diperbarui   text not null default to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
  primary key (tabel, baris_id)
);
create index if not exists idx_baris_sync_tarik on baris_sync (tabel, versi);

-- ============================ RLS ===========================================
-- Default deny untuk anon/authenticated. Service role (server) bypass RLS.
-- Bila kelak perlu akses langsung dari klien (mis. Realtime postgres_changes),
-- tambahkan policy SELECT eksplisit per tabel — JANGAN buka pesanan/pelanggan.

do $$
declare t text;
begin
  foreach t in array array['pelanggan','sesi','pesanan','pengaturan','push_sub',
                          'webhook_event','vapid','perangkat','baris_sync']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ============================================================================
-- Catatan migrasi / kebijakan:
--  * KASIR_SECRET, CORS_ORIGIN, SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY adalah
--    env di Vercel — bukan tabel.
--  * VAPID: generate sekali (row vapid id=1) atau simpan di env VAPID_PUBLIC/
--    VAPID_PRIVATE bila ingin menghindari baca tabel tiap request.
--  * polling gateway 20 dtk tidak bisa jalan di serverless → ganti: webhook
--    QRIS Bridge sebagai trigger utama + polling per-pesanan oleh klien
--    (sudah ada di portal) + opsional pg_cron (lihat contoh di bawah).
-- ============================================================================

-- Contoh pg_cron (opsional) — verifikasi gateway tiap 5 menit:
--   create extension if not exists pg_cron;
--   select cron.schedule('cek-gateway', '*/5 * * * *',
--     $$select net.http_post(
--         url := current_setting('app.vercel_fn_url', true),
--         headers := jsonb_build_object('Content-Type','application/json',
--                                       'Authorization', 'Bearer ' || current_setting('app.vercel_cron_token', true)),
--         body := jsonb_build_object('aksi','cek-gateway'))$$);
