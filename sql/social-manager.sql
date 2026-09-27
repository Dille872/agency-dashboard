-- ============================================================================
-- v4.102.0 · Social Media Manager (Poster-Ansicht) + Ziel-Account
--
-- Voraussetzung: sql/model-social-profil.sql und sql/reel-skripte.sql sind
-- gelaufen. Wiederholbar. Löscht und überschreibt keine Daten.
--
-- 1) public.ist_social_media()  — hat der eingeloggte Nutzer die Rolle
--    social_media (Zusatzrolle, z. B. Chatter + Social)?
-- 2) reel_skripte: Ziel-Account (von der Agentur beim Anlegen gewählt).
--    Poster (Rolle social_media) darf lesen und NUR die Posting-Felder setzen:
--    reel_url, account, gepostet_am, gepostet_von.
-- 3) model_social_service: account_notizen (jsonb, @handle → „DE · Hauptaccount“).
--    Poster darf lesen.
-- 4) model_social_profil: Poster darf lesen.
-- 5) model_board: Poster darf NUR nogos, einschraenkungen, social_media lesen,
--    und nur von Models im Service (keine Preise).
-- 6) public.social_uebersetzung: Übersetzungs-Speicher (DE → EN) für die
--    englische Ansicht. Schreiben nur die Edge Function „uebersetzen“.
-- 7) lyra.reel_skripte bekommt ziel_account.
-- ============================================================================

-- ── 1) Rolle prüfen ─────────────────────────────────────────────────────────
create or replace function public.ist_social_media()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and 'social_media' = any(coalesce(roles, '{}'))
  )
$$;
grant execute on function public.ist_social_media() to authenticated;

-- Model im Service? (für die Board-Policy unten)
create or replace function public.model_im_social_service(p_model text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.model_social_service where model_name = p_model and service_aktiv)
$$;
grant execute on function public.model_im_social_service(text) to authenticated;

-- ── 2) reel_skripte ─────────────────────────────────────────────────────────
alter table public.reel_skripte add column if not exists ziel_account text;

drop policy if exists reel_skripte_lesen   on public.reel_skripte;
drop policy if exists reel_skripte_aendern on public.reel_skripte;

create policy reel_skripte_lesen on public.reel_skripte for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_media() or model_name = public.my_display_name());

create policy reel_skripte_aendern on public.reel_skripte for update to authenticated
  using      (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_media() or model_name = public.my_display_name())
  with check (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_media() or model_name = public.my_display_name());

-- Schutz-Trigger neu: Staff/Pfleger alles; Poster nur Posting-Felder;
-- Model nur Video-Felder.
create or replace function public.reel_skripte_schuetzen()
returns trigger language plpgsql as $$
declare
  poster boolean := public.ist_social_media();
  model  boolean := (old.model_name = public.my_display_name());
begin
  new.aktualisiert_am := now();
  if public.is_staff() or public.darf_kontakte_pflegen() then
    return new;
  end if;
  -- immer fest
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

-- ── 3) model_social_service ─────────────────────────────────────────────────
alter table public.model_social_service add column if not exists account_notizen jsonb not null default '{}'::jsonb;

-- account_notizen gehört zur Agentur: im bestehenden Schutz-Trigger mit festhalten
create or replace function public.social_service_agenturfelder_schuetzen()
returns trigger language plpgsql as $$
begin
  if public.is_staff() or public.darf_kontakte_pflegen() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.service_aktiv   := false;
    new.posting_ab      := null;
    new.angefordert_am  := null;
    new.angefordert_von := null;
    new.account_notizen := '{}'::jsonb;
  else
    new.service_aktiv    := old.service_aktiv;
    new.posting_ab       := old.posting_ab;
    new.angefordert_am   := old.angefordert_am;
    new.angefordert_von  := old.angefordert_von;
    new.account_notizen  := old.account_notizen;
  end if;
  return new;
end $$;

drop policy if exists social_service_lesen on public.model_social_service;
create policy social_service_lesen on public.model_social_service for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_media() or model_name = public.my_display_name());

-- ── 4) model_social_profil ──────────────────────────────────────────────────
drop policy if exists social_profil_lesen on public.model_social_profil;
create policy social_profil_lesen on public.model_social_profil for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_media() or model_name = public.my_display_name());

-- ── 5) model_board: schmaler Lesezugang für Poster ──────────────────────────
-- Zusätzliche (permissive) Policy — bestehende Policies bleiben unberührt.
drop policy if exists board_social_manager_lesen on public.model_board;
create policy board_social_manager_lesen on public.model_board for select to authenticated
  using (public.ist_social_media()
         and category in ('nogos', 'einschraenkungen', 'social_media')
         and public.model_im_social_service(model_name));

-- ── 6) Übersetzungs-Speicher ────────────────────────────────────────────────
create table if not exists public.social_uebersetzung (
  schluessel  text primary key,          -- SHA-256 des Originals + ":" + Zielsprache
  original    text not null,
  sprache     text not null default 'en',
  text        text not null,
  erstellt_am timestamptz not null default now()
);
alter table public.social_uebersetzung enable row level security;
drop policy if exists uebersetzung_lesen on public.social_uebersetzung;
create policy uebersetzung_lesen on public.social_uebersetzung for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_media());
-- Kein insert/update für authenticated: schreibt nur die Edge Function (Service-Rolle).

-- ── 7) Lyra ─────────────────────────────────────────────────────────────────
drop view if exists lyra.reel_skripte;
create view lyra.reel_skripte as
select nr, model_name, titel,
       case when verworfen then 'verworfen'
            when reel_url is not null then 'gepostet'
            when video_link is not null then 'gedreht'
            else 'freigegeben' end as status,
       ziel_account,
       erstellt_am as freigegeben_am,
       video_am    as gedreht_am,
       gepostet_am, account, reel_url
from public.reel_skripte;
alter view lyra.reel_skripte owner to postgres;
grant select on lyra.reel_skripte to lyra_readonly;

-- ── Prüfen ──────────────────────────────────────────────────────────────────
-- select public.ist_social_media();   -- im SQL-Editor false (kein Login), in der App je nach Rolle
-- select policyname from pg_policies where tablename = 'model_board' and policyname = 'board_social_manager_lesen';
-- set role lyra_readonly; select ziel_account from lyra.reel_skripte limit 1; reset role;
