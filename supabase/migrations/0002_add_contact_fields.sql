-- 0002_add_contact_fields.sql
-- Adiciona colunas CPF e Cartão SUS à tabela Contatos.
alter table "Contatos" add column if not exists cpf text;
alter table "Contatos" add column if not exists cartao_sus text;
