-- ============================================================================
-- v5.53.0 · Sicherheit: private Dateien und Schichtübergaben enger fassen
--
-- Anlass: Code-Review vom 15.10.2026 (Punkte 3 und 4).
--
-- Was bisher galt (sql/erledigt/medien-privat.sql, rls-stufe7-…sql):
--   • content-requests, chat-attachments: JEDES aktive Konto durfte JEDE Datei
--     lesen — und auch auflisten. Model A konnte also die Anhänge von Model B
--     durchblättern.
--   • model-media: jeder Chatter sah die Dateien ALLER Models.
--   • offene_uebergaben(): lieferte jedem aktiven Konto (auch Models, Social,
--     Cutter) alle Übergaben der letzten 16 Stunden.
--
-- Was danach gilt:
--   • Team (Admin/Manager mit Code, Dienstplan, Creator-Manager): alles wie bisher.
--   • model-media: Model nur eigener Ordner; Chatter nur die Models, bei denen
--     sie im Dienstplan stehen (meine_model_namen(), gleiche Quelle wie die
--     übrigen Regeln); Social-Leitung wie bisher.
--   • content-requests: wer die Anfrage sehen darf, darf ihre Fotos sehen
--     (die Regeln von content_requests entscheiden), plus der Hochlader selbst.
--   • chat-attachments: wer die Nachricht / Anfrage / das Reel-Skript sehen
--     darf, die auf die Datei zeigt, darf die Datei sehen.
--   • offene_uebergaben(): nur Team und Chatter, und Chatter nur Übergaben,
--     die sie betreffen können (Empfänger, unbestimmt, oder eines ihrer Models).
--     Die genaue Auswahl macht weiterhin das Portal.
--   • uebergabe_bestaetigen(): nur Team und Chatter.
--
-- Ändert und löscht KEINE Daten und KEINE Dateien. Nur Regeln und Funktionen.
-- Wiederholbar. Rückbau ganz unten.
--
-- REIHENFOLGE:
--   TEIL A (nur lesen) ausführen und Ergebnis anschauen → TEIL B ausführen
--   → mit einem Chatter- und einem Model-Konto testen (siehe TEIL C).
-- ============================================================================


-- ═══════════════════ TEIL A — Vorab prüfen (ändert nichts) ══════════════════

-- A1) Gibt es die Spalten, auf die sich die neuen Regeln stützen?
--     Erwartet: 2 Zeilen (messages.image_urls, reel_skripte.drehzettel_url).
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and (table_name, column_name) in (('messages', 'image_urls'), ('reel_skripte', 'drehzettel_url'));

-- A2) Dateien in chat-attachments, auf die KEINE Nachricht, Anfrage oder kein
--     Reel-Skript zeigt. Die sieht nach Teil B nur noch das Team.
--     Viele Treffer in einem Ordner = Hinweis, dass dort noch eine Quelle fehlt
--     → dann Teil B NICHT ausführen und Bescheid geben.
select (storage.foldername(o.name))[1] as ordner, count(*) as ohne_bezug
  from storage.objects o
 where o.bucket_id = 'chat-attachments'
   and not exists (select 1 from public.messages m
                    where m.image_urls is not null and strpos(m.image_urls::text, storage.filename(o.name)) > 0)
   and not exists (select 1 from public.content_requests cr
                    where strpos(cr::text, storage.filename(o.name)) > 0)
   and not exists (select 1 from public.reel_skripte r
                    where r.drehzettel_url is not null and strpos(r.drehzettel_url, storage.filename(o.name)) > 0)
 group by 1 order by 2 desc;

-- A3) Dateien in content-requests ohne passende Anfrage (sieht danach nur noch
--     das Team und der Hochlader).
select (storage.foldername(o.name))[1] as ordner, count(*) as ohne_bezug
  from storage.objects o
 where o.bucket_id = 'content-requests'
   and not exists (select 1 from public.content_requests cr
                    where strpos(cr::text, storage.filename(o.name)) > 0)
 group by 1 order by 2 desc;

