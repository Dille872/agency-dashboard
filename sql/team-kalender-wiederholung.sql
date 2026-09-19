-- v4.65.0: Team-Kalender — Wiederholungen + Titel des Events an Folgeaufgaben
-- Nur neue Spalten, bestehende Daten bleiben unverändert.
alter table public.team_kalender
  add column if not exists serie_id uuid,
  add column if not exists wiederholung text
    check (wiederholung in ('taeglich','woechentlich','zweiwoechentlich','monatlich')),
  add column if not exists folge_titel text;

create index if not exists team_kalender_serie_idx on public.team_kalender(serie_id);

-- Bestehende Folgeaufgaben bekommen den Titel ihres Events (einmalig)
update public.team_kalender f
   set folge_titel = e.titel
  from public.team_kalender e
 where f.folge_von = e.id and f.folge_titel is null;
