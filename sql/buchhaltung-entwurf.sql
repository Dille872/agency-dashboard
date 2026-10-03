-- ══════════════════════════════════════════════════════════════════════════
-- v5.37.1 · Buchhaltung: Zahlen stehen automatisch drin, Extras, „Bescheid geben“
--
-- Voraussetzung: sql/buchhaltung.sql ist gelaufen.
--
-- Neu:
--   extras         Zusatzbeträge in € (z. B. Skripte, Bonus, Abzug als minus)
--                  [{ "text": "Skripte September", "betrag": 120 }]
--   mitgeteilt_am  erst ab diesem Zeitpunkt sieht der Chatter seine Abrechnung.
--                  Vorher ist es euer Entwurf (anpassen, Extras eintragen).
--
-- Chatter sehen nur noch mitgeteilte Abrechnungen. Ändert keine bestehenden
-- Zeilen. Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.chatter_abrechnungen add column if not exists extras jsonb not null default '[]'::jsonb;
alter table public.chatter_abrechnungen add column if not exists mitgeteilt_am timestamptz;
alter table public.chatter_abrechnungen add column if not exists mitgeteilt_von text;

-- Chatter: nur mitgeteilte Abrechnungen sehen und dort die Rechnung hochladen
drop policy if exists abr_lesen on public.chatter_abrechnungen;
drop policy if exists abr_aendern on public.chatter_abrechnungen;
create policy abr_lesen on public.chatter_abrechnungen for select to authenticated
  using ((select public.is_staff())
         or (chatter_name = (select public.my_display_name()) and mitgeteilt_am is not null));
create policy abr_aendern on public.chatter_abrechnungen for update to authenticated
  using ((select public.is_staff())
         or (chatter_name = (select public.my_display_name()) and mitgeteilt_am is not null))
  with check ((select public.is_staff())
         or (chatter_name = (select public.my_display_name()) and mitgeteilt_am is not null));

-- Kontrolle: 2 (beide neuen Spalten da)
select count(*) from information_schema.columns
where table_schema = 'public' and table_name = 'chatter_abrechnungen' and column_name in ('extras', 'mitgeteilt_am');