-- A4) Ordner in model-media, die zu keinem Model-Namen passen (sieht danach
--     kein Chatter mehr — nur Team, Social-Leitung und wer genau so heißt).
select (storage.foldername(o.name))[1] as ordner, count(*) as dateien
  from storage.objects o
 where o.bucket_id = 'model-media'
   and lower(btrim((storage.foldername(o.name))[1])) not in (
         select lower(btrim(name)) from public.models_contact where name is not null)
 group by 1 order by 2 desc;


-- ═══════════════════════ TEIL B — Regeln umstellen ══════════════════════════
begin;

-- B1) Hilfsfunktion: Zeigt eine Zeile, die ICH sehen darf, auf diese Datei?
--     SECURITY INVOKER (Standard) → die Regeln von messages, content_requests
--     und reel_skripte gelten mit. Verglichen wird nur der Dateiname
--     (Zeitstempel + Zufall), damit kodierte Ordnernamen („Anna%20Maria“)
--     keine Rolle spielen.
create or replace function public.datei_referenziert(p_bucket text, p_name text)
returns boolean
language sql stable
set search_path = public
as $$
  select case p_bucket
    when 'content-requests' then
      exists (select 1 from public.content_requests cr
               where strpos(cr::text, storage.filename(p_name)) > 0)
    when 'chat-attachments' then
         exists (select 1 from public.messages m
                  where m.image_urls is not null and strpos(m.image_urls::text, storage.filename(p_name)) > 0)
      or exists (select 1 from public.content_requests cr
                  where strpos(cr::text, storage.filename(p_name)) > 0)
      or exists (select 1 from public.reel_skripte r
                  where r.drehzettel_url is not null and strpos(r.drehzettel_url, storage.filename(p_name)) > 0)
    else false
  end
$$;
revoke all on function public.datei_referenziert(text, text) from public, anon;
grant execute on function public.datei_referenziert(text, text) to authenticated;

-- B2) model-media: Chatter nur noch für ihre eingeteilten Models
drop policy if exists medien_lesen_model_media on storage.objects;
create policy medien_lesen_model_media on storage.objects for select to authenticated
  using (
    bucket_id = 'model-media' and public.is_active_user() and (
      public.is_staff()
      or public.darf_kontakte_pflegen()
      or public.hat_rolle('creator_manager')
      or public.darf_social_leiten()
      or lower(btrim((storage.foldername(name))[1])) = lower(btrim(coalesce(public.my_display_name(), '')))
      or ( public.hat_rolle('chatter')
           and lower(btrim((storage.foldername(name))[1])) = any (
                 select lower(btrim(x)) from unnest(public.meine_model_namen()) as x) )
    )
  );

-- B3) content-requests: Hochlader + wer die Anfrage sehen darf
drop policy if exists medien_lesen_content_requests on storage.objects;
create policy medien_lesen_content_requests on storage.objects for select to authenticated
  using (
    bucket_id = 'content-requests' and public.is_active_user() and (
      public.is_staff()
      or public.darf_kontakte_pflegen()
      or lower(btrim((storage.foldername(name))[1])) = lower(btrim(coalesce(public.my_display_name(), '')))
      or public.datei_referenziert(bucket_id, name)
    )
  );

-- B4) chat-attachments: wer die verweisende Nachricht/Anfrage/das Skript sehen darf
drop policy if exists medien_lesen_chat_attachments on storage.objects;
create policy medien_lesen_chat_attachments on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments' and public.is_active_user() and (
      public.is_staff()
      or public.darf_kontakte_pflegen()
      or public.datei_referenziert(bucket_id, name)
    )
  );

-- B5) Übergaben: nur Team + Chatter, Chatter nur was sie betreffen kann
create or replace function public.offene_uebergaben()
returns setof public.shift_logs
language sql stable security definer
set search_path = public
as $$
  select l.* from public.shift_logs l
  where public.is_active_user()
    and public.zwei_faktor_ok()
    and l.handover_text is not null
    and l.handover_at >= now() - interval '16 hours'
    and (
      public.is_staff()
      or public.darf_kontakte_pflegen()
      or ( public.hat_rolle('chatter') and (
             l.handover_for is null
             or exists (select 1 from unnest(l.handover_for) n
                         where lower(btrim(n)) = lower(btrim(coalesce(public.my_display_name(), ''))))
             or exists (select 1 from unnest(coalesce(l.handover_models, '{}')) hm
                          join public.models_contact mc on mc.id::text = hm::text
                         where mc.name = any (public.meine_model_namen()))
             or lower(btrim(l.display_name)) = lower(btrim(coalesce(public.my_display_name(), '')))
         ) )
    )
  order by l.handover_at desc
  limit 100
