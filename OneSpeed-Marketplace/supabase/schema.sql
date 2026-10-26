-- OneSpeed Marketplace production foundation for Supabase PostgreSQL.
-- Run in Supabase SQL Editor. Review the policies and configure the first admin manually.
begin;

do $$
begin
  if exists (
    select 1
    from unnest(array[
      'profiles', 'seller_profiles', 'categories', 'products', 'delivery_zones',
      'orders', 'order_items', 'bank_transfer_submissions', 'seller_payouts',
      'reviews', 'support_tickets', 'audit_logs'
    ]) as required_table(name)
    where to_regclass(format('public.%I', required_table.name)) is not null
  ) then
    raise exception 'OneSpeed core tables already exist. Do not rerun the base schema; inspect the project and apply only missing migrations.';
  end if;
end;
$$;

create extension if not exists pgcrypto;

create type public.app_role as enum ('customer','seller','admin');
create type public.seller_status as enum ('not_applied','pending','approved','rejected','suspended');
create type public.product_status as enum ('draft','pending_review','active','rejected','archived');
create type public.order_status as enum ('pending_payment','payment_review','paid','processing','shipped','delivered','cancelled','refund_pending','refunded');
create type public.transfer_status as enum ('pending_review','approved','rejected');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '', phone text, role public.app_role not null default 'customer',
  seller_status public.seller_status not null default 'not_applied',
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.seller_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  store_name text not null, store_slug text not null unique, description text not null default '',
  support_email text, contact_phone text, address jsonb not null default '{}'::jsonb,
  application_status text not null default 'pending' check (application_status in ('pending','approved','rejected')),
  application_note text, review_note text, applied_at timestamptz not null default now(),
  commission_rate numeric(5,2) not null default 10 check (commission_rate >= 0 and commission_rate <= 50),
  approved_at timestamptz, created_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), name text not null unique, slug text not null unique,
  image_url text, is_active boolean not null default true, sort_order integer not null default 0
);
create table public.products (
  id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (length(title) between 2 and 180), slug text not null,
  description text not null default '', price numeric(12,2) not null check (price >= 0), currency char(3) not null default 'NGN',
  category text not null, stock integer not null default 0 check (stock >= 0), sku text,
  image_url text, images jsonb not null default '[]'::jsonb,
  status public.product_status not null default 'pending_review',
  moderation_note text,
  search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(seller_id, slug), unique(seller_id, sku)
);
insert into public.categories(name,slug,sort_order) values
('Fashion & Apparel','fashion-apparel',1),('Electronics & Gadgets','electronics-gadgets',2),('Home & Living','home-living',3),
('Beauty & Personal Care','beauty-personal-care',4),('Groceries & Essentials','groceries-essentials',5),('Sports & Outdoors','sports-outdoors',6),
('Automotive','automotive',7),('Pets & Accessories','pets-accessories',8)
on conflict(slug) do nothing;
create index products_active_category_idx on public.products(category, created_at desc) where status = 'active';
create index products_seller_idx on public.products(seller_id, created_at desc);
create index products_search_document_idx on public.products using gin(search_document);
create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  country text not null check (length(trim(country)) > 0),
  state text check (state is null or length(trim(state)) > 0),
  city text check (city is null or length(trim(city)) > 0),
  fee numeric(12,2) not null default 0 check (fee >= 0),
  currency char(3) not null default 'NGN',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index delivery_zones_location_unique on public.delivery_zones
  (lower(trim(country)), coalesce(lower(trim(state)),''), coalesce(lower(trim(city)),''));
