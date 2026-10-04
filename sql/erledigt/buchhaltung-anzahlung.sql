-- ══════════════════════════════════════════════════════════════════════════
-- v5.40.0 · Buchhaltung: Anzahlungen
--
-- Wenn ihr einem Chatter schon einen Teil überwiesen habt, bevor die Rechnung
-- da ist: [{ "betrag": 300, "am": "2026-10-03", "notiz": "Vorschuss", "von": "Chris" }]
-- In der Buchhaltung steht dann „angezahlt“ und der Rest, der noch offen ist.
--
-- Nur für euch (Staff). Chatter können das Feld nicht ändern (der Schutz-
-- Trigger lässt Chatter ohnehin nur ihre Rechnungsfelder ändern).
-- Ändert keine bestehenden Zeilen. Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.chatter_abrechnungen add column if not exists anzahlungen jsonb not null default '[]'::jsonb;

-- Chatter dürfen beim Anlegen ihrer Zeile keine Anzahlungen mitschicken
create or replace function public.chatter_abrechnungen_anzahlung_schuetzen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff() then
    if tg_op = 'INSERT' then new.anzahlungen := '[]'::jsonb; else new.anzahlungen := old.anzahlungen; end if;
  end if;
  return new;
end $$;
drop trigger if exists b_chatter_abrechnungen_anzahlung on public.chatter_abrechnungen;
create trigger b_chatter_abrechnungen_anzahlung before insert or update on public.chatter_abrechnungen
  for each row execute function public.chatter_abrechnungen_anzahlung_schuetzen();

-- Kontrolle: 1 (Spalte da)
select count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'chatter_abrechnungen' and column_name = 'anzahlungen';
