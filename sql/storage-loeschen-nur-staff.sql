-- ============================================================================
-- v4.102.0 · Löschen im Speicher nur noch für Staff (Admin/Manager)
--
-- Vorher durfte JEDER eingeloggte Nutzer (auch Models und Chatter) alle
-- Dateien in chat-attachments und guideline-images löschen — die Regel
-- prüfte nur den Bucket, nicht die Person. Dort liegen Chat-Bilder,
-- Guideline-Bilder und seit v4.101.0 die Drehzettel-PDFs.
--
-- Geprüft vor der Änderung (27.09.2026):
--   • Das Dashboard löscht NIRGENDS Dateien aus dem Speicher (kein .remove()).
--   • Der Telegram-Bot lädt mit dem Service-Key hoch; der ist von diesen
--     Regeln nicht betroffen.
--   • Hochladen und Ansehen bleiben unverändert für alle Eingeloggten.
--   • Überschreiben war schon vorher nicht möglich (keine UPDATE-Regel).
--
-- Wiederholbar. Löscht keine Dateien.
-- Rückbau: die zwei Policies wieder mit „to authenticated using (bucket_id = …)“
-- anlegen (alte Fassung siehe unten).
-- ============================================================================

drop policy if exists "Authenticated users can delete chat attachments" on storage.objects;
drop policy if exists "Authenticated can delete guideline images"       on storage.objects;
drop policy if exists "Staff kann Chat-Anhaenge loeschen"              on storage.objects;
drop policy if exists "Staff kann Guideline-Bilder loeschen"           on storage.objects;

create policy "Staff kann Chat-Anhaenge loeschen" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-attachments' and public.is_staff() and public.is_active_user());

create policy "Staff kann Guideline-Bilder loeschen" on storage.objects
  for delete to authenticated
  using (bucket_id = 'guideline-images' and public.is_staff() and public.is_active_user());

-- Prüfen: DELETE-Regeln im Speicher (sollte genau die zwei neuen zeigen)
-- select policyname, cmd, qual from pg_policies
-- where schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE';

-- Alte Fassung (nur für den Rückbau):
-- create policy "Authenticated users can delete chat attachments" on storage.objects
--   for delete to authenticated using (bucket_id = 'chat-attachments');
-- create policy "Authenticated can delete guideline images" on storage.objects
--   for delete to authenticated using (bucket_id = 'guideline-images');
