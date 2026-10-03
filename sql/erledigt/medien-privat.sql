-- ════════════════════════════════════════════════════════════════════════════
-- v5.33.0 · Dateien privat: model-media, content-requests, chat-attachments,
--           guideline-images
-- ════════════════════════════════════════════════════════════════════════════
-- Bisher „öffentlich per Link“: Wer einen Link hatte, sah die Datei ohne Login,
-- für immer (siehe claude/sicherheit-audit-2026-09-19.md, Stufe 3).
-- Danach: Nur Eingeloggte mit aktivem Account bekommen einen signierten Link,
-- der nach einer Stunde abläuft (Telegram-Versand: 1 Tag). Das Dashboard macht
-- das ab v5.33.0 automatisch (src/medien.js). Gespeicherte Links bleiben, wie sie sind.
--
-- WICHTIG – Reihenfolge:
--   1. Erst v5.33.0 pushen und warten, bis Vercel fertig ist.
--   2. Dann Schritt A (nur lesen) ausführen und mir das Ergebnis zeigen.
--   3. Dann Schritt B ausführen.
-- Wird B vor dem Push ausgeführt, sind Bilder/Anhänge im alten Stand kurz kaputt.
--
-- Wer darf lesen (nur mit aktivem Account):
--   model-media       Admin/Manager, Creator-Manager, Chatter, Social-Leitung und
--                     das Model selbst (erster Ordner = ihr Name)
--   content-requests  alle aktiven Nutzer (Chatter laden hoch, Models sehen es)
--   chat-attachments  alle aktiven Nutzer (Chat, Drehzettel-PDFs)
--   guideline-images  alle aktiven Nutzer (Guidelines für Chatter)
-- Hochladen und Löschen bleiben, wie sie sind.
-- ════════════════════════════════════════════════════════════════════════════


-- ── Schritt A · Vorschau (ändert nichts) ───────────────────────────────────
select b.id as bucket, b.public as oeffentlich from storage.buckets b
 where b.id in ('model-media', 'content-requests', 'chat-attachments', 'guideline-images');

select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and coalesce(qual, '') || coalesce(with_check, '') ~ '(model-media|content-requests|chat-attachments|guideline-images)'
 order by cmd, policyname;


-- ── Schritt B · Umstellen ──────────────────────────────────────────────────
-- (Ab hier markieren und ausführen, nachdem v5.33.0 live ist.)

-- B1: alte Lese-Regeln für diese Buckets entfernen (nur reine SELECT-Regeln;
--     Regeln für ALL werden nur gemeldet, nicht angefasst)
do $$
declare r record;
begin
  for r in
    select policyname, cmd from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and coalesce(qual, '') || coalesce(with_check, '') ~ '(model-media|content-requests|chat-attachments|guideline-images)'
       and cmd in ('SELECT', 'ALL')
       and policyname not like 'medien_lesen_%'
  loop
    if r.cmd = 'SELECT' then
      execute format('drop policy %I on storage.objects', r.policyname);
      raise notice 'Lese-Regel entfernt: %', r.policyname;
    else
      raise notice 'Bitte prüfen (ALL-Regel, nicht angefasst): %', r.policyname;
    end if;
  end loop;
end $$;

-- B2: neue Lese-Regeln (nur angemeldet + aktiv)
drop policy if exists medien_lesen_model_media on storage.objects;
create policy medien_lesen_model_media on storage.objects for select to authenticated
  using (
    bucket_id = 'model-media' and public.is_active_user() and (
      public.is_staff()
      or (storage.foldername(name))[1] = public.my_display_name()
      or public.hat_rolle('chatter')
      or public.hat_rolle('creator_manager')
      or public.darf_social_leiten()
    )
  );

drop policy if exists medien_lesen_content_requests on storage.objects;
create policy medien_lesen_content_requests on storage.objects for select to authenticated
  using (bucket_id = 'content-requests' and public.is_active_user());

drop policy if exists medien_lesen_chat_attachments on storage.objects;
create policy medien_lesen_chat_attachments on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and public.is_active_user());

drop policy if exists medien_lesen_guideline_images on storage.objects;
create policy medien_lesen_guideline_images on storage.objects for select to authenticated
  using (bucket_id = 'guideline-images' and public.is_active_user());

-- B3: Buckets privat schalten
update storage.buckets set public = false
 where id in ('model-media', 'content-requests', 'chat-attachments', 'guideline-images');

-- Kontrolle: alle vier jetzt public = false
select id, public from storage.buckets
 where id in ('model-media', 'content-requests', 'chat-attachments', 'guideline-images');


-- ── Notfall: zurück auf öffentlich (nur falls etwas Wichtiges nicht mehr lädt) ──
-- update storage.buckets set public = true
--  where id in ('model-media', 'content-requests', 'chat-attachments', 'guideline-images');
