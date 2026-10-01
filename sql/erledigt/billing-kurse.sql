-- ============================================================================
-- v5.22.0 · Billing: Euro-Kurs pro Monat
--
-- Wunsch Chris (01.10.): am 1. jedes Monats den Kurs $ → € eintragen und
-- speichern, damit man den Verdienst jedes Monats in Euro sieht. Jeder Monat
-- behält seinen Kurs; ältere Monate rechnen mit ihrem eigenen.
--
-- Neue Tabelle, ändert nichts Bestehendes. Wiederholbar.
-- ============================================================================

create table if not exists public.billing_kurse (
  monat           text primary key check (monat ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- 'YYYY-MM'
  usd_eur         numeric(10, 6) not null check (usd_eur > 0 and usd_eur < 10),     -- 1 $ = x €
  eingetragen_am  timestamptz not null default now(),
  eingetragen_von text
);
alter table public.billing_kurse enable row level security;

drop policy if exists kurse_lesen    on public.billing_kurse;
drop policy if exists kurse_schreiben on public.billing_kurse;
drop policy if exists aktiv_erforderlich on public.billing_kurse;
create policy kurse_lesen on public.billing_kurse for select to authenticated
  using (public.is_staff());
create policy kurse_schreiben on public.billing_kurse for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy aktiv_erforderlich on public.billing_kurse as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
grant select, insert, update on public.billing_kurse to authenticated;

-- Prüfen:
-- select * from public.billing_kurse order by monat desc;
