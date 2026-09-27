-- ============================================================================
-- v4.103.0 · Social-Steuerung: Poster pro Account zuteilen
--
-- Voraussetzung: sql/social-manager.sql ist gelaufen. Wiederholbar.
-- Löscht und überschreibt keine Daten.
--
-- Vorher (v4.102.0) sah JEDER mit der Rolle social_media alle Models im
-- Service. Jetzt sieht ein Poster nur noch die Accounts, die ihm zugeteilt
-- sind (Tabelle social_account_poster), und nur deren Skripte. Ein Account
-- ohne Poster ist nur für Admins/Pfleger sichtbar.
--
--   account = @handle, genau wie im Dashboard aus dem Instagram-Link im Board
--             gebildet (public.insta_handle) und wie reel_skripte.ziel_account.
-- ============================================================================

-- ── Zuteilung ──────────────────────────────────────────────────────────────
create table if not exists public.social_account_poster (
  model_name   text not null,
  account      text not null,
  poster_name  text not null,          -- user_roles.display_name
  erstellt_am  timestamptz not null default now(),
  erstellt_von text,
  primary key (model_name, account, poster_name)
);
alter table public.social_account_poster enable row level security;

drop policy if exists sap_lesen    on public.social_account_poster;
drop policy if exists sap_anlegen  on public.social_account_poster;
drop policy if exists sap_loeschen on public.social_account_poster;
drop policy if exists aktiv_erforderlich on public.social_account_poster;

create policy sap_lesen on public.social_account_poster for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or poster_name = public.my_display_name());
create policy sap_anlegen on public.social_account_poster for insert to authenticated
  with check (public.is_staff() or public.darf_kontakte_pflegen());
create policy sap_loeschen on public.social_account_poster for delete to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen());
create policy aktiv_erforderlich on public.social_account_poster as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- ── Hilfsfunktionen ────────────────────────────────────────────────────────
-- @handle aus einem Instagram-Link (wie instaHandle() in src/reelSkripte.js)
create or replace function public.insta_handle(p_url text)
returns text language sql immutable as $$
  select coalesce('@' || substring(p_url from '(?i)instagram\.com/([^/?#]+)'), trim(p_url))
$$;

-- Ist dem eingeloggten Poster dieser Account zugeteilt?
create or replace function public.poster_hat_account(p_model text, p_account text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ist_social_media() and exists (
    select 1 from public.social_account_poster
    where model_name = p_model and account = p_account and poster_name = public.my_display_name()
  )
$$;

-- Hat der eingeloggte Poster irgendeinen Account dieses Models?
create or replace function public.poster_hat_model(p_model text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.ist_social_media() and exists (
    select 1 from public.social_account_poster
    where model_name = p_model and poster_name = public.my_display_name()
  )
$$;
grant execute on function public.insta_handle(text) to authenticated;
grant execute on function public.poster_hat_account(text, text) to authenticated;
grant execute on function public.poster_hat_model(text) to authenticated;

-- ── Lesen/Schreiben eingrenzen ─────────────────────────────────────────────
drop policy if exists reel_skripte_lesen   on public.reel_skripte;
drop policy if exists reel_skripte_aendern on public.reel_skripte;
create policy reel_skripte_lesen on public.reel_skripte for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen()
         or public.poster_hat_account(model_name, ziel_account)
         or model_name = public.my_display_name());
create policy reel_skripte_aendern on public.reel_skripte for update to authenticated
  using      (public.is_staff() or public.darf_kontakte_pflegen() or public.poster_hat_account(model_name, ziel_account) or model_name = public.my_display_name())
  with check (public.is_staff() or public.darf_kontakte_pflegen() or public.poster_hat_account(model_name, ziel_account) or model_name = public.my_display_name());

drop policy if exists social_service_lesen on public.model_social_service;
create policy social_service_lesen on public.model_social_service for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.poster_hat_model(model_name) or model_name = public.my_display_name());

drop policy if exists social_profil_lesen on public.model_social_profil;
create policy social_profil_lesen on public.model_social_profil for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.poster_hat_model(model_name) or model_name = public.my_display_name());

-- Board: Poster sehen No Gos/Einschränkungen ihrer Models und NUR die
-- Instagram-Links der Accounts, die ihnen zugeteilt sind.
drop policy if exists board_social_manager_lesen on public.model_board;
create policy board_social_manager_lesen on public.model_board for select to authenticated
  using (public.ist_social_media() and public.model_im_social_service(model_name) and (
           (category in ('nogos', 'einschraenkungen') and public.poster_hat_model(model_name))
        or (category = 'social_media' and public.poster_hat_account(model_name, public.insta_handle(content)))
        ));

-- Schutz-Trigger: Posting-Felder nur für den zugeteilten Poster
create or replace function public.reel_skripte_schuetzen()
returns trigger language plpgsql as $$
declare
  poster boolean := public.poster_hat_account(old.model_name, old.ziel_account);
  model  boolean := (old.model_name = public.my_display_name());
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
  return new;
end $$;

-- ── Prüfen ─────────────────────────────────────────────────────────────────
-- select policyname from pg_policies where tablename = 'social_account_poster';  → 4
-- select public.insta_handle('https://www.instagram.com/sandra.waayne?igsh=abc'); → @sandra.waayne
