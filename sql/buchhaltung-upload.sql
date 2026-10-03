-- ══════════════════════════════════════════════════════════════════════════
-- v5.39.0 · Buchhaltung: Chatter können ihre Rechnung jederzeit hochladen
--
-- Kein „Bescheid geben“ mehr, keine automatischen Nachrichten. Chatter haben
-- im Portal einfach einen Knopf „Rechnung hochladen“ (Monat wählen → Datei).
--
--   • Chatter dürfen für SICH SELBST eine Zeile anlegen (nur Name + Monat;
--     Beträge, Status, „bezahlt“ … setzt die Datenbank leer/offen)
--   • Chatter sehen ihre eigenen Zeilen (ohne „mitgeteilt“-Bedingung)
--
-- Voraussetzung: buchhaltung.sql, buchhaltung-entwurf.sql, buchhaltung-team.sql.
-- Ändert keine bestehenden Zeilen. Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

drop policy if exists abr_lesen on public.chatter_abrechnungen;
drop policy if exists abr_anlegen on public.chatter_abrechnungen;
drop policy if exists abr_aendern on public.chatter_abrechnungen;
create policy abr_lesen on public.chatter_abrechnungen for select to authenticated
  using ((select public.is_staff()) or chatter_name = (select public.my_display_name()));
create policy abr_anlegen on public.chatter_abrechnungen for insert to authenticated
  with check ((select public.is_staff()) or chatter_name = (select public.my_display_name()));
create policy abr_aendern on public.chatter_abrechnungen for update to authenticated
  using ((select public.is_staff()) or chatter_name = (select public.my_display_name()))
  with check ((select public.is_staff()) or chatter_name = (select public.my_display_name()));

-- Schutz-Trigger jetzt auch beim Anlegen
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

-- Kontrolle: true (Trigger läuft jetzt auch beim Anlegen)
select exists (
  select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where c.relname = 'chatter_abrechnungen' and t.tgname = 'a_chatter_abrechnungen_schuetzen'
    and (t.tgtype & 4) = 4   -- INSERT
) as trigger_beim_anlegen;
