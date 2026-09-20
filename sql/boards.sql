-- ============================================================================
-- v4.73.0 · Boards — gemeinsames Whiteboard für Admin/Manager
--
-- Zwei Tabellen:
--   boards          ein Board (Titel, Vorlage, wer, wann, archiviert)
--   board_elemente  alles, was darauf liegt: Rahmen, Notizen, Personen,
--                   Text, Pfeile. Eine Zeile je Element, damit zwei Leute
--                   gleichzeitig an verschiedenen Stellen arbeiten können,
--                   ohne sich gegenseitig zu überschreiben.
--
-- WER DARF WAS
-- Nur Admin/Manager mit aktivem Account (is_staff() und is_active_user()).
-- Chatter und Models sehen die Boards nicht — Strukturfragen und Ideen für
-- Massennachrichten sind Leitungssache.
--   boards:          lesen, anlegen, ändern. KEIN Löschen — ein Board wird
--                    archiviert (Spalte archiviert), nie gelöscht.
--   board_elemente:  lesen, anlegen, ändern, löschen. Eine Notiz wegzunehmen
--                    ist normales Arbeiten am Board.
--
-- LIVE
-- board_elemente kommt in die Realtime-Publikation, damit Änderungen sofort
-- beim anderen erscheinen. Cursor und "wer ist da" laufen ohne Datenbank über
-- Realtime-Presence/Broadcast.
--
-- Wiederholbar. Rückbau:
--   drop table public.board_elemente; drop table public.boards;
-- ============================================================================

create table if not exists public.boards (
  id              uuid primary key default gen_random_uuid(),
  titel           text not null check (char_length(titel) between 1 and 120),
  vorlage         text not null default 'leer',
  erstellt_von    text,
  erstellt_am     timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now(),
  aktualisiert_von text,
  archiviert      boolean not null default false
);

create table if not exists public.board_elemente (
  id               uuid primary key default gen_random_uuid(),
  board_id         uuid not null references public.boards(id) on delete cascade,
  typ              text not null check (typ in ('rahmen', 'notiz', 'person', 'text', 'pfeil')),
  x                double precision not null default 0,
  y                double precision not null default 0,
  w                double precision not null default 0,
  h                double precision not null default 0,
  z                integer not null default 0,
  daten            jsonb not null default '{}'::jsonb,
  erstellt_von     text,
  aktualisiert_von text,
  aktualisiert_am  timestamptz not null default now()
);

create index if not exists board_elemente_board_idx on public.board_elemente (board_id);

alter table public.boards enable row level security;
alter table public.board_elemente enable row level security;

drop policy if exists boards_lesen on public.boards;
drop policy if exists boards_anlegen on public.boards;
drop policy if exists boards_aendern on public.boards;
create policy boards_lesen   on public.boards for select to authenticated using (public.is_staff() and public.is_active_user());
create policy boards_anlegen on public.boards for insert to authenticated with check (public.is_staff() and public.is_active_user());
create policy boards_aendern on public.boards for update to authenticated using (public.is_staff() and public.is_active_user()) with check (public.is_staff() and public.is_active_user());

drop policy if exists board_elemente_staff on public.board_elemente;
create policy board_elemente_staff on public.board_elemente for all to authenticated
  using (public.is_staff() and public.is_active_user())
  with check (public.is_staff() and public.is_active_user());

-- Realtime: nur hinzufügen, wenn noch nicht drin (sonst Fehler beim zweiten Lauf)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_elemente'
  ) then
    alter publication supabase_realtime add table public.board_elemente;
  end if;
end $$;

-- ── Kontrolle ───────────────────────────────────────────────────────────────
-- select tablename, policyname, permissive, cmd from pg_policies
--  where tablename in ('boards', 'board_elemente') order by tablename, cmd;
-- select * from pg_publication_tables where tablename = 'board_elemente';
