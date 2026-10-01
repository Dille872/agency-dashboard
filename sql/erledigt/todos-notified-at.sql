-- v4.43.0 — Eine Aufgabe wird höchstens einmal gemeldet.
--
-- Ausgeführt am 29.08.2026.
--
-- Vorher hing der Telegram-Versand allein am Haken: jedes Abhaken schickte eine
-- Nachricht, auch beim zweiten und dritten Mal. Der Merker gehört in die
-- Datenbank und nicht in den Browser — nur so kann auch ein zweiter Tab oder
-- eine zweite Person dieselbe Aufgabe nicht ein weiteres Mal melden.
--
-- Vor dem Deploy des Frontends ausführen. Ohne diese Spalte bleibt das Abhaken
-- funktionsfähig, nur die Meldung schlägt still fehl (PGRST204 in der Konsole).

alter table public.todos
  add column if not exists notified_at timestamptz;

-- Altbestand: was schon erledigt ist, wurde damals auch schon gemeldet.
-- Ohne diese Zeile würde jede alte Aufgabe beim nächsten Anfassen erneut
-- durchs Telegram gehen.
update public.todos
   set notified_at = coalesce(completed_at, now())
 where completed and notified_at is null;

-- Kontrolle: sollte 0 sein.  (29.08.2026: 0)
select count(*) as erledigt_ohne_merker
  from public.todos where completed and notified_at is null;
