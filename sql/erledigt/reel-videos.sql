-- ============================================================================
-- v5.7.0 · Videos direkt ins Dashboard hochladen (Supabase Storage)
--
-- Entscheidung Chris (01.10.): Models laden ihr Video im Portal hoch statt
-- einen Dropbox-Link einzufügen. Speicher: Supabase Storage (Pro-Plan).
--
-- Privater Bucket reel-videos. Ablage je Skript:
--   skript/<id>/roh-<zeit>.<ext>        Rohvideo vom Model
--   skript/<id>/schnitt-<zeit>.<ext>    geschnittene Fassung vom Cutter
--   … jeweils + „.jpg“                  Vorschaubild (macht das Handy beim Hochladen)
-- In reel_skripte.video_link / schnitt_link steht dann
--   speicher://reel-videos/skript/<id>/…   (statt eines Dropbox-Links)
-- Alte Links bleiben gültig. reel_skripte selbst ändert sich nicht.
--
-- Rechte (Datenbank prüft selbst, über den Pfad → Skript):
--   ansehen/laden: Admin, Pfleger, Social-Leitung, Freigeber, das Model des
--                  Skripts, Poster und Cutter des Ziel-Accounts
--   hochladen:     Model des Skripts nur „roh-…“, Cutter des Accounts nur
--                  „schnitt-…“, Admin/Social-Leitung beides
--   löschen:       nur Admin/Pfleger/Social-Leitung. Überschreiben: niemand.
--
-- WICHTIG: Zusätzlich in Supabase → Storage → Settings die
-- „Upload file size limit“ auf 5 GB stellen (Standard sind 50 MB).
--
-- Voraussetzung: social-leitung.sql, social-schnitt.sql. Wiederholbar.
-- Löscht keine Daten.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reel-videos', 'reel-videos', false, 5368709120,
        array['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/3gpp', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Pfad prüfen: Wer darf diese Datei sehen (p_schreiben = false) oder anlegen?
create or replace function public.reel_video_recht(p_name text, p_schreiben boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  teile text[] := string_to_array(coalesce(p_name, ''), '/');
  datei text;
  s     record;
  leiten boolean;
begin
  if array_length(teile, 1) <> 3 or teile[1] <> 'skript' or teile[2] !~ '^[0-9]{1,18}$' then
    return false;
  end if;
  datei := teile[3];
  if datei !~ '^(roh|schnitt)-[0-9]{10,16}\.[a-z0-9]{2,5}(\.jpg)?$' then
    return false;
  end if;
  select id, model_name, ziel_account, verworfen into s
  from public.reel_skripte where id = teile[2]::bigint;
  if not found then return false; end if;
  if not public.is_active_user() then return false; end if;

  leiten := public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_leitung();

  if not p_schreiben then
    return leiten
        or public.darf_social_freigeben()
        or s.model_name = public.my_display_name()
        or public.poster_hat_account(s.model_name, s.ziel_account)
        or public.cutter_hat_account(s.model_name, s.ziel_account);
  end if;

  if s.verworfen then return leiten; end if;
  if leiten then return true; end if;
  if datei like 'roh-%' then
    return s.model_name = public.my_display_name();
  end if;
  return public.cutter_hat_account(s.model_name, s.ziel_account);
end $$;
grant execute on function public.reel_video_recht(text, boolean) to authenticated;

drop policy if exists reel_videos_lesen    on storage.objects;
drop policy if exists reel_videos_anlegen  on storage.objects;
drop policy if exists reel_videos_loeschen on storage.objects;
create policy reel_videos_lesen on storage.objects for select to authenticated
  using (bucket_id = 'reel-videos' and public.reel_video_recht(name, false));
create policy reel_videos_anlegen on storage.objects for insert to authenticated
  with check (bucket_id = 'reel-videos' and public.reel_video_recht(name, true));
create policy reel_videos_loeschen on storage.objects for delete to authenticated
  using (bucket_id = 'reel-videos'
         and (public.is_staff() or public.darf_kontakte_pflegen() or public.ist_social_leitung())
         and public.is_active_user());
-- Kein UPDATE: hochgeladene Videos werden nie überschrieben.

-- Prüfen:
-- select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'reel-videos';
