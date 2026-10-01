-- ============================================================================
-- v5.9.0 · Hochladen auch im Posting-Plan (Reel-Video, Story-Frames) und
--          beim Material
--
-- Entscheidung Chris (01.10.): Story-Fotos/-Videos und Material direkt
-- hochladen statt Links. Gleicher Bucket wie die Skript-Videos (reel-videos).
--
-- Ablage (Model und Account als Hex, damit Umlaute/Leerzeichen kein Problem sind):
--   plan/<hex(model)>/<hex(account)>/<zeit>-<zufall>.<ext>     Plan-Eintrag
--   material/<hex(model)>/<zeit>-<zufall>.<ext>                Material
--   … Videos zusätzlich „.jpg“ daneben = Vorschaubild
--
-- Rechte (wie im Plan selbst):
--   plan/      ansehen: Leitung, Freigeber, Poster des Accounts, das Model
--              hochladen: Leitung, Poster des Accounts, Model mit „plant mit“
--   material/  ansehen + hochladen: Leitung, Poster des Models, das Model selbst
--              (Freigeber nur ansehen)
--
-- Aufräumen (ergänzt videos_zum_aufraeumen, Regel wie bei den Rohvideos):
--   • Datei hängt an Plan-Einträgen, die alle vor > 30 Tagen gepostet wurden → weg
--   • Datei hängt an nichts mehr (Eintrag/Material gelöscht oder verworfen)
--     und ist älter als 30 Tage → weg
--   • Material, das noch nicht eingeplant ist, bleibt.
--
-- Voraussetzung: reel-videos.sql, speicher-aufraeumen.sql, posting-plan.sql,
-- plan-model.sql. Wiederholbar. Löscht keine Daten.
-- ============================================================================

-- Fotos zusätzlich erlauben (iPhone-HEIC wandelt das Dashboard vorher in JPG um)
update storage.buckets
   set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/3gpp',
                                  'image/jpeg', 'image/png', 'image/webp']
 where id = 'reel-videos';

create or replace function public.hex_text(p text)
returns text language sql immutable as $$
  select case when p ~ '^([0-9a-f]{2})+$' then convert_from(decode(p, 'hex'), 'UTF8') end
$$;

create or replace function public.social_datei_recht(p_name text, p_schreiben boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  t text[] := string_to_array(coalesce(p_name, ''), '/');
  datei_re constant text := '^[0-9]{10,16}-[a-z0-9]{4,8}\.[a-z0-9]{2,5}(\.jpg)?$';
  modell text;
  konto  text;
  leiten boolean;
begin
  if not public.is_active_user() then return false; end if;
  leiten := public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_leitung();

  if t[1] = 'plan' and array_length(t, 1) = 4 and t[4] ~ datei_re then
    modell := public.hex_text(t[2]); konto := public.hex_text(t[3]);
    if modell is null or konto is null then return false; end if;
    if not p_schreiben then
      return leiten or public.darf_social_freigeben()
          or public.poster_hat_account(modell, konto)
          or modell = public.my_display_name();
    end if;
    return leiten or public.poster_hat_account(modell, konto)
        or public.model_plant_account(modell, konto);
  end if;

  if t[1] = 'material' and array_length(t, 1) = 3 and t[3] ~ datei_re then
    modell := public.hex_text(t[2]);
    if modell is null then return false; end if;
    if not p_schreiben then
      return leiten or public.darf_social_freigeben()
          or public.poster_hat_model(modell)
          or modell = public.my_display_name();
    end if;
    return leiten or public.poster_hat_model(modell) or modell = public.my_display_name();
  end if;

  return false;
end $$;
grant execute on function public.social_datei_recht(text, boolean) to authenticated;

drop policy if exists social_dateien_lesen   on storage.objects;
drop policy if exists social_dateien_anlegen on storage.objects;
create policy social_dateien_lesen on storage.objects for select to authenticated
  using (bucket_id = 'reel-videos' and public.social_datei_recht(name, false));
create policy social_dateien_anlegen on storage.objects for insert to authenticated
  with check (bucket_id = 'reel-videos' and public.social_datei_recht(name, true));
-- Löschen: weiter nur Leitung (Policy reel_videos_loeschen gilt für den ganzen Bucket).

-- ── Aufräumen erweitern ────────────────────────────────────────────────────
create or replace function public.videos_zum_aufraeumen(p_tage integer default 30)
returns table (name text, bytes bigint)
language sql stable security definer set search_path = public, storage as $$
  -- 1) Skript-Videos (wie v5.8.0)
  with skripte as (
    select s.id,
           case when s.video_link  like 'speicher://reel-videos/%' then substr(s.video_link, 24)  end as roh,
           case when s.schnitt_link like 'speicher://reel-videos/%' then substr(s.schnitt_link, 24) end as schnitt,
           (s.schnitt_link is not null and s.schnitt_link <> '') as hat_schnitt
    from public.reel_skripte s
    where s.reel_url is not null and not s.verworfen
      and s.gepostet_am is not null and s.gepostet_am < current_date - p_tage
  ),
  skript_dateien as (
    select o.name, coalesce((o.metadata->>'size')::bigint, 0) as bytes
    from storage.objects o
    join skripte k on split_part(o.name, '/', 1) = 'skript' and split_part(o.name, '/', 2) = k.id::text
    where o.bucket_id = 'reel-videos'
      and (k.schnitt is null or o.name not in (k.schnitt, k.schnitt || '.jpg'))
      and (k.hat_schnitt or k.roh is null or o.name not in (k.roh, k.roh || '.jpg'))
  ),
  -- 2) Plan- und Material-Dateien (v5.9.0)
  pm as (
    select o.name, coalesce((o.metadata->>'size')::bigint, 0) as bytes, o.created_at,
           'speicher://reel-videos/' ||
             case when o.name ~ '\.[a-z0-9]{2,5}\.jpg$' then regexp_replace(o.name, '\.jpg$', '') else o.name end as link
    from storage.objects o
    where o.bucket_id = 'reel-videos' and split_part(o.name, '/', 1) in ('plan', 'material')
  ),
  bezug as (
    select pm.*,
      (select count(*) from public.social_plan p
        where p.video_link = pm.link
           or exists (select 1 from jsonb_array_elements(coalesce(p.frames, '[]'::jsonb)) f where f->>'link' = pm.link)) as plan_n,
      (select count(*) from public.social_plan p
        where (p.video_link = pm.link
           or exists (select 1 from jsonb_array_elements(coalesce(p.frames, '[]'::jsonb)) f where f->>'link' = pm.link))
          and not (p.status = 'gepostet' and p.gepostet_am < now() - make_interval(days => p_tage))) as plan_offen,
      (select count(*) from public.social_material m where m.link = pm.link and not m.verworfen) as material_n
    from pm
  )
  select name, bytes from skript_dateien
  union all
  select name, bytes from bezug
  where (plan_n > 0 and plan_offen = 0)                                                    -- alles längst gepostet
     or (plan_n = 0 and material_n = 0 and created_at < now() - make_interval(days => p_tage))  -- hängt an nichts mehr
$$;
revoke all on function public.videos_zum_aufraeumen(integer) from public, anon, authenticated;
grant execute on function public.videos_zum_aufraeumen(integer) to service_role;

-- Prüfen:
-- select * from public.videos_zum_aufraeumen(30);
