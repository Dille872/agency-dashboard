-- ════════════════════════════════════════════════════════════════════════════
-- v5.27.0 · Storyteller & Script Builder
-- ════════════════════════════════════════════════════════════════════════════
-- Zwei neue Zusatzrollen (zu Chatter & Co. kombinierbar):
--   ✍️ storyteller     schreibt Skripte (Schritt für Schritt) für ein Model
--   🧩 script_builder  baut daraus die Skripte in CreatorHero
--
-- Ablauf eines Skripts (Spalte status):
--   entwurf → freigabe (Storyteller schickt ab) → beim_model (Admin schaltet frei)
--   → hochgeladen (Model: „Gedreht & auf OF hochgeladen“) → gebaut (Script Builder)
--   Nebenwege: zurueck (Admin schickt mit Notiz zurück), verworfen
--
-- Dazu bekommt der Script Builder auch jedes Video, das ein Model selbst
-- unter „Videos“ einträgt (model_videos). Was davon erledigt ist, steht in
-- ch_video_erledigt. Alle Videos, die es heute schon gibt, gelten als erledigt
-- (sonst stünde gleich die ganze Historie in seiner Liste).
--
-- Wer darf was (Regeln unten + Schutz-Trigger):
--   Admin/Manager (is_staff)  alles
--   Storyteller               eigene Skripte anlegen/ändern, solange Entwurf/Freigabe/zurück
--   Model                     eigene freigeschaltete Skripte lesen, Schritte abhaken,
--                             OF-Titel/Frage eintragen, auf „hochgeladen“ setzen
--   Script Builder            hochgeladene Skripte lesen und auf „gebaut“ setzen,
--                             Model-Videos lesen und als erledigt markieren
--
-- Mehrfach ausführbar. Löscht und überschreibt keine bestehenden Daten.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Rollen im Check-Constraint erlauben (user_roles + signup_invites)
do $$
declare
  r   record;
  neu text;
begin
  for r in
    select c.conrelid::regclass as tabelle, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.conrelid in ('public.user_roles'::regclass, 'public.signup_invites'::regclass)
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '\mchatter\M'
  loop
    if r.def ~ '\mstoryteller\M' and r.def ~ '\mscript_builder\M' then
      raise notice '% · % kennt die neuen Rollen schon', r.tabelle, r.conname;
      continue;
    end if;
    if r.def like '%''chatter''::text%' then
      neu := replace(r.def, '''chatter''::text', '''chatter''::text, ''storyteller''::text, ''script_builder''::text');
    elsif r.def ~ '[{,]chatter[,}]' then
      neu := regexp_replace(r.def, '([{,])chatter([,}])', '\1chatter,storyteller,script_builder\2');
    else
      raise notice '% · % nicht automatisch anpassbar, bitte Chris/Claude zeigen: %', r.tabelle, r.conname, r.def;
      continue;
    end if;
    execute format('alter table %s drop constraint %I', r.tabelle, r.conname);
    execute format('alter table %s add constraint %I %s', r.tabelle, r.conname, neu);
    raise notice '% · % angepasst', r.tabelle, r.conname;
  end loop;
end $$;

-- 2) Hat der eingeloggte Nutzer eine (aktive) Rolle?
create or replace function public.hat_rolle(r text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and (r = any(coalesce(roles, '{}')) or role = r)
      and coalesce(status, 'active') = 'active'
  )
$$;
grant execute on function public.hat_rolle(text) to authenticated;