create table public.orders (
  id uuid primary key default gen_random_uuid(), order_number text not null unique default ('OS-' || upper(substr(encode(gen_random_bytes(8),'hex'),1,12))),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  status public.order_status not null default 'pending_payment', currency char(3) not null default 'NGN',
  subtotal numeric(12,2) not null check (subtotal >= 0), shipping_amount numeric(12,2) not null default 0 check (shipping_amount >= 0),
  total numeric(12,2) not null check (total >= 0), shipping_address jsonb not null,
  customer_note text, tracking_number text, carrier text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null, seller_id uuid not null references public.profiles(id) on delete restrict,
  product_title text not null, product_image_url text, quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0), line_total numeric(12,2) generated always as (quantity * unit_price) stored
);
create index order_items_seller_idx on public.order_items(seller_id, order_id);
create table public.bank_transfer_submissions (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0), currency char(3) not null,
  bank_reference text not null, sender_name text not null, proof_path text,
  status public.transfer_status not null default 'pending_review', admin_note text,
  reviewed_by uuid references public.profiles(id) on delete set null, reviewed_at timestamptz,
  created_at timestamptz not null default now(), unique(customer_id, bank_reference)
);
create table public.seller_payouts (
  id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.profiles(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  gross_amount numeric(12,2) not null check (gross_amount >= 0), commission_amount numeric(12,2) not null check (commission_amount >= 0),
  net_amount numeric(12,2) not null check (net_amount >= 0), status text not null default 'pending' check (status in ('pending','approved','paid','reversed')),
  payout_reference text, paid_at timestamptz, created_at timestamptz not null default now(), unique(order_item_id)
);
create table public.reviews (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  rating integer not null check (rating between 1 and 5), body text not null default '', is_published boolean not null default false,
  created_at timestamptz not null default now(), unique(product_id, customer_id, order_id)
);
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null, subject text not null, message text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  admin_reply text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles(id) on delete set null,
  action text not null, entity_type text not null, entity_id text, details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.is_active)
$$;
create or replace function public.is_active_user() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
$$;
create or replace function public.is_approved_seller() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'seller' and p.seller_status = 'approved' and p.is_active)
$$;
create or replace function public.can_access_order(p_order_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_active_user() and (
    exists(select 1 from public.orders o where o.id=p_order_id and o.customer_id=auth.uid())
    or exists(select 1 from public.order_items oi where oi.order_id=p_order_id and oi.seller_id=auth.uid() and public.is_approved_seller())
  ))
$$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'phone',''));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
create or replace function public.protect_profile_privileges() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and pg_trigger_depth() < 2 then
    new.role := old.role;
    new.seller_status := old.seller_status;
    new.is_active := old.is_active;
  end if;
  new.updated_at := now();
  return new;
end; $$;
create trigger protect_profile_privileges_before_update before update on public.profiles for each row execute procedure public.protect_profile_privileges();
create or replace function public.sync_seller_application_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from public.profiles where id = new.user_id and role = 'admin') then return new; end if;
  update public.profiles
    set role = case when new.application_status = 'approved' then 'seller'::public.app_role else 'customer'::public.app_role end,
        seller_status = new.application_status::public.seller_status,
        updated_at = now()
    where id = new.user_id;
  return new;
end; $$;
create trigger sync_seller_application_profile_after_write
  after insert or update of application_status on public.seller_profiles
  for each row execute procedure public.sync_seller_application_profile();

create or replace function public.apply_seller_application(
  p_store_name text, p_store_slug text, p_description text, p_support_email text,
  p_contact_phone text, p_address jsonb, p_application_note text default null
) returns public.seller_profiles language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
  v_application public.seller_profiles;
  v_slug text;
