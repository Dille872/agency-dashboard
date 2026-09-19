-- ============================================================================
-- v4.60.0 · Team-Kalender (Stufe 1)
--
-- Ein Eintrag = ein fester Zeitpunkt (timestamptz). Eingegeben wird in
-- deutscher Zeit (wie im Dienstplan), angezeigt in der Zeit des Browsers.
--
-- Sichtbarkeit:
--   Admin/Manager/Dienstplan/Creator-Manager: alles
--   Chatter/Models: Einträge für alle (fuer_alle) und solche, in denen sie
--   namentlich stehen (fuer).
-- Anlegen/Ändern/Löschen: Admin/Manager/Dienstplan/Creator-Manager.
-- Erledigt-Haken: Empfänger über kalender_erledigt(id).
-- Nur Hinzufügen — bestehende Tabellen werden nicht angefasst.
-- ============================================================================
begin;

create table if not exists public.team_kalender (
  id          uuid primary key default gen_random_uuid(),
  titel       text not null check (length(btrim(titel)) > 0),
  art         text not null default 'aufgabe'
              check (art in ('aufgabe', 'event', 'termin', 'erinnerung')),
  beginn      timestamptz not null,
  ende        timestamptz,
  notiz       text,
  fuer        text[] not null default '{}',   -- Anzeigenamen
  fuer_alle   boolean not null default false,
  erledigt_von text[] not null default '{}',
  erinnern_min integer,                        -- Stufe 2: Erinnerung X Min vorher
  erstellt_von text,
  erstellt_am timestamptz not null default now(),
  geaendert_am timestamptz not null default now(),
  check (ende is null or ende >= beginn)
);
create index if not exists team_kalender_beginn_idx on public.team_kalender (beginn);

alter table public.team_kalender enable row level security;

create policy kalender_lesen on public.team_kalender
  for select to authenticated
  using ( (select public.darf_kontakte_pflegen())
          or fuer_alle
          or (select public.my_display_name()) = any (fuer) );
create policy kalender_anlegen on public.team_kalender
  for insert to authenticated
  with check ( (select public.darf_kontakte_pflegen()) );
create policy kalender_aendern on public.team_kalender
  for update to authenticated
  using ( (select public.darf_kontakte_pflegen()) )
  with check ( (select public.darf_kontakte_pflegen()) );
create policy kalender_loeschen on public.team_kalender
  for delete to authenticated
  using ( (select public.darf_kontakte_pflegen()) );
-- wie alle Tabellen: gesperrte Accounts sehen nichts
create policy aktiv_erforderlich on public.team_kalender
  as restrictive for all to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));

-- Erledigt-Haken für Empfänger (sie dürfen die Zeile sonst nicht ändern)
create or replace function public.kalender_erledigt(p_id uuid, p_erledigt boolean default true)
returns text[]
language plpgsql security definer
set search_path = public
as $$
declare ich text := public.my_display_name(); ergebnis text[];
begin
  if not public.is_active_user() or coalesce(ich, '') = '' then raise exception 'nicht berechtigt'; end if;
  update public.team_kalender
     set erledigt_von = case when p_erledigt
                              then (select array_agg(distinct x) from unnest(erledigt_von || ich) x)
                              else array_remove(erledigt_von, ich) end,
         geaendert_am = now()
   where id = p_id
     and (fuer_alle or ich = any (fuer) or public.darf_kontakte_pflegen())
  returning erledigt_von into ergebnis;
  return ergebnis;
end $$;
revoke all on function public.kalender_erledigt(uuid, boolean) from public, anon;
grant execute on function public.kalender_erledigt(uuid, boolean) to authenticated;

commit;

-- RÜCKGÄNGIG (löscht die Tabelle MIT allen Kalendereinträgen!)
-- drop function if exists public.kalender_erledigt(uuid, boolean);
-- drop table if exists public.team_kalender;
