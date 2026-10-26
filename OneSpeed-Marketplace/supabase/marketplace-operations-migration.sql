-- Add after schema.sql and the existing delivery/auth onboarding migrations.
-- Additive customer/seller/admin capabilities with explicit ownership policies.

alter table public.products
  add column if not exists moderation_note text,
  add column if not exists search_document tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'C')
  ) stored;
create index if not exists products_search_document_idx
  on public.products using gin(search_document);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'Home',
  full_name text not null,
  phone text not null,
  address text not null,
  city text not null,
  state text,
  postal_code text,
  country text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (length(trim(full_name)) > 0 and length(trim(phone)) > 0),
  check (length(trim(address)) > 0 and length(trim(city)) > 0 and length(trim(country)) > 0)
);
create index if not exists customer_addresses_owner_idx
  on public.customer_addresses(customer_id, is_default desc, updated_at desc);
create unique index if not exists customer_addresses_single_default_idx
  on public.customer_addresses(customer_id) where is_default;
alter table public.customer_addresses enable row level security;
drop policy if exists "customers manage own addresses" on public.customer_addresses;
create policy "customers manage own addresses" on public.customer_addresses
  for all to authenticated using (customer_id = auth.uid() and public.is_active_user())
  with check (customer_id = auth.uid() and public.is_active_user());

create table if not exists public.wishlist_items (
  customer_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, product_id)
);
alter table public.wishlist_items enable row level security;
drop policy if exists "customers manage own wishlist" on public.wishlist_items;
create policy "customers manage own wishlist" on public.wishlist_items
  for all to authenticated using (customer_id = auth.uid() and public.is_active_user())
  with check (customer_id = auth.uid() and public.is_active_user());

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  message text not null check (length(trim(message)) between 1 and 1000),
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_owner_recent_idx
  on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid() and public.is_active_user());
revoke insert, update, delete on public.notifications from anon, authenticated;

create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  status public.order_status not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_idx
  on public.order_status_history(order_id, created_at);
alter table public.order_status_history enable row level security;
drop policy if exists "order parties read status history" on public.order_status_history;
create policy "order parties read status history" on public.order_status_history
  for select to authenticated using (public.can_access_order(order_id));
revoke insert, update, delete on public.order_status_history from anon, authenticated;

alter table public.seller_payouts
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists admin_note text;

create or replace function public.record_order_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_seller record;
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history(order_id, actor_id, status, note)
      values(new.id, auth.uid(), new.status, 'Order created');
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;

  insert into public.order_status_history(order_id, actor_id, status, note)
    values(new.id, auth.uid(), new.status, null);

  insert into public.notifications(user_id, title, message, href)
    values(new.customer_id, 'Order status updated',
      'Order ' || new.order_number || ' is now ' || replace(new.status::text, '_', ' ') || '.',
      '/order-success.html?id=' || new.id);

  for v_seller in
    select distinct seller_id from public.order_items where order_id = new.id
  loop
    insert into public.notifications(user_id, title, message, href)
      values(v_seller.seller_id, 'Order status updated',
        'An order containing your product is now ' || replace(new.status::text, '_', ' ') || '.',
        '/seller.html');
  end loop;

  if new.status = 'paid' and old.status <> 'paid' then
    insert into public.seller_payouts(seller_id, order_item_id, gross_amount, commission_amount, net_amount)
    select oi.seller_id, oi.id, oi.line_total,
      round(oi.line_total * coalesce(sp.commission_rate, 10) / 100, 2),
      oi.line_total - round(oi.line_total * coalesce(sp.commission_rate, 10) / 100, 2)
    from public.order_items oi
    left join public.seller_profiles sp on sp.user_id = oi.seller_id
    where oi.order_id = new.id
    on conflict (order_item_id) do nothing;
  end if;

  if new.status in ('cancelled','refunded') and old.status not in ('cancelled','refunded') then
    update public.seller_payouts set status = 'reversed'
      where order_item_id in (select id from public.order_items where order_id = new.id)
        and status in ('pending','approved');
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values(auth.uid(), 'order_status_changed', 'order', new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status));
  return new;
end; $$;

drop trigger if exists record_order_status_change_after_insert on public.orders;
create trigger record_order_status_change_after_insert after insert on public.orders
  for each row execute function public.record_order_status_change();
drop trigger if exists record_order_status_change_after_update on public.orders;
create trigger record_order_status_change_after_update after update of status on public.orders
  for each row execute function public.record_order_status_change();