begin
  if v_user_id is null then raise exception 'Sign in is required'; end if;
  select * into v_profile from public.profiles where id = v_user_id for update;
  if not found or not v_profile.is_active then raise exception 'An active customer account is required'; end if;
  if v_profile.role = 'admin' then raise exception 'Administrator accounts cannot apply for seller access'; end if;
  if v_profile.role = 'seller' and v_profile.seller_status = 'approved' then raise exception 'This account is already an approved seller'; end if;
  if v_profile.seller_status not in ('not_applied','rejected')
    and not (v_profile.seller_status = 'pending' and not exists(select 1 from public.seller_profiles where user_id = v_user_id)) then
    raise exception 'A seller application is already awaiting review';
  end if;
  if length(trim(coalesce(p_store_name,''))) not between 2 and 120
    or length(trim(coalesce(p_description,''))) not between 10 and 3000 then
    raise exception 'Enter a store name and a business description';
  end if;
  v_slug := trim(both '-' from regexp_replace(lower(trim(coalesce(p_store_slug,''))), '[^a-z0-9]+', '-', 'g'));
  if length(v_slug) < 2 then
    v_slug := trim(both '-' from regexp_replace(lower(trim(p_store_name)), '[^a-z0-9]+', '-', 'g'));
  end if;
  v_slug := left(v_slug, 90) || '-' || substr(replace(v_user_id::text, '-', ''), 1, 8);
  insert into public.seller_profiles(
    user_id, store_name, store_slug, description, support_email, contact_phone, address,
    application_status, application_note, applied_at, approved_at
  ) values (
    v_user_id, trim(p_store_name), v_slug, trim(p_description),
    nullif(trim(coalesce(p_support_email,'')),''), nullif(trim(coalesce(p_contact_phone,'')), ''),
    coalesce(p_address,'{}'::jsonb), 'pending', nullif(trim(coalesce(p_application_note,'')),''), now(), null
  )
  on conflict (user_id) do update set
    store_name = excluded.store_name, store_slug = excluded.store_slug,
    description = excluded.description, support_email = excluded.support_email,
    contact_phone = excluded.contact_phone, address = excluded.address,
    application_status = 'pending', application_note = excluded.application_note,
    review_note = null, applied_at = now(), approved_at = null
  returning * into v_application;
  return v_application;
end; $$;
revoke all on function public.apply_seller_application(text,text,text,text,text,jsonb,text) from public;
grant execute on function public.apply_seller_application(text,text,text,text,text,jsonb,text) to authenticated;

create or replace function public.admin_review_seller_application(
  p_user_id uuid, p_approve boolean, p_note text default null
) returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found or v_profile.role = 'admin' or v_profile.seller_status <> 'pending' then raise exception 'No pending seller application found'; end if;
  if not exists(select 1 from public.seller_profiles where user_id = p_user_id and application_status = 'pending') then
    raise exception 'Seller application details are missing';
  end if;
  update public.seller_profiles
    set application_status = case when p_approve then 'approved' else 'rejected' end,
        review_note = case when p_approve then null else nullif(trim(coalesce(p_note,'')),'') end,
        applied_at = applied_at,
        approved_at = case when p_approve then now() else null end
    where user_id = p_user_id;
  select * into v_profile from public.profiles where id = p_user_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values(auth.uid(), case when p_approve then 'seller_application_approved' else 'seller_application_rejected' end,
      'seller_profile', p_user_id::text, jsonb_build_object('note', nullif(trim(coalesce(p_note,'')),'')));
  return v_profile;
end; $$;
revoke all on function public.admin_review_seller_application(uuid,boolean,text) from public;
grant execute on function public.admin_review_seller_application(uuid,boolean,text) to authenticated;

create or replace function public.match_delivery_zone(p_country text, p_state text, p_city text)
returns setof public.delivery_zones language sql stable security definer set search_path = public as $$
  select z from public.delivery_zones z
  where z.is_active
    and lower(trim(z.country)) = lower(trim(p_country))
    and (z.state is null or lower(trim(z.state)) = lower(trim(coalesce(p_state,''))))
    and (z.city is null or lower(trim(z.city)) = lower(trim(coalesce(p_city,''))))
  order by (z.city is not null) desc, (z.state is not null) desc, z.updated_at desc
  limit 1
$$;
revoke all on function public.match_delivery_zone(text,text,text) from public;
create or replace function public.quote_delivery_fee(p_country text, p_state text, p_city text, p_currency char(3))
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_zone public.delivery_zones;
begin
  select * into v_zone from public.match_delivery_zone(p_country, p_state, p_city);
  if found then
    if v_zone.currency <> p_currency then
      return jsonb_build_object('available', false, 'message', 'The delivery zone fee currency does not match the order currency.');
    end if;
    return jsonb_build_object('available', true, 'fee', v_zone.fee, 'currency', v_zone.currency, 'zone_name', v_zone.name);
  end if;
  if exists(select 1 from public.delivery_zones where is_active) then
    return jsonb_build_object('available', false, 'message', 'Delivery is not available for this address.');
  end if;
  return jsonb_build_object('available', true, 'fee', 0, 'currency', p_currency, 'zone_name', null);
