-- ─────────────────────────────────────────────────────────────────────────────
-- v4.36.0 · Empfängerkreis der Schichtübergabe
--
-- Einmalig im Supabase SQL-Editor ausführen. Idempotent.
--
-- WARUM: Bis v4.35.1 waren Zustellung und Anzeige unterschiedlich streng.
-- Verschickt wurde gezielt an die, die laut Dienstplan übernehmen — angezeigt
-- wurde die Übergabe aber JEDEM, der innerhalb von 16 Stunden das Portal öffnete
-- oder /on schickte. Dadurch konnte sie jemand abhaken, der mit der Schicht gar
-- nichts zu tun hatte, und das „gelesen von …" im Schicht-Log sagte nichts mehr
-- darüber aus, ob die richtige Person es gesehen hat.
--
-- `handover-notify` ermittelt den Empfängerkreis ohnehin. Ab jetzt schreibt es ihn
-- mit — Portal und Bot filtern einfach danach, statt die Plan-Logik ein zweites
-- Mal nachzubauen.
--
-- Drei Zustände, bewusst unterschieden:
--   NULL          Empfänger wurden nie ermittelt (Altbestand, oder die Function
--                 war nicht erreichbar). Notnagel: die Übergabe bleibt für alle
--                 sichtbar — eine verlorene Information ist schlimmer als eine,
--                 die einer zu viel liest.
--   '{}' (leer)   Ermittelt, aber im Plan steht niemand. Erscheint bei keinem
--                 Chatter; Chris und Rey haben sie per Telegram und im Schicht-Log.
--   {Namen}       Genau diese Leute sehen und bestätigen sie.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.shift_logs
  add column if not exists handover_for text[];

-- Gegenprobe:
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'shift_logs' and column_name = 'handover_for';
-- Erwartet: eine Zeile (handover_for, ARRAY).
