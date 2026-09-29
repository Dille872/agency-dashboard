-- ============================================================================
-- v5.1.0 · Rolle „Social-Leitung“ (ersetzt „Social-Freigabe“)
--
-- Social-Team, nach Absprache mit Chris (29.09.):
--   Poster  (social_media)   postet — nur zugeteilte Accounts
--   Cutter  (cutter)         schneidet — nur zugeteilte Accounts
--   Social-Leitung (social_leitung)  der ganze Social-Media-Bereich für ALLE
--       Models: Steuerung, Freigabe, Poster/Cutter zuteilen, Drehzettel
--       hochladen, Service an/aus, Wirkung. Nichts außerhalb von Social Media
--       (keine Umsätze, kein Dienstplan, keine Chats der Chatter).
--
-- Grenzen (bewusst, brauchen Board-/Kontakt-Rechte, bleiben bei Admins):
--   • Agentur-Accounts im Board anlegen/löschen
--   • Telegram-Hinweise an Models (Drehzettel, Fragebogen, Erinnern)
--
-- Wer „social_freigabe“ hat, wird zur Social-Leitung.
-- Voraussetzung: alle bisherigen Social-SQL-Dateien (zuletzt reel-ohne-skript.sql).
-- Wiederholbar. Löscht keine Daten.
-- ============================================================================

-- ── 1) Rolle umstellen ─────────────────────────────────────────────────────
update public.user_roles
   set roles = array_replace(roles, 'social_freigabe', 'social_leitung')
 where 'social_freigabe' = any(coalesce(roles, '{}'));
update public.user_roles set role = 'social_leitung' where role = 'social_freigabe';

-- ── 2) Hilfsfunktionen ─────────────────────────────────────────────────────
create or replace function public.ist_social_leitung()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and ('social_leitung' = any(coalesce(roles, '{}')) or role = 'social_leitung')
      and coalesce(status, 'active') = 'active'
  )
$$;
grant execute on function public.ist_social_leitung() to authenticated;

-- Freigeben dürfen: Staff und Social-Leitung (social_freigabe bleibt als Altname gültig).
-- Die Funktion steckt schon in allen Lese-Regeln der Social-Tabellen — damit
-- sieht die Social-Leitung automatisch alles, was Freigeber bisher sahen.
create or replace function public.darf_social_freigeben()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and (coalesce(roles, '{}') && array['social_freigabe', 'social_leitung'] or role in ('social_freigabe', 'social_leitung'))
  )
$$;

-- Wer darf den Social-Bereich steuern?
create or replace function public.darf_social_leiten()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_leitung()
$$;
grant execute on function public.darf_social_leiten() to authenticated;

-- Listen, die die Social-Leitung braucht, ohne user_roles/models_contact
-- komplett lesen zu dürfen:
create or replace function public.social_team_liste()
returns table (display_name text, roles text[], status text)
language sql stable security definer set search_path = public as $$
  select ur.display_name, ur.roles, ur.status
  from public.user_roles ur
  where public.darf_social_leiten()
    and ur.display_name is not null
    and coalesce(ur.roles, '{}') && array['social_media', 'cutter', 'social_leitung', 'social_freigabe']
$$;
grant execute on function public.social_team_liste() to authenticated;

create or replace function public.social_models_liste()
returns table (name text, active boolean)
language sql stable security definer set search_path = public as $$
  select m.name, coalesce(m.active, true)
  from public.models_contact m
  where public.darf_social_leiten()
$$;
grant execute on function public.social_models_liste() to authenticated;

-- ── 3) Zusätzliche Regeln für die Social-Leitung (permissiv, ergänzend) ────
-- reel_skripte: anlegen (ändern darf sie über darf_social_freigeben schon)
drop policy if exists leitung_anlegen on public.reel_skripte;
create policy leitung_anlegen on public.reel_skripte for insert to authenticated
  with check (public.ist_social_leitung());

-- model_social_service: Service an/aus, Accounts-Notizen, Modus, nicht betreut
drop policy if exists leitung_anlegen on public.model_social_service;
drop policy if exists leitung_aendern on public.model_social_service;
create policy leitung_anlegen on public.model_social_service for insert to authenticated
  with check (public.ist_social_leitung());
create policy leitung_aendern on public.model_social_service for update to authenticated
  using (public.ist_social_leitung()) with check (public.ist_social_leitung());

