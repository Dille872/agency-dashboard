-- ============================================================================
-- v5.48.0 · Open Chats (CreatorHero „Detailed Comparison“) für Lyra
--
-- Neu, jeweils als LETZTE Spalte(n), damit bestehende Abfragen weiterlaufen:
--   lyra.model_tag    offene_chats          Wert des Tages je Account
--   lyra.model_woche  offene_chats          Summe der Woche je Model
--                     offene_chats_tage     an wie vielen Tagen ein Wert da war
--   lyra.model_monat  offene_chats, offene_chats_tage   (dto. je Monat)
--   lyra.model_block  offene_chats, offene_chats_tage   (dto. je 28-Tage-Block)
--
-- Quelle: model_snapshots.rows[].openChats (Dashboard ab v5.48.0; ältere Tage
-- über „Datenstand → Open Chats nachtragen“). Fehlt der Wert, ist er NULL,
-- nicht 0 — ein Tag ohne Angabe ist kein Tag mit 0 offenen Chats. Die Summe
-- ist NULL, wenn im Zeitraum kein einziger Wert vorliegt.
--
-- Sonst ändert sich nichts: alle übrigen Spalten und Berechnungen sind 1:1
-- die heutigen Definitionen (aus pg_get_viewdef vom 14.10.2026).
-- Abhängige Views (model_gestern, model_puls, agentur_*, model_befund …) und
-- die Funktion model_zeitraum bleiben unverändert und laufen weiter.
--
-- Wiederholbar. Ändert keine Daten. Alles in einer Transaktion.
-- ============================================================================

begin;

-- Sicherung: CREATE OR REPLACE VIEW setzt View-Optionen (security_invoker,
-- security_barrier …) zurück. Hat eine der vier Views welche, brechen wir ab.
do $$
declare n int;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'lyra' and c.relname in ('model_tag','model_woche','model_monat','model_block')
    and c.reloptions is not null;
  if n > 0 then
    raise exception 'Abbruch: eine der Views hat Optionen (reloptions). Bitte Claude Bescheid geben.';
  end if;
end $$;

-- ── lyra.model_tag ──
create or replace view lyra.model_tag as
 WITH roh AS (
         SELECT s.business_date AS datum,
            btrim(r.value ->> 'creator'::text) AS account,
            r.value AS j,
            s.file_name,
            s.uploaded_at
           FROM model_snapshots s
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.rows, '[]'::jsonb)) r(value)
          WHERE COALESCE(btrim(r.value ->> 'creator'::text), ''::text) <> ''::text AND btrim(r.value ->> 'creator'::text) !~* '^(\*+|total|totals|gesamt|summe|sum|all|alle)$'::text AND btrim(r.value ->> 'creator'::text) !~ '^\*'::text
        )
 SELECT roh.datum,
    roh.account,
    COALESCE(a.model_name, dir.name) AS model,
    COALESCE(a.model_name, dir.name, roh.account) AS gruppe,
    COALESCE(a.model_name, dir.name) IS NOT NULL AS ist_zugeordnet,
        CASE
            WHEN a.model_name IS NOT NULL THEN 'alias'::text
            WHEN dir.name IS NOT NULL THEN 'namensgleich'::text
            ELSE NULL::text
        END AS zuordnung_quelle,
    COALESCE(a.alias_label, 'MAIN'::text) AS funnel_stufe,
    COALESCE(mc.active, dir.active) AS model_aktiv,
    COALESCE((roh.j ->> 'revenue'::text)::numeric, 0::numeric) AS umsatz,
    COALESCE((roh.j ->> 'messageRevenue'::text)::numeric, 0::numeric) AS umsatz_nachrichten,
    COALESCE((roh.j ->> 'tipsRevenue'::text)::numeric, 0::numeric) AS umsatz_tips,
    COALESCE((roh.j ->> 'subsRevenue'::text)::numeric, 0::numeric) AS umsatz_subs,
    COALESCE((roh.j ->> 'newSubsRevenue'::text)::numeric, 0::numeric) AS umsatz_subs_neu,
    COALESCE((roh.j ->> 'recurringSubsRevenue'::text)::numeric, 0::numeric) AS umsatz_subs_wiederkehrend,
    COALESCE((roh.j ->> 'subs'::text)::numeric, 0::numeric) AS neue_subs,
    COALESCE((roh.j ->> 'sellingChats'::text)::numeric, 0::numeric) AS verkaufende_chats,
    COALESCE((roh.j ->> 'avgSpend'::text)::numeric, 0::numeric) AS schnitt_ausgabe_pro_fan,
    roh.file_name AS quelldatei,
    roh.uploaded_at AS hochgeladen_am,
    NULLIF(roh.j ->> 'openChats'::text, ''::text)::numeric AS offene_chats
   FROM roh
     LEFT JOIN ( SELECT DISTINCT ON (model_aliases.csv_name) model_aliases.csv_name,
            model_aliases.model_name,
            model_aliases.alias_label
           FROM model_aliases
          ORDER BY model_aliases.csv_name, model_aliases.model_name, model_aliases.alias_label) a ON a.csv_name = roh.account
     LEFT JOIN ( SELECT DISTINCT ON (models_contact.name) models_contact.name,
            models_contact.active
           FROM models_contact
          ORDER BY models_contact.name, models_contact.active DESC) dir ON a.model_name IS NULL AND dir.name = roh.account
     LEFT JOIN ( SELECT DISTINCT ON (models_contact.name) models_contact.name,
            models_contact.active
           FROM models_contact
          ORDER BY models_contact.name, models_contact.active DESC) mc ON mc.name = a.model_name;

