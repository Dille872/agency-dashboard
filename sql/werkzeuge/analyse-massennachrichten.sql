-- =============================================================================
-- Analyse: Massennachrichten-Vorschlaege (Beschwerde 29.08.2026)
-- Zweck: MESSEN, bevor am Prompt/Code gedreht wird.
--   Frage 1: Wie oft sind Vorschlaege model-UEBERGREIFEND fast gleich?
--   Frage 2: Unterscheiden sich Frueh / Spaet / Nacht ueberhaupt?
--   Frage 3: Sind die Steckbriefe stark genug, um Models auseinanderzuziehen?
-- Ausfuehren: Supabase SQL-Editor, Abfrage fuer Abfrage (0 zuerst).
-- Nur SELECTs. Einzige Ausnahme: die pg_trgm-Extension in Schritt 1.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0) Welche Anlaesse gibt es, und welcher ist "Massennachricht"?
--    Ergebnis bitte zurueckmelden - danach kann der Rest exakt gefiltert werden.
-- -----------------------------------------------------------------------------
select
  o.key,
  o.label,
  o.active,
  o.sort,
  count(s.id) filter (where s.created_at > now() - interval '14 days') as vorschlaege_14t,
  left(coalesce(o.guardrail, ''), 160)                                 as leitplanke_anfang
from message_occasions o
left join message_suggestions s on s.occasion = o.key
group by o.key, o.label, o.active, o.sort, o.guardrail
order by o.sort;


-- -----------------------------------------------------------------------------
-- 1) VORBEREITUNG: Aehnlichkeitsmessung aktivieren (einmalig)
--    pg_trgm ist nicht dieselbe Formel wie der Jaccard-Filter in der Function,
--    aber nah genug, um "fast gleich" zu zaehlen.
-- -----------------------------------------------------------------------------
create extension if not exists pg_trgm;


-- -----------------------------------------------------------------------------
-- 2) HAUPTFRAGE: model-uebergreifende Zwillinge
--    Zeigt Paare aus ZWEI VERSCHIEDENEN Models, die sich stark aehneln.
--    Genau diese Faelle sieht der Filter der Edge Function heute NICHT,
--    weil die Sperrbasis mit .eq('model_name', model) geladen wird.
--    Zeitraum bewusst 7 Tage - 14 Tage kann bei vielen Zeilen lange laufen.
-- -----------------------------------------------------------------------------
with anlass as (
  select key from message_occasions
  where key ilike '%mass%' or label ilike '%mass%'
), basis as (
  select
    s.id, s.model_name, s.shift, s.chatter, s.created_at, s.text,
    regexp_replace(lower(translate(s.text, 'äöüÄÖÜß', 'aouAOUs')), '[^a-z0-9 ]+', ' ', 'g') as norm
  from message_suggestions s
  where s.created_at > now() - interval '7 days'
    and s.occasion in (select key from anlass)
)
select
  round(similarity(a.norm, b.norm)::numeric, 2) as aehnlichkeit,
  a.model_name as model_a, a.shift as schicht_a, a.text as text_a,
  b.model_name as model_b, b.shift as schicht_b, b.text as text_b
from basis a
join basis b on a.id < b.id and a.model_name <> b.model_name
where similarity(a.norm, b.norm) > 0.55
order by 1 desc
limit 60;


-- -----------------------------------------------------------------------------
-- 3) Dieselbe Frage als QUOTE (die Zahl fuer die Chatter-Diskussion):
--    Wie viel Prozent aller Vorschlaege haben einen Zwilling bei einem
--    ANDEREN Model? Alles ueber ~10 % ist in der Praxis auffaellig.
-- -----------------------------------------------------------------------------
with anlass as (
  select key from message_occasions
  where key ilike '%mass%' or label ilike '%mass%'
), basis as (
  select
    s.id, s.model_name,
    regexp_replace(lower(translate(s.text, 'äöüÄÖÜß', 'aouAOUs')), '[^a-z0-9 ]+', ' ', 'g') as norm
  from message_suggestions s
  where s.created_at > now() - interval '7 days'
    and s.occasion in (select key from anlass)
)
select
  count(*)                                                    as vorschlaege_gesamt,
  count(*) filter (where hat_zwilling)                        as mit_fremdmodel_zwilling,
  round(100.0 * count(*) filter (where hat_zwilling) / nullif(count(*), 0), 1) as prozent
