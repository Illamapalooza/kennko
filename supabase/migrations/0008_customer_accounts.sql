-- Optional customer account, used only for order history. Nullable because
-- guest checkout remains the default path -- most orders will never have one.
alter table orders
  add column customer_user_id uuid references auth.users(id) on delete set null;

create index orders_customer_user_idx on orders (customer_user_id, created_at desc);
create index orders_customer_email_idx on orders (lower(customer_email), created_at desc);

-- A customer may read their own orders: ones placed while signed in, and ones
-- placed as a guest under an address they have since PROVEN is theirs.
-- The email match is gated on email_confirmed_at: without that, anyone could
-- sign up as someone else's address and read their order history.
create policy "customer reads own orders"
  on orders for select using (
    customer_user_id = auth.uid()
    or (
      auth.uid() is not null
      and exists (
        select 1 from auth.users u
        where u.id = auth.uid()
          and u.email_confirmed_at is not null
          and lower(u.email) = lower(orders.customer_email)
      )
    )
  );

create policy "customer reads own order items"
  on order_items for select using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and (
          o.customer_user_id = auth.uid()
          or exists (
            select 1 from auth.users u
            where u.id = auth.uid()
              and u.email_confirmed_at is not null
              and lower(u.email) = lower(o.customer_email)
          )
        )
    )
  );

create policy "customer reads own order item modifiers"
  on order_item_modifiers for select using (
    exists (
      select 1 from order_items i
      join orders o on o.id = i.order_id
      where i.id = order_item_modifiers.order_item_id
        and (
          o.customer_user_id = auth.uid()
          or exists (
            select 1 from auth.users u
            where u.id = auth.uid()
              and u.email_confirmed_at is not null
              and lower(u.email) = lower(o.customer_email)
          )
        )
    )
  );
