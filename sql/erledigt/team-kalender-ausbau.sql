-- ============================================================================
-- v4.66.0: Team-Kalender — Ausbau
--   1. Model am Eintrag (Filter + Empfänger nach Schicht)
--   2. Nachhaken bei überfälligen Aufgaben (send-reminders merkt sich, wann)
--   3. Vorlagen (vom Team gespeichert)
--   4. Rückmeldungen der Empfänger — eigene Tabelle, damit ein Chatter NUR
--      seine eigenen Rückmeldungen lesen kann (nicht die der anderen).
-- Nur Hinzufügen — bestehende Daten bleiben unverändert. Wiederholbar.
-- ============================================================================
begin;

-- 1 + 2 ----------------------------------------------------------------------
alter table public.team_kalender
  add column if not exists model_name    text,
  add column if not exists nachgehakt_am timestamptz,
  add column if not exists eskaliert_am  timestamptz;

create index if not exists team_kalender_model_idx on public.team_kalender (model_name);

-- 3 Vorlagen -----------------------------------------------------------------
create table if not exists public.kalender_vorlagen (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) > 0),
  daten        jsonb not null default '{}'::jsonb,
  erstellt_von text,
  erstellt_am  timestamptz not null default now()
);
alter table public.kalender_vorlagen enable row level security;

drop policy if exists vorlagen_team on public.kalender_vorlagen;
create policy vorlagen_team on public.kalender_vorlagen
  for all to authenticated
  using ( (select public.darf_kontakte_pflegen()) )
  with check ( (select public.darf_kontakte_pflegen()) );

drop policy if exists aktiv_erforderlich on public.kalender_vorlagen;
create policy aktiv_erforderlich on public.kalender_vorlagen
  as restrictive for all to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));

-- 4 Rückmeldungen ------------------------------------------------------------
create table if not exists public.kalender_rueckmeldungen (
  id          uuid primary key default gen_random_uuid(),
  kalender_id uuid not null references public.team_kalender(id) on delete cascade,
  von         text not null,
  text        text not null check (length(btrim(text)) between 1 and 1000),
  am          timestamptz not null default now()
);
create index if not exists kalender_rueckmeldungen_kal_idx on public.kalender_rueckmeldungen (kalender_id);
alter table public.kalender_rueckmeldungen enable row level security;

-- Lesen: Team alles, sonst nur die eigenen
drop policy if exists rueckmeldung_lesen on public.kalender_rueckmeldungen;
create policy rueckmeldung_lesen on public.kalender_rueckmeldungen
  for select to authenticated
  using ( (select public.darf_kontakte_pflegen())
          or von = (select public.my_display_name()) );

-- Schreiben: nur unter eigenem Namen und nur zu Einträgen, die man sehen darf
-- (das exists läuft mit der RLS von team_kalender → nur eigene/Team-Einträge)
drop policy if exists rueckmeldung_anlegen on public.kalender_rueckmeldungen;
create policy rueckmeldung_anlegen on public.kalender_rueckmeldungen
  for insert to authenticated
  with check ( von = (select public.my_display_name())
               and exists (select 1 from public.team_kalender k where k.id = kalender_id) );

-- Löschen: nur Team (Ändern gar nicht)
drop policy if exists rueckmeldung_loeschen on public.kalender_rueckmeldungen;
create policy rueckmeldung_loeschen on public.kalender_rueckmeldungen
  for delete to authenticated
  using ( (select public.darf_kontakte_pflegen()) );

drop policy if exists aktiv_erforderlich on public.kalender_rueckmeldungen;
create policy aktiv_erforderlich on public.kalender_rueckmeldungen
  as restrictive for all to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));

commit;
