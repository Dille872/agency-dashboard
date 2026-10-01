-- ============================================================================
-- v5.21.0 · Einzelrechte im Social-Team (Reiter „🔐 Rechte“)
--
-- Wunsch Chris (01.10.): pro Person und Account sauber sehen und zuteilen,
-- wer was darf. Beispiel: Noah (Cutter + Poster bei Julia) darf Content
-- hochladen, Alina (nur Poster) nicht.
--
-- Rechte pro Person × Account:
--   posten     → wie bisher social_account_poster   (Rolle Poster nötig)
--   schneiden  → wie bisher social_account_cutter   (Rolle Cutter nötig)
--   hochladen  → NEU: Content in die Ablage des Models laden
--   planen     → NEU: Beiträge anlegen/ändern/verschieben/löschen (enthält hochladen)
--   freigeben  → NEU: Reels dieses Accounts freigeben/zurückgeben
--                (die Rollen Social-Leitung/-Freigabe dürfen es weiter überall)
-- Die drei neuen stehen in public.social_rechte.
--
-- Erweitert werden: Plan, Ablage (Material), Speicher (plan/, material/),
-- Skripte (Freigabe), Lesen von Service/Profil/Board für die Anzeige, der
-- Poster-Trigger (Planer dürfen alles ändern) und platzhalter_umstellen.
--
-- Voraussetzung: alle bisherigen Social-Dateien bis platzhalter-accounts.sql.
-- Wiederholbar. Löscht keine Daten.
-- ============================================================================

create table if not exists public.social_rechte (
  id           bigint generated always as identity primary key,
  person       text not null,          -- user_roles.display_name
  model_name   text not null,
  account      text not null,          -- @handle (auch Platzhalter @neu-…)
  recht        text not null check (recht in ('hochladen', 'planen', 'freigeben')),
  erstellt_am  timestamptz not null default now(),
  erstellt_von text,
  unique (person, model_name, account, recht)
);
alter table public.social_rechte enable row level security;
drop policy if exists rechte_lesen    on public.social_rechte;
drop policy if exists rechte_anlegen  on public.social_rechte;
drop policy if exists rechte_loeschen on public.social_rechte;
drop policy if exists aktiv_erforderlich on public.social_rechte;
create policy rechte_lesen on public.social_rechte for select to authenticated
  using (public.darf_social_leiten() or person = public.my_display_name());
create policy rechte_anlegen on public.social_rechte for insert to authenticated
  with check (public.darf_social_leiten());
create policy rechte_loeschen on public.social_rechte for delete to authenticated
  using (public.darf_social_leiten());
create policy aktiv_erforderlich on public.social_rechte as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
grant select, insert, delete on public.social_rechte to authenticated;

-- Hat die eingeloggte Person dieses Recht auf dem Account? (recht null = irgendeins)
-- „planen“ schließt „hochladen“ ein.
create or replace function public.social_recht_hat(p_model text, p_account text, p_recht text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_rechte r
    where r.person = public.my_display_name()
      and r.model_name = p_model
      and lower(r.account) = lower(trim(p_account))
      and (p_recht is null or r.recht = p_recht or (p_recht = 'hochladen' and r.recht = 'planen'))
  )
$$;
-- … auf irgendeinem Account des Models (für die Ablage, die gehört dem Model)
create or replace function public.social_recht_model(p_model text, p_recht text default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.social_rechte r
    where r.person = public.my_display_name()
      and r.model_name = p_model
      and (p_recht is null or r.recht = p_recht or (p_recht = 'hochladen' and r.recht = 'planen'))
  )
$$;
grant execute on function public.social_recht_hat(text, text, text) to authenticated;
grant execute on function public.social_recht_model(text, text) to authenticated;

-- ── Posting-Plan ───────────────────────────────────────────────────────────
drop policy if exists plan_lesen    on public.social_plan;
drop policy if exists plan_anlegen  on public.social_plan;
drop policy if exists plan_aendern  on public.social_plan;
drop policy if exists plan_loeschen on public.social_plan;
create policy plan_lesen on public.social_plan for select to authenticated
  using (public.darf_social_leiten() or public.poster_hat_account(model_name, account)
         or model_name = public.my_display_name() or public.social_recht_hat(model_name, account));