create or replace function public.audit_product_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
      values(auth.uid(), 'product_created', 'product', new.id::text,
        jsonb_build_object('seller_id', new.seller_id, 'status', new.status));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
      values(auth.uid(), 'product_status_changed', 'product', new.id::text,
        jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end; $$;
drop trigger if exists audit_product_change_after_write on public.products;
create trigger audit_product_change_after_write after insert or update of status on public.products
  for each row execute function public.audit_product_change();

create or replace function public.notify_seller_application_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.application_status is distinct from old.application_status
    and new.application_status in ('approved','rejected') then
    insert into public.notifications(user_id, title, message, href)
      values(new.user_id,
        case when new.application_status = 'approved' then 'Seller application approved' else 'Seller application update' end,
        case when new.application_status = 'approved' then 'Your store is approved. Seller tools are now available.'
          else coalesce(nullif(new.review_note,''), 'Your application was not approved. You may update and resubmit it.') end,
        '/seller.html');
  end if;
  return new;
end; $$;
drop trigger if exists notify_seller_application_review_after_update on public.seller_profiles;
create trigger notify_seller_application_review_after_update after update of application_status on public.seller_profiles
  for each row execute function public.notify_seller_application_review();

create or replace function public.update_seller_store_profile(
  p_store_name text, p_description text, p_support_email text,
  p_contact_phone text, p_address jsonb
) returns public.seller_profiles language plpgsql security definer set search_path = public as $$
declare v_store public.seller_profiles;
begin
  if auth.uid() is null or not public.is_approved_seller() then raise exception 'Approved seller access is required'; end if;
  if length(trim(coalesce(p_store_name,''))) not between 2 and 120
    or length(trim(coalesce(p_description,''))) not between 10 and 3000
    or length(trim(coalesce(p_contact_phone,''))) < 5 then
    raise exception 'Enter a valid store name, description, and contact phone';
  end if;
  update public.seller_profiles set
    store_name = trim(p_store_name), description = trim(p_description),
    support_email = nullif(trim(coalesce(p_support_email,'')),''),
    contact_phone = trim(p_contact_phone), address = coalesce(p_address,'{}'::jsonb)
  where user_id = auth.uid() and application_status = 'approved'
  returning * into v_store;
  if not found then raise exception 'Approved store profile not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values(auth.uid(), 'seller_store_profile_updated', 'seller_profile', auth.uid()::text,
      jsonb_build_object('store_name', v_store.store_name));
  return v_store;
end; $$;
revoke all on function public.update_seller_store_profile(text,text,text,text,jsonb) from public;
grant execute on function public.update_seller_store_profile(text,text,text,text,jsonb) to authenticated;

create or replace function public.notify_transfer_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.notifications(user_id, title, message, href)
      values(new.customer_id, 'Bank transfer reviewed',
        case when new.status = 'approved' then 'Your bank transfer was verified and the order is paid.'
          else coalesce(nullif(new.admin_note,''), 'Your bank transfer was not approved. Review the note and contact support if needed.') end,
        '/account.html');
  end if;
  return new;
end; $$;
drop trigger if exists notify_transfer_review_after_update on public.bank_transfer_submissions;
create trigger notify_transfer_review_after_update after update of status on public.bank_transfer_submissions
  for each row execute function public.notify_transfer_review();

create or replace function public.touch_customer_address()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.is_default then
    update public.customer_addresses set is_default = false
      where customer_id = new.customer_id and id <> new.id and is_default;
  end if;
  return new;
end; $$;
drop trigger if exists touch_customer_address_before_write on public.customer_addresses;
create trigger touch_customer_address_before_write before insert or update on public.customer_addresses
  for each row execute function public.touch_customer_address();

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'An active account is required'; end if;
  update public.notifications set read_at = coalesce(read_at, now())
    where id = p_notification_id and user_id = auth.uid();
  if not found then raise exception 'Notification not found'; end if;
end; $$;
revoke all on function public.mark_notification_read(uuid) from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.create_product_review(
  p_product_id uuid, p_order_id uuid, p_rating integer, p_body text default ''
) returns public.reviews language plpgsql security definer set search_path = public as $$
declare v_review public.reviews;
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'An active customer account is required'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating must be between 1 and 5'; end if;
  if length(trim(coalesce(p_body,''))) > 3000 then raise exception 'Review text is too long'; end if;
  if not exists(select 1 from public.order_items oi where oi.order_id = p_order_id
      and oi.product_id = p_product_id
      and exists(select 1 from public.orders o where o.id = oi.order_id
        and o.customer_id = auth.uid() and o.status in ('paid','processing','shipped','delivered'))) then
    raise exception 'A completed purchase of this product is required to review it';
  end if;
  insert into public.reviews(product_id, customer_id, order_id, rating, body, is_published)
    values(p_product_id, auth.uid(), p_order_id, p_rating, trim(coalesce(p_body,'')), false)
    returning * into v_review;
  return v_review;
