-- Smart Solutions Kateya: homepage offer posters / promotional banners
-- Additive migration: does not alter products, orders, product_offers, or existing branding.
create extension if not exists pgcrypto;

create table if not exists public.site_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  subtitle text not null default '' check (char_length(subtitle) <= 300),
  image_url text not null check (image_url ~* '^https://'),
  button_text text not null default '' check (char_length(button_text) <= 40),
  link_url text null check (link_url is null or link_url ~* '^https://'),
  start_date timestamptz not null,
  end_date timestamptz not null,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_banners_valid_dates check (end_date > start_date)
);

create index if not exists site_banners_active_dates_idx
  on public.site_banners (is_active, start_date, end_date);
create index if not exists site_banners_sort_order_idx
  on public.site_banners (sort_order, created_at desc);

alter table public.site_banners enable row level security;
-- All reads/writes are handled by server API routes. Admin routes verify Supabase Auth
-- and membership in public.admins; service-role key must remain server-side in Vercel.
