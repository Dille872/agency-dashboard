-- ============================================================================
-- v4.31.0 · Model-Einzeldateien: Umsatz je Chatter × Model × Tag
--
-- WARUM DIESE TABELLE
-- Die beiden bestehenden Uploads liefern Tagessummen: model_snapshots kennt den
-- Umsatz je Model, chatter_snapshots den Umsatz je Chatter. Eine Brücke zwischen
-- beiden gab es nicht — "welcher Chatter hat bei welchem Model wie viel gemacht"
-- war aus dem Datenbestand nicht beantwortbar (shift_logs.model_names ist beim
-- Portal-Check-in leer und enthält beim Bot IDs statt csv_name).
--
-- Diese Tabelle schließt genau diese Lücke. Befüllt wird sie aus den
-- Einzel-Exporten des OF-Tools ("Chatter Leaderboard", gefiltert auf ein Model).
--
-- BEWUSST ECHTE SPALTEN, KEIN JSONB
-- model_snapshots/chatter_snapshots legen alles als JSONB-Blob pro Tag ab. Das ist
-- historisch gewachsen und macht jede Auswertung zur Entpack-Übung. Hier fangen wir
-- neu an, also mit normalen Spalten: Aggregate sind damit reines SQL und Lyra kann
-- ohne Umweg darauf lesen.
--
-- EINMALIG IM SUPABASE-SQL-EDITOR AUSFÜHREN.
-- ============================================================================

CREATE TABLE IF NOT EXISTS model_chatter_daily (
  id            bigserial PRIMARY KEY,
  business_date date        NOT NULL,

  -- Model-Seite. creator ist der Schlüssel, weil model_aliases.csv_name genau
  -- darauf zeigt und die gesamte Gruppierung Account → Model daran hängt.
  creator       text        NOT NULL,
  of_name       text,

  -- Chatter-Seite. Schreibweise wie in der Komplett-Chatter-CSV, passt damit
  -- direkt auf chatter_aliases.csv_name.
  chatter_name  text        NOT NULL,

  -- Kennzahlen dieses Chatters BEI DIESEM MODEL an diesem Tag.
  revenue               numeric NOT NULL DEFAULT 0,
  sent_messages         integer NOT NULL DEFAULT 0,
  sent_ppvs             integer NOT NULL DEFAULT 0,
  bought_ppvs           integer NOT NULL DEFAULT 0,
  avg_response_seconds  numeric NOT NULL DEFAULT 0,
  active_minutes        integer,
  inactive_minutes      integer,

  -- Herkunft
  file_name   text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  user_id     uuid,

  -- Ein Chatter kommt je Model und Tag genau einmal vor. Ein erneuter Upload
  -- derselben Datei korrigiert damit, statt zu duplizieren.
  CONSTRAINT model_chatter_daily_unique UNIQUE (business_date, creator, chatter_name)
);

CREATE INDEX IF NOT EXISTS model_chatter_daily_date_idx    ON model_chatter_daily (business_date);
CREATE INDEX IF NOT EXISTS model_chatter_daily_creator_idx ON model_chatter_daily (creator);
CREATE INDEX IF NOT EXISTS model_chatter_daily_chatter_idx ON model_chatter_daily (chatter_name);

-- ── Fallstricke als Spaltenkommentar, damit sie am Objekt kleben ────────────

COMMENT ON COLUMN model_chatter_daily.revenue IS
  'Message Revenue dieses Chatters bei diesem Model. ACHTUNG: das Chatter-Leaderboard '
  'des OF-Tools enthaelt NUR Message Revenue — Subs und Tips sind darin nicht abgebildet. '
  'Die Summe je Model trifft deshalb model_snapshots.rows[].messageRevenue, NICHT .revenue. '
  'Am 22.08.2026 waren das 3.833 von 4.714 $ Gesamtumsatz, also rund 81 %.';

