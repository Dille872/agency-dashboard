-- ─────────────────────────────────────────────────────────────────────────────
-- v4.34.0 · Schichtübergabe
--
-- Einmalig im Supabase SQL-Editor ausführen. Idempotent — mehrfaches Ausführen
-- schadet nicht.
--
-- WARUM an `shift_logs` und nicht in einer eigenen Tabelle:
-- Eine Übergabe gehört zu genau einer gearbeiteten Schicht. Sie entsteht beim
-- Auschecken und endet, wenn die nächste Person sie gelesen hat. Damit hängt sie
-- natürlich am Schicht-Log — kein zweiter Datenbestand, der auseinanderlaufen kann,
-- und der Verlauf steht automatisch neben Check-in und Check-out.
--
-- Felder:
--   handover_text  Der Übergabe-Text. NULL = es gab nichts zu übergeben.
--   handover_at    Wann sie geschrieben wurde (in der Regel = checked_out_at).
--   handover_ack   Namen derer, die sie gelesen und bestätigt haben.
--                  Array, weil bei mehreren parallelen Schichten mehrere Leute
--                  dieselbe Übergabe sehen — jeder bestätigt für sich.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.shift_logs
  add column if not exists handover_text text,
  add column if not exists handover_at   timestamptz,
  add column if not exists handover_ack  text[] not null default '{}';

-- Die Abfrage beim Check-in sucht offene Übergaben der letzten Stunden.
-- Ohne Index würde dafür die komplette Log-Historie gelesen.
create index if not exists shift_logs_handover_offen_idx
  on public.shift_logs (checked_out_at desc)
  where handover_text is not null;

-- Gegenprobe nach dem Ausführen:
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'shift_logs' and column_name like 'handover%';
-- Erwartet: drei Zeilen (handover_text text, handover_at timestamptz, handover_ack ARRAY).
