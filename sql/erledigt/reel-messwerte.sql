-- ============================================================================
-- v4.107.0 · Messwerte der Reels zurück ins Dashboard
--
-- Abgestimmt mit dem Reels-Pipeline-Chat (27.09.2026):
--   • Geschrieben wird NICHT von Lyra, sondern vom Sammel-Skript auf dem
--     Mac mini (~/Lyra/reels/reels_sammler.py, nachts 02:00).
--   • Einziger Schreibweg: Edge Function „messwerte-eintragen“ mit eigenem
--     Geheimnis (Secret MESSWERTE_SECRET). Die Function ruft die Datenbank-
--     Funktion public.messwerte_eintragen() auf — die darf NUR die
--     Service-Rolle ausführen, niemand aus der App.
--   • Die Funktion nimmt nur Reels von betreuten Accounts (im Service, nicht
--     „nicht betreut“) an, prüft Zahlen und Shortcode, setzt „art“ selbst und
--     schreibt nur in reel_messwerte — nie löschen, keine anderen Tabellen.
--   • Verlauf: pro Reel und Tag (Berlin) eine Zeile; erneutes Senden am
--     selben Tag aktualisiert sie.
--   • Lyra liest über lyra.reel_messwerte.
--
-- Voraussetzung: social-steuerung.sql (insta_handle), nicht-betreut.sql.
-- Wiederholbar. Löscht und überschreibt keine Daten.
-- ============================================================================

create table if not exists public.reel_messwerte (
  id           bigint generated always as identity primary key,
  shortcode    text not null,
  reel_url     text not null,          -- kanonisch: https://www.instagram.com/reel/<shortcode>/
  account      text not null,          -- @handle, klein geschrieben
  model_name   text,
  skript_nr    text,                   -- S-… wenn es unser Reel ist
  art          text not null check (art in ('skript', 'vergleich')),
  gepostet_am  timestamptz,
  gemessen_am  timestamptz not null,
  mess_tag     date not null,          -- Kalendertag Berlin, Schlüssel für „eine Zeile pro Tag“
  alter_std    numeric check (alter_std is null or alter_std >= 0),
  plays        bigint  check (plays is null or plays >= 0),
  likes        bigint  check (likes is null or likes >= 0),
  comments     bigint  check (comments is null or comments >= 0),
  faktor       numeric check (faktor is null or faktor >= 0),
  eingetragen_am timestamptz not null default now(),
  unique (shortcode, mess_tag)
);
create index if not exists reel_messwerte_account_idx on public.reel_messwerte (account, gepostet_am desc);

alter table public.reel_messwerte enable row level security;
drop policy if exists messwerte_lesen on public.reel_messwerte;
drop policy if exists aktiv_erforderlich on public.reel_messwerte;
-- Lesen: Staff, Pfleger, Freigeber. Schreiben: gar keine Policy → aus der App unmöglich.
create policy messwerte_lesen on public.reel_messwerte for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben());
create policy aktiv_erforderlich on public.reel_messwerte as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- ── Einziger Schreibweg ────────────────────────────────────────────────────
-- Eingabe: jsonb-Array von Objekten mit
--   shortcode (oder reel_url), account, gepostet_am, gemessen_am,
--   alter_std, plays, likes, comments, faktor
-- Rückgabe: {"uebernommen": n, "verworfen": [{"index": i, "shortcode": "…", "grund": "…"}]}
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
      -- Shortcode: direkt oder aus der URL
      v_code := nullif(trim(z->>'shortcode'), '');
      if v_code is null then
        v_code := substring(coalesce(z->>'reel_url', '') from '(?i)instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)');
      end if;
      if v_code is null or v_code !~ '^[A-Za-z0-9_-]{5,40}$' then
        weg := weg || jsonb_build_object('index', i, 'shortcode', v_code, 'grund', 'Shortcode fehlt oder ungültig'); continue;
      end if;

      -- Account normalisieren (@handle, klein) und prüfen: betreut + im Service
      v_acc := lower(trim(coalesce(z->>'account', '')));
      if v_acc = '' then
        weg := weg || jsonb_build_object('index', i, 'shortcode', v_code, 'grund', 'Account fehlt'); continue;
      end if;
      if left(v_acc, 1) <> '@' then v_acc := '@' || v_acc; end if;

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

      -- Zeitpunkte
      v_gemessen := coalesce((z->>'gemessen_am')::timestamptz, now());
      v_gepostet := (z->>'gepostet_am')::timestamptz;

      -- Zahlen: nur ≥ 0
      foreach v_zahl in array array['alter_std', 'plays', 'likes', 'comments', 'faktor'] loop
        if z ? v_zahl and z->>v_zahl is not null and (z->>v_zahl)::numeric < 0 then
          raise exception 'negativ: %', v_zahl;
        end if;
      end loop;

      -- Unser Reel? (reel_url in reel_skripte enthält den Shortcode)
      select nr into v_nr from public.reel_skripte
      where reel_url is not null
        and substring(reel_url from '(?i)instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)') = v_code
      limit 1;

      insert into public.reel_messwerte
        (shortcode, reel_url, account, model_name, skript_nr, art, gepostet_am, gemessen_am, mess_tag,
         alter_std, plays, likes, comments, faktor)
      values
        (v_code, 'https://www.instagram.com/reel/' || v_code || '/', v_acc, v_model, v_nr,
         case when v_nr is not null then 'skript' else 'vergleich' end,
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

-- Nur die Service-Rolle (also die Edge Function) darf das ausführen.
revoke all on function public.messwerte_eintragen(jsonb) from public;
revoke all on function public.messwerte_eintragen(jsonb) from authenticated;
revoke all on function public.messwerte_eintragen(jsonb) from anon;
grant execute on function public.messwerte_eintragen(jsonb) to service_role;

-- ── Lyra ───────────────────────────────────────────────────────────────────
create or replace view lyra.reel_messwerte as
select reel_url, shortcode, account, model_name, skript_nr, art,
       gepostet_am, gemessen_am, alter_std, plays, likes, comments, faktor
from public.reel_messwerte;
alter view lyra.reel_messwerte owner to postgres;
grant select on lyra.reel_messwerte to lyra_readonly;

-- ── Prüfen ─────────────────────────────────────────────────────────────────
-- select count(*) from public.reel_messwerte;
-- set role lyra_readonly; select count(*) from lyra.reel_messwerte; reset role;
