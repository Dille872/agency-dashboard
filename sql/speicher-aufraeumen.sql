-- ============================================================================
-- v5.8.0 · Speicheranzeige + Aufräumregel für Videos
--
-- Entscheidung Chris (01.10.): Rohvideos 30 Tage nach dem Posten löschen,
-- die geschnittene Fassung bleibt.
--
-- Genau gelöscht wird, für Skripte, die vor mehr als 30 Tagen gepostet wurden:
--   • das Rohvideo (+ Vorschaubild), aber NUR wenn es eine geschnittene
--     Fassung gibt. Ohne Schnitt ist das Rohvideo das fertige Video → bleibt.
--   • alte, nicht mehr verwendete Uploads desselben Skripts (z. B. ein
--     zweites Hochladen hat das erste ersetzt).
-- Nie gelöscht: Skripte, die nicht gepostet oder verworfen sind, die
-- geschnittene Fassung, Dateien außerhalb von reel-videos.
--
-- Gelöscht wird nicht hier in SQL (das ließe die Dateien im Speicher liegen),
-- sondern von der Edge Function videos-aufraeumen über die Storage-API.
-- Diese Funktion liefert ihr nur die Liste.
--
-- Voraussetzung: reel-videos.sql. Wiederholbar. Ändert keine Daten.
-- ============================================================================

-- Welche Dateien dürfen weg? (nur Service-Rolle)
create or replace function public.videos_zum_aufraeumen(p_tage integer default 30)
returns table (name text, bytes bigint)
language sql stable security definer set search_path = public, storage as $$
  with skripte as (
    select s.id,
           case when s.video_link  like 'speicher://reel-videos/%' then substr(s.video_link, 24)  end as roh,
           case when s.schnitt_link like 'speicher://reel-videos/%' then substr(s.schnitt_link, 24) end as schnitt,
           (s.schnitt_link is not null and s.schnitt_link <> '') as hat_schnitt
    from public.reel_skripte s
    where s.reel_url is not null
      and not s.verworfen
      and s.gepostet_am is not null
      and s.gepostet_am < current_date - p_tage
  )
  select o.name, coalesce((o.metadata->>'size')::bigint, 0) as bytes
  from storage.objects o
  join skripte k on split_part(o.name, '/', 1) = 'skript' and split_part(o.name, '/', 2) = k.id::text
  where o.bucket_id = 'reel-videos'
    -- geschnittene Fassung bleibt immer
    and (k.schnitt is null or o.name not in (k.schnitt, k.schnitt || '.jpg'))
    -- aktuelles Rohvideo bleibt, solange es keinen Schnitt gibt
    and (k.hat_schnitt or k.roh is null or o.name not in (k.roh, k.roh || '.jpg'))
$$;
revoke all on function public.videos_zum_aufraeumen(integer) from public, anon, authenticated;
grant execute on function public.videos_zum_aufraeumen(integer) to service_role;

-- Stand für die Anzeige in der Steuerung (nur Leitung bekommt Zahlen)
create or replace function public.speicher_stand()
returns jsonb language plpgsql stable security definer set search_path = public, storage as $$
declare
  r jsonb;
begin
  if not (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_leitung()) then
    return null;
  end if;
  select jsonb_build_object(
    'gesamt_bytes', coalesce(sum((metadata->>'size')::bigint), 0),
    'video_bytes',  coalesce(sum((metadata->>'size')::bigint) filter (where bucket_id = 'reel-videos'), 0),
    'video_anzahl', count(*) filter (where bucket_id = 'reel-videos' and name not like '%.jpg'),
    'aufraeumbar_bytes', (select coalesce(sum(bytes), 0) from public.videos_zum_aufraeumen(30)),
    'aufraeumbar_anzahl', (select count(*) from public.videos_zum_aufraeumen(30) where name not like '%.jpg')
  ) into r
  from storage.objects;
  return r;
end $$;
grant execute on function public.speicher_stand() to authenticated;

-- Prüfen:
-- select public.speicher_stand();                         -- als Admin eingeloggt; im SQL-Editor null
-- select * from public.videos_zum_aufraeumen(30);          -- Vorschau, was gelöscht würde
