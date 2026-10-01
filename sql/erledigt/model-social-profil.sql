-- ============================================================================
-- v4.100.0 · Social-Media-Fragebogen (für die Reels-Pipeline / Lyra)
--
-- ZWEI Tabellen, bewusst getrennt vom Board (dort liegen Preise):
--
-- 1) public.model_social_profil — die Antworten des Models
--    Eine Zeile je Model UND Frage (schluessel). Jede Antwort hat ihren
--    eigenen Änderungszeitpunkt. Schlüssel siehe src/socialProfil.js.
--    antwort ist jsonb: Text ('…'), Liste (['…', …]) oder Zahl (1–5).
--    Fotos: Liste von Speicher-Links (Bucket model-media), nie Bilddaten.
--
-- 2) public.model_social_service — eine Zeile je Model
--    fragebogen_status  null | 'offen' (angefordert) | 'laeuft' | 'fertig'
--    service_aktiv, posting_ab: NUR die Agentur.
--    Die Accounts selbst stehen NICHT hier: Es gelten die Instagram-Links,
--    die das Model im Board einträgt (model_board, category social_media).
--    Der Social-Tab (public.social_accounts) ist für eigene Mitarbeiter-
--    Accounts und wird hier NICHT benutzt.
--    Ein Trigger hält diese Felder fest, wenn ein Model seine Zeile
--    speichert (RLS kann keine einzelnen Spalten sperren).
--
-- WER DARF WAS (wie beim Steckbrief)
--   Lesen:    Staff, Kontakt-Pfleger, das Model die EIGENEN Zeilen.
--   Anlegen/Ändern: Staff, Kontakt-Pfleger, das Model die EIGENEN Zeilen.
--   Löschen:  nur Staff.
--   Dazu die restrictive Policy aktiv_erforderlich.
--
-- 3) Lyra (Rolle lyra_readonly) bekommt ZWEI schmale Ansichten im Schema lyra:
--    lyra.model_social_profil  Antworten + Agentur-Felder als zusätzliche
--                              Schlüssel: service_aktiv, posting_ab und
--                              service_accounts (= Instagram-Links aus dem
--                              Board, als @handle)
--    lyra.model_grenzen        model_board, nur nogos + einschraenkungen
--    Eigentümer postgres, OHNE security_invoker — sonst greift RLS und Lyra
--    sieht leere Ergebnisse.
--
-- Wiederholbar. Löscht und überschreibt keine Daten.
-- Rückbau: drop view lyra.model_social_profil, lyra.model_grenzen;
--          drop table public.model_social_profil, public.model_social_service;
-- ============================================================================

-- ── 1) Antworten ────────────────────────────────────────────────────────────
create table if not exists public.model_social_profil (
  model_name    text not null,
  schluessel    text not null,
  antwort       jsonb,
  geaendert_am  timestamptz not null default now(),
  geaendert_von text,
  primary key (model_name, schluessel)
);

alter table public.model_social_profil enable row level security;

drop policy if exists social_profil_lesen    on public.model_social_profil;
drop policy if exists social_profil_anlegen  on public.model_social_profil;
drop policy if exists social_profil_aendern  on public.model_social_profil;
drop policy if exists social_profil_loeschen on public.model_social_profil;
drop policy if exists aktiv_erforderlich     on public.model_social_profil;

