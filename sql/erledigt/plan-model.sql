-- ============================================================================
-- v5.4.0 · Ein gemeinsamer Posting-Plan — auch Models planen mit (per Schalter)
--
-- Entscheidung Chris (29.09.):
--   • Ein Kalender für alle: Poster, Admin, Social-Leitung und das Model.
--   • Nur Models im Social-Service, und nur wenn der Schalter „Model plant
--     mit“ an ist (Social Media → Steuerung). Standard: aus.
--   • Das Model darf auf seinen eigenen, betreuten Accounts alles, was ein
--     Poster darf: anlegen, ändern, als gepostet markieren, löschen.
--   • Im Kalender steht, wer einen Beitrag eingetragen hat.
--
-- Voraussetzung: posting-plan.sql (und plan-vorschlaege.sql). Wiederholbar.
-- Löscht und überschreibt keine Daten.
-- ============================================================================

-- ── Schalter pro Model ─────────────────────────────────────────────────────
alter table public.model_social_service add column if not exists model_plant boolean not null default false;

-- Der Schalter gehört der Agentur (wie service_aktiv): Models können ihn nicht
-- selbst umlegen. Neufassung des Schutz-Triggers aus social-leitung.sql, nur
-- um model_plant ergänzt.
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
  else
    new.service_aktiv    := old.service_aktiv;
    new.posting_ab       := old.posting_ab;
    new.angefordert_am   := old.angefordert_am;
    new.angefordert_von  := old.angefordert_von;
    new.account_notizen  := old.account_notizen;
    new.nicht_betreut    := old.nicht_betreut;
    new.account_modus    := old.account_modus;
    new.model_plant      := old.model_plant;
  end if;
  return new;
end $$;

-- ── Darf die eingeloggte Person als Model auf diesem Account planen? ───────
-- Ja, wenn: es ihr eigenes Model ist, der Service aktiv ist, der Schalter an
-- ist und der Account als Instagram-Link in ihrem Board steht und betreut ist.
create or replace function public.model_plant_account(p_model text, p_account text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_model = public.my_display_name() and exists (
    select 1
    from public.model_social_service s
    join public.model_board b on b.model_name = s.model_name and b.category = 'social_media'
    where s.model_name = p_model and s.service_aktiv and s.model_plant
      and lower(public.insta_handle(b.content)) = lower(trim(p_account))
      and not (lower(trim(p_account)) = any(array(select lower(x) from unnest(s.nicht_betreut) x)))
  )
$$;
grant execute on function public.model_plant_account(text, text) to authenticated;

-- ── Rechte im Plan: Model dazu ─────────────────────────────────────────────
drop policy if exists plan_anlegen  on public.social_plan;
drop policy if exists plan_aendern  on public.social_plan;
drop policy if exists plan_loeschen on public.social_plan;
create policy plan_anlegen on public.social_plan for insert to authenticated
  with check (public.darf_social_leiten() or public.poster_hat_account(model_name, account)
              or public.model_plant_account(model_name, account));
create policy plan_aendern on public.social_plan for update to authenticated
  using (public.darf_social_leiten() or public.poster_hat_account(model_name, account)
         or public.model_plant_account(model_name, account))
  with check (public.darf_social_leiten() or public.poster_hat_account(model_name, account)
              or public.model_plant_account(model_name, account));
create policy plan_loeschen on public.social_plan for delete to authenticated
  using (public.darf_social_leiten() or public.poster_hat_account(model_name, account)
         or public.model_plant_account(model_name, account));
-- (plan_lesen bleibt: das Model sah seinen Plan schon vorher.)

-- ── „Eingetragen von“ zuverlässig setzen ───────────────────────────────────
-- Vorher: vom Browser übernommen, falls mitgeschickt. Jetzt: immer die
-- eingeloggte Person; beim Ändern bleibt der ursprüngliche Name stehen.
-- (Ohne Login, z. B. Lyra-Function, bleibt der mitgeschickte Wert.)
create or replace function public.social_plan_vorbereiten()
returns trigger language plpgsql as $$
begin
  new.account := trim(new.account);   -- Schreibweise wie in der Zuteilung lassen (RLS vergleicht genau)
  if left(new.account, 1) <> '@' then new.account := '@' || new.account; end if;
  new.aktualisiert_am := now();
  if tg_op = 'INSERT' then
    new.erstellt_von := coalesce(nullif(public.my_display_name(), ''), new.erstellt_von);
  else
    new.erstellt_von := old.erstellt_von;
  end if;
  if new.status = 'gepostet' and (tg_op = 'INSERT' or old.status is distinct from 'gepostet') then
    new.gepostet_am := coalesce(new.gepostet_am, now());
    new.gepostet_von := coalesce(new.gepostet_von, public.my_display_name());
  end if;
  return new;
end $$;

-- Prüfen:
-- select model_name, service_aktiv, model_plant from public.model_social_service order by 1;
