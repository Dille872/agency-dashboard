-- ============================================================================
-- v4.61.0 · Team-Kalender Stufe 2 — nur Spalten hinzufügen, nichts ändern
--   online_status.zeitzone          Zeitzone des Browsers (für Telegram-Texte
--                                   in der Zeit des Empfängers)
--   team_kalender.erinnerung_gesendet  Erinnerung X Min vorher schon raus?
-- ============================================================================
alter table public.online_status add column if not exists zeitzone text;
alter table public.team_kalender add column if not exists erinnerung_gesendet boolean not null default false;
