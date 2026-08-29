-- =====================================================================
-- Indre aus dem Dienstplan nehmen  —  Stand 2026-08-29 (App v4.42.1)
--
-- Ausgangslage: Indre ist ein MODEL, das nie sauber eingepflegt wurde
-- (kein Login in user_roles), steht aber im Dienstplan. Das Offboarding
-- unter Einstellungen -> Team greift nur bei Personen MIT user_roles-
-- Eintrag, deshalb gibt es für sie dort keinen "Status..."-Knopf.
--
-- Regel aus dem Code (src/dienstplanAufraeumen.js): Eine Zelle gehört dem
-- MODEL. Fällt das Model weg, wird die Zelle GELÖSCHT — ohne Model gibt es
-- keine Schicht. Vergangene Wochen bleiben Historie und werden nie angefasst.
--
-- Blockweise ausführen, nicht am Stück. Block 1 und 2 lesen nur.
-- =====================================================================


-- ── Block 1: Wer ist Indre in der Datenbank? ─────────────────────────
-- Erwartung: genau eine Zeile in models_contact, keine in user_roles.

select id, name, active, in_schedule, telegram_id
  from models_contact
 where name ilike '%indre%';

select display_name, status, role, roles
  from user_roles
 where display_name ilike '%indre%';

-- Spaltentyp von schedule.assignments merken (json oder jsonb).
-- Steht hier 'json', in Block 4 beim UPDATE ::jsonb durch ::json ersetzen.
select column_name, data_type
  from information_schema.columns
 where table_name = 'schedule' and column_name = 'assignments';


-- ── Block 2: Wo genau steht sie? ─────────────────────────────────────
-- Die Schlüssel im assignments-JSON haben die Form <model_id>__<rest>.

-- 2a) Zellen ab dieser Woche, pro Woche gezählt
with m as (select id::text as id from models_contact where name ilike 'Indre')
select s.week_start, count(*) as zellen
  from schedule s,
       lateral jsonb_object_keys(s.assignments::jsonb) k
 where s.week_start >= date_trunc('week', current_date)::date
   and split_part(k, '__', 1) in (select id from m)
 group by s.week_start
 order by s.week_start;

-- 2b) Dauerschichten (die tragen sie sonst in JEDE neue Woche wieder ein)
select r.*
  from recurring_shifts r
 where r.model_id::text in (select id::text from models_contact where name ilike 'Indre');

-- 2c) Sicherheitsnetz: Zellen mit einer Model-ID, zu der es GAR KEIN
--     models_contact gibt (verwaiste Einträge, z. B. nach Löschen).
select split_part(k, '__', 1) as verwaiste_model_id, count(*) as zellen
  from schedule s,
       lateral jsonb_object_keys(s.assignments::jsonb) k
 where s.week_start >= date_trunc('week', current_date)::date
   and split_part(k, '__', 1) not in (select id::text from models_contact)
 group by 1
 order by 2 desc;


-- ── Block 3: Der bequeme Weg (empfohlen) ─────────────────────────────
-- Nur den Schalter umlegen — aufräumen macht dann das Dashboard selbst.
--
-- active = false setzt sie auf "stillgelegt". Danach erscheint sie unter
-- Einstellungen -> Team im Kasten "Noch im Dienstplan" mit dem Knopf
-- "Aus Plan nehmen". Der räumt Zellen UND Dauerschichten auf und
-- protokolliert das als schedule.cleanup. Nichts wird gelöscht, was sich
-- nicht mit active = true wieder zurückholen ließe.

-- update models_contact set active = false, in_schedule = false
--  where name ilike 'Indre';

-- Danach im Dashboard: Einstellungen -> Team -> "Noch im Dienstplan"
-- -> "Aus Plan nehmen". Block 5 kontrolliert das Ergebnis.


-- ── Block 4: Der direkte Weg (nur falls der Knopf nicht erscheint) ───
-- Zum Beispiel wenn Block 2c verwaiste IDs zeigt, es also gar keinen
-- models_contact-Eintrag mehr gibt. Reihenfolge einhalten.

-- 4a) Sicherungskopie. RLS an, keine Policy -> nur per SQL-Editor lesbar.
-- create table public.schedule_backup_20260829 as select * from public.schedule;
-- alter table public.schedule_backup_20260829 enable row level security;

-- 4b) Vorschau: welche Schlüssel würden verschwinden?
-- with m as (select id::text as id from models_contact where name ilike 'Indre')
-- select s.week_start, k as schluessel, s.assignments::jsonb -> k as inhalt
--   from schedule s,
--        lateral jsonb_object_keys(s.assignments::jsonb) k
--  where s.week_start >= date_trunc('week', current_date)::date
--    and split_part(k, '__', 1) in (select id from m)
--  order by s.week_start, k;

-- 4c) Erst wenn 4b genau das zeigt, was weg soll:
-- with m as (select id::text as id from models_contact where name ilike 'Indre')
-- update schedule s
--    set assignments = coalesce((
--          select jsonb_object_agg(e.key, e.value)
--            from jsonb_each(s.assignments::jsonb) e
--           where split_part(e.key, '__', 1) not in (select id from m)
--        ), '{}'::jsonb)
--  where s.week_start >= date_trunc('week', current_date)::date
--    and exists (
--          select 1 from jsonb_object_keys(s.assignments::jsonb) k
--           where split_part(k, '__', 1) in (select id from m)
--        );

-- 4d) Dauerschichten löschen — ohne das ist sie nächste Woche zurück.
-- delete from recurring_shifts
--  where model_id::text in (select id::text from models_contact where name ilike 'Indre');


-- ── Block 5: Kontrolle ───────────────────────────────────────────────
-- Beide Abfragen müssen 0 liefern.

with m as (select id::text as id from models_contact where name ilike 'Indre')
select count(*) as zellen_uebrig
  from schedule s,
       lateral jsonb_object_keys(s.assignments::jsonb) k
 where s.week_start >= date_trunc('week', current_date)::date
   and split_part(k, '__', 1) in (select id from m);

select count(*) as dauerschichten_uebrig
  from recurring_shifts
 where model_id::text in (select id::text from models_contact where name ilike 'Indre');

-- Sicherungskopie erst löschen, wenn der Dienstplan im Dashboard stimmt:
-- drop table public.schedule_backup_20260829;
