-- ============================================================================
-- v4.106.0 · Cutter und Freigabe zwischen Model und Poster
--
-- Ablauf pro Skript:
--   Drehzettel → Model dreht (video_link)
--     → hat der Account einen Cutter: Cutter schneidet (schnitt_link)
--       sonst schneidet das Model selbst
--   → Freigabe (Admin oder Zusatzrolle social_freigabe): freigabe_am
--     oder „zurück“ an Cutter bzw. Model (zurueck_an, zurueck_am, zurueck_notiz)
--   → Poster postet (reel_url …)
--
-- Der Status wird im Frontend aus diesen Feldern abgeleitet (src/reelSkripte.js,
-- statusVon). Links werden beim „Zurück“ NICHT gelöscht — ein neuer Link mit
-- späterem Zeitstempel ersetzt den alten.
--
-- Neue Zusatzrollen (in user_roles.roles, vergeben unter Einstellungen → Team):
--   cutter           — schneidet für die ihm zugeteilten Accounts
--   social_freigabe  — darf geschnittene Reels freigeben oder zurückgeben
--
-- Voraussetzung: social-manager.sql, social-steuerung.sql, nicht-betreut.sql.
-- Wiederholbar. Löscht und überschreibt keine Daten.
-- ============================================================================

-- ── Felder am Skript ───────────────────────────────────────────────────────
alter table public.reel_skripte add column if not exists schnitt_link  text;
alter table public.reel_skripte add column if not exists schnitt_am    timestamptz;
alter table public.reel_skripte add column if not exists schnitt_von   text;
alter table public.reel_skripte add column if not exists freigabe_am   timestamptz;
alter table public.reel_skripte add column if not exists freigabe_von  text;
alter table public.reel_skripte add column if not exists zurueck_an    text check (zurueck_an in ('model', 'cutter'));
alter table public.reel_skripte add column if not exists zurueck_am    timestamptz;
alter table public.reel_skripte add column if not exists zurueck_von   text;
alter table public.reel_skripte add column if not exists zurueck_notiz text;

-- ── Cutter pro Account ─────────────────────────────────────────────────────
create table if not exists public.social_account_cutter (
  model_name   text not null,
  account      text not null,
  cutter_name  text not null,          -- user_roles.display_name
  erstellt_am  timestamptz not null default now(),
  erstellt_von text,
  primary key (model_name, account, cutter_name)
);
alter table public.social_account_cutter enable row level security;

-- ── Rollen-Funktionen ──────────────────────────────────────────────────────
create or replace function public.ist_cutter()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and 'cutter' = any(coalesce(roles, '{}')))
$$;

create or replace function public.darf_social_freigeben()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from public.user_roles where user_id = auth.uid() and 'social_freigabe' = any(coalesce(roles, '{}'))
  )
$$;

create or replace function public.cutter_hat_account(p_model text, p_account text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ist_cutter() and exists (
    select 1 from public.social_account_cutter
    where model_name = p_model and account = p_account and cutter_name = public.my_display_name()
  )
$$;

create or replace function public.cutter_hat_model(p_model text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ist_cutter() and exists (
    select 1 from public.social_account_cutter
    where model_name = p_model and cutter_name = public.my_display_name()
  )
$$;

grant execute on function public.ist_cutter() to authenticated;
grant execute on function public.darf_social_freigeben() to authenticated;
grant execute on function public.cutter_hat_account(text, text) to authenticated;
grant execute on function public.cutter_hat_model(text) to authenticated;

-- ── Policies social_account_cutter ─────────────────────────────────────────
-- Lesen dürfen alle Social-Rollen (Poster brauchen es, um „im Schnitt“ korrekt
-- anzuzeigen). Namen der Cutter sind nicht vertraulich.
drop policy if exists sac_lesen    on public.social_account_cutter;
drop policy if exists sac_anlegen  on public.social_account_cutter;
drop policy if exists sac_loeschen on public.social_account_cutter;
drop policy if exists aktiv_erforderlich on public.social_account_cutter;
create policy sac_lesen on public.social_account_cutter for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_media() or public.ist_cutter() or public.darf_social_freigeben());
create policy sac_anlegen on public.social_account_cutter for insert to authenticated
  with check (public.is_staff() or public.darf_kontakte_pflegen());
create policy sac_loeschen on public.social_account_cutter for delete to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen());
create policy aktiv_erforderlich on public.social_account_cutter as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- ── Skripte: lesen / ändern ────────────────────────────────────────────────
drop policy if exists reel_skripte_lesen   on public.reel_skripte;
drop policy if exists reel_skripte_aendern on public.reel_skripte;
create policy reel_skripte_lesen on public.reel_skripte for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
         or public.poster_hat_account(model_name, ziel_account)
         or public.cutter_hat_account(model_name, ziel_account)
         or model_name = public.my_display_name());