create policy plan_anlegen on public.social_plan for insert to authenticated
  with check (public.darf_social_leiten() or public.model_plant_account(model_name, account)
              or public.social_recht_hat(model_name, account, 'planen'));
create policy plan_aendern on public.social_plan for update to authenticated
  using (public.darf_social_leiten() or public.poster_hat_account(model_name, account)
         or public.model_plant_account(model_name, account) or public.social_recht_hat(model_name, account, 'planen'))
  with check (public.darf_social_leiten() or public.poster_hat_account(model_name, account)
              or public.model_plant_account(model_name, account) or public.social_recht_hat(model_name, account, 'planen'));
create policy plan_loeschen on public.social_plan for delete to authenticated
  using (public.darf_social_leiten() or public.model_plant_account(model_name, account)
         or public.social_recht_hat(model_name, account, 'planen'));

-- Poster-Trigger (poster-nur-posten.sql): wer planen darf, darf alles ändern
create or replace function public.social_plan_poster_nur_posten()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  frei constant text[] := array['status', 'reel_url', 'gepostet_am', 'gepostet_von', 'aktualisiert_am'];
begin
  if auth.uid() is null then return new; end if;
  if public.darf_social_leiten() then return new; end if;
  if public.model_plant_account(old.model_name, old.account) then return new; end if;
  if public.social_recht_hat(old.model_name, old.account, 'planen')
     and public.social_recht_hat(new.model_name, new.account, 'planen') then return new; end if;
  if (to_jsonb(new) - frei) is distinct from (to_jsonb(old) - frei) then
    raise exception 'Als Poster kannst du Beiträge nur als gepostet markieren. Änderungen bitte über das Team.'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ── Ablage (Material) ──────────────────────────────────────────────────────
drop policy if exists material_lesen   on public.social_material;
drop policy if exists material_anlegen on public.social_material;
drop policy if exists material_aendern on public.social_material;
create policy material_lesen on public.social_material for select to authenticated
  using (public.darf_social_leiten() or public.poster_hat_model(model_name)
         or model_name = public.my_display_name() or public.social_recht_model(model_name));
create policy material_anlegen on public.social_material for insert to authenticated
  with check (public.darf_social_leiten() or model_name = public.my_display_name()
              or public.social_recht_model(model_name, 'hochladen'));
create policy material_aendern on public.social_material for update to authenticated
  using (public.darf_social_leiten() or erstellt_von = public.my_display_name() or public.social_recht_model(model_name, 'planen'))
  with check (public.darf_social_leiten() or erstellt_von = public.my_display_name() or public.social_recht_model(model_name, 'planen'));

-- ── Speicher (plan/, material/) ────────────────────────────────────────────
create or replace function public.social_datei_recht(p_name text, p_schreiben boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  t text[] := string_to_array(coalesce(p_name, ''), '/');
  datei_re constant text := '^[0-9]{10,16}-[a-z0-9]{4,8}\.[a-z0-9]{2,5}(\.jpg)?$';
  modell text;
  konto  text;
  leiten boolean;
begin
  if not public.is_active_user() then return false; end if;
  leiten := public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_leitung();

  if t[1] = 'plan' and array_length(t, 1) = 4 and t[4] ~ datei_re then
    modell := public.hex_text(t[2]); konto := public.hex_text(t[3]);
    if modell is null or konto is null then return false; end if;
    if not p_schreiben then
      return leiten or public.darf_social_freigeben()
          or public.poster_hat_account(modell, konto)
          or modell = public.my_display_name()
          or public.social_recht_hat(modell, konto);
    end if;
    return leiten or public.model_plant_account(modell, konto) or public.social_recht_hat(modell, konto, 'planen');
  end if;

  if t[1] = 'material' and array_length(t, 1) = 3 and t[3] ~ datei_re then
    modell := public.hex_text(t[2]);
    if modell is null then return false; end if;
    if not p_schreiben then
      return leiten or public.darf_social_freigeben()
          or public.poster_hat_model(modell)
          or modell = public.my_display_name()
          or public.social_recht_model(modell);
    end if;
    return leiten or modell = public.my_display_name() or public.social_recht_model(modell, 'hochladen');
  end if;

  return false;
end $$;
grant execute on function public.social_datei_recht(text, boolean) to authenticated;

-- ── Skripte: Freigabe pro Account ──────────────────────────────────────────
drop policy if exists reel_skripte_lesen   on public.reel_skripte;
drop policy if exists reel_skripte_aendern on public.reel_skripte;
create policy reel_skripte_lesen on public.reel_skripte for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
         or public.poster_hat_account(model_name, ziel_account)
         or public.cutter_hat_account(model_name, ziel_account)
         or model_name = public.my_display_name()
         or public.social_recht_hat(model_name, ziel_account));
