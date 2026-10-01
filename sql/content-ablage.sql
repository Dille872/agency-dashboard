-- ============================================================================
-- v5.12.0 · Content-Ablage: Models (und Team) laden Fotos/Videos auf Vorrat hoch
--
-- Entscheidung Chris (01.10.): Sandra lädt fertigen Content einfach hoch
-- (mehrere Dateien auf einmal), das Team verplant ihn per Ziehen im Kalender.
-- Jede Datei = eine Zeile in social_material. Videos: art 'reel', Fotos: 'foto'.
--
-- Nur die Prüfregel für social_material.art wird erweitert. Rechte unverändert
-- (Model: eigenes Material anlegen; Team: wie bisher). Wiederholbar.
-- Ändert keine Daten.
-- ============================================================================

alter table public.social_material drop constraint if exists social_material_art_check;
alter table public.social_material add constraint social_material_art_check
  check (art in ('reel', 'foto', 'karussell', 'story'));