$$;
revoke all on function public.offene_uebergaben() from public, anon;
grant execute on function public.offene_uebergaben() to authenticated;

create or replace function public.uebergabe_bestaetigen(p_id text)
returns text[]
language plpgsql security definer
set search_path = public
as $$
declare ich text := public.my_display_name(); ergebnis text[];
begin
  if not public.is_active_user() or not public.zwei_faktor_ok() or coalesce(ich, '') = ''
     or not (public.is_staff() or public.darf_kontakte_pflegen() or public.hat_rolle('chatter')) then
    raise exception 'nicht berechtigt';
  end if;
  update public.shift_logs
     set handover_ack = array_append(coalesce(handover_ack, '{}'), ich)
   where id::text = p_id
     and handover_text is not null
     and handover_at >= now() - interval '48 hours'
     and not (ich = any(coalesce(handover_ack, '{}')))
  returning handover_ack into ergebnis;
  return ergebnis;
end $$;
revoke all on function public.uebergabe_bestaetigen(text) from public, anon;
grant execute on function public.uebergabe_bestaetigen(text) to authenticated;

commit;

-- Kontrolle: drei Lese-Regeln vorhanden
select policyname from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like 'medien_lesen_%'
 order by 1;


-- ═══════════════════════ TEIL C — Test (von Hand) ═══════════════════════════
-- Chatter-Konto:  Chatter-Portal → Board eines eingeteilten Models: Bilder/Videos da?
--                 Custom-Anfrage mit Foto anlegen → Foto sichtbar?
--                 Übergabe-Fenster beim Einchecken kommt wie gewohnt?
-- Model-Konto:    eigene Anfragen mit Fotos sichtbar? Bilder im Chat mit dem Team?
--                 Drehzettel-PDF im Social-Bereich öffnet sich?
-- Admin:          Kommunikation → Chat-Bilder und Anfragen wie bisher.
-- Fehlt irgendwo ein Bild → Rückbau unten ausführen und Bescheid geben.


-- ═══════════════════════ RÜCKBAU (Stand v5.33 / v4.56) ══════════════════════
-- begin;
-- drop policy if exists medien_lesen_model_media on storage.objects;
-- create policy medien_lesen_model_media on storage.objects for select to authenticated
--   using (bucket_id = 'model-media' and public.is_active_user() and (
--     public.is_staff() or (storage.foldername(name))[1] = public.my_display_name()
--     or public.hat_rolle('chatter') or public.hat_rolle('creator_manager') or public.darf_social_leiten()));
-- drop policy if exists medien_lesen_content_requests on storage.objects;
-- create policy medien_lesen_content_requests on storage.objects for select to authenticated
--   using (bucket_id = 'content-requests' and public.is_active_user());
-- drop policy if exists medien_lesen_chat_attachments on storage.objects;
-- create policy medien_lesen_chat_attachments on storage.objects for select to authenticated
--   using (bucket_id = 'chat-attachments' and public.is_active_user());
-- create or replace function public.offene_uebergaben() returns setof public.shift_logs
--   language sql stable security definer set search_path = public as $f$
--   select l.* from public.shift_logs l where public.is_active_user() and l.handover_text is not null
--     and l.handover_at >= now() - interval '16 hours' order by l.handover_at desc limit 100 $f$;
-- create or replace function public.uebergabe_bestaetigen(p_id text) returns text[]
--   language plpgsql security definer set search_path = public as $f$
--   declare ich text := public.my_display_name(); ergebnis text[];
--   begin
--     if not public.is_active_user() or coalesce(ich, '') = '' then raise exception 'nicht berechtigt'; end if;
--     update public.shift_logs set handover_ack = array_append(coalesce(handover_ack, '{}'), ich)
--      where id::text = p_id and handover_text is not null and handover_at >= now() - interval '48 hours'
--        and not (ich = any(coalesce(handover_ack, '{}'))) returning handover_ack into ergebnis;
--     return ergebnis;
--   end $f$;
-- commit;
