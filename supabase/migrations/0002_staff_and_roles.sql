create type staff_role as enum ('owner', 'barista');

create table staff (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  full_name  text not null,
  role       staff_role not null default 'barista',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table staff enable row level security;

-- SECURITY DEFINER so these can read `staff` without tripping its own RLS,
-- which would otherwise recurse. search_path is pinned so a caller cannot
-- shadow `staff` with a table of their own and vote themselves owner.
create or replace function public.is_active_staff()
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff
    where id = auth.uid() and is_active
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
    where id = auth.uid() and is_active and role = 'owner'
  );
$$;

create policy "staff read own row or owner reads all"
  on staff for select using (id = auth.uid() or public.is_owner());

create policy "owner inserts staff"
  on staff for insert with check (public.is_owner());

create policy "owner updates staff"
  on staff for update using (public.is_owner());

-- No delete policy: staff are deactivated, never deleted, so that
-- `orders.verified_by` in Plan 3 keeps pointing at a real person.
