-- Apply after schema.sql and delivery-zones-migration.sql on existing projects.
-- Additive and data-preserving: existing profiles, products, and orders are retained.

alter table public.seller_profiles
  add column if not exists application_status text not null default 'pending',
  add column if not exists application_note text,
  add column if not exists review_note text,
  add column if not exists applied_at timestamptz not null default now();

alter table public.seller_profiles
  drop constraint if exists seller_profiles_application_status_check;
alter table public.seller_profiles
  add constraint seller_profiles_application_status_check
  check (application_status in ('pending','approved','rejected'));

update public.seller_profiles sp
set application_status = case
      when p.role = 'seller' and p.seller_status = 'approved' then 'approved'
      when p.seller_status = 'rejected' then 'rejected'
      else 'pending'
    end,
    applied_at = coalesce(sp.applied_at, sp.created_at)
from public.profiles p
where p.id = sp.user_id;

update public.profiles p
set role = 'customer', seller_status = 'not_applied', updated_at = now()
where p.seller_status = 'pending'
  and not exists(select 1 from public.seller_profiles sp where sp.user_id = p.id);

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
$$;

create or replace function public.can_access_order(p_order_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_active_user() and (
    exists(select 1 from public.orders o where o.id=p_order_id and o.customer_id=auth.uid())
    or exists(select 1 from public.order_items oi where oi.order_id=p_order_id and oi.seller_id=auth.uid() and public.is_approved_seller())
  ))
$$;

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and pg_trigger_depth() < 2 then
    new.role := old.role;
    new.seller_status := old.seller_status;
    new.is_active := old.is_active;
  end if;
  new.updated_at := now();
  return new;
end; $$;

create or replace function public.sync_seller_application_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from public.profiles where id = new.user_id and role = 'admin') then return new; end if;
  update public.profiles
    set role = case when new.application_status = 'approved' then 'seller'::public.app_role else 'customer'::public.app_role end,
        seller_status = new.application_status::public.seller_status,
        updated_at = now()
    where id = new.user_id;
  return new;
end; $$;

drop trigger if exists sync_seller_application_profile_after_write on public.seller_profiles;
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

drop policy if exists "seller can request own store" on public.seller_profiles;
drop policy if exists "active products public read" on public.products;
create policy "active products public read" on public.products for select to anon, authenticated
  using (status='active' or (seller_id=auth.uid() and public.is_approved_seller()) or public.is_admin());
drop policy if exists "sellers delete own draft products" on public.products;
create policy "sellers delete own draft products" on public.products for delete to authenticated
  using ((seller_id=auth.uid() and public.is_approved_seller() and status in ('draft','pending_review')) or public.is_admin());
drop policy if exists "seller sees own payouts" on public.seller_payouts;
create policy "seller sees own payouts" on public.seller_payouts for select to authenticated
  using ((seller_id=auth.uid() and public.is_approved_seller()) or public.is_admin());

create or replace function public.require_active_order_customer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.profiles p where p.id = new.customer_id and p.is_active) then
    raise exception 'An active customer account is required';
  end if;
  return new;
end; $$;
drop trigger if exists require_active_order_customer_before_insert on public.orders;
create trigger require_active_order_customer_before_insert
  before insert on public.orders for each row execute procedure public.require_active_order_customer();

create or replace function public.require_active_transfer_customer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.profiles p where p.id = new.customer_id and p.is_active) then
    raise exception 'An active account is required';
  end if;
  return new;
end; $$;
drop trigger if exists require_active_transfer_customer_before_insert on public.bank_transfer_submissions;
create trigger require_active_transfer_customer_before_insert
  before insert on public.bank_transfer_submissions
  for each row execute procedure public.require_active_transfer_customer();

drop policy if exists "customer uploads own transfer proof" on storage.objects;
create policy "customer uploads own transfer proof" on storage.objects for insert to authenticated
  with check (bucket_id='transfer-proofs' and (storage.foldername(name))[1]=auth.uid()::text and public.is_active_user());

-- User creation always gets the customer role; user metadata cannot request seller/admin privileges.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, full_name, phone)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name',''), nullif(new.raw_user_meta_data->>'phone',''));
  return new;
end; $$;
