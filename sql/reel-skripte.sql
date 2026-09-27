-- ============================================================================
-- v4.101.0 · Reel-Skripte: Drehzettel → Video → gepostet
--
-- Eine Zeile je freigegebenem Skript. Ablauf:
--   1. Agentur lädt den Drehzettel (PDF) hoch → Nummer S-0001, S-0002 …
--   2. Model dreht und hinterlegt den LINK zum Video (Dropbox o. Ä.) —
--      keine Videodatei in Supabase.
--   3. Wer postet, lädt das Video über den Link, postet und trägt Reel-Link,
--      Account und Datum ein.
--   4. Lyra liest lyra.reel_skripte und misst jedes Reel einzeln.
--
-- Der Status wird NICHT gespeichert, sondern ergibt sich aus den Feldern:
--   reel_url gesetzt → 'gepostet', video_link gesetzt → 'gedreht',
--   sonst 'freigegeben'; verworfen = true → 'verworfen'.
--
-- WER DARF WAS
--   Lesen:    Staff, Kontakt-Pfleger, das Model die EIGENEN Skripte.
--   Anlegen:  Staff, Kontakt-Pfleger.
--   Ändern:   Staff, Kontakt-Pfleger; das Model die eigenen — aber ein Trigger
--             lässt beim Model NUR video_link / video_am / video_von durch.
--   Löschen:  nur Staff (im Dashboard wird stattdessen „verworfen“ gesetzt).
--   Dazu die restrictive Policy aktiv_erforderlich.
--
-- Wiederholbar. Löscht und überschreibt keine Daten.
-- Rückbau: drop view lyra.reel_skripte; drop table public.reel_skripte;
--          drop sequence public.reel_skript_nr_seq;
-- ============================================================================

create sequence if not exists public.reel_skript_nr_seq;

create table if not exists public.reel_skripte (
  id              bigint generated always as identity primary key,
  nr              text not null unique default ('S-' || lpad(nextval('public.reel_skript_nr_seq')::text, 4, '0')),
  model_name      text not null,
  titel           text not null,
  drehzettel_url  text,
  video_link      text,
  video_am        timestamptz,
  video_von       text,
  reel_url        text,
  account         text,
  gepostet_am     date,
  gepostet_von    text,
  notiz           text,
  verworfen       boolean not null default false,
  erstellt_am     timestamptz not null default now(),
  erstellt_von    text,
  aktualisiert_am timestamptz not null default now()
);

create index if not exists reel_skripte_model_idx on public.reel_skripte (model_name, erstellt_am desc);

alter table public.reel_skripte enable row level security;

drop policy if exists reel_skripte_lesen    on public.reel_skripte;
drop policy if exists reel_skripte_anlegen  on public.reel_skripte;
drop policy if exists reel_skripte_aendern  on public.reel_skripte;
drop policy if exists reel_skripte_loeschen on public.reel_skripte;
drop policy if exists aktiv_erforderlich    on public.reel_skripte;

create policy reel_skripte_lesen on public.reel_skripte for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy reel_skripte_anlegen on public.reel_skripte for insert to authenticated
  with check (public.is_staff() or public.darf_kontakte_pflegen());

create policy reel_skripte_aendern on public.reel_skripte for update to authenticated
  using      (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name())
  with check (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy reel_skripte_loeschen on public.reel_skripte for delete to authenticated
  using (public.is_staff());

create policy aktiv_erforderlich on public.reel_skripte as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Model darf nur den Video-Link setzen; alles andere bleibt, wie es war.
create or replace function public.reel_skripte_schuetzen()
returns trigger language plpgsql as $$
begin
  new.aktualisiert_am := now();
  if public.is_staff() or public.darf_kontakte_pflegen() then
    return new;
  end if;
  new.id := old.id; new.nr := old.nr; new.model_name := old.model_name;
  new.titel := old.titel; new.drehzettel_url := old.drehzettel_url;
  new.reel_url := old.reel_url; new.account := old.account;
  new.gepostet_am := old.gepostet_am; new.gepostet_von := old.gepostet_von;
  new.notiz := old.notiz; new.verworfen := old.verworfen;
  new.erstellt_am := old.erstellt_am; new.erstellt_von := old.erstellt_von;
  return new;
end $$;

drop trigger if exists reel_skripte_schutz on public.reel_skripte;
create trigger reel_skripte_schutz
  before update on public.reel_skripte
  for each row execute function public.reel_skripte_schuetzen();

-- ── Ansicht für Lyra ────────────────────────────────────────────────────────
-- Ohne Video-Link (privat) und ohne Drehzettel-Datei. account = @handle.
create or replace view lyra.reel_skripte as
select nr, model_name, titel,
       case when verworfen then 'verworfen'
            when reel_url is not null then 'gepostet'
            when video_link is not null then 'gedreht'
            else 'freigegeben' end as status,
       erstellt_am as freigegeben_am,
       video_am    as gedreht_am,
       gepostet_am, account, reel_url
from public.reel_skripte;

alter view lyra.reel_skripte owner to postgres;
grant select on lyra.reel_skripte to lyra_readonly;

-- ── Prüfen ──────────────────────────────────────────────────────────────────
-- select policyname, cmd from pg_policies where tablename = 'reel_skripte';   → 5
-- set role lyra_readonly; select count(*) from lyra.reel_skripte; reset role; → kein Fehler