-- ── lyra.model_woche ──
create or replace view lyra.model_woche as
 WITH je_woche AS (
         SELECT date_trunc('week'::text, model_tag.datum::timestamp with time zone)::date AS woche,
            model_tag.gruppe,
            max(model_tag.model) AS model,
            bool_or(model_tag.ist_zugeordnet) AS ist_zugeordnet,
            bool_and(COALESCE(model_tag.model_aktiv, true)) AS model_aktiv,
            count(DISTINCT model_tag.datum) AS tage_mit_daten,
            count(DISTINCT model_tag.datum) FILTER (WHERE model_tag.umsatz > 0::numeric) AS aktive_tage,
            count(DISTINCT model_tag.account) AS accounts,
            sum(model_tag.umsatz) AS umsatz,
            sum(model_tag.umsatz_nachrichten) AS umsatz_nachrichten,
            sum(model_tag.umsatz_tips) AS umsatz_tips,
            sum(model_tag.umsatz_subs) AS umsatz_subs,
            sum(model_tag.neue_subs) AS neue_subs,
            sum(model_tag.verkaufende_chats) AS verkaufende_chats,
            sum(model_tag.offene_chats) AS offene_chats,
            count(DISTINCT model_tag.datum) FILTER (WHERE model_tag.offene_chats IS NOT NULL) AS offene_chats_tage
           FROM lyra.model_tag
          GROUP BY (date_trunc('week'::text, model_tag.datum::timestamp with time zone)::date), model_tag.gruppe
        )
 SELECT w.woche,
    w.woche + 6 AS woche_ende,
    to_char(w.woche::timestamp with time zone, 'IYYY-"KW"IW'::text) AS kw,
    w.gruppe,
    w.model,
    w.ist_zugeordnet,
    w.model_aktiv,
    w.tage_mit_daten,
    w.aktive_tage,
    w.accounts,
    w.umsatz,
    w.umsatz_nachrichten,
    w.umsatz_tips,
    w.umsatz_subs,
    w.neue_subs,
    w.verkaufende_chats,
    round(w.umsatz / NULLIF(w.aktive_tage, 0)::numeric, 2) AS umsatz_pro_aktivem_tag,
    round(w.umsatz_nachrichten / NULLIF(w.verkaufende_chats, 0::numeric), 2) AS umsatz_pro_chat,
    round(100::numeric * w.umsatz_nachrichten / NULLIF(w.umsatz, 0::numeric), 1) AS anteil_nachrichten_pct,
    round(100::numeric * w.umsatz_tips / NULLIF(w.umsatz, 0::numeric), 1) AS anteil_tips_pct,
    round(100::numeric * w.umsatz_subs / NULLIF(w.umsatz, 0::numeric), 1) AS anteil_subs_pct,
    v.umsatz AS umsatz_vorwoche,
    v.neue_subs AS neue_subs_vorwoche,
    v.verkaufende_chats AS verkaufende_chats_vorwoche,
    round(100::numeric * (w.umsatz - v.umsatz) / NULLIF(abs(v.umsatz), 0::numeric), 1) AS umsatz_delta_pct,
    round(b.median_umsatz_tag, 2) AS baseline_umsatz_tag,
    round(b.median_neue_subs, 2) AS baseline_neue_subs_tag,
    round(b.median_chats, 2) AS baseline_chats_tag,
    round(b.median_umsatz_pro_chat, 2) AS baseline_umsatz_pro_chat,
    b.baseline_tage,
    round(100::numeric * (w.umsatz / NULLIF(w.aktive_tage, 0)::numeric - b.median_umsatz_tag) / NULLIF(b.median_umsatz_tag, 0::numeric), 1) AS abweichung_baseline_pct,
    t.daily_target AS tagesziel,
    round(100::numeric * (w.umsatz / NULLIF(w.aktive_tage, 0)::numeric) / NULLIF(t.daily_target, 0::numeric), 1) AS zielerreichung_pct,
    w.offene_chats,
    w.offene_chats_tage
   FROM je_woche w
     LEFT JOIN je_woche v ON v.gruppe = w.gruppe AND v.woche = (w.woche - 7)
     LEFT JOIN model_revenue_targets t ON t.model_name = w.model
     LEFT JOIN LATERAL ( SELECT percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (d.umsatz::double precision))::numeric AS median_umsatz_tag,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (d.neue_subs::double precision))::numeric AS median_neue_subs,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (d.chats::double precision))::numeric AS median_chats,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (d.upc::double precision))::numeric AS median_umsatz_pro_chat,
            count(*) AS baseline_tage
           FROM ( SELECT mt.datum,
                    sum(mt.umsatz) AS umsatz,
                    sum(mt.neue_subs) AS neue_subs,
                    sum(mt.verkaufende_chats) AS chats,
                    sum(mt.umsatz_nachrichten) / NULLIF(sum(mt.verkaufende_chats), 0::numeric) AS upc
                   FROM lyra.model_tag mt
                  WHERE mt.gruppe = w.gruppe AND mt.datum >= (w.woche - 28) AND mt.datum < w.woche
                  GROUP BY mt.datum
                 HAVING sum(mt.umsatz) > 0::numeric) d) b ON true;

