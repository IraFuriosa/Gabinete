-- 0004_add_demanda_seguimento.sql
-- Adiciona coluna de data de seguimento (follow-up) às demandas ativas.
alter table "Demandas Ativas" add column if not exists data_seguimento date;
