-- ============================================================================
-- v4.56 · RLS Stufe 4 — Sicherheits-Audit 19.09.2026, Stufe 1
--
--   Teil 1  Gesperrte Accounts (suspended/offboarded) verlieren auf ALLEN
--           Tabellen den Zugriff — bisher nur auf 7 Tabellen.
--   Teil 2  model_aliases: schreiben nur Admin/Manager.
--   Teil 3  models_contact / chatters_contact: schreiben nur Admin, Manager,
--           Dienstplan, Creator-Manager — oder die eigene Zeile.
--
-- NICHTS WIRD GELÖSCHT ODER GEÄNDERT. Es kommen nur RESTRICTIVE Policies dazu
-- (werden mit UND verknüpft, bestehende Policies bleiben unangetastet).
-- Rückgängig: Block ganz unten.
--
-- VORAUSSETZUNG: Prüfung A (Models mit abweichendem Namen) war leer.
-- Serverseitige Functions (Bot, Alarm, Übergabe …) nutzen den Service-Key
-- und sind von RLS nicht betroffen.
-- ============================================================================

begin;

-- ── Hilfsfunktion: darf Kontakte pflegen ────────────────────────────────────
create or replace function public.darf_kontakte_pflegen()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ( ur.roles && array['admin','manager','dienstplan','creator_manager']
            or ur.role in ('admin','manager','dienstplan','creator_manager') )
  );
$$;
revoke all on function public.darf_kontakte_pflegen() from public, anon;
grant execute on function public.darf_kontakte_pflegen() to authenticated;

-- ── Teil 1: Sperre für gesperrte Accounts auf allen Tabellen ────────────────
-- user_roles bleibt bewusst frei — sonst sieht ein Gesperrter statt
-- „Zugang gesperrt" nur einen hängenden Ladebildschirm.
-- Tabellen, die `aktiv_erforderlich` schon haben, werden übersprungen.
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> 'user_roles'
      and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname
                        and p.policyname = 'aktiv_erforderlich')
  loop
    execute format(
      'create policy aktiv_erforderlich on public.%I as restrictive for all to authenticated
         using ((select public.is_active_user())) with check ((select public.is_active_user()))',
      t.relname);
    raise notice 'aktiv_erforderlich angelegt: %', t.relname;
  end loop;
end $$;

-- ── Teil 2: model_aliases nur Staff schreibt (DELETE war schon Staff) ───────
create policy alias_insert_nur_staff on public.model_aliases
  as restrictive for insert to authenticated
  with check ((select public.is_staff()));
create policy alias_update_nur_staff on public.model_aliases
  as restrictive for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- ── Teil 3: Kontakte ─────────────────────────────────────────────────────────
-- Anlegen: nur Pfleger (Registrierung läuft über den Service-Key)
create policy kontakt_insert_pfleger on public.models_contact
  as restrictive for insert to authenticated
  with check ((select public.darf_kontakte_pflegen()));
create policy kontakt_insert_pfleger on public.chatters_contact
  as restrictive for insert to authenticated
  with check ((select public.darf_kontakte_pflegen()));
-- Ändern: Pfleger oder eigene Zeile (Model setzt eigenen Status/last_seen)
create policy kontakt_update_pfleger_oder_selbst on public.models_contact
  as restrictive for update to authenticated
  using ((select public.darf_kontakte_pflegen()) or name = (select public.my_display_name()))
  with check ((select public.darf_kontakte_pflegen()) or name = (select public.my_display_name()));
create policy kontakt_update_pfleger_oder_selbst on public.chatters_contact
  as restrictive for update to authenticated
  using ((select public.darf_kontakte_pflegen()) or name = (select public.my_display_name()))
  with check ((select public.darf_kontakte_pflegen()) or name = (select public.my_display_name()));

commit;

-- ============================================================================
-- KONTROLLE (nur lesen)
-- ============================================================================
-- Welche Tabellen haben jetzt aktiv_erforderlich? (alle außer user_roles)
-- select c.relname,
--        exists (select 1 from pg_policies p where p.tablename = c.relname
--                and p.policyname = 'aktiv_erforderlich') as gesperrt_wirkt
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind = 'r' order by 2, 1;

-- Simulierter Login als gesperrter Account (Beispiel: Christian) — muss 0 liefern:
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub',
--     (select user_id from user_roles where display_name = 'Christian'), 'role','authenticated')::text, true);
--   select count(*) as sollte_0_sein from schedule;
-- rollback;

-- Simulierter Login als aktiver Chatter — Kontakt eines anderen ändern muss 0 Zeilen treffen:
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub',
--     (select user_id from user_roles where display_name = 'Mario'), 'role','authenticated')::text, true);
--   select count(*) as sieht_schedule from schedule;               -- > 0 (unverändert)
--   update models_contact set telegram_id = telegram_id where name <> 'Mario';  -- ERWARTET: Fehler/0 Zeilen
-- rollback;

-- ============================================================================
-- RÜCKGÄNGIG (nur bei Problemen, entfernt ausschließlich das hier Angelegte)
-- ============================================================================
-- begin;
-- do $$
-- declare t record;
-- -- ACHTUNG: aktiv_erforderlich gab es vorher schon auf 7 Tabellen — die bleiben!
-- begin
--   for t in select tablename from pg_policies
--            where schemaname = 'public' and policyname = 'aktiv_erforderlich'
--              and tablename not in ('model_snapshots','chatter_snapshots','billing_settings',
--                                    'models_contact','chatter_aliases','model_aliases','messages')
--   loop
--     execute format('drop policy aktiv_erforderlich on public.%I', t.tablename);
--   end loop;
-- end $$;
-- drop policy if exists alias_insert_nur_staff on public.model_aliases;
-- drop policy if exists alias_update_nur_staff on public.model_aliases;
-- drop policy if exists kontakt_insert_pfleger on public.models_contact;
-- drop policy if exists kontakt_insert_pfleger on public.chatters_contact;
-- drop policy if exists kontakt_update_pfleger_oder_selbst on public.models_contact;
-- drop policy if exists kontakt_update_pfleger_oder_selbst on public.chatters_contact;
-- drop function if exists public.darf_kontakte_pflegen();
-- commit;