-- ── lyra.model_block ──
create or replace view lyra.model_block as
 WITH spanne AS (
         SELECT model_tag.model,
            min(model_tag.datum) AS von,
            max(model_tag.datum) AS bis
           FROM lyra.model_tag
          WHERE model_tag.model IS NOT NULL
          GROUP BY model_tag.model
        ), gitter AS (
         SELECT s.model,
            b.block_nr,
            b.block_start,
            b.block_ende,
            b.block_label,
            b.block_vollstaendig
           FROM spanne s
             JOIN lyra.block_raster b ON b.block_ende >= s.von AND b.block_start <= s.bis
        ), fakten AS (
         SELECT g.model,
            g.block_nr,
            g.block_start,
            g.block_ende,
            g.block_label,
            g.block_vollstaendig,
            COALESCE(sum(t.umsatz), 0::numeric) AS umsatz,
            count(DISTINCT t.datum) AS tage_mit_daten,
            count(DISTINCT t.account) AS accounts,
            COALESCE(sum(t.neue_subs), 0::numeric) AS neue_subs,
            COALESCE(sum(t.verkaufende_chats), 0::numeric) AS verkaufende_chats,
            bool_or(t.model_aktiv) AS model_aktiv,
            sum(t.offene_chats) AS offene_chats,
            count(DISTINCT t.datum) FILTER (WHERE t.offene_chats IS NOT NULL) AS offene_chats_tage
           FROM gitter g
             LEFT JOIN lyra.model_tag t ON t.model = g.model AND t.datum >= g.block_start AND t.datum <= g.block_ende
          GROUP BY g.model, g.block_nr, g.block_start, g.block_ende, g.block_label, g.block_vollstaendig
        ), mit_prev AS (
         SELECT f.model,
            f.block_nr,
            f.block_start,
            f.block_ende,
            f.block_label,
            f.block_vollstaendig,
            f.umsatz,
            f.tage_mit_daten,
            f.accounts,
            f.neue_subs,
            f.verkaufende_chats,
            f.model_aktiv,
            f.offene_chats,
            f.offene_chats_tage,
            round(f.umsatz / NULLIF(f.tage_mit_daten, 0)::numeric, 2) AS umsatz_pro_tag,
            f.tage_mit_daten >= 21 AS vergleichbar,
            lag(f.umsatz) OVER w AS umsatz_vorblock,
            lag(round(f.umsatz / NULLIF(f.tage_mit_daten, 0)::numeric, 2)) OVER w AS pro_tag_vorblock,
            lag(f.tage_mit_daten >= 21) OVER w AS vorblock_vergleichbar
           FROM fakten f
          WINDOW w AS (PARTITION BY f.model ORDER BY f.block_start)
        ), mit_delta AS (
         SELECT p.model,
            p.block_nr,
            p.block_start,
            p.block_ende,
            p.block_label,
            p.block_vollstaendig,
            p.umsatz,
            p.tage_mit_daten,
            p.accounts,
            p.neue_subs,
            p.verkaufende_chats,
            p.model_aktiv,
            p.offene_chats,
            p.offene_chats_tage,
            p.umsatz_pro_tag,
            p.vergleichbar,
            p.umsatz_vorblock,
            p.pro_tag_vorblock,
            p.vorblock_vergleichbar,
                CASE
                    WHEN p.vergleichbar AND p.vorblock_vergleichbar THEN round(100.0 * (p.umsatz - p.umsatz_vorblock) / NULLIF(p.umsatz_vorblock, 0::numeric), 1)
                    ELSE NULL::numeric
                END AS delta_pct,
                CASE
                    WHEN p.vergleichbar AND p.vorblock_vergleichbar THEN round(100.0 * (p.umsatz_pro_tag - p.pro_tag_vorblock) / NULLIF(p.pro_tag_vorblock, 0::numeric), 1)
                    ELSE NULL::numeric
                END AS delta_pro_tag_pct
           FROM mit_prev p
        )
 SELECT model,
    block_nr,
    block_start,
    block_ende,
    block_label,
    block_vollstaendig,
    vergleichbar,
    tage_mit_daten,
    umsatz,
    umsatz_pro_tag,
    model_aktiv,
    accounts,
    neue_subs,
    verkaufende_chats,
    umsatz_vorblock,
    delta_pct,
    delta_pro_tag_pct,
    max(
        CASE
            WHEN vergleichbar THEN umsatz
            ELSE NULL::numeric
        END) OVER wp AS umsatz_bester_block,
        CASE
            WHEN vergleichbar THEN round(umsatz - max(
            CASE
                WHEN vergleichbar THEN umsatz
                ELSE NULL::numeric
            END) OVER wp, 2)
            ELSE NULL::numeric
        END AS rueckstand_bestwert,
        CASE
            WHEN vergleichbar THEN round(100.0 * (umsatz - max(
            CASE
                WHEN vergleichbar THEN umsatz
                ELSE NULL::numeric
            END) OVER wp) / NULLIF(max(
            CASE
                WHEN vergleichbar THEN umsatz
                ELSE NULL::numeric
            END) OVER wp, 0::numeric), 1)
            ELSE NULL::numeric
        END AS rueckstand_bestwert_pct,
    lag(delta_pro_tag_pct) OVER w AS delta_pro_tag_pct_vorblock,
        CASE
            WHEN delta_pro_tag_pct IS NULL OR lag(delta_pro_tag_pct) OVER w IS NULL THEN NULL::text
            WHEN delta_pro_tag_pct = 0::numeric AND lag(delta_pro_tag_pct) OVER w = 0::numeric THEN 'unveraendert'::text
            WHEN delta_pro_tag_pct < 0::numeric AND lag(delta_pro_tag_pct) OVER w < 0::numeric THEN 'fallend'::text
            WHEN delta_pro_tag_pct > 0::numeric AND lag(delta_pro_tag_pct) OVER w > 0::numeric THEN 'steigend'::text
            ELSE 'gemischt'::text
        END AS trend,
    delta_pro_tag_pct < '-5'::integer::numeric AND lag(delta_pro_tag_pct) OVER w < '-5'::integer::numeric AS trend_deutlich,
    offene_chats,
    offene_chats_tage
   FROM mit_delta
  WINDOW w AS (PARTITION BY model ORDER BY block_start), wp AS (PARTITION BY model);

