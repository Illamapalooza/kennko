-- The policies in 0008 read auth.users directly. Neither `anon` nor
-- `authenticated` holds SELECT on that table, so those policies raised
-- "permission denied for table users" instead of evaluating -- meaning they
-- never actually granted a customer access, and anon saw an error mentioning
-- internal tables rather than a clean empty result.
--
-- Same fix as is_owner(): a SECURITY DEFINER helper with a pinned search_path.
drop policy if exists "customer reads own orders" on orders;
drop policy if exists "customer reads own order items" on order_items;
drop policy if exists "customer reads own order item modifiers" on order_item_modifiers;

create or replace function public.owns_order(order_user_id uuid, order_email text)
returns boolean
language sql
security definer
stable
set search_path = public, auth, pg_temp
as $$
  select
    auth.uid() is not null
    and (
      order_user_id = auth.uid()
      or exists (
        select 1 from auth.users u
        where u.id = auth.uid()
          and u.email_confirmed_at is not null
          and lower(u.email) = lower(order_email)
      )
    );
$$;

revoke all on function public.owns_order(uuid, text) from public;
grant execute on function public.owns_order(uuid, text) to authenticated;

create policy "customer reads own orders"
  on orders for select
  using (public.owns_order(customer_user_id, customer_email));

create policy "customer reads own order items"
  on order_items for select using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and public.owns_order(o.customer_user_id, o.customer_email)
    )
  );

create policy "customer reads own order item modifiers"
  on order_item_modifiers for select using (
    exists (
      select 1 from order_items i
      join orders o on o.id = i.order_id
      where i.id = order_item_modifiers.order_item_id
        and public.owns_order(o.customer_user_id, o.customer_email)
    )
  );
