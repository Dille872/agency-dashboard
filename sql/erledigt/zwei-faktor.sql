-- ══════════════════════════════════════════════════════════════════════════
-- v5.42.0 · Zwei-Faktor-Pflicht für Admin und Manager
--
-- WANN AUSFÜHREN: nachdem v5.42.0 gepusht und bei Vercel live ist.
-- (Vorher hätte ein Admin keine Seite, auf der er die App einrichten kann.)
-- Ob ihr vorher schon eingerichtet habt, ist egal: Wer noch nicht hat, sieht
-- beim nächsten Öffnen die Einrichtung und danach wieder alles.
--
-- Was es macht:
--   1) Admin-/Manager-Logins OHNE Code aus der Authenticator-App („aal1“)
--      bekommen aus keiner Tabelle und keinem Datei-Speicher etwas heraus.
--      Chatter, Models, Social usw. sind NICHT betroffen.
--   2) user_roles bleibt lesbar (die App muss die eigene Rolle kennen),
--      aber Ändern geht nur mit Code.
--   3) is_staff() und darf_kontakte_pflegen() zählen Admin/Manager nur mit
--      Code — damit greifen auch alle Datenbank-Funktionen (RPCs).
--      Sicherheitsnetz: is_staff() wird nur angepasst, wenn der Inhalt exakt
--      dem bekannten Stand entspricht — sonst bleibt sie unverändert und die
--      Kontrolle unten zeigt „nicht angepasst“.
--   4) Funktionen für Einstellungen → Team: Übersicht + Zurücksetzen.
--
-- Ändert keine Daten. Kann mehrfach ausgeführt werden.
-- Rückbau: ganz unten (auskommentiert).
-- ══════════════════════════════════════════════════════════════════════════

-- 1) Prüf-Funktion ----------------------------------------------------------
create or replace function public.zwei_faktor_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid()
          and (ur.roles && array['admin','manager']::text[] or ur.role in ('admin','manager'))
      )
$$;
revoke all on function public.zwei_faktor_ok() from public, anon;
grant execute on function public.zwei_faktor_ok() to authenticated;

-- 2) Sperre auf allen Tabellen (außer user_roles) ---------------------------
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'user_roles'
  loop
    execute format('drop policy if exists zwei_faktor_pflicht on public.%I', t.relname);
    execute format(
      'create policy zwei_faktor_pflicht on public.%I as restrictive for all to authenticated
         using ((select public.zwei_faktor_ok())) with check ((select public.zwei_faktor_ok()))',
      t.relname);
  end loop;
end $$;

-- user_roles: lesen bleibt, schreiben nur mit Code
drop policy if exists zwei_faktor_anlegen on public.user_roles;
drop policy if exists zwei_faktor_aendern on public.user_roles;
drop policy if exists zwei_faktor_loeschen on public.user_roles;
create policy zwei_faktor_anlegen on public.user_roles as restrictive for insert to authenticated
  with check ((select public.zwei_faktor_ok()));
create policy zwei_faktor_aendern on public.user_roles as restrictive for update to authenticated
  using ((select public.zwei_faktor_ok())) with check ((select public.zwei_faktor_ok()));
create policy zwei_faktor_loeschen on public.user_roles as restrictive for delete to authenticated
  using ((select public.zwei_faktor_ok()));

-- Datei-Speicher (Rechnungen, Medien, Anhänge …)
drop policy if exists zwei_faktor_pflicht on storage.objects;
create policy zwei_faktor_pflicht on storage.objects as restrictive for all to authenticated
  using ((select public.zwei_faktor_ok())) with check ((select public.zwei_faktor_ok()));

-- 3) is_staff() / darf_kontakte_pflegen(): Admin/Manager nur mit Code -------
do $$
declare
  f record;
  bekannt text := regexp_replace(lower($b$
    select exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ( ur.roles && array['admin','manager']
              or ur.role in ('admin','manager') )
    )
  $b$), '[\s;]', '', 'g');
  neu text := regexp_replace(lower($b$
    select exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ( ur.roles && array['admin','manager']
              or ur.role in ('admin','manager') )
        and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    )
  $b$), '[\s;]', '', 'g');
begin
  select p.prosrc, p.prosecdef into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_staff' and p.pronargs = 0;
  if f is null then
    raise notice 'is_staff() nicht gefunden – übersprungen';
  elsif regexp_replace(lower(f.prosrc), '[\s;]', '', 'g') = neu then
    raise notice 'is_staff() ist schon angepasst';
  elsif regexp_replace(lower(f.prosrc), '[\s;]', '', 'g') = bekannt then
    execute 'create or replace function public.is_staff() returns boolean language sql stable '
      || case when f.prosecdef then 'security definer ' else '' end
      || $q$set search_path = public as $f$
    select exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ( ur.roles && array['admin','manager']
              or ur.role in ('admin','manager') )
        and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    )
  $f$ $q$;
    raise notice 'is_staff() angepasst';
  else
    raise notice 'is_staff() hat einen unbekannten Inhalt – NICHT angepasst';
  end if;
