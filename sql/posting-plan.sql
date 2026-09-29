-- ============================================================================
-- v5.3.0 · Posting-Plan (Kalender) + Material
--
-- Entscheidungen Chris (29.09.):
--   • Planen dürfen Admins, Social-Leitung und Poster (Poster nur auf ihren
--     zugeteilten Accounts).
--   • Poster sehen den Kalender ihrer Accounts, Admins alles (mit Filter).
--   • Stories: Frames + Text/Sticker + „gepostet“, keine Zahlen.
--   • Material tragen Models selbst ein (Portal → Social) oder das Team.
--     Models sehen ihren Plan (nur lesen).
--   • Lyra macht Vorschläge für Caption/Hashtags (Felder *_vorschlag) und
--     sieht über lyra.social_plan, welche funktionieren. Lyra bleibt lesend;
--     WIE die Vorschläge hereinkommen, wird mit dem Pipeline-Chat abgestimmt.
--
-- Beim Posten eines Reels aus dem Plan wird es automatisch gemessen:
--   mit Skript  → reel_skripte bekommt reel_url (wie bisher)
--   ohne Skript → Eintrag in reel_ohne_skript
--
-- Voraussetzung: social-leitung.sql, reel-ohne-skript.sql. Wiederholbar.
-- Löscht keine Daten.
-- ============================================================================

-- ── Material ───────────────────────────────────────────────────────────────
create table if not exists public.social_material (
  id           bigint generated always as identity primary key,
  model_name   text not null,
  art          text not null default 'reel' check (art in ('reel', 'story')),
  titel        text not null,
  link         text,
  notiz        text,
  verworfen    boolean not null default false,
  erstellt_am  timestamptz not null default now(),
  erstellt_von text
);
create index if not exists social_material_model_idx on public.social_material (model_name, erstellt_am desc);

-- ── Plan ───────────────────────────────────────────────────────────────────
create table if not exists public.social_plan (
  id                 bigint generated always as identity primary key,
  model_name         text not null,
  account            text not null,               -- @handle
  art                text not null default 'reel' check (art in ('reel', 'story')),
  geplant_am         timestamptz not null,
  titel              text,
  material_id        bigint references public.social_material(id) on delete set null,
  skript_id          bigint,                       -- reel_skripte.id, wenn aus Skript
  video_link         text,
  caption            text,
  hashtags           text,
  overlays           jsonb not null default '[]'::jsonb,   -- [{zeit:"0:04", text:"…"}]
  frames             jsonb not null default '[]'::jsonb,   -- Story: [{link, text, sticker}]
  hinweis            text,
  caption_vorschlag  text,                          -- von Lyra
  hashtags_vorschlag text,                          -- von Lyra
  status             text not null default 'geplant' check (status in ('geplant', 'gepostet')),
  reel_url           text,
  gepostet_am        timestamptz,
  gepostet_von       text,
  erstellt_am        timestamptz not null default now(),
  erstellt_von       text,
  aktualisiert_am    timestamptz not null default now()
);
create index if not exists social_plan_zeit_idx on public.social_plan (geplant_am);
create index if not exists social_plan_acc_idx on public.social_plan (model_name, account);

-- ── Rechte ─────────────────────────────────────────────────────────────────
alter table public.social_material enable row level security;
alter table public.social_plan enable row level security;

drop policy if exists material_lesen    on public.social_material;
drop policy if exists material_anlegen  on public.social_material;
drop policy if exists material_aendern  on public.social_material;
drop policy if exists aktiv_erforderlich on public.social_material;
create policy material_lesen on public.social_material for select to authenticated
  using (public.darf_social_leiten() or public.poster_hat_model(model_name) or model_name = public.my_display_name());
create policy material_anlegen on public.social_material for insert to authenticated
  with check (public.darf_social_leiten() or public.poster_hat_model(model_name) or model_name = public.my_display_name());
-- Ändern/Verwerfen: Team, oder wer es selbst angelegt hat
create policy material_aendern on public.social_material for update to authenticated
  using (public.darf_social_leiten() or erstellt_von = public.my_display_name())
  with check (public.darf_social_leiten() or erstellt_von = public.my_display_name());
create policy aktiv_erforderlich on public.social_material as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

