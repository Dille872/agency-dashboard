-- ============================================================================
-- v5.11.0 · Posting-Plan: Beitragsarten Foto und Karussell
--
-- Entscheidung Chris (01.10.): Im Plan wählt man Reel (Video), Foto (ein Bild),
-- Karussell (mehrere Fotos/Videos in fester Reihenfolge) oder Story.
--   Foto       → Datei in video_link (Feld heißt im Dashboard „Foto“)
--   Karussell  → Dateien in frames [{link}] in Posting-Reihenfolge
--   Story      → wie bisher frames [{link, text, sticker}]
-- Gemessen werden weiterhin nur Reels.
--
-- Nur die Prüfregel für „art“ wird erweitert. Wiederholbar. Ändert keine Daten.
-- ============================================================================

alter table public.social_plan drop constraint if exists social_plan_art_check;
alter table public.social_plan add constraint social_plan_art_check
  check (art in ('reel', 'foto', 'karussell', 'story'));

-- Prüfen:
-- select art, count(*) from public.social_plan group by 1;
