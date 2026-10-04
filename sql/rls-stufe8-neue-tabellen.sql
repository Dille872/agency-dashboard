-- ══════════════════════════════════════════════════════════════════════════
-- v5.41.0 · Sicherheit: Sperre für gesperrte Accounts auch auf neueren Tabellen
--
-- Seit Stufe 4 bekommt jede Tabelle die Regel „nur aktive Accounts“. Einige
-- später angelegte Tabellen hatten sie noch nicht (Check vom 04.10.2026):
--   board_elemente, boards, ch_video_erledigt, gelesen_stand,
--   of_skripte, of_vorlagen, social_uebersetzung
-- Ein gesperrter/offboardeter Account hätte dort noch lesen/schreiben können.
--
-- Das Skript sucht ALLE Tabellen ohne diese Sperre (nicht nur die 7) und legt
-- sie an. user_roles bleibt bewusst frei (sonst hängt der Gesperrt-Bildschirm).
-- Ändert keine Daten, entfernt keine Regeln. Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname <> 'user_roles'
      and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.relname
                        and p.permissive = 'RESTRICTIVE'
                        and coalesce(p.qual, '') ilike '%is_active_user%')
  loop
    execute format(
      'create policy aktiv_erforderlich on public.%I as restrictive for all to authenticated
         using ((select public.is_active_user())) with check ((select public.is_active_user()))',
      t.relname);
    raise notice 'aktiv_erforderlich angelegt: %', t.relname;
  end loop;
end $$;

-- KONTROLLE — erwartet: keine Zeilen
select c.relname as ohne_aktiv_sperre
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'user_roles'
  and not exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = c.relname
                    and p.permissive = 'RESTRICTIVE'
                    and coalesce(p.qual, '') ilike '%is_active_user%')
order by 1;