from (
  select a.id, exists (
    select 1 from basis b
    where b.model_name <> a.model_name
      and similarity(a.norm, b.norm) > 0.55
  ) as hat_zwilling
  from basis a
) x;


-- -----------------------------------------------------------------------------
-- 4) Macht die Schicht einen Unterschied? Tageszeit-Woerter je Schicht.
--    Erwartung bei funktionierender Schicht-Steuerung: die Diagonale ist
--    deutlich hoeher als der Rest. Flache Zeilen = Schicht wirkt nicht.
-- -----------------------------------------------------------------------------
with anlass as (
  select key from message_occasions
  where key ilike '%mass%' or label ilike '%mass%'
), basis as (
  select coalesce(s.shift, '(leer)') as schicht, lower(s.text) as t
  from message_suggestions s
  where s.created_at > now() - interval '21 days'
    and s.occasion in (select key from anlass)
)
select
  schicht,
  count(*) as n,
  round(100.0 * count(*) filter (where t ~ 'morgen|aufgewacht|frühstück|kaffee|wach|aufgestanden|dusche') / count(*), 1) as morgen_pct,
  round(100.0 * count(*) filter (where t ~ 'abend|feierabend|couch|serie|wein|essen|kochen')            / count(*), 1) as abend_pct,
  round(100.0 * count(*) filter (where t ~ 'nacht|bett|schlaf|müde|mitternacht|dunkel|liege')           / count(*), 1) as nacht_pct,
  round(100.0 * count(*) filter (where t !~ 'morgen|aufgewacht|frühstück|kaffee|wach|aufgestanden|dusche|abend|feierabend|couch|serie|wein|essen|kochen|nacht|bett|schlaf|müde|mitternacht|dunkel|liege') / count(*), 1) as ohne_tageszeit_pct
from basis
group by schicht
order by n desc;


-- -----------------------------------------------------------------------------
-- 5) Schicht-uebergreifende Zwillinge INNERHALB eines Models.
--    Wenn hier viel kommt, ist der Text zwischen Frueh und Nacht austauschbar.
-- -----------------------------------------------------------------------------
with anlass as (
  select key from message_occasions
  where key ilike '%mass%' or label ilike '%mass%'
), basis as (
  select
    s.id, s.model_name, coalesce(s.shift, '(leer)') as schicht, s.text,
    regexp_replace(lower(translate(s.text, 'äöüÄÖÜß', 'aouAOUs')), '[^a-z0-9 ]+', ' ', 'g') as norm
  from message_suggestions s
  where s.created_at > now() - interval '7 days'
    and s.occasion in (select key from anlass)
)
select
  round(similarity(a.norm, b.norm)::numeric, 2) as aehnlichkeit,
  a.model_name, a.schicht as schicht_a, b.schicht as schicht_b,
  a.text as text_a, b.text as text_b
from basis a
join basis b on a.id < b.id and a.model_name = b.model_name and a.schicht <> b.schicht
where similarity(a.norm, b.norm) > 0.55
order by 1 desc
limit 40;


-- -----------------------------------------------------------------------------
-- 6) Kommt "Vorschicht" (oder ein anderer unbekannter Wert) im Feld shift an?
--    Die Function kennt nur frueh|spaet|nacht - alles andere landet im Prompt
--    als "unbestimmte Tageszeit".
-- -----------------------------------------------------------------------------
select coalesce(shift, '(null)') as shift_wert, count(*) as n,
       min(created_at) as seit, max(created_at) as zuletzt
from message_suggestions
where created_at > now() - interval '30 days'
group by 1
order by n desc;