create policy social_profil_lesen on public.model_social_profil for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy social_profil_anlegen on public.model_social_profil for insert to authenticated
  with check (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy social_profil_aendern on public.model_social_profil for update to authenticated
  using      (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name())
  with check (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy social_profil_loeschen on public.model_social_profil for delete to authenticated
  using (public.is_staff());

create policy aktiv_erforderlich on public.model_social_profil as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- ── 2) Status + Agentur-Felder ──────────────────────────────────────────────
create table if not exists public.model_social_service (
  model_name        text primary key,
  fragebogen_status text check (fragebogen_status in ('offen', 'laeuft', 'fertig')),
  angefordert_am    timestamptz,
  angefordert_von   text,
  fertig_am         timestamptz,
  service_aktiv     boolean not null default false,
  posting_ab        date,
  aktualisiert_am   timestamptz not null default now(),
  aktualisiert_von  text
);

alter table public.model_social_service enable row level security;

drop policy if exists social_service_lesen    on public.model_social_service;
drop policy if exists social_service_anlegen  on public.model_social_service;
drop policy if exists social_service_aendern  on public.model_social_service;
drop policy if exists social_service_loeschen on public.model_social_service;
drop policy if exists aktiv_erforderlich      on public.model_social_service;

create policy social_service_lesen on public.model_social_service for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy social_service_anlegen on public.model_social_service for insert to authenticated
  with check (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy social_service_aendern on public.model_social_service for update to authenticated
  using      (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name())
  with check (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy social_service_loeschen on public.model_social_service for delete to authenticated
  using (public.is_staff());

create policy aktiv_erforderlich on public.model_social_service as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Agentur-Felder schützen: speichert jemand ohne Staff-/Pfleger-Recht
-- (also das Model selbst), bleiben service_aktiv, posting_ab und
-- die Anforderungs-Angaben, wie sie sind. Beim Anlegen durch das Model
-- gelten die Standardwerte.
create or replace function public.social_service_agenturfelder_schuetzen()
returns trigger language plpgsql as $$
begin
  if public.is_staff() or public.darf_kontakte_pflegen() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.service_aktiv   := false;
    new.posting_ab      := null;
    new.angefordert_am  := null;
    new.angefordert_von := null;
  else
    new.service_aktiv    := old.service_aktiv;
    new.posting_ab       := old.posting_ab;
    new.angefordert_am   := old.angefordert_am;
    new.angefordert_von  := old.angefordert_von;
  end if;
  return new;
end $$;

drop trigger if exists social_service_agenturfelder on public.model_social_service;
create trigger social_service_agenturfelder
  before insert or update on public.model_social_service
  for each row execute function public.social_service_agenturfelder_schuetzen();

-- ── 3) Ansichten für Lyra ───────────────────────────────────────────────────
-- Eine Zeile je Model und Schlüssel. antwort = jsonb wie gespeichert,
-- antwort_text = lesbar (Listen mit Komma). Die Agentur-Felder erscheinen als
-- eigene Schlüssel: service_aktiv ('ja'/'nein'), posting_ab (Datum) —
-- geaendert_am ist dort der letzte Speicherzeitpunkt — und service_accounts
-- (Instagram-Links aus dem Board als @handle, ohne Datum). Nur für Models mit
-- Zeile in model_social_service. Die vollen Links hat Lyra ohnehin über
-- lyra.model_social_media.
create or replace view lyra.model_social_profil as
select p.model_name,
       p.schluessel,
       p.antwort,
       case jsonb_typeof(p.antwort)
         when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(p.antwort) x)
         when 'string' then p.antwort #>> '{}'
         else p.antwort::text
       end as antwort_text,
       p.geaendert_am
from public.model_social_profil p
where p.antwort is not null
union all
select s.model_name, 'service_aktiv',
       to_jsonb(case when s.service_aktiv then 'ja' else 'nein' end),
       case when s.service_aktiv then 'ja' else 'nein' end,
       s.aktualisiert_am
from public.model_social_service s
union all
select b.model_name, 'service_accounts',
       jsonb_agg(distinct b.handle),
       string_agg(distinct b.handle, ', '),
       null::timestamptz
from (
  select model_name,
         coalesce('@' || substring(content from '(?i)instagram\.com/([^/?#]+)'), trim(content)) as handle
  from public.model_board
  where category = 'social_media'
    and lower(trim(title)) = 'instagram'
    and nullif(trim(content), '') is not null
) b
where exists (select 1 from public.model_social_service s where s.model_name = b.model_name)
group by b.model_name
union all
select s.model_name, 'posting_ab',
       to_jsonb(s.posting_ab::text),
       s.posting_ab::text,
       s.aktualisiert_am
from public.model_social_service s
where s.posting_ab is not null;

-- No-Gos und Einschränkungen aus dem Board (keine Preise, nichts anderes)
create or replace view lyra.model_grenzen as
select model_name, category, title, content
from public.model_board
where category in ('nogos', 'einschraenkungen');

alter view lyra.model_social_profil owner to postgres;
alter view lyra.model_grenzen owner to postgres;
grant select on lyra.model_social_profil to lyra_readonly;
grant select on lyra.model_grenzen to lyra_readonly;

-- ── Prüfen ──────────────────────────────────────────────────────────────────
-- select policyname, cmd from pg_policies where tablename in ('model_social_profil','model_social_service');
--   → je 5 Policies
-- set role lyra_readonly; select count(*) from lyra.model_social_profil; select count(*) from lyra.model_grenzen; reset role;
--   → darf keinen Fehler werfen (0 ist ok, solange noch niemand ausgefüllt hat;
--     model_grenzen sollte > 0 liefern)
