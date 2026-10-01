-- ============================================================================
-- v4.104.0 · Accounts, die die Agentur selbst anlegt (z. B. US-Account)
--
-- Chris legt im Admin („+ Account“) einen Instagram-Account für ein Model an.
-- Er landet wie alle anderen Links im Board unter „Social Media Kanäle“
-- (model_board, category social_media) — Chatter und Model sehen ihn, die
-- Social-Steuerung und Lyra auch. Markiert mit von_agentur = true.
--
-- Solche Einträge darf nur Staff/Pfleger anlegen, ändern und löschen — das
-- Model nicht (RESTRICTIVE-Policies, die bestehenden Board-Policies bleiben
-- unberührt; restrictive wird mit AND verknüpft).
--
-- Wiederholbar. Löscht und überschreibt keine Daten.
-- ============================================================================

alter table public.model_board add column if not exists von_agentur boolean not null default false;

drop policy if exists board_agentur_anlegen on public.model_board;
drop policy if exists board_agentur_aendern on public.model_board;
drop policy if exists board_agentur_loeschen on public.model_board;

create policy board_agentur_anlegen on public.model_board as restrictive for insert to authenticated
  with check (not von_agentur or public.is_staff() or public.darf_kontakte_pflegen());

create policy board_agentur_aendern on public.model_board as restrictive for update to authenticated
  using      (not von_agentur or public.is_staff() or public.darf_kontakte_pflegen())
  with check (not von_agentur or public.is_staff() or public.darf_kontakte_pflegen());

create policy board_agentur_loeschen on public.model_board as restrictive for delete to authenticated
  using (not von_agentur or public.is_staff() or public.darf_kontakte_pflegen());

-- Prüfen:
-- select policyname, permissive, cmd from pg_policies where tablename = 'model_board' and policyname like 'board_agentur%';
--   → 3 Zeilen, permissive = RESTRICTIVE