drop policy if exists plan_lesen    on public.social_plan;
drop policy if exists plan_anlegen  on public.social_plan;
drop policy if exists plan_aendern  on public.social_plan;
drop policy if exists plan_loeschen on public.social_plan;
drop policy if exists aktiv_erforderlich on public.social_plan;
create policy plan_lesen on public.social_plan for select to authenticated
  using (public.darf_social_leiten() or public.poster_hat_account(model_name, account) or model_name = public.my_display_name());
create policy plan_anlegen on public.social_plan for insert to authenticated
  with check (public.darf_social_leiten() or public.poster_hat_account(model_name, account));
create policy plan_aendern on public.social_plan for update to authenticated
  using (public.darf_social_leiten() or public.poster_hat_account(model_name, account))
  with check (public.darf_social_leiten() or public.poster_hat_account(model_name, account));
create policy plan_loeschen on public.social_plan for delete to authenticated
  using (public.darf_social_leiten() or public.poster_hat_account(model_name, account));
create policy aktiv_erforderlich on public.social_plan as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Vereinheitlichen + Zeitstempel
create or replace function public.social_plan_vorbereiten()
returns trigger language plpgsql as $$
begin
  new.account := trim(new.account);   -- Schreibweise wie in der Zuteilung lassen (RLS vergleicht genau)
  if left(new.account, 1) <> '@' then new.account := '@' || new.account; end if;
  new.aktualisiert_am := now();
  if tg_op = 'INSERT' then new.erstellt_von := coalesce(new.erstellt_von, public.my_display_name()); end if;
  if new.status = 'gepostet' and (tg_op = 'INSERT' or old.status is distinct from 'gepostet') then
    new.gepostet_am := coalesce(new.gepostet_am, now());
    new.gepostet_von := coalesce(new.gepostet_von, public.my_display_name());
  end if;
  return new;
end $$;
drop trigger if exists social_plan_vorbereiten on public.social_plan;
create trigger social_plan_vorbereiten before insert or update on public.social_plan
  for each row execute function public.social_plan_vorbereiten();

-- Gepostetes Reel → Messung (Skript oder „ohne Skript“). Fehler hier dürfen
-- das Speichern des Plans nie verhindern.
create or replace function public.social_plan_messung()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.art <> 'reel' or new.reel_url is null or new.status <> 'gepostet' then return new; end if;
  if tg_op = 'UPDATE' and old.reel_url is not distinct from new.reel_url and old.status = 'gepostet' then return new; end if;
  begin
    if new.skript_id is not null then
      update public.reel_skripte
         set reel_url = new.reel_url, account = new.account,
             gepostet_am = coalesce((new.gepostet_am at time zone 'Europe/Berlin')::date, current_date),
             gepostet_von = new.gepostet_von
       where id = new.skript_id and reel_url is null;
    else
      insert into public.reel_ohne_skript (reel_url, model_name, account, gepostet_am, notiz)
      values (new.reel_url, new.model_name, new.account, (new.gepostet_am at time zone 'Europe/Berlin')::date, 'aus Posting-Plan')
      on conflict (shortcode) do nothing;
    end if;
  exception when others then
    raise notice 'Messung nicht eingetragen: %', sqlerrm;
  end;
  return new;
end $$;
drop trigger if exists social_plan_messung on public.social_plan;
create trigger social_plan_messung after insert or update on public.social_plan
  for each row execute function public.social_plan_messung();

-- ── Lyra: sieht Plan mit Caption/Hashtags, um zu lernen, was funktioniert ──
create or replace view lyra.social_plan as
select p.model_name, p.account, p.art, p.geplant_am, p.titel, p.caption, p.hashtags,
       p.overlays, p.caption_vorschlag, p.hashtags_vorschlag, p.status, p.reel_url, p.gepostet_am,
       s.nr as skript_nr,
       substring(p.reel_url from '(?i)instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)') as shortcode
from public.social_plan p
left join public.reel_skripte s on s.id = p.skript_id;
alter view lyra.social_plan owner to postgres;
grant select on lyra.social_plan to lyra_readonly;

-- Prüfen:
-- select count(*) from public.social_plan;  select count(*) from public.social_material;
