-- 0003_create_anexos_bucket.sql
-- Bucket privado para anexos de Contatos e Demandas + policies para
-- usuários autenticados (upload/leitura/exclusão).
insert into storage.buckets (id, name, public)
values ('anexos', 'anexos', false)
on conflict (id) do nothing;

drop policy if exists "authenticated can upload anexos" on storage.objects;
drop policy if exists "authenticated can read anexos" on storage.objects;
drop policy if exists "authenticated can update anexos" on storage.objects;
drop policy if exists "authenticated can delete anexos" on storage.objects;

create policy "authenticated can upload anexos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'anexos');

create policy "authenticated can read anexos" on storage.objects
  for select to authenticated
  using (bucket_id = 'anexos');

create policy "authenticated can update anexos" on storage.objects
  for update to authenticated
  using (bucket_id = 'anexos');

create policy "authenticated can delete anexos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'anexos');
