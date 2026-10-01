-- ============================================================================
-- v4.108.0 · „Model postet selbst“ pro Account
--
-- Pro Account wird festgelegt, wer postet:
--   • Team (Standard): Poster aus social_account_poster, mit Schnitt/Freigabe.
--   • Model: Das Model dreht, schneidet und postet selbst und trägt im Portal
--     nur den Reel-Link ein. KEIN Video-Upload, KEIN Schnitt, KEINE Freigabe
--     (Entscheidung Chris, 27.09.). Gemessen wird trotzdem (reel_url steht im
--     Skript → Messwerte laufen als „skript“).
--
-- Gespeichert in model_social_service.account_modus (jsonb):
--   { "@handle": { "posten": "model" } }   — fehlt der Eintrag: Team.
-- Nur Agentur (steht im Schutz-Trigger).
--
-- Außerdem: Models dürfen lesen, ob ihre Accounts einen Cutter haben
-- (für den Hinweis „Rohmaterial reicht“ / „bitte fertig geschnitten“).
--
-- Voraussetzung: social-schnitt.sql. Wiederholbar. Löscht und überschreibt
-- keine Daten.
-- ============================================================================

alter table public.model_social_service add column if not exists account_modus jsonb not null default '{}'::jsonb;

-- Postet das Model diesen Account selbst?
create or replace function public.model_postet_selbst(p_model text, p_account text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select (account_modus -> p_account ->> 'posten') = 'model'
    from public.model_social_service where model_name = p_model
  ), false)
$$;
grant execute on function public.model_postet_selbst(text, text) to authenticated;

-- Agentur-Schutz-Trigger: account_modus gehört zur Agentur
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

-- Skript-Schutz: Model darf die Posting-Felder setzen, wenn es den Account
-- selbst postet (sonst wie in social-schnitt.sql).
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
  if public.is_staff() or public.darf_kontakte_pflegen() then
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

-- Models sehen, ob ihre Accounts einen Cutter haben
drop policy if exists sac_lesen on public.social_account_cutter;
create policy sac_lesen on public.social_account_cutter for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_media() or public.ist_cutter()
         or public.darf_social_freigeben() or model_name = public.my_display_name());

-- Prüfen:
-- select model_name, account_modus from model_social_service;
