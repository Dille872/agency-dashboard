-- ══════════════════════════════════════════════════════════════════════════
-- v5.44.0 · Buchhaltung: Chatter wöchentlich abrechnen (z. B. Etienne)
--
-- Pro Chatter: monatlich (Standard, keine Zeile nötig) oder wöchentlich, mit
-- Wochenstart (0 = Sonntag … 6 = Samstag; Woche = 7 Tage ab diesem Tag).
-- Nur Admin/Manager lesen und ändern. Der Chatter erfährt seinen eigenen
-- Rhythmus über mein_abrechnungs_rhythmus() (für die Auswahl im Portal).
--
-- Ändert keine bestehenden Daten. Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.abrechnung_rhythmus (
  chatter_name  text primary key,
  rhythmus      text not null default 'monat' check (rhythmus in ('monat', 'woche')),
  wochenstart   int  not null default 0 check (wochenstart between 0 and 6),
  geaendert_von text,
  geaendert_am  timestamptz not null default now()
);

alter table public.abrechnung_rhythmus enable row level security;
drop policy if exists rhythmus_staff on public.abrechnung_rhythmus;
drop policy if exists aktiv_erforderlich on public.abrechnung_rhythmus;
create policy rhythmus_staff on public.abrechnung_rhythmus for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy aktiv_erforderlich on public.abrechnung_rhythmus as restrictive for all to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'zwei_faktor_ok') then
    execute 'drop policy if exists zwei_faktor_pflicht on public.abrechnung_rhythmus';
    execute 'create policy zwei_faktor_pflicht on public.abrechnung_rhythmus as restrictive for all to authenticated
               using ((select public.zwei_faktor_ok())) with check ((select public.zwei_faktor_ok()))';
  end if;
end $$;
grant select, insert, update, delete on public.abrechnung_rhythmus to authenticated;

-- Chatter: mein eigener Rhythmus (ohne Zeile = monatlich)
create or replace function public.mein_abrechnungs_rhythmus()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('rhythmus', r.rhythmus, 'wochenstart', r.wochenstart)
       from public.abrechnung_rhythmus r
      where lower(r.chatter_name) = lower(public.my_display_name()) and public.is_active_user()),
    jsonb_build_object('rhythmus', 'monat', 'wochenstart', 0))
$$;
revoke all on function public.mein_abrechnungs_rhythmus() from public, anon;
grant execute on function public.mein_abrechnungs_rhythmus() to authenticated;

-- Kontrolle: true · true
select to_regclass('public.abrechnung_rhythmus') is not null as tabelle,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'mein_abrechnungs_rhythmus') as funktion;
