-- Public-read, owner-write. Deliberately a SEPARATE bucket from Plan 3's
-- payment-proofs, which is fully private: sharing one bucket would mean making
-- customer payment receipts public in order to serve menu photos.
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

create policy "public reads menu images"
  on storage.objects for select
  using (bucket_id = 'menu-images');

create policy "owner uploads menu images"
  on storage.objects for insert
  with check (bucket_id = 'menu-images' and public.is_owner());

create policy "owner replaces menu images"
  on storage.objects for update
  using (bucket_id = 'menu-images' and public.is_owner());

create policy "owner deletes menu images"
  on storage.objects for delete
  using (bucket_id = 'menu-images' and public.is_owner());