create policy reel_skripte_aendern on public.reel_skripte for update to authenticated
  using      (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
              or public.poster_hat_account(model_name, ziel_account) or public.cutter_hat_account(model_name, ziel_account)
              or model_name = public.my_display_name())
  with check (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
              or public.poster_hat_account(model_name, ziel_account) or public.cutter_hat_account(model_name, ziel_account)
              or model_name = public.my_display_name());

-- Schutz-Trigger: jede Rolle nur ihre Felder
create or replace function public.reel_skripte_schuetzen()
returns trigger language plpgsql as $$
declare
  poster    boolean := public.poster_hat_account(old.model_name, old.ziel_account);
  cutter    boolean := public.cutter_hat_account(old.model_name, old.ziel_account);
  freigeber boolean := public.darf_social_freigeben();
  model     boolean := (old.model_name = public.my_display_name());
begin
  new.aktualisiert_am := now();
  if public.is_staff() or public.darf_kontakte_pflegen() then
    return new;
  end if;
  new.id := old.id; new.nr := old.nr; new.model_name := old.model_name;
  new.titel := old.titel; new.drehzettel_url := old.drehzettel_url;
  new.ziel_account := old.ziel_account; new.notiz := old.notiz;
  new.verworfen := old.verworfen;
  new.erstellt_am := old.erstellt_am; new.erstellt_von := old.erstellt_von;
  if not poster then
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

-- ── Was Cutter und Freigeber sonst lesen dürfen ────────────────────────────
drop policy if exists social_service_lesen on public.model_social_service;
create policy social_service_lesen on public.model_social_service for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
         or public.poster_hat_model(model_name) or public.cutter_hat_model(model_name)
         or model_name = public.my_display_name());

drop policy if exists social_profil_lesen on public.model_social_profil;
create policy social_profil_lesen on public.model_social_profil for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
         or public.poster_hat_model(model_name) or public.cutter_hat_model(model_name)
         or model_name = public.my_display_name());

-- Board: No Gos/Einschränkungen und nur die eigenen Instagram-Links (keine Preise)
drop policy if exists board_social_manager_lesen on public.model_board;
create policy board_social_manager_lesen on public.model_board for select to authenticated
  using (public.model_im_social_service(model_name) and (
           (category in ('nogos', 'einschraenkungen')
              and (public.poster_hat_model(model_name) or public.cutter_hat_model(model_name) or public.darf_social_freigeben()))
        or (category = 'social_media'
              and (public.poster_hat_account(model_name, public.insta_handle(content))
                   or public.cutter_hat_account(model_name, public.insta_handle(content))
                   or public.darf_social_freigeben()))
        ));

drop policy if exists uebersetzung_lesen on public.social_uebersetzung;
create policy uebersetzung_lesen on public.social_uebersetzung for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_media() or public.ist_cutter() or public.darf_social_freigeben());

-- ── Prüfen ─────────────────────────────────────────────────────────────────
-- select policyname from pg_policies where tablename = 'social_account_cutter';  → 4
-- select column_name from information_schema.columns where table_name = 'reel_skripte' and column_name like 'schnitt%';
