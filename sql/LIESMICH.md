# SQL-Ordner

Die Dateien hier sind die Baupläne der Datenbank (Tabellen, Rechte, Funktionen).
Das Dashboard selbst liest sie nie. Sie werden von Hand im Supabase SQL-Editor
ausgeführt. Löschen ändert an der Datenbank nichts, aber dann fehlt der Bauplan
für einen Neuaufbau oder zum Nachschlagen. Deshalb bleiben sie hier.

## Aufteilung

- **`sql/` (oberste Ebene):** Dateien, die noch **nicht** ausgeführt sind.
  Steht hier etwas, ist noch etwas zu tun.
- **`sql/erledigt/`:** schon in Supabase ausgeführt. Nur noch zum Nachschlagen
  oder für einen Neuaufbau. Fast alle sind wiederholbar: ein zweites Ausführen
  schadet nicht.
- **`sql/werkzeuge/`:** Abfragen zum Prüfen oder Einmal-Aktionen, keine
  Baupläne:
  - `stand-pruefen.sql`: zeigt für jede Datei, ob sie in Supabase ausgeführt
    ist (ja/NEIN). Ändert nichts.
  - `rls-selbsttest.sql`: testet die Sicherheitsregeln. Ändert nichts.
  - `analyse-massennachrichten.sql`: Auswertung vom 29.08.
  - `indre-aus-dienstplan.sql`: einmalige Aufräum-Aktion vom 29.08., nicht
    nochmal ausführen.

## Neue Dateien

Neue SQL-Dateien kommen erst in `sql/`. Sobald sie ausgeführt sind, wandern
sie nach `sql/erledigt/`. Bei Unsicherheit `werkzeuge/stand-pruefen.sql`
ausführen.