-- 3) Skripte
create table if not exists public.of_skripte (
  id                bigint generated always as identity primary key,
  model_name        text not null,
  titel             text not null check (length(titel) between 1 and 200),
  art               text not null default 'video' check (art in ('video', 'bilder', 'sonstiges')),
  schritte          jsonb not null default '[]'::jsonb,   -- [{ "text": "…", "tipp": "…" }]
  schritte_erledigt int[] not null default '{}',          -- vom Model abgehakt (Positionen ab 0)
  outfit            text,
  laenge            text,
  notiz_builder     text,
  faellig           date,
  status            text not null default 'entwurf'
                    check (status in ('entwurf', 'freigabe', 'zurueck', 'beim_model', 'hochgeladen', 'gebaut', 'verworfen')),
  zurueck_notiz     text,
  model_frage       text,
  of_titel          text,
  erstellt_von      text,
  erstellt_am       timestamptz not null default now(),
  aktualisiert_am   timestamptz not null default now(),
  freigegeben_von   text,
  freigegeben_am    timestamptz,
  hochgeladen_am    timestamptz,
  gebaut_von        text,
  gebaut_am         timestamptz
);
create index if not exists of_skripte_status_idx on public.of_skripte (status);
create index if not exists of_skripte_model_idx on public.of_skripte (model_name);
alter table public.of_skripte enable row level security;

drop policy if exists of_skripte_staff on public.of_skripte;
create policy of_skripte_staff on public.of_skripte for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists of_skripte_st_lesen on public.of_skripte;
create policy of_skripte_st_lesen on public.of_skripte for select to authenticated
  using (public.hat_rolle('storyteller') and erstellt_von = public.my_display_name());
drop policy if exists of_skripte_st_anlegen on public.of_skripte;
create policy of_skripte_st_anlegen on public.of_skripte for insert to authenticated
  with check (public.hat_rolle('storyteller') and erstellt_von = public.my_display_name() and status in ('entwurf', 'freigabe'));
drop policy if exists of_skripte_st_aendern on public.of_skripte;
create policy of_skripte_st_aendern on public.of_skripte for update to authenticated
  using (public.hat_rolle('storyteller') and erstellt_von = public.my_display_name() and status in ('entwurf', 'freigabe', 'zurueck'))
  with check (erstellt_von = public.my_display_name() and status in ('entwurf', 'freigabe', 'zurueck'));
drop policy if exists of_skripte_st_loeschen on public.of_skripte;
create policy of_skripte_st_loeschen on public.of_skripte for delete to authenticated
  using (public.hat_rolle('storyteller') and erstellt_von = public.my_display_name() and status in ('entwurf', 'zurueck'));

drop policy if exists of_skripte_model_lesen on public.of_skripte;
create policy of_skripte_model_lesen on public.of_skripte for select to authenticated
  using (model_name = public.my_display_name() and status in ('beim_model', 'hochgeladen', 'gebaut'));
drop policy if exists of_skripte_model_aendern on public.of_skripte;
create policy of_skripte_model_aendern on public.of_skripte for update to authenticated
  using (model_name = public.my_display_name() and status = 'beim_model')
  with check (model_name = public.my_display_name() and status in ('beim_model', 'hochgeladen'));

drop policy if exists of_skripte_builder_lesen on public.of_skripte;
create policy of_skripte_builder_lesen on public.of_skripte for select to authenticated
  using (public.hat_rolle('script_builder') and status in ('hochgeladen', 'gebaut'));
drop policy if exists of_skripte_builder_aendern on public.of_skripte;
create policy of_skripte_builder_aendern on public.of_skripte for update to authenticated
  using (public.hat_rolle('script_builder') and status in ('hochgeladen', 'gebaut'))
  with check (status in ('hochgeladen', 'gebaut'));

-- Schutz-Trigger: jede Rolle darf nur ihre eigenen Felder ändern, Zeitstempel setzt die Datenbank.
-- Name mit a_ → läuft vor anderen BEFORE-Triggern.
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
  elsif public.hat_rolle('storyteller') and old.erstellt_von = ich and old.status in ('entwurf', 'freigabe', 'zurueck') then
    -- Storyteller: Inhalt ja, Verwaltungsfelder nein
    v := new;
    v.erstellt_von := old.erstellt_von; v.erstellt_am := old.erstellt_am;
    v.freigegeben_von := old.freigegeben_von; v.freigegeben_am := old.freigegeben_am;
    v.hochgeladen_am := old.hochgeladen_am; v.gebaut_von := old.gebaut_von; v.gebaut_am := old.gebaut_am;
    v.schritte_erledigt := old.schritte_erledigt; v.of_titel := old.of_titel; v.model_frage := old.model_frage;
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
drop trigger if exists a_of_skripte_schuetzen on public.of_skripte;
create trigger a_of_skripte_schuetzen before insert or update on public.of_skripte
  for each row execute function public.of_skripte_schuetzen();

