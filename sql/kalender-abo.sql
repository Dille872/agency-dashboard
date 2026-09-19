-- ============================================================================
-- v4.67.0: Kalender-Abo fürs Handy (Apple / Google / Android)
--
-- Jede Person bekommt einen eigenen geheimen Link. Die Edge Function
-- `kalender-ics` liefert darüber NUR die eigenen Einträge (für mich / Ganzes
-- Team) und die eigenen Schichten (nur Live-Wochen).
--
-- Sicherheit:
--  - Token = 64 Hex-Zeichen (zwei UUIDs), nicht erratbar.
--  - Die Tabelle ist nur über die beiden RPCs beschreibbar; lesen darf jeder
--    nur die eigene Zeile.
--  - Gesperrte / offboardete Accounts: die Function prüft den Status bei JEDEM
--    Abruf → Link liefert sofort nichts mehr. „Neuen Link erzeugen" macht den
--    alten sofort ungültig.
-- Nur Hinzufügen, wiederholbar.
-- ============================================================================
begin;

create table if not exists public.kalender_abos (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  display_name      text not null,
  token             text not null unique,
  erstellt_am       timestamptz not null default now(),
  zuletzt_abgerufen timestamptz
);
alter table public.kalender_abos enable row level security;

drop policy if exists abo_eigenes_lesen on public.kalender_abos;
create policy abo_eigenes_lesen on public.kalender_abos
  for select to authenticated
  using ( user_id = (select auth.uid()) );

drop policy if exists aktiv_erforderlich on public.kalender_abos;
create policy aktiv_erforderlich on public.kalender_abos
  as restrictive for all to authenticated
  using ((select public.is_active_user())) with check ((select public.is_active_user()));

-- Link holen (p_neu = true → neuen Link, alter wird sofort ungültig)
create or replace function public.kalender_abo_link(p_neu boolean default false)
returns text
language plpgsql security definer
set search_path = public
as $$
declare ich text := public.my_display_name(); t text;
begin
  if auth.uid() is null or not public.is_active_user() or coalesce(ich, '') = '' then
    raise exception 'nicht berechtigt';
  end if;
  if not p_neu then
    select token into t from public.kalender_abos where user_id = auth.uid();
    if t is not null then
      update public.kalender_abos set display_name = ich where user_id = auth.uid() and display_name is distinct from ich;
      return t;
    end if;
  end if;
  t := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.kalender_abos (user_id, display_name, token)
  values (auth.uid(), ich, t)
  on conflict (user_id) do update
    set token = excluded.token, display_name = excluded.display_name, erstellt_am = now(), zuletzt_abgerufen = null;
  return t;
end $$;
revoke all on function public.kalender_abo_link(boolean) from public, anon;
grant execute on function public.kalender_abo_link(boolean) to authenticated;

-- Abo beenden (Link ungültig machen, ohne neuen)
create or replace function public.kalender_abo_beenden()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'nicht berechtigt'; end if;
  delete from public.kalender_abos where user_id = auth.uid();
end $$;
revoke all on function public.kalender_abo_beenden() from public, anon;
grant execute on function public.kalender_abo_beenden() to authenticated;

commit;

-- Prüfen (separat): wer hat ein Abo, wann zuletzt abgerufen?
-- select display_name, erstellt_am, zuletzt_abgerufen from public.kalender_abos order by display_name;