-- ── lyra.model_monat ──
create or replace view lyra.model_monat as
 WITH spanne AS (
         SELECT model_tag.model,
            min(model_tag.datum) AS von,
            max(model_tag.datum) AS bis
           FROM lyra.model_tag
          WHERE model_tag.model IS NOT NULL
          GROUP BY model_tag.model
        ), gitter AS (
         SELECT s.model,
            m.monat_start,
            m.monat_ende,
            m.monat_label,
            m.tage_im_monat,
            m.ist_laufend,
            m.fenster_tage
           FROM spanne s
             JOIN lyra.monat_raster m ON m.monat_ende >= s.von AND m.monat_start <= s.bis
        ), fakten AS (
         SELECT g.model,
            g.monat_start,
            g.monat_ende,
            g.monat_label,
            g.tage_im_monat,
            g.ist_laufend,
            g.fenster_tage,
            COALESCE(sum(t.umsatz), 0::numeric) AS umsatz,
            count(DISTINCT t.datum) AS tage_mit_daten,
            COALESCE(sum(t.umsatz) FILTER (WHERE EXTRACT(day FROM t.datum) <= g.fenster_tage::numeric), 0::numeric) AS umsatz_fenster,
            count(DISTINCT t.datum) FILTER (WHERE EXTRACT(day FROM t.datum) <= g.fenster_tage::numeric) AS fenster_tage_mit_daten,
            count(DISTINCT t.account) AS accounts,
            COALESCE(sum(t.neue_subs), 0::numeric) AS neue_subs,
            COALESCE(sum(t.verkaufende_chats), 0::numeric) AS verkaufende_chats,
            bool_or(t.model_aktiv) AS model_aktiv,
            sum(t.offene_chats) AS offene_chats,
            count(DISTINCT t.datum) FILTER (WHERE t.offene_chats IS NOT NULL) AS offene_chats_tage
           FROM gitter g
             LEFT JOIN lyra.model_tag t ON t.model = g.model AND t.datum >= g.monat_start AND t.datum <= g.monat_ende
          GROUP BY g.model, g.monat_start, g.monat_ende, g.monat_label, g.tage_im_monat, g.ist_laufend, g.fenster_tage
        ), mit_prev AS (
         SELECT f.model,
            f.monat_start,
            f.monat_ende,
            f.monat_label,
            f.tage_im_monat,
            f.ist_laufend,
            f.fenster_tage,
            f.umsatz,
            f.tage_mit_daten,
            f.umsatz_fenster,
            f.fenster_tage_mit_daten,
            f.accounts,
            f.neue_subs,
            f.verkaufende_chats,
            f.model_aktiv,
            f.offene_chats,
            f.offene_chats_tage,
            round(f.umsatz / NULLIF(f.tage_mit_daten, 0)::numeric, 2) AS umsatz_pro_tag,
            NOT f.ist_laufend AND f.tage_mit_daten::numeric >= (0.9 * f.tage_im_monat::numeric) AS vergleichbar,
            lag(f.umsatz) OVER w AS umsatz_vormonat,
            lag(round(f.umsatz / NULLIF(f.tage_mit_daten, 0)::numeric, 2)) OVER w AS pro_tag_vormonat,
            lag(NOT f.ist_laufend AND f.tage_mit_daten::numeric >= (0.9 * f.tage_im_monat::numeric)) OVER w AS vormonat_vergleichbar,
            lag(f.umsatz_fenster) OVER w AS umsatz_fenster_vormonat,
            lag(f.fenster_tage_mit_daten) OVER w AS fenster_tage_vormonat
           FROM fakten f
          WINDOW w AS (PARTITION BY f.model ORDER BY f.monat_start)
        ), mit_delta AS (
         SELECT p.model,
            p.monat_start,
            p.monat_ende,
            p.monat_label,
            p.tage_im_monat,
            p.ist_laufend,
            p.fenster_tage,
            p.umsatz,
            p.tage_mit_daten,
            p.umsatz_fenster,
            p.fenster_tage_mit_daten,
            p.accounts,
            p.neue_subs,
            p.verkaufende_chats,
            p.model_aktiv,
            p.offene_chats,
            p.offene_chats_tage,
            p.umsatz_pro_tag,
            p.vergleichbar,
            p.umsatz_vormonat,
            p.pro_tag_vormonat,
            p.vormonat_vergleichbar,
            p.umsatz_fenster_vormonat,
            p.fenster_tage_vormonat,
                CASE
                    WHEN p.vergleichbar AND p.vormonat_vergleichbar THEN round(100.0 * (p.umsatz - p.umsatz_vormonat) / NULLIF(p.umsatz_vormonat, 0::numeric), 1)
                    ELSE NULL::numeric
                END AS delta_voll_pct,
                CASE
                    WHEN p.vergleichbar AND p.vormonat_vergleichbar THEN round(100.0 * (p.umsatz_pro_tag - p.pro_tag_vormonat) / NULLIF(p.pro_tag_vormonat, 0::numeric), 1)
                    ELSE NULL::numeric
                END AS delta_pro_tag_pct,
                CASE
                    WHEN p.fenster_tage_mit_daten = p.fenster_tage_vormonat AND p.fenster_tage_mit_daten > 0 THEN round(100.0 * (p.umsatz_fenster - p.umsatz_fenster_vormonat) / NULLIF(p.umsatz_fenster_vormonat, 0::numeric), 1)
                    ELSE NULL::numeric
                END AS delta_fenster_pct
           FROM mit_prev p
        )
 SELECT model,
    monat_label,
    monat_start,
    monat_ende,
    ist_laufend,
    tage_mit_daten,
    tage_im_monat,
    vergleichbar,
    umsatz,
    umsatz_pro_tag,
    model_aktiv,
    accounts,
    neue_subs,
    verkaufende_chats,
    umsatz_vormonat,
    delta_voll_pct,
    delta_pro_tag_pct,
    fenster_tage,
    fenster_tage_mit_daten,
    umsatz_fenster,
    umsatz_fenster_vormonat,
    delta_fenster_pct,
    lag(delta_pro_tag_pct) OVER w AS delta_pro_tag_pct_vormonat,
        CASE
            WHEN delta_pro_tag_pct IS NULL OR lag(delta_pro_tag_pct) OVER w IS NULL THEN NULL::text
            WHEN delta_pro_tag_pct = 0::numeric AND lag(delta_pro_tag_pct) OVER w = 0::numeric THEN 'unveraendert'::text
            WHEN delta_pro_tag_pct < 0::numeric AND lag(delta_pro_tag_pct) OVER w < 0::numeric THEN 'fallend'::text
            WHEN delta_pro_tag_pct > 0::numeric AND lag(delta_pro_tag_pct) OVER w > 0::numeric THEN 'steigend'::text
            ELSE 'gemischt'::text
        END AS trend,
    delta_pro_tag_pct < '-5'::integer::numeric AND lag(delta_pro_tag_pct) OVER w < '-5'::integer::numeric AS trend_deutlich,
    offene_chats,
    offene_chats_tage
   FROM mit_delta
  WINDOW w AS (PARTITION BY model ORDER BY monat_start);


