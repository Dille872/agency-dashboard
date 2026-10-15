-- ============================================================================
-- v5.51.0 · Schichtzeiten für Massennachrichten
--
-- Neue Rolle „massen“: sieht im Dashboard nur die Seite „Schichtzeiten“.
-- Dort stehen für die Accounts, die ihr ihm freigebt, je Tag die Schichten
-- (Vorschicht, Früh, Spät, Nacht) mit Beginn und Ende in deutscher Zeit.
--
-- Entscheidungen Chris (15.10.2026):
--   • Unbesetzte Schichten zählen als normale Schicht. Nur eine Freischicht
--     („Bewusst frei“, __FREI__) fällt weg.
--   • Deutsche Zeit.
--   • Freigabe pro OnlyFans-Account (model_aliases.csv_name), von euch gewählt.
--
-- Datenschutz: Die Rolle bekommt KEINEN Zugriff auf schedule, user_roles,
-- chatters_contact usw. Die Funktion massen_schichtzeiten() läuft mit
-- Eigentümerrechten und gibt nur Account, Model, Tag, Schicht und die
-- Zeitangabe heraus. Chatter-Namen verlassen die Datenbank nie.
-- Nur Wochen mit Status „live“ (keine Entwürfe).
--
-- Wiederholbar. Ändert und löscht keine bestehenden Daten.
-- ============================================================================

-- 1) Rolle im Check-Constraint erlauben (user_roles + signup_invites)
do $$
declare
  r   record;
  neu text;
begin
  for r in
    select c.conrelid::regclass as tabelle, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.conrelid in ('public.user_roles'::regclass, 'public.signup_invites'::regclass)
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '\mchatter\M'
  loop
    if r.def ~ '\mmassen\M' then
      raise notice '% · % kennt die Rolle massen schon', r.tabelle, r.conname;
      continue;
    end if;
    if r.def like '%''chatter''::text%' then
      neu := replace(r.def, '''chatter''::text', '''chatter''::text, ''massen''::text');
    elsif r.def ~ '[{,]chatter[,}]' then
      neu := regexp_replace(r.def, '([{,])chatter([,}])', '\1chatter,massen\2');
    else
      raise notice '% · % nicht automatisch anpassbar, bitte Chris/Claude zeigen: %', r.tabelle, r.conname, r.def;
      continue;
    end if;
    execute format('alter table %s drop constraint %I', r.tabelle, r.conname);
    execute format('alter table %s add constraint %I %s', r.tabelle, r.conname, neu);
    raise notice '% · % angepasst', r.tabelle, r.conname;
  end loop;
end $$;

-- 2) Welche Accounts sieht wer?
create table if not exists public.massen_accounts (
  user_id      uuid not null,
  account      text not null,                 -- model_aliases.csv_name
  erstellt_am  timestamptz not null default now(),
  erstellt_von text,
  primary key (user_id, account)
);
alter table public.massen_accounts enable row level security;

drop policy if exists massen_accounts_lesen    on public.massen_accounts;
drop policy if exists massen_accounts_anlegen  on public.massen_accounts;
drop policy if exists massen_accounts_loeschen on public.massen_accounts;
create policy massen_accounts_lesen on public.massen_accounts for select to authenticated
  using (public.is_staff() or user_id = auth.uid());
create policy massen_accounts_anlegen on public.massen_accounts for insert to authenticated
  with check (public.is_staff());
create policy massen_accounts_loeschen on public.massen_accounts for delete to authenticated
  using (public.is_staff());

-- 3) Die Schichtzeiten
--    p_fuer: nur für Admin/Manager — „so sieht es Person X“. Ohne p_fuer sieht
--    die Leitung alle Accounts, die Rolle massen nur ihre freigegebenen.
--    zeit = abweichende Zeit der Zelle, sonst die Standardzeit des Models
--    (wie im Dienstplan). Leere Zeit → keine Schicht.
create or replace function public.massen_schichtzeiten(p_von date, p_bis date, p_fuer uuid default null)
returns table (account text, funnel text, model text, datum date, schicht text, zeit text)
language plpgsql stable security definer set search_path = public as $$
declare
  leitung boolean := public.is_staff();
  ziel    uuid;
