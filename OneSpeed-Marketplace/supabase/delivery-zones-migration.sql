-- Apply after schema.sql on projects that already have the original schema installed.
begin;

create table if not exists public.delivery_zones (
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
create unique index if not exists delivery_zones_location_unique on public.delivery_zones
  (lower(trim(country)), coalesce(lower(trim(state)),''), coalesce(lower(trim(city)),''));
alter table public.delivery_zones enable row level security;
drop policy if exists "admins manage delivery zones" on public.delivery_zones;
create policy "admins manage delivery zones" on public.delivery_zones
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

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

create or replace function public.place_order(p_items jsonb, p_shipping_address jsonb, p_currency char(3) default 'NGN', p_shipping_amount numeric default 0)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_customer uuid := auth.uid(); v_order public.orders; v_item jsonb; v_product public.products; v_qty integer;
  v_subtotal numeric(12,2) := 0; v_total numeric(12,2); v_shipping_amount numeric(12,2) := 0;
  v_zone public.delivery_zones;
begin
  if v_customer is null then raise exception 'Sign in is required'; end if;
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

commit;
