-- ============================================================================
-- v4.109.0 · Reels ohne Skript (von uns gepostet, trotzdem messen)
--
-- Manchmal postet die Agentur Reels, denen kein Drehzettel vorausgeht
-- (z. B. alter Content, der erst abgearbeitet wird). Die gehören zu „uns“,
-- nicht zum eigenen Content des Models. Bisher landeten sie beim Messen als
-- „vergleich“ (= Model).
--
-- Neu:
--   • Tabelle reel_ohne_skript: Reel-Link + Account. Eintragen dürfen
--     Admins/Pfleger und der Poster, der dem Account zugeteilt ist.
--   • reel_messwerte.art bekommt einen dritten Wert: 'ohne_skript'.
--   • messwerte_eintragen() setzt 'ohne_skript', wenn der Shortcode in
--     reel_ohne_skript steht (Skript geht vor).
--   • Beim Eintragen/Löschen werden schon vorhandene Messwerte desselben
--     Reels umsortiert (vergleich ↔ ohne_skript). Sonst nichts.
--   • Lyra: lyra.reel_messwerte bleibt gleich, art kann jetzt auch
--     'ohne_skript' sein.
--
-- Voraussetzung: reel-messwerte.sql, social-schnitt.sql. Wiederholbar.
-- Löscht keine Daten.
-- ============================================================================

create table if not exists public.reel_ohne_skript (
  shortcode      text primary key,
  reel_url       text not null,
  model_name     text not null,
  account        text not null,          -- @handle, klein
  gepostet_am    date,
  notiz          text,
  eingetragen_am timestamptz not null default now(),
  eingetragen_von text
);
create index if not exists reel_ohne_skript_account_idx on public.reel_ohne_skript (model_name, account);

-- Prüfen und vereinheitlichen, bevor gespeichert wird
create or replace function public.reel_ohne_skript_pruefen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_ok   boolean;
begin
  v_code := substring(coalesce(new.reel_url, '') from '(?i)instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)');
  if v_code is null or v_code !~ '^[A-Za-z0-9_-]{5,40}$' then
    raise exception 'Bitte einen Instagram-Reel-Link einfügen (…instagram.com/reel/…)';
  end if;
  new.shortcode := v_code;
  new.reel_url := 'https://www.instagram.com/reel/' || v_code || '/';
  new.account := lower(trim(coalesce(new.account, '')));
  if new.account = '' then raise exception 'Account fehlt'; end if;
  if left(new.account, 1) <> '@' then new.account := '@' || new.account; end if;
  new.notiz := nullif(left(trim(coalesce(new.notiz, '')), 300), '');
  new.eingetragen_am := now();
  new.eingetragen_von := public.my_display_name();

  -- Account muss betreut sein und zum Model gehören
  select exists (
    select 1 from public.model_board b
    join public.model_social_service s on s.model_name = b.model_name and s.service_aktiv
    where b.model_name = new.model_name and b.category = 'social_media'
      and lower(public.insta_handle(b.content)) = new.account
      and not (new.account = any(array(select lower(x) from unnest(s.nicht_betreut) x)))
  ) into v_ok;
  if not v_ok then raise exception 'Account % gehört nicht zu % oder wird nicht betreut', new.account, new.model_name; end if;

  -- Hängt schon an einem Skript? Dann ist es kein Reel ohne Skript.
  if exists (select 1 from public.reel_skripte
             where reel_url is not null
               and substring(reel_url from '(?i)instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)') = v_code) then
    raise exception 'Dieses Reel ist schon bei einem Skript eingetragen';
  end if;
  return new;
end $$;

drop trigger if exists reel_ohne_skript_pruefen on public.reel_ohne_skript;
create trigger reel_ohne_skript_pruefen before insert on public.reel_ohne_skript
  for each row execute function public.reel_ohne_skript_pruefen();

-- Vorhandene Messwerte umsortieren
create or replace function public.reel_ohne_skript_messwerte()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.reel_messwerte set art = 'ohne_skript' where shortcode = new.shortcode and art = 'vergleich';
    return new;
  else
    update public.reel_messwerte set art = 'vergleich' where shortcode = old.shortcode and art = 'ohne_skript';
    return old;
  end if;
end $$;

drop trigger if exists reel_ohne_skript_messwerte on public.reel_ohne_skript;
create trigger reel_ohne_skript_messwerte after insert or delete on public.reel_ohne_skript
  for each row execute function public.reel_ohne_skript_messwerte();

-- Rechte
alter table public.reel_ohne_skript enable row level security;
drop policy if exists ros_lesen    on public.reel_ohne_skript;
drop policy if exists ros_anlegen  on public.reel_ohne_skript;
drop policy if exists ros_loeschen on public.reel_ohne_skript;
drop policy if exists aktiv_erforderlich on public.reel_ohne_skript;
create policy ros_lesen on public.reel_ohne_skript for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
         or public.poster_hat_account(model_name, account));
create policy ros_anlegen on public.reel_ohne_skript for insert to authenticated
  with check (public.is_staff() or public.darf_kontakte_pflegen() or public.poster_hat_account(model_name, account));
-- Löschen: Agentur immer, Poster nur eigene Einträge auf seinen Accounts
create policy ros_loeschen on public.reel_ohne_skript for delete to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen()
         or (public.poster_hat_account(model_name, account) and eingetragen_von = public.my_display_name()));
create policy aktiv_erforderlich on public.reel_ohne_skript as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
-- Kein UPDATE: falsch eingetragen → löschen und neu.