begin
  if p_von is null or p_bis is null or p_bis < p_von or p_bis - p_von > 62 then
    raise exception 'Zeitraum ungültig (höchstens 62 Tage)';
  end if;
  if leitung then
    ziel := p_fuer;                                   -- null = alle Accounts
  elsif public.hat_rolle('massen') then
    ziel := auth.uid();
  else
    return;                                           -- alle anderen: nichts
  end if;

  return query
  with konten as (
    select distinct on (a.csv_name) a.csv_name, coalesce(a.alias_label, 'MAIN') as funnel, a.model_name
    from public.model_aliases a
    where a.csv_name is not null and a.model_name is not null
      and (ziel is null or exists (select 1 from public.massen_accounts m where m.user_id = ziel and m.account = a.csv_name))
    order by a.csv_name, a.id
  ), models as (
    select distinct on (mc.name) mc.id, mc.name
    from public.models_contact mc
    where mc.name in (select k.model_name from konten k)
      and coalesce(mc.in_schedule, true) and coalesce(mc.active, true)
    order by mc.name, mc.id
  ), zellen as (
    select m.name as model, (s.week_start + d.i) as tag, sh.schicht,
           coalesce(nullif(btrim(c.zelle ->> 'time_override'), ''),
                    nullif(btrim(s.shift_times ->> (m.id::text || '__' || sh.schicht)), '')) as zeit,
           c.zelle ->> 'chatter' as wer
    from public.schedule s
    cross join generate_series(0, 6) d(i)
    cross join models m
    cross join (values ('Vorschicht'), ('Früh'), ('Spät'), ('Nacht')) sh(schicht)
    cross join lateral (select s.assignments -> (m.id::text || '__' || to_char(s.week_start + d.i, 'YYYY-MM-DD') || '__' || sh.schicht) as zelle) c
    where s.status = 'live'
      and s.week_start between p_von - 6 and p_bis
      and (s.week_start + d.i) between p_von and p_bis
  )
  select k.csv_name, k.funnel, z.model, z.tag, z.schicht, regexp_replace(z.zeit, '\s*\(DE\)\s*', '', 'gi')
  from zellen z
  join konten k on k.model_name = z.model
  where z.zeit is not null
    and coalesce(z.wer, '') <> '__FREI__'
  order by z.tag, z.model, k.csv_name,
           array_position(array['Vorschicht', 'Früh', 'Spät', 'Nacht'], z.schicht);
end $$;
revoke all on function public.massen_schichtzeiten(date, date, uuid) from public, anon;
grant execute on function public.massen_schichtzeiten(date, date, uuid) to authenticated;

-- 4) Riegel: Wer NUR die Rolle massen hat, liest und schreibt sonst nichts.
--    Viele Tabellen (schedule, chatters_contact, absences …) sind für jeden
--    aktiven Login lesbar, weil Chatter-Portal und Dienstplan sie brauchen.
--    Ohne diesen Riegel käme die Rolle über die Schnittstelle an Chatter-Namen.
--    RESTRICTIVE = wird mit UND verknüpft; für alle anderen Rollen ändert sich
--    nichts (nur_massen() ist für sie false). Ausgenommen: user_roles (eigene
--    Zeile, sonst kein Login) und massen_accounts (eigene Freigaben).
--    Neue Tabellen, die später dazukommen, haben den Riegel noch nicht:
--    dieses Skript dann einfach erneut ausführen.
create or replace function public.nur_massen()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and ('massen' = any(coalesce(roles, '{}')) or role = 'massen')
      and not (coalesce(roles, '{}') && array['admin','manager','dienstplan','creator_manager','chatter','model',
                                              'social_media','cutter','social_leitung','social_freigabe','storyteller','script_builder'])
      and coalesce(role, 'massen') = 'massen'
  )
$$;
grant execute on function public.nur_massen() to authenticated;

do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
      and c.relname not in ('user_roles', 'massen_accounts')
  loop
    if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'massen_gesperrt') then
      continue;
    end if;
    execute format(
      'create policy massen_gesperrt on public.%I as restrictive for all to authenticated
         using (not (select public.nur_massen())) with check (not (select public.nur_massen()))', t.relname);
    raise notice 'massen_gesperrt angelegt: %', t.relname;
  end loop;
end $$;

-- Prüfen:
-- select * from public.massen_schichtzeiten(current_date, current_date + 6);   -- im SQL-Editor: leer (kein Login)
-- select * from public.massen_accounts;
-- select tablename from pg_policies where policyname = 'massen_gesperrt' order by 1;   -- alle Tabellen mit Riegel
-- Test als Planer (UUID einsetzen):
-- begin; set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--   select count(*) from public.schedule;                                  -- muss 0 sein
--   select * from public.massen_schichtzeiten(current_date, current_date + 6);
-- rollback;