end $$;

create or replace function public.darf_kontakte_pflegen()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ( ur.roles && array['dienstplan','creator_manager']::text[]
            or ur.role in ('dienstplan','creator_manager')
            or ( (ur.roles && array['admin','manager']::text[] or ur.role in ('admin','manager'))
                 and coalesce(auth.jwt() ->> 'aal', '') = 'aal2' ) )
  );
$$;
revoke all on function public.darf_kontakte_pflegen() from public, anon;
grant execute on function public.darf_kontakte_pflegen() to authenticated;

-- 4) Einstellungen → Team ---------------------------------------------------
create or replace function public.zwei_faktor_stand()
returns table(user_id uuid, display_name text, rolle text, aktiv boolean, seit timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' or not exists (
       select 1 from public.user_roles ur where ur.user_id = auth.uid()
         and (ur.roles && array['admin']::text[] or ur.role = 'admin')) then
    raise exception 'Nur für Admins';
  end if;
  return query
    select ur.user_id, ur.display_name::text,
           case when (ur.roles && array['admin']::text[] or ur.role = 'admin') then 'admin' else 'manager' end,
           exists (select 1 from auth.mfa_factors f where f.user_id = ur.user_id and f.status::text = 'verified'),
           (select min(f.created_at) from auth.mfa_factors f where f.user_id = ur.user_id and f.status::text = 'verified')
      from public.user_roles ur
     where (ur.roles && array['admin','manager']::text[] or ur.role in ('admin','manager'))
       and coalesce(ur.status, 'active') not in ('suspended', 'offboarded')
     order by 3, 2;
end $$;
revoke all on function public.zwei_faktor_stand() from public, anon;
grant execute on function public.zwei_faktor_stand() to authenticated;

-- Notfall (Handy verloren): App-Verknüpfung eines ANDEREN Admins/Managers löschen
create or replace function public.zwei_faktor_zuruecksetzen(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' or not exists (
       select 1 from public.user_roles ur where ur.user_id = auth.uid()
         and (ur.roles && array['admin']::text[] or ur.role = 'admin')) then
    raise exception 'Nur für Admins';
  end if;
  if p_user = auth.uid() then
    raise exception 'Den eigenen Zwei-Faktor kann man hier nicht zurücksetzen';
  end if;
  if not exists (select 1 from public.user_roles ur where ur.user_id = p_user
       and (ur.roles && array['admin','manager']::text[] or ur.role in ('admin','manager'))) then
    raise exception 'Nur für Admin-/Manager-Konten';
  end if;
  delete from auth.mfa_factors where user_id = p_user;
end $$;
revoke all on function public.zwei_faktor_zuruecksetzen(uuid) from public, anon;
grant execute on function public.zwei_faktor_zuruecksetzen(uuid) to authenticated;

-- ── KONTROLLE ──────────────────────────────────────────────────────────────
-- Erwartet: tabellen_ohne_sperre = 0 · speicher = true · is_staff = angepasst
--           · darf_loeschen = true
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relname <> 'user_roles'
      and not exists (select 1 from pg_policies p where p.schemaname = 'public'
                        and p.tablename = c.relname and p.policyname = 'zwei_faktor_pflicht')) as tabellen_ohne_sperre,
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
            and policyname = 'zwei_faktor_pflicht') as speicher,
  case when (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'is_staff' and p.pronargs = 0) ilike '%aal2%'
       then 'angepasst' else 'NICHT angepasst – Claude Bescheid geben' end as is_staff,
  has_table_privilege('auth.mfa_factors', 'DELETE') as darf_loeschen;

-- ── RÜCKBAU (nur im Notfall, alles markieren und ausführen) ────────────────
-- do $$ declare t record; begin
--   for t in select tablename from pg_policies where schemaname='public' and policyname='zwei_faktor_pflicht' loop
--     execute format('drop policy zwei_faktor_pflicht on public.%I', t.tablename); end loop; end $$;
-- drop policy if exists zwei_faktor_pflicht on storage.objects;
-- drop policy if exists zwei_faktor_anlegen on public.user_roles;
-- drop policy if exists zwei_faktor_aendern on public.user_roles;
-- drop policy if exists zwei_faktor_loeschen on public.user_roles;
-- create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $f$
--   select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid()
--     and ( ur.roles && array['admin','manager'] or ur.role in ('admin','manager') )) $f$;
-- create or replace function public.darf_kontakte_pflegen() returns boolean language sql stable security definer set search_path = public as $f$
--   select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid()
--     and ( ur.roles && array['admin','manager','dienstplan','creator_manager']
--           or ur.role in ('admin','manager','dienstplan','creator_manager') )) $f$;
