-- ============================================================================
-- RLS Stufe 6 — Sicherheits-Audit Stufe 2, Teil 2 (19.09.2026)
-- Nur RESTRICTIVE Policies hinzufügen, keine Daten ändern. Rückgängig unten.
--
-- survey_responses: Chatter/Models sehen und schreiben nur ihre eigenen
--   Antworten (responder_name = eigener Name). Auswertung in den Einstellungen
--   bleibt für Admin/Manager vollständig.
-- user_roles (nur LESEN): jeder sieht die eigene Zeile. Alle Zeilen sehen
--   Admin, Manager, Dienstplan, Creator-Manager (Dienstplan braucht die Liste
--   der Admins und der Stillgelegten). Schreiben war schon nur Admin.
-- ============================================================================
begin;

create policy umfrage_lesen_staff_oder_eigene on public.survey_responses
  as restrictive for select to authenticated
  using ((select public.is_staff()) or responder_name = (select public.my_display_name()));
create policy umfrage_schreiben_staff_oder_eigene on public.survey_responses
  as restrictive for insert to authenticated
  with check ((select public.is_staff()) or responder_name = (select public.my_display_name()));
create policy umfrage_aendern_staff_oder_eigene on public.survey_responses
  as restrictive for update to authenticated
  using ((select public.is_staff()) or responder_name = (select public.my_display_name()))
  with check ((select public.is_staff()) or responder_name = (select public.my_display_name()));

create policy rollen_lesen_team_oder_selbst on public.user_roles
  as restrictive for select to authenticated
  using (user_id = (select auth.uid()) or (select public.darf_kontakte_pflegen()));

commit;

-- RÜCKGÄNGIG
-- drop policy if exists umfrage_lesen_staff_oder_eigene on public.survey_responses;
-- drop policy if exists umfrage_schreiben_staff_oder_eigene on public.survey_responses;
-- drop policy if exists umfrage_aendern_staff_oder_eigene on public.survey_responses;
-- drop policy if exists rollen_lesen_team_oder_selbst on public.user_roles;
