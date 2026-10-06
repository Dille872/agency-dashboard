-- ══════════════════════════════════════════════════════════════════════════
-- v5.45.0 · Buchhaltung: Export für Wise-Sammelüberweisungen
--
-- Merkt sich pro Person, was Wise braucht und im Dashboard sonst fehlt:
-- den Namen wie auf dem Bankkonto, Privat/Firma und die zuletzt benutzte IBAN.
-- Beim nächsten Export ist alles vorausgefüllt. Nur Admin/Manager.
--
-- Ändert keine bestehenden Daten. Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

create table if not exists public.zahlungsempfaenger (
  name          text primary key,                 -- Name im Dashboard (Chatter, Gruppe, Team)
  kontoinhaber  text,                             -- wie auf dem Bankkonto
  typ           text not null default 'PRIVATE' check (typ in ('PRIVATE', 'INSTITUTION')),
  iban          text,
  geaendert_von text,
  geaendert_am  timestamptz not null default now()
);

alter table public.zahlungsempfaenger enable row level security;
drop policy if exists empfaenger_staff on public.zahlungsempfaenger;
drop policy if exists aktiv_erforderlich on public.zahlungsempfaenger;
create policy empfaenger_staff on public.zahlungsempfaenger for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy aktiv_erforderlich on public.zahlungsempfaenger as restrictive for all to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'zwei_faktor_ok') then
    execute 'drop policy if exists zwei_faktor_pflicht on public.zahlungsempfaenger';
    execute 'create policy zwei_faktor_pflicht on public.zahlungsempfaenger as restrictive for all to authenticated
               using ((select public.zwei_faktor_ok())) with check ((select public.zwei_faktor_ok()))';
  end if;
end $$;
grant select, insert, update, delete on public.zahlungsempfaenger to authenticated;

-- Kontrolle: true
select to_regclass('public.zahlungsempfaenger') is not null as tabelle;