end; $$;
revoke all on function public.create_product_review(uuid,uuid,integer,text) from public;
grant execute on function public.create_product_review(uuid,uuid,integer,text) to authenticated;
drop policy if exists "customer creates review" on public.reviews;
drop policy if exists "admin reviews submissions" on public.reviews;
revoke insert, update, delete on public.reviews from anon, authenticated;
create policy "admin reviews submissions" on public.reviews for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_review_product_review(
  p_review_id uuid, p_publish boolean
) returns public.reviews language plpgsql security definer set search_path = public as $$
declare v_review public.reviews;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  update public.reviews set is_published = p_publish where id = p_review_id returning * into v_review;
  if not found then raise exception 'Review not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values(auth.uid(), case when p_publish then 'review_published' else 'review_rejected' end,
      'review', p_review_id::text, '{}'::jsonb);
  return v_review;
end; $$;
revoke all on function public.admin_review_product_review(uuid,boolean) from public;
grant execute on function public.admin_review_product_review(uuid,boolean) to authenticated;

create or replace function public.open_support_ticket(
  p_subject text, p_message text, p_order_id uuid default null
) returns public.support_tickets language plpgsql security definer set search_path = public as $$
declare v_ticket public.support_tickets;
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'An active account is required'; end if;
  if length(trim(coalesce(p_subject,''))) not between 4 and 160
    or length(trim(coalesce(p_message,''))) not between 10 and 5000 then
    raise exception 'Enter a subject and a message between 10 and 5000 characters';
  end if;
  if p_order_id is not null and not exists(select 1 from public.orders
      where id = p_order_id and customer_id = auth.uid()) then raise exception 'Order not found'; end if;
  insert into public.support_tickets(customer_id, order_id, subject, message)
    values(auth.uid(), p_order_id, trim(p_subject), trim(p_message)) returning * into v_ticket;
  insert into public.notifications(user_id, title, message, href)
    values(auth.uid(), 'Support request received', 'Your request "' || v_ticket.subject || '" is open.',
      '/support.html');
  return v_ticket;
end; $$;
revoke all on function public.open_support_ticket(text,text,uuid) from public;
grant execute on function public.open_support_ticket(text,text,uuid) to authenticated;
drop policy if exists "customer opens support ticket" on public.support_tickets;
create policy "customer opens support ticket" on public.support_tickets for insert to authenticated
  with check (customer_id = auth.uid() and status = 'open' and admin_reply is null);
revoke update, delete on public.support_tickets from anon, authenticated;

create or replace function public.admin_reply_support_ticket(
  p_ticket_id uuid, p_status text, p_reply text
) returns public.support_tickets language plpgsql security definer set search_path = public as $$
declare v_ticket public.support_tickets;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('in_progress','resolved','closed') then raise exception 'Invalid support status'; end if;
  if length(trim(coalesce(p_reply,''))) not between 1 and 5000 then raise exception 'Enter a reply'; end if;
  update public.support_tickets set status = p_status, admin_reply = trim(p_reply), updated_at = now()
    where id = p_ticket_id returning * into v_ticket;
  if not found then raise exception 'Support request not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values(auth.uid(), 'support_ticket_replied', 'support_ticket', p_ticket_id::text,
      jsonb_build_object('status', p_status));
  insert into public.notifications(user_id, title, message, href)
    values(v_ticket.customer_id, 'Support replied', 'There is an update to "' || v_ticket.subject || '".',
      '/support.html');
  return v_ticket;
end; $$;
revoke all on function public.admin_reply_support_ticket(uuid,text,text) from public;
grant execute on function public.admin_reply_support_ticket(uuid,text,text) to authenticated;

