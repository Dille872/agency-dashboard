-- ============================================================================
-- 20.09.2026 · shift_swaps: Status "abgelaufen" erlauben
--
-- WAS LOS WAR
-- Seit v4.22.0 schließt `shift-alert` offene Ausschreibungen automatisch:
-- Tag vorbei oder Schicht schon begonnen → status = 'abgelaufen'. Der Code
-- läuft alle fünf Minuten, die Oberfläche kennt den Wert („⏱ Abgelaufen",
-- CommTab; das Chatter-Portal blendet ihn aus) — aber die Prüfregel der
-- Tabelle ließ nur 'offen', 'vorgeschlagen', 'angenommen', 'abgelehnt' zu.
-- Jeder Schreibversuch scheiterte, der Fehler landete nur im Function-Log.
-- Folge: Ausschreibungen blieben ewig auf „offen" stehen (am 20.09. acht
-- Stück, die älteste vom 13.09. für den 19.09.).
--
-- WAS DAS SKRIPT MACHT
-- Nur die Prüfregel ersetzen, sonst nichts. Keine Zeile wird geändert — das
-- Aufräumen übernimmt shift-alert beim nächsten Lauf (max. 5 Minuten).
--
-- Wiederholbar. Rückbau: dieselbe Regel ohne 'abgelaufen' setzen — dann
-- müssten vorher alle abgelaufenen Zeilen umgestellt werden.
-- ============================================================================

alter table public.shift_swaps drop constraint if exists shift_swaps_status_check;

alter table public.shift_swaps add constraint shift_swaps_status_check
  check (status = any (array['offen', 'vorgeschlagen', 'angenommen', 'abgelehnt', 'abgelaufen']));

-- ── Kontrolle ───────────────────────────────────────────────────────────────
-- Regel:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.shift_swaps'::regclass;
-- Nach spätestens 5 Minuten sollten die alten Ausschreibungen umspringen:
--   select status, count(*) from public.shift_swaps group by status;
