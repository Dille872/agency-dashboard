-- ════════════════════════════════════════════════════════════════════════════
-- v5.30.0 · Skript-Bibliothek & Aufträge an den Script Builder
-- ════════════════════════════════════════════════════════════════════════════
-- 1) Bibliothek (of_vorlagen): fertige Skripte als Vorlage speichern und später
--    an ein oder mehrere Models geben (z. B. Startpaket für neue Models).
--    Jede Zuweisung ist eine normale Zeile in of_skripte mit vorlage_id —
--    so sieht man, welches Model eine Vorlage schon hatte.
-- 2) quelle in of_skripte: woher ein Skript kommt
--      storyteller · bibliothek · builder_auftrag · admin
--    builder_auftrag = ihr gebt Noa direkt etwas zum Skripten (z. B. das Model
--    hat selbst etwas online gestellt), ohne Storyteller und ohne Model-Schritt.
--
-- Rechte: Bibliothek schreiben nur Admin/Manager, lesen auch Storyteller.
-- Mehrfach ausführbar. Ändert keine bestehenden Skripte.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.of_vorlagen (
  id              bigint generated always as identity primary key,
  titel           text not null check (length(titel) between 1 and 200),
  art             text not null default 'video' check (art in ('video', 'bilder', 'sonstiges')),
  schritte        jsonb not null default '[]'::jsonb,
  outfit          text,
  laenge          text,
  notiz_builder   text,
  stichworte      text,
  erstellt_von    text,
  erstellt_am     timestamptz not null default now(),
  aktualisiert_am timestamptz not null default now()
);
alter table public.of_vorlagen enable row level security;
drop policy if exists of_vorlagen_staff on public.of_vorlagen;
create policy of_vorlagen_staff on public.of_vorlagen for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
drop policy if exists of_vorlagen_lesen on public.of_vorlagen;
create policy of_vorlagen_lesen on public.of_vorlagen for select to authenticated
  using (public.hat_rolle('storyteller'));

alter table public.of_skripte add column if not exists vorlage_id bigint references public.of_vorlagen(id) on delete set null;
alter table public.of_skripte add column if not exists quelle text;
alter table public.of_skripte drop constraint if exists of_skripte_quelle_check;
alter table public.of_skripte add constraint of_skripte_quelle_check
  check (quelle is null or quelle in ('storyteller', 'bibliothek', 'builder_auftrag', 'admin'));
create index if not exists of_skripte_vorlage_idx on public.of_skripte (vorlage_id);

-- Schutz-Trigger: wie v5.28.0, Storyteller dürfen vorlage_id/quelle nicht setzen
create or replace function public.of_skripte_schuetzen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ich text := public.my_display_name();
  v   public.of_skripte;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_staff() then
      new.erstellt_von := ich;
      if new.status not in ('entwurf', 'freigabe') then new.status := 'entwurf'; end if;
      new.freigegeben_von := null; new.freigegeben_am := null;
      new.hochgeladen_am := null; new.gebaut_von := null; new.gebaut_am := null;
      new.schritte_erledigt := '{}'; new.zurueck_notiz := null; new.model_frage := null; new.of_titel := null;
      new.auftrag_von := null; new.auftrag_notiz := null;
      new.vorlage_id := null; new.quelle := 'storyteller';
    else
      new.erstellt_von := coalesce(new.erstellt_von, ich);
      if new.status = 'beim_model' then new.freigegeben_von := coalesce(new.freigegeben_von, ich); new.freigegeben_am := now(); end if;
    end if;
    new.erstellt_am := now(); new.aktualisiert_am := now();
    return new;
  end if;

  -- UPDATE
  if auth.uid() is null or public.is_staff() then
    v := new;
  elsif old.model_name = ich and old.status = 'beim_model' then
    -- Model: nur abhaken, OF-Titel, Frage, auf „hochgeladen“
    v := old;
    v.schritte_erledigt := new.schritte_erledigt;
    v.of_titel := new.of_titel;
    v.model_frage := new.model_frage;
    if new.status = 'hochgeladen' then v.status := 'hochgeladen'; end if;
  elsif public.hat_rolle('script_builder') and old.status in ('hochgeladen', 'gebaut') then
    -- Script Builder: nur „gebaut“ an/aus
    v := old;
    if new.status in ('hochgeladen', 'gebaut') then v.status := new.status; end if;
  elsif public.hat_rolle('storyteller') and old.erstellt_von = ich and old.status in ('auftrag', 'entwurf', 'freigabe', 'zurueck') then
    -- Storyteller: Inhalt ja, Verwaltungsfelder nein
    v := new;
    v.erstellt_von := old.erstellt_von; v.erstellt_am := old.erstellt_am;
    v.freigegeben_von := old.freigegeben_von; v.freigegeben_am := old.freigegeben_am;
    v.hochgeladen_am := old.hochgeladen_am; v.gebaut_von := old.gebaut_von; v.gebaut_am := old.gebaut_am;
    v.schritte_erledigt := old.schritte_erledigt; v.of_titel := old.of_titel; v.model_frage := old.model_frage;
    v.auftrag_von := old.auftrag_von; v.auftrag_notiz := old.auftrag_notiz;
    v.vorlage_id := old.vorlage_id; v.quelle := old.quelle;
    if v.status not in ('entwurf', 'freigabe') then v.status := old.status; end if;
  else
    raise exception 'Keine Berechtigung für dieses Skript';
  end if;

  v.id := old.id;
  v.erstellt_am := old.erstellt_am;
  if v.status = 'beim_model' and old.status <> 'beim_model' then
    v.freigegeben_von := coalesce(ich, v.freigegeben_von); v.freigegeben_am := now();
  end if;
  if v.status = 'hochgeladen' and old.status <> 'hochgeladen' and old.status <> 'gebaut' then v.hochgeladen_am := now(); end if;
  if v.status = 'gebaut' and old.status <> 'gebaut' then v.gebaut_von := ich; v.gebaut_am := now(); end if;
  if v.status = 'hochgeladen' and old.status = 'gebaut' then v.gebaut_von := null; v.gebaut_am := null; end if;
  v.aktualisiert_am := now();
  return v;
end $$;
