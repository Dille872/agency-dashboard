-- v4.63.0 · Zeitzone bewusst bestätigt/gewählt (Portal „Meine Zeitzone")
-- Nur eine Spalte hinzufügen, nichts ändern.
alter table public.online_status add column if not exists zeitzone_bestaetigt boolean not null default false;
