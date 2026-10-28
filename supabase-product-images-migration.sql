-- Smart Solutions Kateya: multiple product images (safe additive migration)
-- Run once in Supabase SQL Editor. Existing image_url values are preserved and copied into image_urls.
alter table public.products add column if not exists image_urls jsonb not null default '[]'::jsonb;
update public.products set image_urls = jsonb_build_array(image_url) where image_url is not null and (image_urls = '[]'::jsonb or image_urls is null);
