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
      'Am Handy stehen die Bereiche unten in einer Leiste: Start, Board, Kalender, Videos — Anfragen, Social und Umsatz findest du unter „Mehr".',
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
      'Oben die Begrüßung — läuft gerade eine Reise, steht sie daneben. Unter dem Status stehen: offene Content-Anfragen, dein Subs-Tracker, die nächsten Termine, eine Kurzfassung deines Boards und der Umsatz des laufenden Monats. Am Handy wechselst du unten über die Leiste zwischen Start, Board, Kalender, Videos und Mehr (Anfragen, Social, Umsatz).',
      'Der Subs-Tracker färbt die Tage nach neuen Abos ein — je dunkler, desto mehr. Du kannst monatsweise blättern und, wenn du mehrere Accounts hast, zwischen ihnen wechseln.',
    ],
    watch: [
      'Die Farben im Subs-Tracker richten sich immer nach dem besten Tag des gezeigten Monats. Zwei Monate lassen sich daran nicht vergleichen.',
      'Bei „Anstehendes" löscht das ✕ einen Termin nach einer Rückfrage.',
    ],
  },

  // ── Board ────────────────────────────────────────────────────────────────
  {
    id: 'board',
    icon: '📌',
    tab: 'board',
    title: 'Mein Board',
    short: 'Reisen, Angebot, Preise, No Gos — die Arbeitsgrundlage der Chatter.',
    body: [
      'Oben steht dein Steckbrief in vier Karten: Urlaub & Reisen, Was ich anbiete, Preise und No Gos. Das ist das, was deine Chatter am meisten brauchen — sie sehen es direkt auf ihrer Startseite.',
      'Der Balken ganz oben zeigt, was noch fehlt (Angebot beantwortet, mindestens ein Preis, No Gos, einmal im Monat bestätigt). Einmal im Monat fragt das Board „Stimmt noch alles?" — ein Tipp auf „Ja, passt" reicht.',
      'Darunter unter „Weitere Angaben" stehen wie bisher Content Regeln, Services / Pakete, Einschränkungen und Termine, und ganz unten deine Social-Media-Kanäle.',
    ],
    steps: [
      'Reise: auf „+ Reise", Ziel und Von/Bis eintragen, dann die Chips antippen — einmal = geht (grün), zweimal = geht nicht (rot), dreimal = weg. Optional ein Satz, den die Chatter Fans sagen können.',
      'Preise: auf „+ Preis", Leistung und ab-Preis eintragen, z. B. „Video" und „$40". Eine Zeile antippen zum Ändern oder Löschen.',
      'Reihenfolge: links an der Zeile auf ⋮⋮ drücken, gedrückt halten und hoch oder runter ziehen. In dieser Reihenfolge sehen es auch die Chatter.',
      'No Gos: Vorschläge (gestrichelt) antippen, um sie zu übernehmen. Rot = gilt für dich. Nochmal antippen entfernt es (mit Rückfrage). „+ eigenes" für alles andere.',
    ],
    watch: [
      'Jede Änderung sieht das Team — die Chatter bekommen sie beim nächsten Login als „Neu" angezeigt.',
      'Deine bisherigen Einträge bleiben alle stehen. Lange Sätze bei den Preisen kannst du antippen und in „Leistung" und „ab-Preis" aufteilen.',
      'Vergangene Reisen verschwinden aus der Karte, bleiben aber gespeichert („… vergangene anzeigen").',
    ],
  },

  {
    id: 'services',
    icon: '✅',
    tab: 'board',
    title: 'Was ich anbiete',
    short: 'Kacheln antippen: Audios, Video-Call, Telefon, Custom, Sexting, Bewertungen.',
    body: [
      'Jede Kachel einmal antippen = biete ich an (grün). Nochmal antippen = biete ich nicht an (durchgestrichen). „noch offen" heißt: noch nicht beantwortet.',
      'Unter „Details zu deinem Angebot" kannst du bei allem, was an ist, Preis oder Dauer dazuschreiben — das lesen die Chatter mit.',
    ],
    watch: [
      'Das Detailfeld wird gespeichert, sobald du woanders hin tippst — es gibt keinen Speichern-Knopf.',
      'Läuft gerade eine Reise, gilt für die Chatter zusätzlich, was du dort bei „geht nicht" angetippt hast.',
    ],
  },
  {
    id: 'substracker',
    icon: '📈',
    tab: 'home',
    title: 'Neue Subs',
    short: 'Wie viele neue Abos pro Tag reinkommen — mit Vergleich zum Vormonat.',
    body: [
      'Oben die neuen Subs im gezeigten Monat, daneben der Vergleich zum Vormonat. Im laufenden Monat wird fair verglichen: gleich viele Tage, also z. B. 1.–21.09. gegen 1.–21.08. Bei abgeschlossenen Monaten ganzer Monat gegen ganzen Monat. Darunter der beste Tag, der Schnitt pro Tag und die Gesamtzahl.',
      'Im Kalender leuchtet jeder Tag umso kräftiger, je mehr neue Subs er hatte. Mit ‹ › blätterst du durch die Monate; bei mehreren Accounts wechselst du oben zwischen ihnen.',
    ],
    watch: [
      'Die Zahlen kommen aus den Tagesdateien, die das Team hochlädt. Der heutige Tag steht meist erst am nächsten Morgen drin.',
      'Die Farben richten sich nach dem besten Tag des gezeigten Monats — vergleichen lassen sich Monate über die Zahl oben, nicht über die Farben.',
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
      'Oben stehen die Videos unter „Demnächst", darunter die schon „Veröffentlicht" sind. Ältere siehst du mit „Alle … anzeigen".',
    ],
    steps: [
      'Oben rechts auf „+ Neu" — ein Fenster fährt von unten hoch.',
      'Titel eintragen (Pflicht), dazu Beschreibung und „Kommt raus am".',
      'Optional „📷 Bild auswählen" für ein Vorschaubild (JPG oder PNG).',
      'Auf „Speichern".',
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
      'Oben der Wochenstreifen: Punkte zeigen, an welchen Tagen etwas ansteht. Einen Tag antippen zeigt nur diesen Tag, mit ‹ › blätterst du wochenweise.',
      'Darunter stehen deine Einträge als Karten: Überfällig (rot), Heute und Demnächst. Ältere Einträge findest du unter „… vergangene anzeigen".',
      'Urlaub trägst du nicht hier, sondern im Board unter „Urlaub & Reisen" ein — dann sehen es auch deine Chatter.',
    ],
    steps: [
      'Oben rechts auf „+ Neu".',
      'Eintragen, was ansteht, und Aufgabe, Content oder Termin antippen.',
      'Tag setzen (Pflicht), Uhrzeit und Erinnerung per Telegram optional.',
      'Auf „Speichern".',
    ],
    watch: [
      'Die Erinnerung wird ab 9 Uhr morgens am Fälligkeitstag zurückgerechnet, nicht ab der Uhrzeit im Eintrag. „1 Stunde vorher" heißt also 8 Uhr.',
      'Ohne hinterlegte Telegram-ID kommt keine Erinnerung an. Schick dem Bot einmal „/start" und gib die ID ans Team.',
      'Jede Erinnerung kommt genau einmal.',
      'Löschen fragt einmal nach und lässt sich dann nicht rückgängig machen.',
      'Einträge lassen sich nicht bearbeiten — nur löschen und neu anlegen.',
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
      'Wenn du fertig bist, tippst du auf „✓ Fertig — als erledigt melden". Dann bekommt genau der Chatter, der die Anfrage gestellt hat, sofort eine Telegram-Nachricht und kann rausschicken.',
    ],
    watch: [
      '„✓ Fertig — als erledigt melden" lässt sich nicht zurücknehmen. Erst hochladen, dann tippen.',
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
      'Oben groß die Summe des laufenden Kalendermonats in Dollar, darunter der Schnitt pro Tag (bis gestern).',
      'Hast du mehrere Accounts, siehst du unter „Nach Account" die Aufteilung als Balken.',
      'Deine Subs mit Vergleich zum Vormonat stehen im Subs-Tracker auf der Übersicht.',
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
    id: 'app',
    icon: '📲',
    tab: null,
    title: 'Als App aufs Handy',
    short: 'Icon auf den Home-Bildschirm – öffnet im Vollbild wie eine App.',
    body: [
      'Das Model-Portal lässt sich wie eine App auf den Home-Bildschirm legen: eigenes Icon, keine Browserleiste, ein Tipp zum Öffnen. Unter „Mehr“ → „Als App aufs Handy“ steht die Anleitung für iPhone und Android.',
    ],
    steps: [
      'iPhone: in Safari öffnen → Teilen → „Zum Home-Bildschirm“ → „Hinzufügen“.',
      'Android: in Chrome öffnen → ⋮ → „App installieren“ (oder direkt „Jetzt installieren“ im Fenster).',
    ],
    watch: [
      'Beim ersten Öffnen der App meldest du dich einmal neu an, danach bleibst du angemeldet.',
      'Updates kommen automatisch – nichts neu installieren. Läuft es schon als App, verschwindet die Kachel.',
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
