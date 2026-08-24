alter table menu_items add column is_archived boolean not null default false;

-- Archived items disappear from the public menu. Replaces the Plan 1 policy,
-- which predated this column.
drop policy "public reads items in active categories" on menu_items;

create policy "public reads live items in active categories"
  on menu_items for select using (
    not is_archived
    and exists (
      select 1 from menu_categories c
      where c.id = menu_items.category_id and c.is_active
    )
  );

-- Staff see everything, archived included, so the owner can un-archive.
create policy "staff read all items"
  on menu_items for select using (public.is_active_staff());

create policy "staff read all categories"
  on menu_categories for select using (public.is_active_staff());

create policy "staff update items"
  on menu_items for update using (public.is_active_staff());

create policy "owner inserts items"
  on menu_items for insert with check (public.is_owner());

create policy "owner deletes items"
  on menu_items for delete using (public.is_owner());

create policy "owner writes categories"
  on menu_categories for all using (public.is_owner()) with check (public.is_owner());

create policy "owner writes prices"
  on menu_item_prices for all using (public.is_owner()) with check (public.is_owner());

create policy "owner writes modifier groups"
  on modifier_groups for all using (public.is_owner()) with check (public.is_owner());

create policy "owner writes modifiers"
  on modifiers for all using (public.is_owner()) with check (public.is_owner());

-- A barista may flip availability and nothing else. Without this, the
-- "staff update items" policy above would let a barista rename a drink or
-- clear its photo.
create or replace function public.guard_menu_item_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_owner() then
    return new;
  end if;

  if new.id            is distinct from old.id
     or new.category_id   is distinct from old.category_id
     or new.name          is distinct from old.name
     or new.description   is distinct from old.description
     or new.image_path    is distinct from old.image_path
     or new.is_bestseller is distinct from old.is_bestseller
     or new.sort_order    is distinct from old.sort_order
     or new.is_archived   is distinct from old.is_archived
  then
    raise exception 'Only an owner may change menu item fields other than availability'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_menu_item_columns_trg
  before update on menu_items
  for each row execute function public.guard_menu_item_columns();
