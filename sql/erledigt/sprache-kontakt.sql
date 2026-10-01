-- ============================================================================
-- v4.110.0 · Sprache pro Person + Kontaktweg für Teammitglieder
--
-- user_roles.sprache: 'de' | 'en' | null (null = wie das Gerät, Standard Deutsch).
--   Wird beim Anmelden übernommen: Anmeldeseite (nächstes Mal), Social Media
--   Manager, Rahmen für Social-Rollen, Hinweis „Neue Version“.
-- user_roles.kontakt_telegram: optionale Telegram-ID für spätere
--   Benachrichtigungen (z. B. Poster). Wird im Moment von nichts benutzt.
--
-- Schreiben darf user_roles weiterhin nur die Agentur (bestehende Regeln).
-- Jeder liest die eigene Zeile (rls-stufe6). Wiederholbar. Löscht nichts.
-- ============================================================================

alter table public.user_roles add column if not exists sprache text;
alter table public.user_roles add column if not exists kontakt_telegram text;

alter table public.user_roles drop constraint if exists user_roles_sprache_check;
alter table public.user_roles add constraint user_roles_sprache_check
  check (sprache is null or sprache in ('de', 'en'));

alter table public.user_roles drop constraint if exists user_roles_kontakt_telegram_check;
alter table public.user_roles add constraint user_roles_kontakt_telegram_check
  check (kontakt_telegram is null or kontakt_telegram ~ '^-?[0-9]{4,20}$');

-- Prüfen:
-- select display_name, sprache, kontakt_telegram from public.user_roles order by display_name;
