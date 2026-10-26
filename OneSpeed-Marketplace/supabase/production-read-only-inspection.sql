-- READ ONLY: Run in the SQL Editor of the Supabase project shown by Render.
-- Select and run each query separately. Do not run schema.sql until these results
-- have been reviewed and the project's backup/recovery point is confirmed.

-- 1. Confirm the SQL Editor context. Compare the project reference in the
-- Supabase Dashboard URL with the hostname configured on the Render service.
select current_database() as database_name,
       current_user as sql_editor_role,
       current_schema() as current_schema,
       now() as inspected_at;

-- 2. Report OneSpeed core and operations tables as physically present in public.
with expected(table_name, installation_group) as (
  values
    ('profiles', 'core'), ('seller_profiles', 'core'), ('categories', 'core'),
    ('products', 'core'), ('delivery_zones', 'core'), ('orders', 'core'),
    ('order_items', 'core'), ('bank_transfer_submissions', 'core'),
    ('seller_payouts', 'core'), ('reviews', 'core'), ('support_tickets', 'core'),
    ('audit_logs', 'core'), ('customer_addresses', 'operations'),
    ('wishlist_items', 'operations'), ('notifications', 'operations'),
    ('order_status_history', 'operations')
)
select expected.installation_group,
       expected.table_name,
       to_regclass(format('public.%I', expected.table_name)) is not null as exists_in_public
from expected
order by installation_group, table_name;

-- 3. Inventory all existing public tables, views and materialized views.
select table_name, table_type
from information_schema.tables
where table_schema = 'public'
order by table_type, table_name;

-- 4. Inspect columns for all public application tables. This is intentionally
-- broad so partial installs and unrelated existing application tables are visible.
select table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default, is_generated, generation_expression
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 5. Compare the storefront's selected product columns with the actual table.
-- This is a catalog-only check; it reads no product records.
with expected(column_name, expected_type) as (
  values
    ('id', 'uuid'), ('title', 'text'), ('description', 'text'),
    ('price', 'numeric'), ('currency', 'character'), ('category', 'text'),
    ('stock', 'integer'), ('image_url', 'text'), ('images', 'jsonb'),
    ('seller_id', 'uuid'), ('created_at', 'timestamp with time zone'),
    ('status', 'USER-DEFINED'), ('moderation_note', 'text'),
    ('search_document', 'tsvector')
)
select expected.column_name,
       expected.expected_type,
       actual.data_type as actual_type,
       actual.udt_name as actual_udt_name,
       case
         when actual.column_name is null then 'MISSING'
         when actual.data_type <> expected.expected_type then 'TYPE MISMATCH'
         else 'OK'
       end as comparison
from expected
left join information_schema.columns actual
  on actual.table_schema = 'public'
 and actual.table_name = 'products'
 and actual.column_name = expected.column_name
order by expected.column_name;

-- 6. Primary keys, unique constraints, checks, and foreign keys in public.
select table_name, constraint_name, constraint_type,
       is_deferrable, initially_deferred
from information_schema.table_constraints
where constraint_schema = 'public'
  and table_name in (
    'profiles', 'seller_profiles', 'categories', 'products', 'delivery_zones',
    'orders', 'order_items', 'bank_transfer_submissions', 'seller_payouts',
    'reviews', 'support_tickets', 'audit_logs', 'customer_addresses',
    'wishlist_items', 'notifications', 'order_status_history'
  )
order by table_name, constraint_type, constraint_name;

select tc.table_name, tc.constraint_name, kcu.column_name,
       ccu.table_name as referenced_table, ccu.column_name as referenced_column
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_name = tc.table_name
join information_schema.constraint_column_usage ccu
  on ccu.constraint_schema = tc.constraint_schema
 and ccu.constraint_name = tc.constraint_name
where tc.constraint_schema = 'public'
  and tc.constraint_type = 'FOREIGN KEY'
order by tc.table_name, tc.constraint_name, kcu.ordinal_position;

-- 7. Indexes and definitions for relevant public tables.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'profiles', 'seller_profiles', 'categories', 'products', 'delivery_zones',
    'orders', 'order_items', 'bank_transfer_submissions', 'seller_payouts',
    'reviews', 'support_tickets', 'audit_logs', 'customer_addresses',
    'wishlist_items', 'notifications', 'order_status_history'
  )
order by tablename, indexname;

-- 8. RLS status, including whether RLS is forced.
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

-- 9. Existing RLS policies, roles, commands, USING and WITH CHECK expressions.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;

-- 10. Triggers and their definitions for marketplace tables.
select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name,
       pg_get_triggerdef(t.oid, true) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal
  and n.nspname in ('public', 'auth', 'storage')
order by n.nspname, c.relname, t.tgname;

-- 11. Marketplace functions, including SECURITY DEFINER definitions.
select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       pg_get_function_result(p.oid) as result_type,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_admin', 'is_active_user', 'is_approved_seller', 'can_access_order',
    'handle_new_user', 'protect_profile_privileges', 'sync_seller_application_profile',
    'apply_seller_application', 'admin_review_seller_application',
    'match_delivery_zone', 'quote_delivery_fee', 'place_order',
    'submit_bank_transfer', 'admin_review_bank_transfer',
    'record_order_status_change', 'audit_product_change',
    'notify_seller_application_review', 'update_seller_store_profile',
    'notify_transfer_review', 'touch_customer_address',
    'mark_notification_read', 'create_product_review',
    'admin_review_product_review', 'open_support_ticket',
    'admin_reply_support_ticket', 'admin_set_order_status',
    'admin_review_seller_payout', 'admin_list_users', 'admin_set_user_active',
    'require_active_order_customer', 'require_active_transfer_customer'
  )
order by p.proname, arguments;

-- 12. Grants relevant to public storefront reads. NULL means the table does
-- not physically exist under public at inspection time.
select role_name,
       case when to_regclass('public.products') is null then null
            else has_table_privilege(role_name, to_regclass('public.products'), 'SELECT')
       end as can_select_products,
       case when to_regclass('public.categories') is null then null
            else has_table_privilege(role_name, to_regclass('public.categories'), 'SELECT')
       end as can_select_categories
from (values ('anon'::name), ('authenticated'::name)) roles(role_name);

-- 13. Storage buckets and object policies (no file contents are read).
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('product-images', 'transfer-proofs')
order by id;

-- 14. Migration tracking table presence. Supabase SQL Editor runs may not be
-- recorded in CLI migration history; do not treat an empty history as proof
-- that no SQL was previously applied.
select to_regclass('supabase_migrations.schema_migrations') as migration_history_table;

-- Only if the preceding result is non-NULL, run this separate read-only query:
-- select version, name from supabase_migrations.schema_migrations order by version;

-- Only after confirming public.products exists, check whether it contains
-- active listings. This reads counts only and invents or changes no data.
-- select count(*) as total_products,
--        count(*) filter (where status = 'active') as active_products
-- from public.products;
