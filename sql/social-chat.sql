-- ============================================================================
-- v5.0.0 · Chat für Social-Rollen (Poster, Cutter, Freigeber)
--
-- Nachrichten laufen über die bestehende Tabelle messages:
--   contact_type = 'social', model_name = Anzeigename der Person.
-- Lesen/Schreiben regeln die bestehenden Policies (rls-stufe5): jeder sieht nur
-- den eigenen Verlauf (model_name = eigener Name), das Team sieht alles.
--
-- Diese Datei sorgt nur dafür, dass 'social' als contact_type erlaubt ist,
-- falls die Datenbank eine Check-Regel auf contact_type hat. Die vorhandenen
-- Werte bleiben erhalten, es kommt nur 'social' dazu. Gibt es keine Regel,
-- passiert nichts. Wiederholbar. Löscht und ändert keine Nachrichten.
-- ============================================================================

do $$
declare
  r      record;
  werte  text[];
begin
  for r in
    select c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.conrelid = 'public.messages'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%contact_type%'
  loop
    if r.def ~* '\msocial\M' then
      raise notice 'Regel % erlaubt social schon: %', r.conname, r.def;
      continue;
    end if;
    -- alle Werte aus den Literalen holen: 'model' … oder '{model,chatter}'
    select array_agg(distinct trim(w)) into werte
    from regexp_matches(r.def, '''([^'']*)''', 'g') as m,
         unnest(string_to_array(translate(m[1], '{}"', ''), ',')) as w
    where trim(w) ~ '^[A-Za-z_]+$';
    werte := array_append(coalesce(werte, '{}'), 'social');
    execute format('alter table public.messages drop constraint %I', r.conname);
    execute format('alter table public.messages add constraint %I check (contact_type is null or contact_type = any (%L::text[]))', r.conname, werte);
    raise notice 'Regel % erneuert, erlaubt jetzt: %', r.conname, werte;
  end loop;
end $$;

-- Prüfen:
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.messages'::regclass and contype = 'c';
