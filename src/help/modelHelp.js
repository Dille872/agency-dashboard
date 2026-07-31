// v4.13.0 — Helpcenter für Models.
//
// Aufbau wie in chatterHelp.js — dieselben Felder, dieselben Bausteine
// (HelpDot, HelpTour, HelpFab), nur andere Inhalte. Die `tab`-Angabe ist hier
// der Wert von `activeSection` im ModelPortal ('home' | 'board' | 'videos' |
// 'kalender' | 'anfragen' | 'social' | 'umsatz') oder null = immer sichtbar.
//
// WICHTIG bei Änderungen am Portal: Wenn sich ein Ablauf ändert, hier
// nachziehen. Eine falsche Erklärung ist schlimmer als keine.
// `npm run check:help` meldet Bereiche ohne Thema und Themen ohne Bereich.

export const HELP_TOPICS = [
  // ── Grundlagen ───────────────────────────────────────────────────────────
  {
    id: 'ueberblick',
    icon: '👋',
    tab: null,
    title: 'Willkommen in deinem Portal',
    short: 'Hier steht alles, was das Team über dich wissen muss.',
    body: [
      'Dein Portal ist die Verbindung zwischen dir und den Chattern, die für dich schreiben. Was du hier einträgst — Preise, No Gos, Regeln — ist für sie verbindlich. Sie sehen es sofort.',
      'Umgekehrt landen hier die Aufträge, die für dich reinkommen, deine Termine und deine Umsatzzahlen.',
      'Wenn du irgendwo nicht weiterweißt: Unten rechts über der Glocke sitzt ein „?" — dort findest du alle Erklärungen. Und neben jeder Bereichsüberschrift steht ein kleines „?" zu genau diesem Bereich.',
    ],
    watch: [
      'Je genauer dein Board gepflegt ist, desto weniger Rückfragen bekommst du. Die meiste Zeit sparst du dir mit einer halben Stunde am Anfang.',
    ],
  },
  {
    id: 'navigation',
    icon: '🧭',
    tab: null,
    title: 'Die sieben Bereiche',
    short: 'Übersicht · Mein Board · Videos · Kalender · Anfragen · Social · Umsatz.',
    body: [
      'Übersicht — dein Startpunkt: Status, Aufgaben, offene Anfragen, anstehende Termine, Umsatz.',
      'Mein Board — deine Regeln und Preise. Das lesen die Chatter.',
      'Videos — was du veröffentlichst, mit Vorschaubild und Datum.',
      'Kalender — deine Termine und Fristen, mit Erinnerung per Telegram.',
      'Anfragen — Aufträge, die Chatter für Kunden bei dir bestellen.',
      'Social — Beiträge freigeben, die das Team für dich vorbereitet hat.',
      'Umsatz — was im laufenden Monat zusammengekommen ist.',
    ],
    watch: [
      'Die Zahlen an den Knöpfen zeigen, wo etwas Neues oder Offenes liegt.',
      'Achtung beim Klick auf „Mein Board": Damit gilt neuer Custom Content sofort als gelesen, auch wenn du nicht hingeschaut hast.',
    ],
  },
  {
    id: 'status',
    icon: '🟢',
    tab: 'home',
    title: 'Dein Status',
    short: 'Sag dem Team, ob du gerade verfügbar bist.',
    body: [
      'Ganz oben steht dein Status: verfügbar (grün), Pause (orange) oder nicht verfügbar (rot). Die Chatter und das Team sehen ihn sofort — daran richten sie aus, was sie Kunden versprechen.',
      'Bei Pause und „Nicht verfügbar" kannst du eine Uhrzeit angeben, bis wann. Die Notiz daneben ist nur für das Team, kein Kunde sieht sie.',
    ],
    steps: [
      'Auf „Pause" oder „Nicht verfügbar" tippen.',
      'Uhrzeit eintragen, bis wann — oder leer lassen, wenn du es offen halten willst.',
      'Optional eine Notiz fürs Team, dann bestätigen.',
      'Zum Zurückmelden auf „Wieder verfügbar" tippen.',
    ],
    watch: [
      'Die Uhrzeit ist ohne Datum. Trägst du um 14 Uhr „bis 08:00" ein, meint das morgen früh.',
      'Ohne Uhrzeit gilt der Status unbefristet, bis du ihn selbst zurücksetzt.',
      'Mit Uhrzeit stellt sich der Status von allein wieder auf verfügbar — du musst dich nicht zurückmelden.',
      '„Wieder verfügbar" löscht auch deine Notiz.',
      'Das geht auch per Telegram an den Bot: „verfügbar", „nicht verfügbar", „pause bis 18", „zurück".',
    ],
  },
  {
    id: 'todos',
    icon: '📋',
    tab: 'home',
    title: 'Meine Aufgaben',
    short: 'Was das Team dir persönlich zugeteilt hat.',
    body: [
      'Aufgaben, die auf deinen Namen laufen — mit Priorität und dem Namen dessen, der sie erstellt hat. Der Bereich erscheint nur, wenn es überhaupt Aufgaben gibt.',
    ],
    steps: [
      'Erledigt? Kästchen antippen. Das Team bekommt sofort eine Telegram-Nachricht.',
      'Du hast eine Rückfrage? „+ Rückmeldung" antippen und schreiben — das geht ebenfalls direkt ans Team.',
    ],
    watch: [
      'Sobald du die Übersicht offen hattest, gilt die Aufgabe als von dir gelesen. Abhaken musst du trotzdem selbst.',
      'Jedes erneute Abhaken schickt wieder eine Nachricht — bitte nicht zum Spaß hin und her klicken.',
    ],
  },
  {
    id: 'home',
    icon: '🏠',
    tab: 'home',
    title: 'Die Übersicht',
    short: 'Alles Wichtige auf einen Blick — Anfragen, Termine, Subs, Umsatz.',
    body: [
      'Unter dem Status stehen: offene Content-Anfragen, dein Subs-Tracker als Monatskalender, die nächsten Termine, eine Kurzfassung deines Boards und der Umsatz des laufenden Monats.',
      'Der Subs-Tracker färbt die Tage nach neuen Abos ein — je dunkler, desto mehr. Du kannst monatsweise blättern und, wenn du mehrere Accounts hast, zwischen ihnen wechseln.',
    ],
    watch: [
      'Die Farben im Subs-Tracker richten sich immer nach dem besten Tag des gezeigten Monats. Zwei Monate lassen sich daran nicht vergleichen.',
      'Bei „Anstehendes" löscht das ✕ einen Termin sofort und ohne Rückfrage.',
    ],
  },

  // ── Board ────────────────────────────────────────────────────────────────
  {
    id: 'board',
    icon: '📌',
    tab: 'board',
    title: 'Mein Board',
    short: 'Deine Regeln und Preise — die Arbeitsgrundlage der Chatter.',
    body: [
      'Sieben Kategorien: Preisstruktur, No Gos, Content Regeln, Services / Pakete, Einschränkungen, Reiseplan und Termine. Jeder Eintrag hat einen Titel, optional eine Beschreibung und einen Preis.',
      'Das ist der wichtigste Bereich für dich. Die Chatter schlagen hier nach, bevor sie einem Kunden etwas zusagen. Was hier nicht steht, wissen sie nicht.',
      'Besonders die No Gos: Alles, was du auf keinen Fall willst, gehört dort hinein — lieber einmal zu viel aufgeschrieben.',
    ],
    steps: [
      'Bei der passenden Kategorie auf „+ Hinzufügen".',
      'Titel eintragen (Pflicht), dazu Beschreibung und Preis, wenn es passt.',
      'Beim Reiseplan gibt es zusätzlich „Von" und „Bis".',
      'Mit ✎ änderst du einen Eintrag später, mit ✕ löschst du ihn.',
    ],
    watch: [
      'Löschen geht sofort und ohne Rückfrage.',
      'Jede Änderung sieht das Team im Aktivitäts-Feed — das ist gewollt, damit niemand mit veralteten Regeln arbeitet.',
      'Reise-Einträge, deren „Bis"-Datum vorbei ist, werden ausgegraut und als abgelaufen markiert, bleiben aber stehen. Ab und zu aufräumen lohnt sich.',
      'Der Preis ist ein Textfeld — du kannst also auch „ab 50" oder „auf Anfrage" schreiben.',
    ],
  },
  {
    id: 'services',
    icon: '✅',
    tab: 'board',
    title: 'Services',
    short: 'Vier Ja/Nein-Fragen: Bewertungen, Audios, Video Chat, Telefonieren.',
    body: [
      'Hier legst du mit einem Klick fest, was du grundsätzlich anbietest. Bei „Ja" erscheint ein Feld für Preis, Dauer oder Details — das lesen die Chatter mit.',
    ],
    watch: [
      'Das Detailfeld wird gespeichert, sobald du woanders hin tippst — es gibt keinen Speichern-Knopf.',
      'Stellst du von „Ja" auf „Nein", verschwindet das Feld, der Text bleibt aber gespeichert. Bei erneutem „Ja" steht er wieder da.',
    ],
  },
  {
    id: 'customcontent',
    icon: '🎬',
    tab: 'board',
    title: 'Custom Content',
    short: 'Deine eigene Liste dessen, was noch zu produzieren ist.',
    body: [
      'Hier stehen Custom-Aufträge mit Titel, Beschreibung und Fälligkeitsdatum. Farbe zeigt den Stand: orange offen, rot überfällig, grün erledigt.',
      'Du kannst auch selbst Einträge anlegen — als Merkzettel für Sachen, die du noch drehen willst.',
    ],
    steps: [
      'Auf „+ Neu", Titel eintragen (Pflicht).',
      'Beschreibung, Fälligkeitsdatum und Erinnerung ergänzen.',
      'Speichern. Ist ein Datum gesetzt, landet der Eintrag automatisch auch in deinem Kalender.',
      'Fertig? Eintrag aufklappen und „Als erledigt markieren".',
    ],
    watch: [
      'Erledigt ist endgültig — du kannst einen Eintrag danach nicht wieder öffnen.',
      'Löschst du einen Eintrag, bleibt der automatisch erzeugte Kalendereintrag stehen. Den musst du separat löschen.',
    ],
  },
  {
    id: 'sociallinks',
    icon: '🔗',
    tab: 'board',
    title: 'Social Media Kanäle',
    short: 'Deine Profil-Links, damit die Chatter sie weitergeben können.',
    body: [
      'Instagram, TikTok, OnlyFans und so weiter. Plattform auswählen, Link einfügen, fertig. Fehlt das „https://", ergänzt das Portal es selbst.',
    ],
    watch: [
      'Nicht zu verwechseln mit dem Bereich „Social" — dort gibst du Beiträge frei, hier pflegst du nur die Links.',
      'Löschen geht ohne Rückfrage.',
    ],
  },

  // ── Weitere Bereiche ─────────────────────────────────────────────────────
  {
    id: 'videos',
    icon: '📹',
    tab: 'videos',
    title: 'Videos',
    short: 'Was du veröffentlichst — mit Vorschaubild und Release-Datum.',
    body: [
      'Trag hier ein, welche Videos anstehen oder erschienen sind. Die Chatter sehen die Liste und können Kunden darauf ansprechen.',
    ],
    steps: [
      'Auf „+ Neues Video eintragen".',
      'Titel eintragen (Pflicht), dazu Beschreibung und Release-Datum.',
      'Optional ein Vorschaubild auswählen (JPG oder PNG).',
      'Speichern.',
    ],
    watch: [
      'Hier wird nur ein Vorschaubild hochgeladen, nicht das Video selbst.',
      'Das Bild liegt danach öffentlich abrufbar im Speicher — nimm nichts, was nicht nach außen darf.',
      'Löschen entfernt den Eintrag, das hochgeladene Bild bleibt im Speicher liegen.',
    ],
  },
  {
    id: 'kalender',
    icon: '📅',
    tab: 'kalender',
    title: 'Kalender',
    short: 'Termine und Fristen — mit Erinnerung per Telegram.',
    body: [
      'Vier Kategorien: Aufgabe, Content, Termin und Reise. Zu jedem Eintrag kannst du eine Erinnerung setzen, die dir der Bot per Telegram schickt.',
      'Überfällige Einträge sind rot markiert, heutige grün.',
    ],
    steps: [
      'Titel eintragen und Kategorie wählen.',
      'Fälliges Datum setzen (Pflicht), Uhrzeit optional.',
      'Erinnerung wählen — von 1 Stunde bis 2 Tage vorher.',
      'Auf „+ Eintrag speichern".',
    ],
    watch: [
      'Die Erinnerung wird ab 9 Uhr morgens am Fälligkeitstag zurückgerechnet, nicht ab der Uhrzeit im Eintrag. „1 Stunde vorher" heißt also 8 Uhr.',
      'Ohne hinterlegte Telegram-ID kommt keine Erinnerung an. Schick dem Bot einmal „/start" und gib die ID ans Team.',
      'Jede Erinnerung kommt genau einmal.',
      'Einträge lassen sich nicht bearbeiten — nur löschen und neu anlegen. Löschen geht ohne Rückfrage.',
    ],
  },
  {
    id: 'anfragen',
    icon: '📥',
    tab: 'anfragen',
    title: 'Anfragen',
    short: 'Aufträge, die Chatter für Kunden bei dir bestellen.',
    body: [
      'Oben die aktiven Aufträge, darunter die erledigten. Zu jedem siehst du, was gewünscht ist, von welchem Chatter er kommt, für welchen Kunden, den Preis und wie dringend es ist.',
      'Ist etwas angezahlt oder schon bezahlt, steht das im Balken darunter — inklusive Hinweis, wenn ein Restbetrag überfällig ist.',
      'Wenn du fertig bist, tippst du auf „✓ Erledigt". Dann bekommt genau der Chatter, der die Anfrage gestellt hat, sofort eine Telegram-Nachricht und kann rausschicken.',
    ],
    watch: [
      '„✓ Erledigt" lässt sich nicht zurücknehmen. Erst hochladen, dann klicken.',
      'Hier stehen nur Aufträge, die das Team bestätigt hat. Was noch in Prüfung ist, siehst du nicht — es kann also sein, dass die Glocke etwas meldet, das hier noch nicht auftaucht.',
      'Am Bezahlstatus kannst du nichts ändern, den pflegt das Team.',
      'Einen Auftrag ablehnen kannst du hier nicht — wenn etwas gegen deine Regeln geht, schreib dem Team.',
    ],
  },
  {
    id: 'social',
    icon: '📱',
    tab: 'social',
    title: 'Social',
    short: 'Beiträge freigeben, die das Team für dich vorbereitet hat.',
    body: [
      'Hat das Team einen Post vorbereitet, steht er unter „Freigabe ausstehend" mit Plattform, geplantem Zeitpunkt und einem Link zum Material. Du gibst frei oder lehnst ab.',
      'Darunter siehst du deine Accounts und die zuletzt veröffentlichten Beiträge mit Aufrufzahlen.',
    ],
    watch: [
      'Beim Ablehnen kannst du keine Begründung mitgeben — schreib sie dem Team kurz in den Chat, sonst weiß niemand warum.',
      'Deine Profil-Links pflegst du nicht hier, sondern unter „Mein Board".',
    ],
  },
  {
    id: 'umsatz',
    icon: '💰',
    tab: 'umsatz',
    title: 'Umsatz',
    short: 'Was im laufenden Monat zusammengekommen ist.',
    body: [
      'Die Summe des laufenden Kalendermonats in Dollar. Hast du mehrere Accounts, siehst du zusätzlich die Aufteilung.',
    ],
    watch: [
      'Nur der laufende Monat — es gibt keine Historie und kein Zurückblättern.',
      'Die Zahl kommt aus einem Export, den das Team täglich hochlädt. Sie ist also nie live.',
      'Das sind Roh-Umsätze, keine Auszahlung.',
    ],
  },

  // ── Kommunikation ────────────────────────────────────────────────────────
  {
    id: 'bell',
    icon: '🔔',
    tab: null,
    title: 'Die Glocke',
    short: 'Neue Anfragen, Custom Content, Aufgaben, Termine, Board-Änderungen.',
    body: [
      'Die Glocke unten rechts sammelt alles Neue der letzten 14 Tage. Mit den Filtern oben schränkst du auf Anfragen, Aufgaben, Termine oder Board ein.',
      'Unter „Board" siehst du Änderungen, die das Team an deinem Board gemacht hat — da lohnt ein Blick, damit du weißt, was gerade gilt.',
    ],
    watch: [
      'Offene Anfragen, ungelesener Custom Content und Termine heute oder morgen bleiben ungelesen, bis du reagiert hast — „Alles gelesen" räumt sie absichtlich nicht weg.',
      'Der Gelesen-Stand hängt am Gerät. Auf dem Handy und am Rechner zählt er getrennt.',
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    tab: null,
    title: 'Chat mit dem Team',
    short: 'Direkter Draht — dasselbe Gespräch wie über Telegram.',
    body: [
      'Der Knopf ganz unten rechts öffnet deinen Chat mit dem Team. Egal ob du hier oder über Telegram schreibst: Es ist derselbe Verlauf.',
      'Das Team bekommt sofort eine Benachrichtigung.',
    ],
    watch: [
      'Nur Text — Bilder kannst du hier nicht schicken, dafür nimm Telegram.',
      'Nachrichten lassen sich nicht bearbeiten oder löschen.',
    ],
  },
  {
    id: 'bot',
    icon: '🤖',
    tab: 'home',
    title: 'Telegram-Bot',
    short: 'Status setzen geht auch per Nachricht an den Bot.',
    body: [
      'Schreib dem Bot „verfügbar", „nicht verfügbar", „pause bis 18" oder „zurück" — das wirkt genauso wie der Status oben im Portal. Mit „/start" zeigt er dir deine Telegram-ID.',
    ],
    watch: [
      'Deine Telegram-ID muss beim Team hinterlegt sein, sonst erkennt der Bot dich nicht — und du bekommst auch keine Kalender-Erinnerungen.',
    ],
  },
]

export const HELP_BY_ID = Object.fromEntries(HELP_TOPICS.map(t => [t.id, t]))

// Einführung für neue Models — bewusst kürzer als die Themenliste.
export const TOUR_IDS = [
  'ueberblick',
  'status',
  'navigation',
  'board',
  'anfragen',
  'kalender',
  'videos',
  'bell',
]
