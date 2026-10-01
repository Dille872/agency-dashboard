-- ── Model-Termine: Endzeit + „nicht erreichbar" (v4.97.0) ──────────────────
--
-- Wunsch Christoph (23.09.2026): Wenn ein Model einen Termin einträgt („Padel
-- 15–18 Uhr"), sollen die Chatter sehen, dass in der Zeit nichts geht — damit
-- niemand in dem Fenster ein Custom verspricht.
--
-- Bisher hatte model_calendar nur due_time (Anfang) und nichts zur
-- Erreichbarkeit. Zwei Spalten reichen:
--   end_time          Ende des Termins (deutsche Zeit, wie due_time)
--   nicht_erreichbar  Häkchen im Model-Portal
--
-- Eintragen darf das nur das Model selbst (so gewollt) — das regeln die
-- bestehenden Policies auf model_calendar, hier ändert sich daran nichts.
-- Neue Spalten sind von den vorhandenen Policies automatisch mit abgedeckt.
--
-- Gefahrlos: nur ADD COLUMN IF NOT EXISTS, keine Daten werden angefasst.
-- Alte Einträge bekommen end_time = NULL und nicht_erreichbar = false und
-- verhalten sich damit exakt wie vorher.

ALTER TABLE public.model_calendar
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS nicht_erreichbar boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.model_calendar.end_time IS
  'Ende des Termins in deutscher Zeit (Europe/Berlin), wie due_time. NULL = offenes Ende.';
COMMENT ON COLUMN public.model_calendar.nicht_erreichbar IS
  'Model ist in diesem Zeitfenster nicht erreichbar — Chatter sehen auf der Model-Karte „Termin bis HH:MM".';

-- Kontrolle: sollte zwei Zeilen liefern.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'model_calendar'
  AND column_name IN ('end_time', 'nicht_erreichbar');