-- -----------------------------------------------------------------------------
-- 7) Steckbrief-Staerke je Model. Der Steckbrief ist der EINZIGE Hebel, der
--    Models im Prompt auseinanderzieht. Duenne Steckbriefe oben = Verdaechtige.
-- -----------------------------------------------------------------------------
select
  model_name,
  active,
  laenge,
  coalesce(length(description), 0)        as beschreibung_zeichen,
  coalesce(length(extra), 0)              as extra_zeichen,
  coalesce(array_length(persona_tags, 1), 0) as tags,
  coalesce(array_length(examples, 1), 0)     as beispiele,
  coalesce(array_length(nogos, 1), 0)        as nogos
from model_personas
order by beschreibung_zeichen asc, beispiele asc;


-- -----------------------------------------------------------------------------
-- 8) Nutzungsquote je Model/Schicht - wird das ueberhaupt genommen?
--    Niedrige "genommen"-Quote bei hoher Menge = Chatter werfen es weg.
-- -----------------------------------------------------------------------------
with anlass as (
  select key from message_occasions
  where key ilike '%mass%' or label ilike '%mass%'
)
select
  model_name,
  coalesce(shift, '(leer)') as schicht,
  count(*)                                   as generiert,
  count(*) filter (where used)               as genommen,
  round(100.0 * count(*) filter (where used) / nullif(count(*), 0), 1) as quote_pct,
  count(*) filter (where rating = 'up')       as daumen_hoch,
  count(*) filter (where rating = 'down')     as daumen_runter
from message_suggestions
where created_at > now() - interval '21 days'
  and occasion in (select key from anlass)
group by model_name, coalesce(shift, '(leer)')
order by generiert desc;


-- -----------------------------------------------------------------------------
-- 9) BEWEIS-ABFRAGE: Welche Woerter verbietet die Function den Models GERADE?
--    Baut motive() aus generate-messages/index.ts nach: Woerter >= 4 Zeichen,
--    keine Stoppwoerter, die in >= 3 Nachrichten der letzten 21 Tage vorkommen,
--    davon die 15 haeufigsten. Genau diese Liste geht als
--    "ABGENUTZTE MOTIVE - vermeide sie in ALLEN Vorschlaegen" in den Prompt.
--    Kleiner Unterschied: die Function schaut auf die letzten 400 Zeilen je
--    Model, diese Abfrage auf alle 21 Tage. Das Bild ist dasselbe.
--
--    ERWARTUNG, falls die Vermutung stimmt: hier stehen die Signatur-Woerter
--    der Models (tennis, twitch, gym, zocken, latex ...) und die Tageszeit-
--    Woerter (nacht, bett, morgen, kaffee). Beides ist damit gesperrt.
-- -----------------------------------------------------------------------------
with basis as (
  select
    s.id,
    s.model_name,
    regexp_replace(lower(translate(s.text, 'äöüÄÖÜß', 'aouAOUs')), '[^a-z0-9 ]+', ' ', 'g') as norm
  from message_suggestions s
  where s.created_at > now() - interval '21 days'
), stopp as (
  select unnest(array[
    'aber','auch','auf','aus','bei','bin','bist','dann','dass','dein','deine','deinen',
    'dich','die','der','das','dir','doch','ein','eine','einen','einfach','euch','fuer',
    'ganz','gar','gerade','grad','hab','habe','hast','hier','ich','immer','ist','jetzt',
    'kann','kannst','lust','mal','man','mein','meine','mich','mir','mit','nach','nicht',
    'noch','nur','oder','ohne','schon','sehr','sein','sich','sind','soll','ueber','und',
    'viel','vielleicht','vom','von','war','was','wenn','wie','will','wir','wird','wirklich',
    'wieder','wo','zu','zum','zur'
  ]) as w
), woerter as (
  select distinct b.model_name, b.id, w
  from basis b, unnest(string_to_array(b.norm, ' ')) as w
  where length(w) >= 4
    and w !~ '^[0-9]+$'
    and w not in (select w from stopp)
), zaehl as (
  select model_name, w, count(distinct id) as treffer
  from woerter
  group by model_name, w
), rang as (
  select model_name, w, treffer,
         row_number() over (partition by model_name order by treffer desc, w) as rn
  from zaehl
  where treffer >= 3
)
select
  model_name,
  string_agg(w || ' (' || treffer || 'x)', ', ' order by rn) as aktuell_verbotene_motive
from rang
where rn <= 15
group by model_name
order by model_name;