end; $$;
revoke all on function public.quote_delivery_fee(text,text,text,char) from public;
grant execute on function public.quote_delivery_fee(text,text,text,char) to authenticated;
-- Create orders transactionally from server-trusted product prices; clients cannot choose unit prices or sellers.
create or replace function public.place_order(p_items jsonb, p_shipping_address jsonb, p_currency char(3) default 'NGN', p_shipping_amount numeric default 0)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid := auth.uid(); v_order public.orders; v_item jsonb; v_product public.products; v_qty integer;
  v_subtotal numeric(12,2) := 0; v_total numeric(12,2); v_shipping_amount numeric(12,2) := 0;
  v_zone public.delivery_zones;
begin
  if v_customer is null then raise exception 'Sign in is required'; end if;
  if not public.is_active_user() then raise exception 'An active customer account is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Order must contain items'; end if;
  if p_shipping_address is null or p_shipping_address = '{}'::jsonb then raise exception 'Shipping address is required'; end if;
  if nullif(trim(p_shipping_address->>'address'),'') is null
    or nullif(trim(p_shipping_address->>'city'),'') is null
    or nullif(trim(p_shipping_address->>'country'),'') is null then
    raise exception 'Street address, city, and country are required';
  end if;
  if (p_shipping_address ? 'latitude') <> (p_shipping_address ? 'longitude') then
    raise exception 'Both delivery coordinates must be provided together';
  end if;
  if p_shipping_address ? 'latitude' and (
    jsonb_typeof(p_shipping_address->'latitude') <> 'number'
    or jsonb_typeof(p_shipping_address->'longitude') <> 'number'
    or (p_shipping_address->>'latitude')::numeric not between -90 and 90
    or (p_shipping_address->>'longitude')::numeric not between -180 and 180
  ) then raise exception 'Invalid delivery coordinates'; end if;
  if coalesce(p_shipping_address->>'method','standard') not in ('standard','express') then
    raise exception 'Invalid shipping method';
  end if;
  select * into v_zone from public.match_delivery_zone(
    p_shipping_address->>'country', p_shipping_address->>'state', p_shipping_address->>'city'
  );
  if found then
    if v_zone.currency <> p_currency then raise exception 'Delivery zone fee currency does not match the order currency'; end if;
    v_shipping_amount := v_zone.fee;
  elsif exists(select 1 from public.delivery_zones where is_active) then
    raise exception 'Delivery is not available for this address';
  end if;
  if p_shipping_address->>'method' = 'express' then v_shipping_amount := v_shipping_amount + 5.99; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty < 1 or v_qty > 100 then raise exception 'Invalid item quantity'; end if;
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and status='active' for update;
    if not found then raise exception 'A product is unavailable'; end if;
    if v_product.currency <> p_currency then raise exception 'All products must use the selected currency'; end if;
    if v_product.stock < v_qty then raise exception 'Insufficient stock for %', v_product.title; end if;
    v_subtotal := v_subtotal + v_product.price * v_qty;
  end loop;
  v_total := v_subtotal + v_shipping_amount;
  insert into public.orders(customer_id,status,currency,subtotal,shipping_amount,total,shipping_address)
  values(v_customer,'pending_payment',p_currency,v_subtotal,v_shipping_amount,v_total,p_shipping_address) returning * into v_order;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and status='active' for update;
    if v_product.stock < v_qty then raise exception 'Insufficient stock for %', v_product.title; end if;
    insert into public.order_items(order_id,product_id,seller_id,product_title,product_image_url,quantity,unit_price)
    values(v_order.id,v_product.id,v_product.seller_id,v_product.title,v_product.image_url,v_qty,v_product.price);
    update public.products set stock=stock-v_qty, updated_at=now() where id=v_product.id;
  end loop;
  return v_order;
