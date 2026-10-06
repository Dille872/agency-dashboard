-- ══════════════════════════════════════════════════════════════════════════
-- v5.46.0 · Buchhaltung: Adressbuch + Rechnungsnummer
--
-- 1) chatter_abrechnungen: rechnung_nr (Rechnungsnummer → Betreff bei Wise)
--    und rechnung_inhaber (Name/Firma aus der Rechnung, nur Vorschlag).
-- 2) zahlungsempfaenger (= Adressbuch): wer hat die Angaben bestätigt, wann.
-- 3) Schutz-Trigger: Chatter dürfen beim Hochladen auch diese zwei Felder
--    ihrer EIGENEN Rechnung setzen (sonst wie bisher nur Datei/Betrag/IBAN).
--    Gleicher Inhalt wie sql/erledigt/buchhaltung-upload.sql + die zwei Felder.
--
-- Ändert keine bestehenden Daten. Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.chatter_abrechnungen add column if not exists rechnung_nr text;
alter table public.chatter_abrechnungen add column if not exists rechnung_inhaber text;

create table if not exists public.zahlungsempfaenger (
  name text primary key, kontoinhaber text,
  typ text not null default 'PRIVATE' check (typ in ('PRIVATE', 'INSTITUTION')),
  iban text, geaendert_von text, geaendert_am timestamptz not null default now()
);
alter table public.zahlungsempfaenger add column if not exists bestaetigt_von text;
alter table public.zahlungsempfaenger add column if not exists bestaetigt_am timestamptz;

create or replace function public.chatter_abrechnungen_schuetzen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ich text := public.my_display_name();
  v   public.chatter_abrechnungen;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or public.is_staff() then return new; end if;
    -- Chatter legt für sich selbst nur den „Platz“ für seine Rechnung an
    if new.chatter_name is distinct from ich then raise exception 'Nur für dich selbst'; end if;
    v := new;
    v.art := 'chatter'; v.status := 'offen'; v.extras := '[]'::jsonb;
    v.umsatz_chat_usd := null; v.umsatz_gesamt_usd := null; v.basis_usd := null; v.prozent := null;
    v.nur_chat := null; v.auszahlung_usd := null; v.kurs := null; v.betrag_eur := null;
    v.betrag_manuell := null; v.waehrung := 'EUR'; v.notiz := null;
    v.rechnung_url := null; v.rechnung_name := null; v.rechnung_betrag := null; v.rechnung_am := null; v.rechnung_von := null;
    v.rechnung_iban := null; v.betrag_erkannt := false;
    v.rechnung_nr := null; v.rechnung_inhaber := null;
    v.klaerung_notiz := null; v.klaerung_am := null; v.erinnert_am := null;
    v.bezahlt_am := null; v.bezahlt_betrag := null; v.bezahlt_von := null; v.bezahlt_eingetragen_am := null;
    v.mitgeteilt_am := null; v.mitgeteilt_von := null;
    v.freigegeben_am := now(); v.freigegeben_von := ich;
    return v;
  end if;

  if auth.uid() is null or public.is_staff() then
    v := new;
  elsif old.chatter_name = ich and old.status <> 'bezahlt' then
    -- Chatter: nur die eigene Rechnung (Datei, Name, Betrag, erkannte IBAN)
    v := old;
    v.rechnung_url := new.rechnung_url;
    v.rechnung_name := new.rechnung_name;
    v.rechnung_betrag := new.rechnung_betrag;
    v.rechnung_iban := new.rechnung_iban;
    v.betrag_erkannt := new.betrag_erkannt;
    v.rechnung_nr := new.rechnung_nr;          -- v5.46.0
    v.rechnung_inhaber := new.rechnung_inhaber;
  else
    raise exception 'Keine Berechtigung für diese Abrechnung';
  end if;

  v.id := old.id;
  v.freigegeben_am := old.freigegeben_am;

  if v.rechnung_url is distinct from old.rechnung_url and v.rechnung_url is not null then
    v.rechnung_am := now();
    v.rechnung_von := ich;
    if v.status in ('offen', 'klaerung') then v.status := 'rechnung'; end if;
  end if;

  if v.status = 'bezahlt' and old.status <> 'bezahlt' then
    v.bezahlt_am := coalesce(v.bezahlt_am, (now() at time zone 'Europe/Berlin')::date);
    v.bezahlt_von := ich;
    v.bezahlt_eingetragen_am := now();
  elsif v.status <> 'bezahlt' and old.status = 'bezahlt' then
    v.bezahlt_am := null; v.bezahlt_betrag := null; v.bezahlt_von := null; v.bezahlt_eingetragen_am := null;
  end if;

  if v.status = 'klaerung' and (old.status <> 'klaerung' or v.klaerung_notiz is distinct from old.klaerung_notiz) then
    v.klaerung_am := now();
  end if;
  return v;
end $$;
drop trigger if exists a_chatter_abrechnungen_schuetzen on public.chatter_abrechnungen;
create trigger a_chatter_abrechnungen_schuetzen before insert or update on public.chatter_abrechnungen
  for each row execute function public.chatter_abrechnungen_schuetzen();


-- Kontrolle: true · true · true
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chatter_abrechnungen' and column_name = 'rechnung_nr') as rechnung_nr,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'zahlungsempfaenger' and column_name = 'bestaetigt_am') as adressbuch,
  (select prosrc ilike '%rechnung_nr%' from pg_proc where proname = 'chatter_abrechnungen_schuetzen') as trigger_neu;
