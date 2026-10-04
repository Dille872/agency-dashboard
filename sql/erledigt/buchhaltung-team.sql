-- ══════════════════════════════════════════════════════════════════════════
-- v5.38.0 · Buchhaltung: Team & Rechnungen ohne Profil, Summe/IBAN erkennen
--
-- Voraussetzung: sql/buchhaltung.sql und sql/buchhaltung-entwurf.sql sind gelaufen.
--
-- Neu in chatter_abrechnungen:
--   art            'chatter' (wie bisher) · 'team' (z. B. Alina) · 'extern'
--                  (ohne Profil, z. B. ehemalige Chatter wie Joel)
--   waehrung       'EUR' oder 'USD' — für Team/Extern
--   betrag_manuell Betrag für Team/Extern (in waehrung)
--   notiz          freie Notiz
--   rechnung_iban  aus der PDF erkannte IBAN
--   betrag_erkannt rechnung_betrag wurde aus der PDF gelesen (bitte prüfen)
--
-- Eindeutig ist jetzt Name + Zeitraum + Art (damit z. B. ein Chatter zusätzlich
-- einen Team-Eintrag haben kann). Ändert keine bestehenden Zeilen.
-- Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.chatter_abrechnungen add column if not exists art text not null default 'chatter';
alter table public.chatter_abrechnungen add column if not exists waehrung text not null default 'EUR';
alter table public.chatter_abrechnungen add column if not exists betrag_manuell numeric(12, 2);
alter table public.chatter_abrechnungen add column if not exists notiz text;
alter table public.chatter_abrechnungen add column if not exists rechnung_iban text;
alter table public.chatter_abrechnungen add column if not exists betrag_erkannt boolean not null default false;

alter table public.chatter_abrechnungen drop constraint if exists chatter_abrechnungen_art_check;
alter table public.chatter_abrechnungen add constraint chatter_abrechnungen_art_check check (art in ('chatter', 'team', 'extern'));
alter table public.chatter_abrechnungen drop constraint if exists chatter_abrechnungen_waehrung_check;
alter table public.chatter_abrechnungen add constraint chatter_abrechnungen_waehrung_check check (waehrung in ('EUR', 'USD'));

-- Eindeutigkeit: Name + Zeitraum + Art
alter table public.chatter_abrechnungen drop constraint if exists chatter_abrechnungen_chatter_name_von_bis_key;
create unique index if not exists chatter_abrechnungen_eindeutig on public.chatter_abrechnungen (chatter_name, von, bis, art);

-- Schutz-Trigger: Chatter dürfen zusätzlich die erkannte IBAN/Summe mitschicken
create or replace function public.chatter_abrechnungen_schuetzen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ich text := public.my_display_name();
  v   public.chatter_abrechnungen;
begin
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

-- Kontrolle: 6 (alle neuen Spalten da) · true (Eindeutigkeit neu)
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'chatter_abrechnungen'
     and column_name in ('art', 'waehrung', 'betrag_manuell', 'notiz', 'rechnung_iban', 'betrag_erkannt')) as neue_spalten,
  (to_regclass('public.chatter_abrechnungen_eindeutig') is not null) as eindeutig;
