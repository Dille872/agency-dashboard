-- ─────────────────────────────────────────────────────────────────────────────
-- v4.35.0 · Nachtrag zum Index der Schichtübergabe
--
-- Einmalig im Supabase SQL-Editor ausführen, nach `schichtuebergabe.sql`.
-- Idempotent — mehrfaches Ausführen schadet nicht.
--
-- WARUM: Die Abfrage „welche Übergaben sind für mich offen?" grenzt seit v4.35.0
-- über `handover_at` ein statt über `checked_out_at`. Grund: eine per Telegram
-- (`/uebergabe`) während der LAUFENDEN Schicht geschriebene Übergabe hat noch
-- gar kein Check-out — über `checked_out_at` wäre sie unsichtbar gewesen,
-- obwohl die Telegram-Nachricht längst draußen ist und zum Bestätigen auffordert.
--
-- Der alte Index passt damit nicht mehr zur Abfrage. Er wird ersetzt, nicht
-- ergänzt: zwei Indizes auf derselben Teilmenge kosten nur Schreibaufwand.
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists shift_logs_handover_at_idx
  on public.shift_logs (handover_at desc)
  where handover_text is not null;

drop index if exists shift_logs_handover_offen_idx;

-- Gegenprobe:
--   select indexname from pg_indexes
--   where tablename = 'shift_logs' and indexname like '%handover%';
-- Erwartet: genau eine Zeile — shift_logs_handover_at_idx.
