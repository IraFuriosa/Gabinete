-- 0001_enable_rls.sql
-- Item 1 da análise de produção: habilitar Row Level Security em todas as
-- tabelas e restringir acesso a usuários autenticados.
--
-- ATENÇÃO: estas policies permitem a qualquer usuário AUTENTICADO acesso
-- total (leitura/escrita) nas tabelas. Elas já são muito mais seguras do que
-- o estado atual (sem RLS = anon key pública lê/escreve tudo), mas para
-- isolamento por gabinete/usuário será necessário adicionar uma coluna de
-- ownership (ex.: user_id uuid references auth.users) e trocar as policies
-- por filtros `auth.uid() = user_id`.

alter table "Contatos" enable row level security;
alter table "Demandas" enable row level security;
alter table "Demandas Ativas" enable row level security;
alter table "Regioes" enable row level security;

-- Remove policies antigas com mesmo nome, se existirem (idempotente)
drop policy if exists "authenticated_full_access" on "Contatos";
drop policy if exists "authenticated_full_access" on "Demandas";
drop policy if exists "authenticated_full_access" on "Demandas Ativas";
drop policy if exists "authenticated_full_access" on "Regioes";

create policy "authenticated_full_access" on "Contatos"
  for all to authenticated
  using (true) with check (true);

create policy "authenticated_full_access" on "Demandas"
  for all to authenticated
  using (true) with check (true);

create policy "authenticated_full_access" on "Demandas Ativas"
  for all to authenticated
  using (true) with check (true);

create policy "authenticated_full_access" on "Regioes"
  for all to authenticated
  using (true) with check (true);

-- Regioes pode ser somente-leitura para usuários comuns:
-- se for um catálogo fixo, prefira revogar insert/update/delete:
-- drop policy "authenticated_full_access" on "Regioes";
-- create policy "authenticated_read" on "Regioes"
--   for select to authenticated using (true);
