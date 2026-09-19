-- v4.64.0: Folgeaufgaben im Team-Kalender
-- Eine Folgeaufgabe ist ein normaler team_kalender-Eintrag (art = 'aufgabe'),
-- der über folge_von an ein Event/Termin hängt.
alter table public.team_kalender
  add column if not exists folge_von uuid references public.team_kalender(id) on delete set null,
  add column if not exists folge_bezug text check (folge_bezug in ('beginn','ende')),
  add column if not exists folge_offset_min integer;

create index if not exists team_kalender_folge_von_idx on public.team_kalender(folge_von);

-- Prüfung (separat ausführen):
-- select column_name, data_type from information_schema.columns
--  where table_name = 'team_kalender' and column_name like 'folge%';