-- Datenlexikon für Lyra (nur ergänzen, nichts überschreiben)
do $$
begin
  if not exists (select 1 from lyra.hinweise_basis where thema = 'offene_chats') then
    insert into lyra.hinweise_basis (thema, hinweis) values ('offene_chats',
      'offene_chats = Spalte "Open Chats" aus der CreatorHero Detailed Comparison, je Account und Tag (lyra.model_tag). '
      || 'In model_woche, model_monat und model_block als Summe je Model; offene_chats_tage sagt, an wie vielen Tagen '
      || 'ein Wert vorlag. NULL heisst: keine Angabe (nicht 0). Vergleiche Zeitraeume nur bei gleicher Zahl von offene_chats_tage. '
      || 'Erfasst ab Dashboard v5.48.0 (14.10.2026); aeltere Tage nur, soweit die alten Exporte nachgetragen wurden.');
  end if;
exception when others then
  raise notice 'Hinweis in lyra.hinweise_basis nicht eingetragen: %', sqlerrm;
end $$;

commit;

-- Prüfen:
-- select datum, account, offene_chats from lyra.model_tag order by datum desc limit 20;
-- select kw, model, offene_chats, offene_chats_tage from lyra.model_woche order by woche desc limit 20;
-- select min(datum), max(datum), count(*) from lyra.model_tag where offene_chats is not null;
-- set role lyra_readonly; select offene_chats from lyra.model_block limit 1; reset role;