COMMENT ON COLUMN model_chatter_daily.active_minutes IS
  '⚠️ NIEMALS ueber mehrere Models aufaddieren. Das OF-Tool meldet die Aktivzeit je Model '
  'ueberlappend: Max stand am 22.08.2026 sowohl in der Elina-Datei als auch in der '
  'Komplett-Datei mit exakt 280 Minuten. Eine Summe ueber die Einzeldateien ergibt ein '
  'Vielfaches der echten Arbeitszeit und wuerde $/Schichtstunde in chatterTargets.js ruinieren. '
  'Arbeitszeiten kommen ausschliesslich aus chatter_snapshots.';

COMMENT ON COLUMN model_chatter_daily.creator IS
  'Schreibweise wie in model_snapshots.rows[].creator — Bindeglied zu model_aliases.csv_name.';

COMMENT ON COLUMN model_chatter_daily.of_name IS
  'OnlyFans-Handle aus der Vergleichsdatei (z. B. chiarabelleme). Eindeutig, ASCII, emojifrei — '
  'der stabilere Schluessel. Kann bei Tagen fehlen, deren Model-CSV vor v4.31.0 hochgeladen wurde.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Strenger als bei model_snapshots (dort: Lesen offen). Diese Tabelle liest nur
-- das Admin-Dashboard, deshalb gibt es keinen Grund sie breiter zu oeffnen.
-- Lyra ist davon nicht betroffen: deren Views gehoeren postgres und laufen mit
-- security_invoker = false, umgehen die RLS der Basistabelle also ohnehin.

ALTER TABLE model_chatter_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff liest model_chatter_daily"    ON model_chatter_daily;
DROP POLICY IF EXISTS "staff schreibt model_chatter_daily" ON model_chatter_daily;

CREATE POLICY "staff liest model_chatter_daily"
  ON model_chatter_daily FOR SELECT
  USING (is_staff());

CREATE POLICY "staff schreibt model_chatter_daily"
  ON model_chatter_daily FOR ALL
  USING (is_staff())
  WITH CHECK (is_staff());

-- ── Kontrollabfragen ────────────────────────────────────────────────────────

-- 1) Abgleich je Tag und Account: erfasste Summe gegen Message Revenue der
--    Vergleichsdatei. Die Spalte differenz muss 0,00 sein.
--
-- SELECT d.business_date,
--        d.creator,
--        round(sum(d.revenue)::numeric, 2)                       AS erfasst,
--        round((r->>'messageRevenue')::numeric, 2)               AS laut_vergleichsdatei,
--        round(sum(d.revenue)::numeric - (r->>'messageRevenue')::numeric, 2) AS differenz
--   FROM model_chatter_daily d
--   JOIN model_snapshots s ON s.business_date = d.business_date
--   CROSS JOIN LATERAL jsonb_array_elements(s.rows) r
--  WHERE r->>'creator' = d.creator
--  GROUP BY d.business_date, d.creator, r
-- HAVING abs(sum(d.revenue) - (r->>'messageRevenue')::numeric) > 0.011
--  ORDER BY d.business_date DESC;

-- 2) Accounts mit Umsatz, fuer die an einem Tag keine Einzeldatei vorliegt.
--
-- SELECT s.business_date,
--        r->>'creator'                             AS creator,
--        round((r->>'messageRevenue')::numeric, 2) AS nicht_erfasst
--   FROM model_snapshots s
--   CROSS JOIN LATERAL jsonb_array_elements(s.rows) r
--  WHERE (r->>'messageRevenue')::numeric > 0
--    AND NOT EXISTS (
--          SELECT 1 FROM model_chatter_daily d
--           WHERE d.business_date = s.business_date
--             AND d.creator = r->>'creator')
--  ORDER BY s.business_date DESC, nicht_erfasst DESC;

-- 3) Erfasste Accounts ohne Alias-Zeile — fallen aus jeder nach model_name
--    gruppierten Auswertung heraus.
--
-- SELECT DISTINCT d.creator
--   FROM model_chatter_daily d
--   LEFT JOIN model_aliases a ON a.csv_name = d.creator
--  WHERE a.id IS NULL;
