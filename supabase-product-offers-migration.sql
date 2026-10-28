-- Smart Solutions Kateya: Offers & Festivals migration
-- Review the existing products table and backup your database before applying.
-- product_id is TEXT deliberately, to accommodate the current app's product ID representation.
create extension if not exists pgcrypto;

create table if not exists public.product_offers (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  title text not null check (char_length(trim(title)) between 1 and 120),
  discount_type text not null check (discount_type in ('percentage','fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  start_date timestamptz not null,
  end_date timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_offers_valid_dates check (end_date > start_date),
  constraint product_offers_valid_percentage check (discount_type <> 'percentage' or discount_value <= 100)
);
create index if not exists product_offers_product_id_idx on public.product_offers(product_id);
create index if not exists product_offers_active_dates_idx on public.product_offers(is_active,start_date,end_date);
alter table public.product_offers enable row level security;
-- Browser clients should not write this table directly. Server APIs use the service-role key
-- only on the server and enforce Supabase Auth + public.admins membership.
