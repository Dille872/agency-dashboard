-- ============================================================================
-- v4.54.0 · Passwort-Reset: Fehlversuche zählen
--
-- Nach der Admin-Freigabe war der 6-stellige Code 60 Minuten lang unbegrenzt
-- durchprobierbar. Die Function `password-reset` zählt jetzt falsche Codes und
-- sperrt die Freigabe nach 5 Fehlversuchen.
--
-- REIHENFOLGE: ERST dieses SQL ausführen, DANN die Function deployen.
-- Ohne die Spalte sperrt die neue Function schon beim ersten falschen Code
-- (bewusst: im Zweifel sperren statt raten lassen).
--
-- Rein additiv, bestehende Zeilen bekommen 0. Ändert keine Daten.
-- ============================================================================

ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS fehlversuche integer NOT NULL DEFAULT 0;

-- Kontrolle:
-- select id, display_name, status, fehlversuche from password_resets order by id desc limit 10;
