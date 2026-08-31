-- v4.45.0 — Eine Übergabe kann sich auf einzelne Models beziehen.
--
-- Bisher gehörte eine Übergabe der ganzen SCHICHT: wer drei Models betreute,
-- schrieb einen Text, und jeder Nachfolger auf irgendeinem dieser Models bekam
-- ihn. In der Praxis heißt das: „Leonie — Kunde xym will noch was kaufen" landet
-- auch bei jemandem, der Leonie gar nicht übernimmt, sondern zwei ganz andere
-- Models betreut.
--
-- `handover_about` hält fest, um WELCHE Models es in der Übergabe geht.
--
--   NULL oder leer  → betrifft alle Models meiner Schicht (Verhalten wie bisher)
--   {'13','21'}     → nur die Nachfolger auf genau diesen Models bekommen sie
--
-- Model-IDs als Text, wie in `handover_models` — die Schlüssel im Dienstplan
-- (`<model_id>__<tag>__<schicht>`) sind ebenfalls Text.
--
-- MIGRATION ZUERST AUSFÜHREN, vor dem Frontend-Deploy: `ladeUebergaben` im
-- Chatter-Portal selektiert die Spalte namentlich. Fehlt sie, schlägt der ganze
-- Select fehl und die Übergabe schaltet sich still ab — dann gibt es beim
-- Auschecken auch kein Dialogfenster mehr.

alter table public.shift_logs
  add column if not exists handover_about text[];

comment on column public.shift_logs.handover_about is
  'Model-IDs, um die es in dieser Übergabe geht. NULL/leer = alle Models der Schicht.';

-- Kontrolle: Spalte da?
select column_name, data_type
  from information_schema.columns
 where table_name = 'shift_logs' and column_name in ('handover_about', 'handover_models', 'handover_for')
 order by column_name;
