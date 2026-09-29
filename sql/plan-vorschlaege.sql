-- ============================================================================
-- v5.3.1 · Caption-/Hashtag-Vorschläge von Lyra für den Posting-Plan
--
-- Abgestimmt mit dem Reels-Pipeline-Chat (29.09.2026):
--   • Lyra schreibt NICHT selbst. Lyra legt Vorschläge lokal ab, ein Sende-
--     Skript ohne KI schickt sie an die Edge Function vorschlaege-eintragen
--     (eigenes Geheimnis VORSCHLAEGE_SECRET). Die Function ruft nur
--     public.vorschlaege_eintragen() auf — ausführbar nur für die Service-Rolle.
--   • Geschrieben werden NUR caption_vorschlag / hashtags_vorschlag, nur bei
--     status = 'geplant'. caption/hashtags ändert allein das Team („übernehmen“).
--   • Prüfungen: Caption ≤ 2200 Zeichen, ≤ 10 Hashtags, keine Links/Domains,
--     keine @-Erwähnungen, gesperrte Wörter (onlyfans, fansly, link in bio, „OF“ großgeschrieben).
--   • vorschlag_uebernommen (ja / geaendert / nein) setzt das Dashboard beim
--     Speichern — Lyra wertet damit aus, ob ihre Vorschläge besser laufen.
--   • lyra.social_plan bekommt id, vorschlag_uebernommen, vorschlag_am.
--
-- Voraussetzung: posting-plan.sql. Wiederholbar. Löscht keine Daten.
-- ============================================================================

alter table public.social_plan add column if not exists vorschlag_uebernommen text;
alter table public.social_plan add column if not exists vorschlag_am timestamptz;
alter table public.social_plan drop constraint if exists social_plan_vorschlag_uebernommen_check;
alter table public.social_plan add constraint social_plan_vorschlag_uebernommen_check
  check (vorschlag_uebernommen is null or vorschlag_uebernommen in ('ja', 'geaendert', 'nein'));