create or replace function public.admin_set_order_status(
  p_order_id uuid, p_status public.order_status, p_tracking_number text default null, p_carrier text default null
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_order public.orders;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (
    (v_order.status = 'paid' and p_status in ('processing','cancelled','refund_pending'))
    or (v_order.status = 'processing' and p_status in ('shipped','cancelled','refund_pending'))
    or (v_order.status = 'shipped' and p_status in ('delivered','refund_pending'))
    or (v_order.status = 'refund_pending' and p_status in ('refunded','processing'))
    or (v_order.status = 'pending_payment' and p_status = 'cancelled')
  ) then raise exception 'Invalid order status transition'; end if;
  if p_status = 'shipped' and length(trim(coalesce(p_tracking_number,''))) < 3 then
    raise exception 'A tracking number is required before shipping';
  end if;
  update public.orders set status = p_status,
    tracking_number = case when p_status = 'shipped' then trim(p_tracking_number) else coalesce(nullif(trim(p_tracking_number),''), tracking_number) end,
    carrier = coalesce(nullif(trim(p_carrier),''), carrier),
    updated_at = now()
    where id = p_order_id returning * into v_order;
  return v_order;
end; $$;
revoke all on function public.admin_set_order_status(uuid,public.order_status,text,text) from public;
grant execute on function public.admin_set_order_status(uuid,public.order_status,text,text) to authenticated;
drop policy if exists "admin updates orders" on public.orders;
revoke update on public.orders from anon, authenticated;

create or replace function public.admin_review_seller_payout(
  p_payout_id uuid, p_action text, p_reference text default null, p_note text default null
) returns public.seller_payouts language plpgsql security definer set search_path = public as $$
declare v_payout public.seller_payouts;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_action is null or p_action not in ('approve','record_paid','reverse') then
    raise exception 'Invalid payout action';
  end if;
  select * into v_payout from public.seller_payouts where id = p_payout_id for update;
  if not found then raise exception 'Payout record not found'; end if;
  if p_action = 'approve' and v_payout.status <> 'pending' then raise exception 'Only pending payouts can be approved'; end if;
  if p_action = 'record_paid' and (v_payout.status <> 'approved' or length(trim(coalesce(p_reference,''))) < 3) then
    raise exception 'Approve the payout first and enter the confirmed transfer reference';
  end if;
  if p_action = 'reverse' and v_payout.status not in ('pending','approved') then raise exception 'This payout cannot be reversed'; end if;
  update public.seller_payouts set
    status = case p_action when 'approve' then 'approved' when 'record_paid' then 'paid' else 'reversed' end,
    payout_reference = case when p_action = 'record_paid' then trim(p_reference) else payout_reference end,
    paid_at = case when p_action = 'record_paid' then now() else paid_at end,
    reviewed_by = auth.uid(), reviewed_at = now(), admin_note = nullif(trim(coalesce(p_note,'')),'')
    where id = p_payout_id returning * into v_payout;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values(auth.uid(), 'seller_payout_' || p_action, 'seller_payout', p_payout_id::text,
      jsonb_build_object('reference', v_payout.payout_reference, 'note', v_payout.admin_note));
  insert into public.notifications(user_id, title, message, href)
    values(v_payout.seller_id, 'Payout status updated',
      case p_action when 'approve' then 'A seller payout was approved.'
        when 'record_paid' then 'A payout was recorded with transfer reference ' || v_payout.payout_reference || '.'
        else coalesce(v_payout.admin_note, 'A payout was reversed.') end,
      '/seller.html');
  return v_payout;
end; $$;
revoke all on function public.admin_review_seller_payout(uuid,text,text,text) from public;
grant execute on function public.admin_review_seller_payout(uuid,text,text,text) to authenticated;
drop policy if exists "seller sees own payouts" on public.seller_payouts;
drop policy if exists "parties read seller payouts" on public.seller_payouts;
create policy "parties read seller payouts" on public.seller_payouts for select to authenticated
  using ((seller_id = auth.uid() and public.is_approved_seller()) or public.is_admin());
revoke insert, update, delete on public.seller_payouts from anon, authenticated;

create or replace function public.admin_list_users(p_query text default '', p_limit integer default 100)
returns table(id uuid, email text, full_name text, phone text, role public.app_role,
  seller_status public.seller_status, is_active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  return query
    select p.id, u.email::text, p.full_name, p.phone, p.role, p.seller_status, p.is_active, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    where coalesce(p_query,'') = ''
      or p.full_name ilike '%' || p_query || '%'
      or u.email ilike '%' || p_query || '%'
      or p.phone ilike '%' || p_query || '%'
    order by p.created_at desc limit greatest(1, least(coalesce(p_limit,100), 200));
end; $$;
revoke all on function public.admin_list_users(text,integer) from public;
grant execute on function public.admin_list_users(text,integer) to authenticated;

create or replace function public.admin_set_user_active(p_user_id uuid, p_active boolean, p_note text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_user_id = auth.uid() and not p_active then raise exception 'You cannot deactivate your own administrator account'; end if;
  update public.profiles set is_active = p_active, updated_at = now()
    where id = p_user_id and role <> 'admin' returning * into v_profile;
  if not found then raise exception 'Customer or seller profile not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values(auth.uid(), case when p_active then 'account_reactivated' else 'account_suspended' end,
      'profile', p_user_id::text, jsonb_build_object('note', nullif(trim(coalesce(p_note,'')),'')));
  return v_profile;
end; $$;
revoke all on function public.admin_set_user_active(uuid,boolean,text) from public;
grant execute on function public.admin_set_user_active(uuid,boolean,text) to authenticated;

-- Keep customer review data and operational records private; public reads only published reviews.
drop policy if exists "admin reads audit logs" on public.audit_logs;
create policy "admin reads audit logs" on public.audit_logs for select to authenticated using (public.is_admin());
grant select on public.customer_addresses, public.wishlist_items, public.notifications,
  public.order_status_history to authenticated;
grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.customer_addresses, public.wishlist_items to authenticated;