-- ── reel_messwerte: dritter Wert für art ───────────────────────────────────
alter table public.reel_messwerte drop constraint if exists reel_messwerte_art_check;
alter table public.reel_messwerte add constraint reel_messwerte_art_check
  check (art in ('skript', 'ohne_skript', 'vergleich'));

-- Poster sehen die Messwerte ihrer Accounts (für die eigene Liste)
drop policy if exists messwerte_lesen on public.reel_messwerte;
create policy messwerte_lesen on public.reel_messwerte for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
         or public.poster_hat_account(model_name, account));

-- ── messwerte_eintragen: wie bisher, plus 'ohne_skript' ────────────────────
create or replace function public.messwerte_eintragen(p_zeilen jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  z          jsonb;
  i          int := -1;
  ok         int := 0;
  weg        jsonb := '[]'::jsonb;
  v_code     text;
  v_acc      text;
  v_model    text;
  v_nr       text;
  v_ohne     boolean;
  v_gemessen timestamptz;
  v_gepostet timestamptz;
  v_zahl     text;
begin
  if jsonb_typeof(p_zeilen) <> 'array' then
    raise exception 'Erwartet wird eine Liste';
  end if;
  if jsonb_array_length(p_zeilen) > 1000 then
    raise exception 'Höchstens 1000 Zeilen pro Aufruf';
  end if;

  for z in select * from jsonb_array_elements(p_zeilen) loop
    i := i + 1;
    begin
      v_code := nullif(trim(z->>'shortcode'), '');
      if v_code is null then
        v_code := substring(coalesce(z->>'reel_url', '') from '(?i)instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)');
      end if;
      if v_code is null or v_code !~ '^[A-Za-z0-9_-]{5,40}$' then
        weg := weg || jsonb_build_object('index', i, 'shortcode', v_code, 'grund', 'Shortcode fehlt oder ungültig'); continue;
      end if;

      v_acc := lower(trim(coalesce(z->>'account', '')));
      if v_acc = '' then
        weg := weg || jsonb_build_object('index', i, 'shortcode', v_code, 'grund', 'Account fehlt'); continue;
      end if;
      if left(v_acc, 1) <> '@' then v_acc := '@' || v_acc; end if;

      v_model := null;
      select b.model_name into v_model
      from public.model_board b
      join public.model_social_service s on s.model_name = b.model_name and s.service_aktiv
      where b.category = 'social_media'
        and lower(public.insta_handle(b.content)) = v_acc
        and not (lower(public.insta_handle(b.content)) = any(array(select lower(x) from unnest(s.nicht_betreut) x)))
      limit 1;
      if v_model is null then
        weg := weg || jsonb_build_object('index', i, 'shortcode', v_code, 'grund', 'Account nicht betreut oder nicht im Service'); continue;
      end if;

      v_gemessen := coalesce((z->>'gemessen_am')::timestamptz, now());
      v_gepostet := (z->>'gepostet_am')::timestamptz;

      foreach v_zahl in array array['alter_std', 'plays', 'likes', 'comments', 'faktor'] loop
        if z ? v_zahl and z->>v_zahl is not null and (z->>v_zahl)::numeric < 0 then
          raise exception 'negativ: %', v_zahl;
        end if;
      end loop;

      v_nr := null;
      select nr into v_nr from public.reel_skripte
      where reel_url is not null
        and substring(reel_url from '(?i)instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)') = v_code
      limit 1;
      v_ohne := v_nr is null and exists (select 1 from public.reel_ohne_skript where shortcode = v_code);

      insert into public.reel_messwerte
        (shortcode, reel_url, account, model_name, skript_nr, art, gepostet_am, gemessen_am, mess_tag,
         alter_std, plays, likes, comments, faktor)
      values
        (v_code, 'https://www.instagram.com/reel/' || v_code || '/', v_acc, v_model, v_nr,
         case when v_nr is not null then 'skript' when v_ohne then 'ohne_skript' else 'vergleich' end,
         v_gepostet, v_gemessen, (v_gemessen at time zone 'Europe/Berlin')::date,
         (z->>'alter_std')::numeric, (z->>'plays')::bigint, (z->>'likes')::bigint,
         (z->>'comments')::bigint, (z->>'faktor')::numeric)
      on conflict (shortcode, mess_tag) do update set
        reel_url = excluded.reel_url, account = excluded.account, model_name = excluded.model_name,
        skript_nr = excluded.skript_nr, art = excluded.art,
        gepostet_am = coalesce(excluded.gepostet_am, reel_messwerte.gepostet_am),
        gemessen_am = excluded.gemessen_am, alter_std = excluded.alter_std,
        plays = excluded.plays, likes = excluded.likes, comments = excluded.comments,
        faktor = excluded.faktor, eingetragen_am = now();
      ok := ok + 1;
    exception when others then
      weg := weg || jsonb_build_object('index', i, 'shortcode', v_code, 'grund', 'Ungültige Werte: ' || sqlerrm);
    end;
  end loop;

  return jsonb_build_object('uebernommen', ok, 'verworfen', weg);
end $$;

revoke all on function public.messwerte_eintragen(jsonb) from public;
revoke all on function public.messwerte_eintragen(jsonb) from authenticated;
revoke all on function public.messwerte_eintragen(jsonb) from anon;
grant execute on function public.messwerte_eintragen(jsonb) to service_role;

-- Prüfen:
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'reel_messwerte_art_check';
-- select policyname from pg_policies where tablename = 'reel_ohne_skript';   → 4
