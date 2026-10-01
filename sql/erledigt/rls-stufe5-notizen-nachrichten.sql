-- ============================================================================
-- RLS Stufe 5 — Sicherheits-Audit Stufe 2 (Lesen je Rolle), Teil 1
-- Nur RESTRICTIVE Policies hinzufügen, keine Daten ändern. Rückgängig unten.
-- ============================================================================

-- ── A) notes — AUSGEFÜHRT 19.09.2026, Test ok ───────────────────────────────
-- Chatter/Models sehen und schreiben nur Notizen mit author = eigener Name.
-- begin;
-- create policy notizen_lesen_staff_oder_eigene on public.notes
--   as restrictive for select to authenticated
--   using ((select public.is_staff()) or author = (select public.my_display_name()));
-- create policy notizen_schreiben_staff_oder_eigene on public.notes
--   as restrictive for insert to authenticated
--   with check ((select public.is_staff()) or author = (select public.my_display_name()));
-- create policy notizen_aendern_staff_oder_eigene on public.notes
--   as restrictive for update to authenticated
--   using ((select public.is_staff()) or author = (select public.my_display_name()))
--   with check ((select public.is_staff()) or author = (select public.my_display_name()));
-- commit;

-- ── B) messages ─────────────────────────────────────────────────────────────
-- Chatter/Models: nur der eigene Verlauf (model_name = eigener Name).
-- Admin/Manager + Dienstplan/Creator-Manager (arbeiten im Kommunikations-Tab): alles.
-- Telegram-Bot, Übergabe usw. laufen mit Service-Key → nicht betroffen.
begin;
create policy nachrichten_lesen_team_oder_eigene on public.messages
  as restrictive for select to authenticated
  using ((select public.darf_kontakte_pflegen()) or model_name = (select public.my_display_name()));
create policy nachrichten_schreiben_team_oder_eigene on public.messages
  as restrictive for insert to authenticated
  with check ((select public.darf_kontakte_pflegen()) or model_name = (select public.my_display_name()));
create policy nachrichten_aendern_team_oder_eigene on public.messages
  as restrictive for update to authenticated
  using ((select public.darf_kontakte_pflegen()) or model_name = (select public.my_display_name()))
  with check ((select public.darf_kontakte_pflegen()) or model_name = (select public.my_display_name()));
commit;

-- ── RÜCKGÄNGIG ───────────────────────────────────────────────────────────────
-- drop policy if exists notizen_lesen_staff_oder_eigene on public.notes;
-- drop policy if exists notizen_schreiben_staff_oder_eigene on public.notes;
-- drop policy if exists notizen_aendern_staff_oder_eigene on public.notes;
-- drop policy if exists nachrichten_lesen_team_oder_eigene on public.messages;
-- drop policy if exists nachrichten_schreiben_team_oder_eigene on public.messages;
-- drop policy if exists nachrichten_aendern_team_oder_eigene on public.messages;
