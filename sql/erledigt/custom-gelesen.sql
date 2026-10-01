-- ============================================================================
-- v5.21.1 · Custom Content: „gelesen“ unabhängig vom Status
--
-- Wunsch Chris (01.10.): Im Custom Content standen immer „3 neu“, obwohl
-- nichts zu tun war. Jetzt kann der Admin eine Anfrage (oder alle) als
-- gelesen markieren. Der Status (neu/angefragt/…) bleibt, wie er ist —
-- nur Zähler und „NEU“-Marke verschwinden.
--
-- Nur zwei neue Spalten. Wiederholbar. Ändert keine vorhandenen Daten.
-- ============================================================================

alter table public.content_requests add column if not exists admin_gelesen_am  timestamptz;
alter table public.content_requests add column if not exists admin_gelesen_von text;

-- Prüfen:
-- select id, model_name, status, admin_gelesen_am, admin_gelesen_von from public.content_requests where status = 'neu' order by created_at desc;