-- model_social_profil: Antworten nachtragen
drop policy if exists leitung_anlegen on public.model_social_profil;
drop policy if exists leitung_aendern on public.model_social_profil;
create policy leitung_anlegen on public.model_social_profil for insert to authenticated
  with check (public.ist_social_leitung());
create policy leitung_aendern on public.model_social_profil for update to authenticated
  using (public.ist_social_leitung()) with check (public.ist_social_leitung());

-- Poster/Cutter zuteilen
drop policy if exists leitung_lesen    on public.social_account_poster;
drop policy if exists leitung_anlegen  on public.social_account_poster;
drop policy if exists leitung_loeschen on public.social_account_poster;
create policy leitung_lesen on public.social_account_poster for select to authenticated
  using (public.ist_social_leitung());
create policy leitung_anlegen on public.social_account_poster for insert to authenticated
  with check (public.ist_social_leitung());
create policy leitung_loeschen on public.social_account_poster for delete to authenticated
  using (public.ist_social_leitung());

drop policy if exists leitung_anlegen  on public.social_account_cutter;
drop policy if exists leitung_loeschen on public.social_account_cutter;
create policy leitung_anlegen on public.social_account_cutter for insert to authenticated
  with check (public.ist_social_leitung());
create policy leitung_loeschen on public.social_account_cutter for delete to authenticated
  using (public.ist_social_leitung());

-- Reels ohne Skript
drop policy if exists leitung_anlegen  on public.reel_ohne_skript;
drop policy if exists leitung_loeschen on public.reel_ohne_skript;
create policy leitung_anlegen on public.reel_ohne_skript for insert to authenticated
  with check (public.ist_social_leitung());
create policy leitung_loeschen on public.reel_ohne_skript for delete to authenticated
  using (public.ist_social_leitung());

-- ── 4) Schutz-Trigger: Social-Leitung wie Agentur ──────────────────────────
create or replace function public.social_service_agenturfelder_schuetzen()
returns trigger language plpgsql as $$
begin
  if public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_leitung() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.service_aktiv   := false;
    new.posting_ab      := null;
    new.angefordert_am  := null;
    new.angefordert_von := null;
    new.account_notizen := '{}'::jsonb;
    new.nicht_betreut   := '{}';
    new.account_modus   := '{}'::jsonb;
  else
    new.service_aktiv    := old.service_aktiv;
    new.posting_ab       := old.posting_ab;
    new.angefordert_am   := old.angefordert_am;
    new.angefordert_von  := old.angefordert_von;
    new.account_notizen  := old.account_notizen;
    new.nicht_betreut    := old.nicht_betreut;
    new.account_modus    := old.account_modus;
  end if;
  return new;
end $$;

create or replace function public.reel_skripte_schuetzen()
returns trigger language plpgsql as $$
declare
  poster    boolean := public.poster_hat_account(old.model_name, old.ziel_account);
  cutter    boolean := public.cutter_hat_account(old.model_name, old.ziel_account);
  freigeber boolean := public.darf_social_freigeben();
  model     boolean := (old.model_name = public.my_display_name());
  model_post boolean := model and public.model_postet_selbst(old.model_name, old.ziel_account);
begin
  new.aktualisiert_am := now();
  if public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_leitung() then
    return new;
  end if;
  new.id := old.id; new.nr := old.nr; new.model_name := old.model_name;
  new.titel := old.titel; new.drehzettel_url := old.drehzettel_url;
  new.ziel_account := old.ziel_account; new.notiz := old.notiz;
  new.verworfen := old.verworfen;
  new.erstellt_am := old.erstellt_am; new.erstellt_von := old.erstellt_von;
  if not (poster or model_post) then
    new.reel_url := old.reel_url; new.account := old.account;
    new.gepostet_am := old.gepostet_am; new.gepostet_von := old.gepostet_von;
  end if;
  if not model then
    new.video_link := old.video_link; new.video_am := old.video_am; new.video_von := old.video_von;
  end if;
  if not cutter then
    new.schnitt_link := old.schnitt_link; new.schnitt_am := old.schnitt_am; new.schnitt_von := old.schnitt_von;
  end if;
  if not freigeber then
    new.freigabe_am := old.freigabe_am; new.freigabe_von := old.freigabe_von;
    new.zurueck_an := old.zurueck_an; new.zurueck_am := old.zurueck_am;
    new.zurueck_von := old.zurueck_von; new.zurueck_notiz := old.zurueck_notiz;
  end if;
  return new;
end $$;

-- Prüfen:
-- select display_name, roles from public.user_roles where roles && array['social_media','cutter','social_leitung','social_freigabe'];