-- ── Einziger Schreibweg ────────────────────────────────────────────────────
-- Eingabe: [{ "id": "<plan-id>", "caption_vorschlag": "…", "hashtags_vorschlag": "#a #b" }]
-- Rückgabe: {"uebernommen": n, "verworfen": [{"index": i, "id": "…", "grund": "…"}]}
create or replace function public.vorschlaege_eintragen(p_zeilen jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- Gesperrte Ausdrücke (Wortgrenzen, Groß/klein egal). Hier ergänzen.
  -- „OF“ wird extra geprüft: nur großgeschrieben, sonst träfe es das englische „of“.
  sperre   text[] := array['onlyfans', 'link in bio', 'fansly'];
  z        jsonb;
  i        int := -1;
  ok       int := 0;
  weg      jsonb := '[]'::jsonb;
  v_id     bigint;
  v_cap    text;
  v_tags   text;
  v_status text;
  v_text   text;
  w        text;
  n_tags   int;
begin
  if jsonb_typeof(p_zeilen) <> 'array' then raise exception 'Erwartet wird eine Liste'; end if;
  if jsonb_array_length(p_zeilen) > 500 then raise exception 'Höchstens 500 Zeilen pro Aufruf'; end if;

  for z in select * from jsonb_array_elements(p_zeilen) loop
    i := i + 1;
    begin
      if coalesce(z->>'id', '') !~ '^[0-9]{1,18}$' then
        weg := weg || jsonb_build_object('index', i, 'id', z->>'id', 'grund', 'id fehlt oder ungültig'); continue;
      end if;
      v_id := (z->>'id')::bigint;
      select status into v_status from public.social_plan where id = v_id;
      if v_status is null then
        weg := weg || jsonb_build_object('index', i, 'id', v_id, 'grund', 'Eintrag gibt es nicht'); continue;
      end if;
      if v_status <> 'geplant' then
        weg := weg || jsonb_build_object('index', i, 'id', v_id, 'grund', 'Eintrag ist schon gepostet'); continue;
      end if;

      v_cap  := nullif(trim(coalesce(z->>'caption_vorschlag', '')), '');
      v_tags := nullif(regexp_replace(trim(coalesce(z->>'hashtags_vorschlag', '')), '\s+', ' ', 'g'), '');
      if v_cap is null and v_tags is null then
        weg := weg || jsonb_build_object('index', i, 'id', v_id, 'grund', 'Kein Vorschlag'); continue;
      end if;
      if length(coalesce(v_cap, '')) > 2200 then
        weg := weg || jsonb_build_object('index', i, 'id', v_id, 'grund', 'Caption länger als 2200 Zeichen'); continue;
      end if;
      select count(*) into n_tags from regexp_matches(coalesce(v_cap, '') || ' ' || coalesce(v_tags, ''), '#[[:alnum:]_]+', 'g');
      if n_tags > 10 then
        weg := weg || jsonb_build_object('index', i, 'id', v_id, 'grund', 'Mehr als 10 Hashtags'); continue;
      end if;
      v_text := lower(coalesce(v_cap, '') || ' ' || coalesce(v_tags, ''));
      if v_text ~ '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|io|me|ly|link|app|co|de|to|gg|bio|page|site|xyz|tv)\M)' then
        weg := weg || jsonb_build_object('index', i, 'id', v_id, 'grund', 'Enthält einen Link oder eine Domain'); continue;
      end if;
      if v_text ~ '(^|[^[:alnum:]_])@[[:alnum:]_.]+' then
        weg := weg || jsonb_build_object('index', i, 'id', v_id, 'grund', 'Enthält eine @-Erwähnung'); continue;
      end if;
      w := null;
      foreach w in array sperre loop
        exit when v_text ~ ('(^|[^[:alnum:]])#?' || regexp_replace(w, ' ', '[[:space:]]+', 'g') || '($|[^[:alnum:]])');
        w := null;
      end loop;
      if w is not null then
        weg := weg || jsonb_build_object('index', i, 'id', v_id, 'grund', 'Gesperrtes Wort: ' || w); continue;
      end if;
      if (coalesce(v_cap, '') || ' ' || coalesce(v_tags, '')) ~ '(^|[^[:alnum:]])#?OF($|[^[:alnum:]])' then
        weg := weg || jsonb_build_object('index', i, 'id', v_id, 'grund', 'Gesperrtes Wort: OF'); continue;
      end if;

      update public.social_plan
         set caption_vorschlag = v_cap, hashtags_vorschlag = v_tags, vorschlag_am = now()
       where id = v_id and status = 'geplant';
      ok := ok + 1;
    exception when others then
      weg := weg || jsonb_build_object('index', i, 'id', z->>'id', 'grund', 'Ungültig: ' || sqlerrm);
    end;
  end loop;
  return jsonb_build_object('uebernommen', ok, 'verworfen', weg);
end $$;

revoke all on function public.vorschlaege_eintragen(jsonb) from public;
revoke all on function public.vorschlaege_eintragen(jsonb) from authenticated;
revoke all on function public.vorschlaege_eintragen(jsonb) from anon;
grant execute on function public.vorschlaege_eintragen(jsonb) to service_role;

-- Der Plan-Trigger setzt aktualisiert_am — beim Schreiben der Vorschläge soll
-- das nicht als Bearbeitung durch das Team zählen; das ist in Ordnung so, weil
-- vorschlag_am separat steht.

-- ── Lyra: id + Übernahme-Status ergänzen (neue Spalten hinten anhängen) ────
create or replace view lyra.social_plan as
select p.model_name, p.account, p.art, p.geplant_am, p.titel, p.caption, p.hashtags,
       p.overlays, p.caption_vorschlag, p.hashtags_vorschlag, p.status, p.reel_url, p.gepostet_am,
       s.nr as skript_nr,
       substring(p.reel_url from '(?i)instagram\.com/(?:reel|reels|p)/([A-Za-z0-9_-]+)') as shortcode,
       p.id, p.vorschlag_uebernommen, p.vorschlag_am
from public.social_plan p
left join public.reel_skripte s on s.id = p.skript_id;
alter view lyra.social_plan owner to postgres;
grant select on lyra.social_plan to lyra_readonly;

-- Prüfen:
-- select id, caption_vorschlag, hashtags_vorschlag, vorschlag_uebernommen from public.social_plan order by id desc limit 10;
