-- v4.46.0 — Übergabe in Abschnitte pro Model.
--
-- Aufbauend auf `handover_about` (v4.45.0, sql/schichtuebergabe-modelbezug.sql).
-- Dort ging es um die Frage „wen geht die Übergabe an?". Hier um die nächste:
-- Wenn zwei Models in der Folgeschicht bei ZWEI VERSCHIEDENEN Leuten liegen,
-- soll nicht jeder den ganzen Text lesen, sondern nur seinen Teil.
--
-- Geschrieben wird die Spalte von `handover-notify` beim Zustellen — nicht vom
-- Portal und nicht vom Bot. Die Zerlegung passiert an genau einer Stelle, sonst
-- laufen drei Fassungen derselben Regel auseinander.
--
--   { "13": "Kunde xym will morgen nochmal kaufen",
--     "44": "nichts Besonderes, war ruhig" }
--
-- `handover_text` bleibt unangetastet der volle Wortlaut — für das Dashboard,
-- die Historie und die Kopie an Chris und Rey.
--
-- VOR dem Frontend-Deploy ausführen. `ladeUebergaben` im Chatter-Portal
-- selektiert die Spalte namentlich; fehlt sie, schlägt der ganze Select fehl und
-- die Übergabe schaltet sich still ab — inklusive Dialogfenster beim Auschecken.
-- Am besten zusammen mit sql/schichtuebergabe-modelbezug.sql in einem Rutsch.
--
-- Der Bot ist unkritisch (er selektiert ohne Spaltenliste), und die Function
-- schreibt best effort: schlägt es fehl, bekommt jeder wie bisher den vollen Text.

alter table public.shift_logs
  add column if not exists handover_parts jsonb;

comment on column public.shift_logs.handover_parts is
  'Übergabe je Model-ID, von handover-notify beim Zustellen gefüllt. NULL = ein Text für alle.';

select column_name, data_type
  from information_schema.columns
 where table_name = 'shift_logs' and column_name like 'handover%'
 order by column_name;
