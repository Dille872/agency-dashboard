-- ============================================================================
-- v5.20.0 · Platzhalter-Accounts („Account in Vorbereitung“)
--
-- Entscheidung Chris (01.10.): Für Models, deren Instagram-Account erst noch
-- angelegt wird (z. B. Dina), schon planen und Content sammeln. Später den
-- echten Handle eintragen — alles wandert mit.
--
-- Ein Platzhalter hat einen eigenen „Handle“ der Form @neu-<model>-<n>.
-- Ein Bindestrich kommt in echten Instagram-Namen nicht vor, es kann also
-- nie mit einem echten Account zusammenfallen. Er steht in
-- model_social_service.platzhalter = [{ "handle": "@neu-dina-1", "name": "Dina · US", "angelegt_am": … }]
-- und wird überall wie ein Account benutzt (Plan, Ziel-Account der Skripte,
-- Zeitzone, Kurzbeschreibung). Poster werden erst beim echten Account zugeteilt.
-- Dateien für einen Platzhalter landen in der Ablage des Models (material/),
-- nicht beim Account — so muss beim Umstellen keine Datei umziehen.
--
-- Umstellen: platzhalter_umstellen(model, '@neu-…', '@echter.name')
--   social_plan.account, reel_skripte.ziel_account/account, Poster-/Cutter-
--   Zuteilung, account_modus, account_notizen, nicht_betreut → neuer Handle,
--   Platzhalter wird entfernt. Den Board-Eintrag legt das Dashboard vorher an.
--
-- Voraussetzung: plan-model.sql, posting-plan.sql, social-steuerung.sql.
-- Wiederholbar. Löscht keine Daten.
-- ============================================================================

alter table public.model_social_service add column if not exists platzhalter jsonb not null default '[]'::jsonb;

-- Gehört der Agentur: Models können Platzhalter nicht selbst anlegen/ändern.
-- Neufassung des Schutz-Triggers (plan-model.sql), nur um platzhalter ergänzt.
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
    new.model_plant     := false;
    new.platzhalter     := '[]'::jsonb;
  else
    new.service_aktiv    := old.service_aktiv;
    new.posting_ab       := old.posting_ab;
    new.angefordert_am   := old.angefordert_am;
    new.angefordert_von  := old.angefordert_von;
    new.account_notizen  := old.account_notizen;
    new.nicht_betreut    := old.nicht_betreut;
    new.account_modus    := old.account_modus;
    new.model_plant      := old.model_plant;
    new.platzhalter      := old.platzhalter;
  end if;
  return new;
end $$;

-- Model mit „plant mit“ darf auch auf ihren Platzhaltern planen.
-- Neufassung aus plan-model.sql, nur um den zweiten Teil ergänzt.
create or replace function public.model_plant_account(p_model text, p_account text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_model = public.my_display_name() and (
    exists (
      select 1
      from public.model_social_service s
      join public.model_board b on b.model_name = s.model_name and b.category = 'social_media'
      where s.model_name = p_model and s.service_aktiv and s.model_plant
        and lower(public.insta_handle(b.content)) = lower(trim(p_account))
        and not (lower(trim(p_account)) = any(array(select lower(x) from unnest(s.nicht_betreut) x)))
    )
    or exists (
      select 1
      from public.model_social_service s, jsonb_array_elements(s.platzhalter) p
      where s.model_name = p_model and s.service_aktiv and s.model_plant
        and lower(p->>'handle') = lower(trim(p_account))
    )
  )
$$;
grant execute on function public.model_plant_account(text, text) to authenticated;

-- ── Umstellen auf den echten Account ───────────────────────────────────────
create or replace function public.platzhalter_umstellen(p_model text, p_alt text, p_neu text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  alt text := lower(trim(p_alt));
  neu text := lower(trim(p_neu));
  s   public.model_social_service%rowtype;
  n_plan int; n_skript int; n_poster int; n_cutter int;
  modus jsonb; notizen jsonb;
begin
  if not public.darf_social_leiten() then raise exception 'nicht berechtigt' using errcode = '42501'; end if;
  if alt !~ '^@neu-' then raise exception 'Das ist kein Platzhalter: %', p_alt; end if;
  if left(neu, 1) <> '@' then neu := '@' || neu; end if;
  if neu !~ '^@[a-z0-9._]{1,30}$' then raise exception 'Kein gültiger Instagram-Name: %', p_neu; end if;

  select * into s from public.model_social_service where model_name = p_model for update;
  if not found then raise exception 'Model % ist nicht im Service', p_model; end if;
  if not exists (select 1 from jsonb_array_elements(s.platzhalter) p where lower(p->>'handle') = alt) then
    raise exception 'Platzhalter % gibt es bei % nicht (mehr)', p_alt, p_model;
  end if;

  update public.social_plan set account = neu where model_name = p_model and lower(account) = alt;
  get diagnostics n_plan = row_count;
  update public.reel_skripte set ziel_account = neu where model_name = p_model and lower(ziel_account) = alt;
  get diagnostics n_skript = row_count;
  update public.reel_skripte set account = neu where model_name = p_model and lower(account) = alt;
  -- Zuteilungen (falls doch schon jemand zugeteilt war; Dubletten vermeiden)
  delete from public.social_account_poster a where a.model_name = p_model and lower(a.account) = alt
    and exists (select 1 from public.social_account_poster b where b.model_name = p_model and lower(b.account) = neu and b.poster_name = a.poster_name);
  update public.social_account_poster set account = neu where model_name = p_model and lower(account) = alt;
  get diagnostics n_poster = row_count;
  begin
    delete from public.social_account_cutter a where a.model_name = p_model and lower(a.account) = alt
      and exists (select 1 from public.social_account_cutter b where b.model_name = p_model and lower(b.account) = neu and b.cutter_name = a.cutter_name);
    update public.social_account_cutter set account = neu where model_name = p_model and lower(account) = alt;
    get diagnostics n_cutter = row_count;
  exception when undefined_table then n_cutter := 0;
  end;

  -- Einstellungen am Model: Schlüssel umbenennen, Platzhalter entfernen
  modus := coalesce(s.account_modus, '{}'::jsonb);
  if modus ? p_alt then modus := (modus - p_alt) || jsonb_build_object(neu, modus -> p_alt); end if;
  notizen := coalesce(s.account_notizen, '{}'::jsonb);
  if notizen ? p_alt then notizen := (notizen - p_alt) || jsonb_build_object(neu, notizen -> p_alt); end if;
  update public.model_social_service
     set account_modus   = modus,
         account_notizen = notizen,
         nicht_betreut   = array(select case when lower(x) = alt then neu else x end from unnest(nicht_betreut) x),
         platzhalter     = coalesce((select jsonb_agg(p) from jsonb_array_elements(platzhalter) p where lower(p->>'handle') <> alt), '[]'::jsonb)
   where model_name = p_model;

  return jsonb_build_object('plan', n_plan, 'skripte', n_skript, 'poster', n_poster, 'cutter', n_cutter, 'handle', neu);
end $$;
revoke all on function public.platzhalter_umstellen(text, text, text) from public, anon;
grant execute on function public.platzhalter_umstellen(text, text, text) to authenticated;

-- Prüfen:
-- select model_name, platzhalter from public.model_social_service where platzhalter <> '[]'::jsonb;
