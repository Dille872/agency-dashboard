-- ============================================================================
-- v4.72.0 · Gelesen-Stand pro Login statt pro Gerät
--
-- Bis v4.71 merkte sich jede Glocke (AdminBell, Team-Feed, ChatterBell,
-- ModelBell) im localStorage des Browsers, bis wann alles gelesen ist. Folge:
-- am Rechner weggeklickt, am Handy wieder 99+, am iMac wieder 99+.
--
-- Jetzt steht der Zeitpunkt hier, eine Zeile je Login und Glocke.
--
-- ZUGRIFF NUR ÜBER DIE ZWEI FUNKTIONEN
-- RLS ist an, es gibt bewusst KEINE Policy: direkt lesen oder schreiben kann
-- niemand. Die Funktionen laufen als SECURITY DEFINER und arbeiten
-- ausschließlich mit auth.uid() — ein Login sieht und ändert nur seine eigenen
-- Zeilen, eine fremde user_id lässt sich gar nicht übergeben.
--
-- DER ZEITPUNKT KOMMT VOM SERVER
-- gelesen_setzen() nimmt now() der Datenbank, nicht die Uhr des Geräts. Eine
-- falsch gehende Handy-Uhr kann so nichts "in die Zukunft" als gelesen
-- markieren. Ein mitgegebener Zeitpunkt (Übernahme des alten localStorage-
-- Werts beim ersten Start) wird auf höchstens now() gekappt.
--
-- Der Stand läuft nur vorwärts (greatest): ein Gerät mit altem Stand kann den
-- neueren eines anderen Geräts nicht zurückdrehen.
--
-- Wiederholbar. Rückbau: drop function public.gelesen_setzen(text, timestamptz);
--   drop function public.gelesen_laden(); drop table public.gelesen_stand;
-- (Das Frontend fällt dann von selbst auf localStorage zurück.)
-- ============================================================================

create table if not exists public.gelesen_stand (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  schluessel   text        not null check (schluessel ~ '^[a-z][a-z0-9_-]{0,39}$'),
  gesehen_bis  timestamptz not null,
  aktualisiert timestamptz not null default now(),
  primary key (user_id, schluessel)
);

alter table public.gelesen_stand enable row level security;

create or replace function public.gelesen_laden()
returns table (schluessel text, gesehen_bis timestamptz)
language sql stable security definer
set search_path = public
as $$
  select g.schluessel, g.gesehen_bis
    from public.gelesen_stand g
   where g.user_id = auth.uid();
$$;

create or replace function public.gelesen_setzen(p_schluessel text, p_bis timestamptz default null)
returns timestamptz
language plpgsql security definer
set search_path = public
as $$
declare
  ergebnis timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  insert into public.gelesen_stand as g (user_id, schluessel, gesehen_bis)
  values (auth.uid(), p_schluessel, least(coalesce(p_bis, now()), now()))
  on conflict (user_id, schluessel) do update
     set gesehen_bis  = greatest(g.gesehen_bis, excluded.gesehen_bis),
         aktualisiert = now()
  returning g.gesehen_bis into ergebnis;
  return ergebnis;
end;
$$;

revoke all on function public.gelesen_laden() from public, anon;
revoke all on function public.gelesen_setzen(text, timestamptz) from public, anon;
grant execute on function public.gelesen_laden() to authenticated;
grant execute on function public.gelesen_setzen(text, timestamptz) to authenticated;

-- ── Kontrolle ───────────────────────────────────────────────────────────────
-- Im SQL-Editor ist auth.uid() NULL — dort liefert gelesen_laden() nichts, das
-- ist kein Fehler. Nach dem ersten "Alles gelesen" im Dashboard:
--   select u.email, g.schluessel, g.gesehen_bis
--     from public.gelesen_stand g join auth.users u on u.id = g.user_id
--    order by g.aktualisiert desc;
