-- ══════════════════════════════════════════════════════════════════════════
-- v5.43.0 · Buchhaltung: Rechnungen zusammenlegen (z. B. Alessia & Pascal)
--
-- Wer gemeinsam EINE Rechnung schreibt (Paar mit Firma), wird weiter einzeln
-- berechnet, steht in der Buchhaltung aber als eine Zeile mit Summe, einer
-- Rechnung und einem „Bezahlt“.
--
-- 1) Tabelle abrechnung_gruppen (nur Admin/Manager lesen und schreiben).
--    „Auflösen“ löscht nichts, sondern setzt aufgeloest_am.
-- 2) chatter_abrechnungen.gruppe: wird beim „Bezahlt“ mitgeschrieben, damit
--    bezahlte Monate auch nach dem Auflösen zusammen bleiben.
-- 3) meine_rechnungsgruppe(): Chatter sieht im Portal nur, ob der Partner die
--    gemeinsame Rechnung schon hochgeladen hat (keine Beträge).
--
-- Ändert keine bestehenden Daten. Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.abrechnung_gruppen (
  id             bigint generated always as identity primary key,
  name           text not null check (length(trim(name)) between 1 and 80),
  mitglieder     text[] not null check (cardinality(mitglieder) >= 2),
  erstellt_von   text,
  erstellt_am    timestamptz not null default now(),
  aufgeloest_am  timestamptz,
  aufgeloest_von text
);
create unique index if not exists abrechnung_gruppen_name_aktiv
  on public.abrechnung_gruppen (lower(name)) where aufgeloest_am is null;

alter table public.abrechnung_gruppen enable row level security;
drop policy if exists gruppen_lesen on public.abrechnung_gruppen;
drop policy if exists gruppen_anlegen on public.abrechnung_gruppen;
drop policy if exists gruppen_aendern on public.abrechnung_gruppen;
drop policy if exists aktiv_erforderlich on public.abrechnung_gruppen;
create policy gruppen_lesen on public.abrechnung_gruppen for select to authenticated
  using ((select public.is_staff()));
create policy gruppen_anlegen on public.abrechnung_gruppen for insert to authenticated
  with check ((select public.is_staff()));
create policy gruppen_aendern on public.abrechnung_gruppen for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy aktiv_erforderlich on public.abrechnung_gruppen as restrictive for all to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));
-- Zwei-Faktor-Sperre wie bei allen Tabellen (nur wenn zwei-faktor.sql schon lief)
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'zwei_faktor_ok') then
    execute 'drop policy if exists zwei_faktor_pflicht on public.abrechnung_gruppen';
    execute 'create policy zwei_faktor_pflicht on public.abrechnung_gruppen as restrictive for all to authenticated
               using ((select public.zwei_faktor_ok())) with check ((select public.zwei_faktor_ok()))';
  end if;
end $$;
grant select, insert, update on public.abrechnung_gruppen to authenticated;

alter table public.chatter_abrechnungen add column if not exists gruppe text;

-- Chatter: gehöre ich zu einer Gruppe, und hat jemand anderes schon hochgeladen?
create or replace function public.meine_rechnungsgruppe()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ich text := public.my_display_name();
  g   public.abrechnung_gruppen;
begin
  if ich is null or not public.is_active_user() then return null; end if;
  select * into g from public.abrechnung_gruppen
   where aufgeloest_am is null
     and exists (select 1 from unnest(mitglieder) m where lower(m) = lower(ich))
   order by erstellt_am desc limit 1;
  if g.id is null then return null; end if;
  return jsonb_build_object(
    'name', g.name,
    'mitglieder', to_jsonb(g.mitglieder),
    'rechnungen', coalesce((
      select jsonb_agg(jsonb_build_object('wer', a.chatter_name, 'monat', a.monat, 'status', a.status, 'rechnung_am', a.rechnung_am))
        from public.chatter_abrechnungen a
       where coalesce(a.art, 'chatter') = 'chatter' and not a.frei
         and lower(a.chatter_name) <> lower(ich)
         and lower(a.chatter_name) in (select lower(m) from unnest(g.mitglieder) m)
         and a.monat >= to_char((now() at time zone 'Europe/Berlin') - interval '6 months', 'YYYY-MM')
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.meine_rechnungsgruppe() from public, anon;
grant execute on function public.meine_rechnungsgruppe() to authenticated;

-- Kontrolle: true · true · true
select
  to_regclass('public.abrechnung_gruppen') is not null as tabelle,
  exists (select 1 from information_schema.columns where table_schema = 'public'
            and table_name = 'chatter_abrechnungen' and column_name = 'gruppe') as spalte,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'meine_rechnungsgruppe') as funktion;