end; $$;
revoke all on function public.place_order(jsonb,jsonb,char,numeric) from public;
grant execute on function public.place_order(jsonb,jsonb,char,numeric) to authenticated;

alter table public.profiles enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.seller_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.bank_transfer_submissions enable row level security;
alter table public.seller_payouts enable row level security;
alter table public.reviews enable row level security;
alter table public.support_tickets enable row level security;
alter table public.audit_logs enable row level security;

create policy "profile read own or admin" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "admins manage delivery zones" on public.delivery_zones for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "profile update own basic fields" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "admin manage profiles" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "active categories public read" on public.categories for select to anon, authenticated using (is_active or public.is_admin());
create policy "seller store public and own read" on public.seller_profiles for select to anon, authenticated using (exists(select 1 from public.profiles p where p.id=user_id and p.seller_status='approved') or user_id=auth.uid() or public.is_admin());
create policy "admin manages seller stores" on public.seller_profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "active products public read" on public.products for select to anon, authenticated using (status='active' or (seller_id=auth.uid() and public.is_approved_seller()) or public.is_admin());
create policy "approved sellers create products" on public.products for insert to authenticated with check (seller_id=auth.uid() and public.is_approved_seller() and status in ('draft','pending_review'));
create policy "sellers update own products" on public.products for update to authenticated using ((seller_id=auth.uid() and public.is_approved_seller()) or public.is_admin()) with check ((seller_id=auth.uid() and public.is_approved_seller() and status in ('draft','pending_review','archived')) or public.is_admin());
create policy "sellers delete own draft products" on public.products for delete to authenticated using ((seller_id=auth.uid() and public.is_approved_seller() and status in ('draft','pending_review')) or public.is_admin());
create policy "parties read order" on public.orders for select to authenticated using (public.can_access_order(id));
create policy "admin updates orders" on public.orders for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "order item visible to parties" on public.order_items for select to authenticated using (public.can_access_order(order_id));
create policy "transfer submissions parties read" on public.bank_transfer_submissions for select to authenticated using (customer_id=auth.uid() or public.is_admin());
create policy "customer submits transfer for own order" on public.bank_transfer_submissions for insert to authenticated with check (customer_id=auth.uid() and exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid() and o.status in ('pending_payment','payment_review')));
create policy "admin reviews transfer" on public.bank_transfer_submissions for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "seller sees own payouts" on public.seller_payouts for select to authenticated using ((seller_id=auth.uid() and public.is_approved_seller()) or public.is_admin());
create policy "published reviews read" on public.reviews for select to anon, authenticated using (is_published or customer_id=auth.uid() or public.is_admin());
create policy "customer creates review" on public.reviews for insert to authenticated with check (customer_id=auth.uid() and exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid() and o.status in ('paid','processing','shipped','delivered')));
create policy "customer reads own support tickets" on public.support_tickets for select to authenticated using (customer_id=auth.uid() or public.is_admin());
create policy "customer opens support ticket" on public.support_tickets for insert to authenticated with check (customer_id=auth.uid());
create policy "admin manages support" on public.support_tickets for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin reads audit logs" on public.audit_logs for select to authenticated using (public.is_admin());

