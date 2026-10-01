-- ============================================================================
-- v5.5.0 · Messfenster pro Reel (30 Tage, verlängerbar um je 30 Tage)
--
-- Entscheidung Chris (30.09.):
--   • Jedes Reel wird 30 Tage lang beobachtet, danach ist es „abgeschlossen“:
--     der letzte Wert bleibt stehen und zählt weiter, es wird aber nicht mehr
--     gemessen.
--   • Nimmt ein Reel spät nochmal Fahrt auf, kann das Team das Fenster um
--     30 Tage verlängern (Social Media → Wirkung → „+30 Tage“), beliebig oft.
--
-- Die Pipeline liest lyra.reel_messplan und misst nur Reels mit
-- noch_messen = true. Lyra bleibt rein lesend.
--
-- Voraussetzung: reel-messwerte.sql, reel-ohne-skript.sql, social-leitung.sql.
-- Wiederholbar. Löscht und überschreibt keine Daten.
-- ============================================================================

-- Nur Verlängerungen werden gespeichert. Fehlt ein Eintrag, gilt
-- gepostet_am + 30 Tage.
create table if not exists public.reel_messfenster (
  shortcode       text primary key check (shortcode ~ '^[A-Za-z0-9_-]{5,40}$'),
  messen_bis      date not null,
  verlaengert_am  timestamptz not null default now(),
  verlaengert_von text
);

alter table public.reel_messfenster enable row level security;
grant select, insert, update on public.reel_messfenster to authenticated;
drop policy if exists messfenster_lesen   on public.reel_messfenster;
drop policy if exists messfenster_anlegen on public.reel_messfenster;
drop policy if exists messfenster_aendern on public.reel_messfenster;
drop policy if exists aktiv_erforderlich  on public.reel_messfenster;
create policy messfenster_lesen on public.reel_messfenster for select to authenticated
  using (public.darf_social_leiten() or public.darf_social_freigeben());
create policy messfenster_anlegen on public.reel_messfenster for insert to authenticated
  with check (public.darf_social_leiten());
create policy messfenster_aendern on public.reel_messfenster for update to authenticated
  using (public.darf_social_leiten()) with check (public.darf_social_leiten());
-- Kein Löschen: eine Verlängerung bleibt nachvollziehbar.
create policy aktiv_erforderlich on public.reel_messfenster as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Wer verlängert hat, setzt die Datenbank selbst.
create or replace function public.reel_messfenster_vorbereiten()
returns trigger language plpgsql as $$
begin
  new.verlaengert_am  := now();
  new.verlaengert_von := coalesce(nullif(public.my_display_name(), ''), new.verlaengert_von);
  return new;
end $$;
drop trigger if exists reel_messfenster_vorbereiten on public.reel_messfenster;
create trigger reel_messfenster_vorbereiten before insert or update on public.reel_messfenster
  for each row execute function public.reel_messfenster_vorbereiten();

-- ── Für die Pipeline: welche Reels noch gemessen werden ────────────────────
-- Enthält jedes Reel, das wir kennen: aus den Messwerten (auch die eigenen des
-- Models), aus den Skripten und aus „Reels ohne Skript“.
create or replace view lyra.reel_messplan as
with bekannt as (
  select distinct on (shortcode) shortcode, account, model_name, art, gepostet_am
  from public.reel_messwerte
  order by shortcode, gemessen_am desc
),
skript as (
  select substring(reel_url from '(?i)instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)') as shortcode,
         lower(account) as account, model_name, 'skript'::text as art,
         (gepostet_am::timestamp at time zone 'Europe/Berlin') as gepostet_am
  from public.reel_skripte
  where reel_url is not null and not verworfen
),
ohne as (
  select shortcode, lower(account) as account, model_name, 'ohne_skript'::text as art,
         (coalesce(gepostet_am, eingetragen_am::date)::timestamp at time zone 'Europe/Berlin') as gepostet_am
  from public.reel_ohne_skript
),
alle as (
  select * from skript where shortcode is not null
  union all select * from ohne
  union all select * from bekannt
),
eins as (   -- ein Eintrag je Reel; Skript vor „ohne Skript“ vor Messwerten
  select distinct on (shortcode) shortcode, account, model_name, art, gepostet_am
  from alle
  order by shortcode, case art when 'skript' then 1 when 'ohne_skript' then 2 else 3 end, gepostet_am nulls last
)
select e.shortcode, e.account, e.model_name, e.art, e.gepostet_am,
       coalesce(f.messen_bis, ((e.gepostet_am at time zone 'Europe/Berlin')::date + 30)) as messen_bis,
       (f.shortcode is not null) as verlaengert,
       (e.gepostet_am is null
        or current_date <= coalesce(f.messen_bis, ((e.gepostet_am at time zone 'Europe/Berlin')::date + 30))) as noch_messen
from eins e
left join public.reel_messfenster f on f.shortcode = e.shortcode;

alter view lyra.reel_messplan owner to postgres;
grant select on lyra.reel_messplan to lyra_readonly;

-- Prüfen:
-- select * from lyra.reel_messplan order by gepostet_am desc limit 20;
