-- ============================================================================
-- v5.6.0 · Messplan für das Sammel-Skript (Function messplan-lesen)
--
-- Das Sammel-Skript hat keinen Datenbank-Zugang. Es fragt über die Edge
-- Function messplan-lesen (gleiches Geheimnis wie messwerte-eintragen), welche
-- Reels es noch messen soll. Diese Funktion liefert genau das: alle Reels aus
-- lyra.reel_messplan mit noch_messen = true.
--
-- Nur lesen. Ausführen darf sie nur die Service-Rolle (also die Function),
-- nicht die App.
--
-- Voraussetzung: reel-messfenster.sql. Wiederholbar. Ändert keine Daten.
-- ============================================================================

create or replace function public.messplan_lesen()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'shortcode',   m.shortcode,
           'account',     '@' || ltrim(lower(trim(m.account)), '@'),
           'gepostet_am', m.gepostet_am,
           'messen_bis',  m.messen_bis,
           'noch_messen', m.noch_messen
         ) order by m.gepostet_am desc nulls first), '[]'::jsonb)
  from lyra.reel_messplan m
  where m.noch_messen and m.account is not null and m.shortcode is not null
$$;
revoke all on function public.messplan_lesen() from public, anon, authenticated;
grant execute on function public.messplan_lesen() to service_role;

-- Prüfen (als Admin im SQL-Editor):
-- select jsonb_array_length(public.messplan_lesen());
