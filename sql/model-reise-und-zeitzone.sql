-- v4.76.0: Reise-Zusatz im Model-Board + Zeitzone der Models
--
-- 1) model_board bekommt drei Felder für Reise-Einträge. Das Model trägt sie im
--    Model-Portal beim Reiseplan ein, die Chatter sehen sie auf „Heute":
--      reise_geht        was während der Reise geht  (Freitext, mit Komma getrennt)
--      reise_geht_nicht  was nicht geht              (Freitext, mit Komma getrennt)
--      reise_fans        Satz, den Chatter Fans sagen können
--
-- 2) models_contact.zeitzone — setzt das Model-Portal automatisch aus dem Gerät
--    des Models (z. B. 'Asia/Nicosia'). Chatter sehen daraus „bei ihr 18:52".
--
-- Nur neue, leere Spalten. Es wird nichts geändert oder gelöscht.
-- Rechte: bestehende Regeln reichen (Model ändert eigene Board-Zeilen und die
-- eigene models_contact-Zeile; lesen dürfen alle aktiven Logins).

alter table public.model_board
  add column if not exists reise_geht       text,
  add column if not exists reise_geht_nicht text,
  add column if not exists reise_fans       text;

alter table public.models_contact
  add column if not exists zeitzone text;

-- Nur echte Zonennamen („Europe/Berlin"), keine beliebigen Texte
alter table public.models_contact drop constraint if exists models_contact_zeitzone_check;
alter table public.models_contact add constraint models_contact_zeitzone_check
  check (zeitzone is null or zeitzone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$');

-- Prüfen:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name in ('model_board', 'models_contact')
--      and column_name in ('reise_geht', 'reise_geht_nicht', 'reise_fans', 'zeitzone');