create policy reel_skripte_aendern on public.reel_skripte for update to authenticated
  using      (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
              or public.poster_hat_account(model_name, ziel_account) or public.cutter_hat_account(model_name, ziel_account)
              or model_name = public.my_display_name() or public.social_recht_hat(model_name, ziel_account, 'freigeben'))
  with check (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
              or public.poster_hat_account(model_name, ziel_account) or public.cutter_hat_account(model_name, ziel_account)
              or model_name = public.my_display_name() or public.social_recht_hat(model_name, ziel_account, 'freigeben'));

-- Schutz-Trigger (Stand social-leitung.sql), Freigeber auch pro Account
create or replace function public.reel_skripte_schuetzen()
returns trigger language plpgsql as $$
declare
  poster    boolean := public.poster_hat_account(old.model_name, old.ziel_account);
  cutter    boolean := public.cutter_hat_account(old.model_name, old.ziel_account);
  freigeber boolean := public.darf_social_freigeben() or public.social_recht_hat(old.model_name, old.ziel_account, 'freigeben');
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

-- ── Lesen für die Anzeige (Service, Profil, Board) ─────────────────────────
drop policy if exists social_service_lesen on public.model_social_service;
create policy social_service_lesen on public.model_social_service for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
         or public.poster_hat_model(model_name) or public.cutter_hat_model(model_name)
         or model_name = public.my_display_name() or public.social_recht_model(model_name));

drop policy if exists social_profil_lesen on public.model_social_profil;
create policy social_profil_lesen on public.model_social_profil for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
         or public.poster_hat_model(model_name) or public.cutter_hat_model(model_name)
         or model_name = public.my_display_name() or public.social_recht_model(model_name));

drop policy if exists board_social_manager_lesen on public.model_board;
create policy board_social_manager_lesen on public.model_board for select to authenticated
  using (public.model_im_social_service(model_name) and (
           (category in ('nogos', 'einschraenkungen')
              and (public.poster_hat_model(model_name) or public.cutter_hat_model(model_name) or public.darf_social_freigeben()
                   or public.social_recht_model(model_name)))
        or (category = 'social_media'
              and (public.poster_hat_account(model_name, public.insta_handle(content))
                   or public.cutter_hat_account(model_name, public.insta_handle(content))
                   or public.darf_social_freigeben()
                   or public.social_recht_hat(model_name, public.insta_handle(content))))
        ));

-- ── Platzhalter umstellen: Einzelrechte mitnehmen ──────────────────────────
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

  -- v5.21.0: Einzelrechte mitnehmen (Dubletten vermeiden)
  delete from public.social_rechte a where a.model_name = p_model and lower(a.account) = alt
    and exists (select 1 from public.social_rechte b where b.model_name = p_model and lower(b.account) = neu and b.person = a.person and b.recht = a.recht);
  update public.social_rechte set account = neu where model_name = p_model and lower(account) = alt;

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
-- select person, model_name, account, recht from public.social_rechte order by 1, 2, 3, 4;