-- 4) Model-Videos für den Script Builder
create table if not exists public.ch_video_erledigt (
  video_id    text primary key,
  model_name  text,
  titel       text,
  gebaut_von  text,
  gebaut_am   timestamptz not null default now()
);
alter table public.ch_video_erledigt enable row level security;
drop policy if exists ch_video_lesen on public.ch_video_erledigt;
create policy ch_video_lesen on public.ch_video_erledigt for select to authenticated
  using (public.is_staff() or public.hat_rolle('script_builder'));
drop policy if exists ch_video_anlegen on public.ch_video_erledigt;
create policy ch_video_anlegen on public.ch_video_erledigt for insert to authenticated
  with check (public.is_staff() or (public.hat_rolle('script_builder') and gebaut_von = public.my_display_name()));
drop policy if exists ch_video_loeschen on public.ch_video_erledigt;
create policy ch_video_loeschen on public.ch_video_erledigt for delete to authenticated
  using (public.is_staff() or (public.hat_rolle('script_builder') and gebaut_von = public.my_display_name()));

-- Bestehende Videos gelten als erledigt (nur beim ersten Lauf relevant, danach greift on conflict)
insert into public.ch_video_erledigt (video_id, model_name, titel, gebaut_von)
select v.id::text, v.model_name, v.title, '(vor Start)'
from public.model_videos v
on conflict (video_id) do nothing;

-- Liste für den Script Builder: offene + die letzten erledigten Model-Videos.
-- to_jsonb, damit die Abfrage nicht an einzelnen Spalten von model_videos hängt.
create or replace function public.builder_videos()
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(v) || jsonb_build_object('erledigt_am', e.gebaut_am, 'erledigt_von', e.gebaut_von)
  from public.model_videos v
  left join public.ch_video_erledigt e on e.video_id = v.id::text
  where (public.is_staff() or public.hat_rolle('script_builder'))
    and (e.video_id is null or (e.gebaut_von <> '(vor Start)' and e.gebaut_am > now() - interval '30 days'))
  order by (e.video_id is null) desc, e.gebaut_am desc nulls last
  limit 300
$$;
grant execute on function public.builder_videos() to authenticated;

-- 5) Wen benachrichtigen? Telegram-IDs aller aktiven Script Builder.
--    Auch Models rufen das auf (nach „hochgeladen“ bzw. neuem Video).
create or replace function public.script_builder_kontakte()
returns table (name text, telegram text) language sql stable security definer set search_path = public as $$
  select distinct ur.display_name,
         coalesce(nullif(ur.kontakt_telegram, ''),
                  (select c.telegram_id::text from public.chatters_contact c
                    where lower(c.name) = lower(ur.display_name) and c.telegram_id is not null limit 1))
  from public.user_roles ur
  where 'script_builder' = any(coalesce(ur.roles, '{}'))
    and coalesce(ur.status, 'active') = 'active'
    and auth.uid() is not null
$$;
grant execute on function public.script_builder_kontakte() to authenticated;

-- 6) Model-Liste für die Storytellerin (models_contact darf sie selbst nicht lesen)
create or replace function public.of_models_liste()
returns table (name text) language sql stable security definer set search_path = public as $$
  select m.name from public.models_contact m
  where coalesce(m.active, true)
    and (public.is_staff() or public.hat_rolle('storyteller'))
  order by m.name
$$;
grant execute on function public.of_models_liste() to authenticated;
