-- Staff logins separated from staff.id, a manager role, till PINs, and paired till devices.
--
-- staff.id keeps its value for every existing row, so every FK to staff(id)
-- (orders, payments, order events, menu snapshots, push subscriptions) keeps
-- pointing at the same person. The website login moves to staff.user_id,
-- backfilled from id. New people may have no login at all (baristas on the till).

-- 1. staff.id no longer is the auth user.
alter table staff drop constraint staff_id_fkey;
alter table staff alter column id set default gen_random_uuid();

-- 2. The website login.
alter table staff add column user_id uuid;
update staff set user_id = id;
alter table staff
  add constraint staff_user_id_key unique (user_id),
  add constraint staff_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

-- 3. role: enum -> text + check (no new enums), with a manager role.
alter table staff alter column role drop default;
alter table staff alter column role type text using role::text;
alter table staff alter column role set default 'barista';
alter table staff add constraint staff_role_check check (role in ('owner', 'manager', 'barista'));
drop type staff_role;

-- 4. A barista without a login has no email. Still unique when present.
alter table staff alter column email drop not null;

-- 5. Till PINs (scrypt hash, see @kennko/core/staff-pin).
alter table staff
  add column pin_hash text,
  add column pin_updated_at timestamptz,
  add column updated_at timestamptz not null default now();

-- 6. An owner always has a website login.
alter table staff add constraint staff_owner_has_login check (role <> 'owner' or user_id is not null);

-- 7. Helpers and policies now match the login, not the row id. Same SECURITY
-- DEFINER + pinned search_path as 0002 (no RLS recursion, no shadowing).
create or replace function public.is_active_staff()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where user_id = auth.uid() and is_active
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where user_id = auth.uid() and is_active and role = 'owner'
  );
$$;

drop policy "staff read own row or owner reads all" on staff;
create policy "staff read own row or owner reads all"
  on staff for select using (user_id = auth.uid() or public.is_owner());

-- Staff writes go through the API (POST /v1/staff and friends).
drop policy "owner inserts staff" on staff;
drop policy "owner updates staff" on staff;

-- 8. The website reads staff without pin_hash and cannot write it.
revoke select, insert, update on staff from authenticated;
grant select (id, user_id, email, full_name, role, is_active, created_at, pin_updated_at) on staff to authenticated;

grant select, insert, update on staff to kennko_api;
create policy "api inserts staff" on staff for insert to kennko_api with check (true);
create policy "api updates staff" on staff for update to kennko_api using (true) with check (true);

-- 9. Paired tills. Only hashes are stored: the device token's SHA-256 and the
-- pairing code's hash. A pending device has a pairing code and no token.
create table devices (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 1 and 40),
  ticket_series      text not null default 'C' check (ticket_series = 'C'),
  token_hash         text unique,
  pairing_code_hash  text,
  pairing_expires_at timestamptz,
  pairing_attempts   int not null default 0 check (pairing_attempts >= 0),
  paired_at          timestamptz,
  paired_by          uuid references staff(id),
  last_seen_at       timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index devices_pending_code on devices (pairing_code_hash) where pairing_code_hash is not null;

alter table devices enable row level security;
revoke all on devices from anon, authenticated;

grant select, insert, update on devices to kennko_api;
create policy "api reads devices" on devices for select to kennko_api using (true);
create policy "api inserts devices" on devices for insert to kennko_api with check (true);
create policy "api updates devices" on devices for update to kennko_api using (true) with check (true);
