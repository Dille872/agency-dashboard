-- ── „Jede Woche so" merkt sich mehr als den Namen (v4.98.0) ────────────────
--
-- Wunsch Christoph (23.09.2026): Wenn eine Schicht als Wiederholung angelegt
-- ist, soll in der neuen Woche nicht nur der Chatter stehen, sondern auch die
-- abweichende Uhrzeit und die zweite Person (Anlernen / Co / Geteilt).
--
-- Bisher hielt recurring_shifts nur chatter und note fest. Eine Spätschicht,
-- die bei einem Model von 19 bis 2 Uhr läuft statt von 14 bis 20, kam in der
-- Folgewoche mit der Standardzeit zurück — der Grund, warum der Plan jede
-- Woche von Hand nachgezogen werden musste.
--
-- Gefahrlos: nur ADD COLUMN IF NOT EXISTS, alle neuen Spalten sind NULL-bar.
-- Bestehende Wiederholungen verhalten sich damit exakt wie vorher, bis die
-- Zelle einmal neu als „Jede Woche so" gesetzt wird.

ALTER TABLE public.recurring_shifts
  ADD COLUMN IF NOT EXISTS time_override text,
  ADD COLUMN IF NOT EXISTS trainee       text,
  ADD COLUMN IF NOT EXISTS trainee_mode  text,
  ADD COLUMN IF NOT EXISTS split_a_von   text,
  ADD COLUMN IF NOT EXISTS split_a_bis   text,
  ADD COLUMN IF NOT EXISTS split_b_von   text,
  ADD COLUMN IF NOT EXISTS split_b_bis   text;

COMMENT ON COLUMN public.recurring_shifts.time_override IS
  'Abweichende Schichtzeit dieser Zelle, z. B. „19:00-02:00". NULL = Standardzeit des Models.';
COMMENT ON COLUMN public.recurring_shifts.trainee_mode IS
  'anlernen | co | split — wie in schedule.assignments.';

-- Kontrolle: sollte sieben Zeilen liefern.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'recurring_shifts'
  AND column_name IN ('time_override', 'trainee', 'trainee_mode',
                      'split_a_von', 'split_a_bis', 'split_b_von', 'split_b_bis')
ORDER BY column_name;