-- Storage: product images public for storefront, but writes restricted to the authenticated user's folder.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp','image/avif']),
('transfer-proofs','transfer-proofs',false,8388608,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
create policy "public read product images" on storage.objects for select to anon, authenticated using (bucket_id='product-images');
create policy "users upload product images to own folder" on storage.objects for insert to authenticated with check (bucket_id='product-images' and (storage.foldername(name))[1]=auth.uid()::text and (public.is_approved_seller() or public.is_admin()));
create policy "seller updates own product images" on storage.objects for update to authenticated using (bucket_id='product-images' and (storage.foldername(name))[1]=auth.uid()::text and (public.is_approved_seller() or public.is_admin())) with check (bucket_id='product-images' and (storage.foldername(name))[1]=auth.uid()::text and (public.is_approved_seller() or public.is_admin()));
create policy "seller deletes own product images" on storage.objects for delete to authenticated using (bucket_id='product-images' and (storage.foldername(name))[1]=auth.uid()::text and (public.is_approved_seller() or public.is_admin()));
create policy "owner reads own transfer proof" on storage.objects for select to authenticated using (bucket_id='transfer-proofs' and (storage.foldername(name))[1]=auth.uid()::text or bucket_id='transfer-proofs' and public.is_admin());
create policy "customer uploads own transfer proof" on storage.objects for insert to authenticated with check (bucket_id='transfer-proofs' and (storage.foldername(name))[1]=auth.uid()::text and public.is_active_user());

-- Customer submits a bank transfer for their own order; amount/currency must match the server order total.
create or replace function public.submit_bank_transfer(p_order_id uuid, p_amount numeric, p_currency char(3), p_reference text, p_sender_name text, p_proof_path text default null)
returns public.bank_transfer_submissions language plpgsql security definer set search_path = public as $$
declare v_order public.orders; v_submission public.bank_transfer_submissions;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if not public.is_active_user() then raise exception 'An active account is required'; end if;
  select * into v_order from public.orders where id=p_order_id and customer_id=auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status not in ('pending_payment','payment_review') then raise exception 'This order is not awaiting payment'; end if;
  if p_amount <> v_order.total or p_currency <> v_order.currency then raise exception 'Transfer amount and currency must match the order total'; end if;
  if length(trim(coalesce(p_reference,''))) < 3 or length(trim(coalesce(p_sender_name,''))) < 2 then raise exception 'Enter a valid transfer reference and sender name'; end if;
  if p_proof_path is not null and split_part(p_proof_path,'/',1) <> auth.uid()::text then raise exception 'Invalid receipt path'; end if;
  insert into public.bank_transfer_submissions(order_id,customer_id,amount,currency,bank_reference,sender_name,proof_path)
  values(v_order.id,auth.uid(),p_amount,p_currency,trim(p_reference),trim(p_sender_name),p_proof_path) returning * into v_submission;
  update public.orders set status='payment_review', updated_at=now() where id=v_order.id;
  return v_submission;
end; $$;
revoke all on function public.submit_bank_transfer(uuid,numeric,char,text,text,text) from public;
grant execute on function public.submit_bank_transfer(uuid,numeric,char,text,text,text) to authenticated;

create or replace function public.admin_review_bank_transfer(p_submission_id uuid, p_approve boolean, p_note text default null)
returns public.bank_transfer_submissions language plpgsql security definer set search_path = public as $$
declare v_submission public.bank_transfer_submissions;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into v_submission from public.bank_transfer_submissions where id=p_submission_id for update;
  if not found then raise exception 'Transfer submission not found'; end if;
  if v_submission.status <> 'pending_review' then raise exception 'This transfer has already been reviewed'; end if;
  update public.bank_transfer_submissions set status=case when p_approve then 'approved'::public.transfer_status else 'rejected'::public.transfer_status end,
    admin_note=nullif(trim(coalesce(p_note,'')),''), reviewed_by=auth.uid(), reviewed_at=now() where id=p_submission_id returning * into v_submission;
  if p_approve then update public.orders set status='paid', updated_at=now() where id=v_submission.order_id and status='payment_review';
  else update public.orders set status='pending_payment', updated_at=now() where id=v_submission.order_id and status='payment_review'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(auth.uid(),case when p_approve then 'bank_transfer_approved' else 'bank_transfer_rejected' end,'bank_transfer',p_submission_id::text,jsonb_build_object('order_id',v_submission.order_id,'note',p_note));
  return v_submission;
end; $$;
revoke all on function public.admin_review_bank_transfer(uuid,boolean,text) from public;
grant execute on function public.admin_review_bank_transfer(uuid,boolean,text) to authenticated;

-- Secure setup: after signing up, promote the intended platform administrator manually in SQL Editor:
-- update public.profiles set role='admin' where id=(select id from auth.users where email='YOUR-ADMIN-EMAIL');
-- Never put a service_role key in browser code. Configure Auth redirect URLs and SMTP before launch.

commit;
