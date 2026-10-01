-- ============================================================================
-- v5.19.0 · Poster nur noch ansehen, laden und „gepostet“ markieren
--
-- Entscheidung Chris (01.10.): Content hochladen und einplanen machen das
-- Model (mit „plant mit“), der Cutter und das Team. Poster sehen den Plan
-- ihrer Accounts, laden Dateien herunter und markieren Beiträge als gepostet.
--
-- Vorher durften Poster auf ihren Accounts alles wie das Team (anlegen,
-- ändern, löschen, hochladen). Jetzt:
--   social_plan     anlegen / löschen:  nur Team + Model mit „plant mit“
--                   ändern: Poster weiter erlaubt, aber per Trigger NUR
--                   status, reel_url, gepostet_am, gepostet_von
--   social_material anlegen: nur Team + das Model selbst
--   Speicher        hochladen in plan/ und material/: ohne Poster
--                   (ansehen/laden bleibt wie bisher)
--
-- Lyra/Edge-Functions (ohne Login) sind vom Trigger ausgenommen.
-- Voraussetzung: posting-plan.sql, plan-model.sql, plan-dateien.sql.
-- Wiederholbar. Löscht und ändert keine Daten.
-- ============================================================================

-- ── Plan: anlegen / löschen ohne Poster ────────────────────────────────────
drop policy if exists plan_anlegen  on public.social_plan;
drop policy if exists plan_loeschen on public.social_plan;
create policy plan_anlegen on public.social_plan for insert to authenticated
  with check (public.darf_social_leiten() or public.model_plant_account(model_name, account));
create policy plan_loeschen on public.social_plan for delete to authenticated
  using (public.darf_social_leiten() or public.model_plant_account(model_name, account));
-- plan_aendern bleibt (Poster müssen „gepostet“ setzen können) — begrenzt durch den Trigger unten.

-- ── Plan: Poster dürfen beim Ändern nur die Posten-Felder anfassen ─────────
-- Name beginnt mit „a_“, damit er VOR social_plan_vorbereiten läuft
-- (Trigger laufen alphabetisch) und nur sieht, was die Person geschickt hat.
create or replace function public.social_plan_poster_nur_posten()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  frei constant text[] := array['status', 'reel_url', 'gepostet_am', 'gepostet_von', 'aktualisiert_am'];
begin
  if auth.uid() is null then return new; end if;                          -- Lyra / Service
  if public.darf_social_leiten() then return new; end if;                  -- Team
  if public.model_plant_account(old.model_name, old.account) then return new; end if;  -- Model „plant mit“
  if (to_jsonb(new) - frei) is distinct from (to_jsonb(old) - frei) then
    raise exception 'Als Poster kannst du Beiträge nur als gepostet markieren. Änderungen bitte über das Team.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists a_social_plan_poster_nur_posten on public.social_plan;
create trigger a_social_plan_poster_nur_posten before update on public.social_plan
  for each row execute function public.social_plan_poster_nur_posten();

-- ── Material: anlegen ohne Poster ──────────────────────────────────────────
drop policy if exists material_anlegen on public.social_material;
create policy material_anlegen on public.social_material for insert to authenticated
  with check (public.darf_social_leiten() or model_name = public.my_display_name());

-- ── Speicher: hochladen ohne Poster (ansehen unverändert) ─────────────────
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
          or modell = public.my_display_name();
    end if;
    return leiten or public.model_plant_account(modell, konto);          -- v5.19.0: ohne Poster
  end if;

  if t[1] = 'material' and array_length(t, 1) = 3 and t[3] ~ datei_re then
    modell := public.hex_text(t[2]);
    if modell is null then return false; end if;
    if not p_schreiben then
      return leiten or public.darf_social_freigeben()
          or public.poster_hat_model(modell)
          or modell = public.my_display_name();
    end if;
    return leiten or modell = public.my_display_name();                   -- v5.19.0: ohne Poster
  end if;

  return false;
end $$;
grant execute on function public.social_datei_recht(text, boolean) to authenticated;

-- Prüfen:
-- select tgname from pg_trigger where tgrelid = 'public.social_plan'::regclass and not tgisinternal order by 1;
--   → a_social_plan_poster_nur_posten steht VOR social_plan_vorbereiten
-- select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
--   from pg_policy where polrelid = 'public.social_plan'::regclass order by 1;
