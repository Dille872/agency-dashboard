-- ============================================================================
-- v5.1.2 · Social-Rollen in user_roles erlauben (Fehler bei Alinas Registrierung)
--
-- Beim „Create account“ kam „Rolle konnte nicht gesetzt werden“. Die Function
-- self-signup schreibt role = 'social_media'. Hat user_roles eine alte
-- Check-Regel, die nur admin/manager/…/chatter/model kennt, wird das
-- abgelehnt. (Bei Noah fiel es nicht auf: dort blieb role = 'chatter', die
-- Social-Rollen stehen nur im Array roles.)
--
-- Diese Datei ergänzt in solchen Regeln die Werte social_media, cutter,
-- social_leitung. Alle bisherigen Werte bleiben. Gibt es keine solche Regel,
-- passiert nichts. Wiederholbar. Ändert keine Daten.
--
-- Danach kann die Person einfach nochmal auf „Create account“ tippen — die
-- Freischaltung ist noch offen (sie wird erst bei Erfolg verbraucht).
-- ============================================================================

do $$
declare
  r      record;
  neu    text;
  zusatz text := '''social_media''::text, ''cutter''::text, ''social_leitung''::text';
begin
  for r in
    select c.conrelid::regclass as tabelle, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.conrelid in ('public.user_roles'::regclass, 'public.signup_invites'::regclass)
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '\mchatter\M'
  loop
    if r.def ~ '\msocial_leitung\M' and r.def ~ '\msocial_media\M' and r.def ~ '\mcutter\M' then
      raise notice '% · % kennt die Social-Rollen schon', r.tabelle, r.conname;
      continue;
    end if;
    -- Form A: ARRAY['admin'::text, …, 'chatter'::text, …]
    if r.def like '%''chatter''::text%' then
      neu := replace(r.def, '''chatter''::text', '''chatter''::text, ' || zusatz);
    -- Form B: '{admin,…,chatter,…}'::text[]
    elsif r.def ~ '[{,]chatter[,}]' then
      neu := regexp_replace(r.def, '([{,])chatter([,}])', '\1chatter,social_media,cutter,social_leitung\2');
    else
      raise notice '% · % nicht automatisch anpassbar, bitte Chris/Claude zeigen: %', r.tabelle, r.conname, r.def;
      continue;
    end if;
    execute format('alter table %s drop constraint %I', r.tabelle, r.conname);
    execute format('alter table %s add constraint %I %s', r.tabelle, r.conname, neu);
    raise notice '% · % erweitert: %', r.tabelle, r.conname, neu;
  end loop;
end $$;

-- Kontrolle: welche Check-Regeln gibt es jetzt? (Ergebnis unten im SQL-Editor)
select c.conrelid::regclass as tabelle, c.conname as regel, pg_get_constraintdef(c.oid) as inhalt
from pg_constraint c
where c.conrelid in ('public.user_roles'::regclass, 'public.signup_invites'::regclass)
  and c.contype = 'c';
