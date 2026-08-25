// v4.9.0 — Helpcenter für neue Chatter.
//
// Warum eine eigene Datei: Die Erklärtexte gehören nicht in die 3000-Zeilen-Datei
// ChatterPortal.jsx. Hier stehen sie zentral, die Oberfläche zieht sie über die
// `id` — sowohl die kleinen ?-Symbole (HelpDot) als auch die Einführungs-Tour
// (HelpTour) und die Liste im Tab „Mehr".
//
// Bewusst NICHT in Supabase: Die Texte ändern sich nur, wenn sich das Dashboard
// ändert — also ohnehin nur bei einem Deploy. Eine Tabelle + Editor wäre Pflege
// ohne Nutzen. Wer den Text ändern will, ändert ihn hier.
//
// Aufbau eines Themas:
//   id      Schlüssel, mit dem HelpDot/Tour das Thema holen. Gleichzeitig der
//           Wert des data-help-Attributs an der Stelle in der Oberfläche.
//   tab     In welchem Tab das Thema sitzt ('heute'|'models'|'content'|'orga'|
//           'mehr') oder null = immer sichtbar.
//   short   Ein Satz. Steht in der Übersichtsliste und als Vorspann im Fenster.
//   body    Fließtext-Absätze.
//   steps   „So geht's" — nummerierte Handgriffe. Optional.
//   watch   „Wichtig zu wissen" — Fallstricke, Regeln, was nicht rückgängig geht.
//
// WICHTIG bei Änderungen am Portal: Wenn sich ein Ablauf ändert, hier
// nachziehen. Eine falsche Erklärung ist schlimmer als keine.

export const HELP_TOPICS = [
  // ── Grundlagen ───────────────────────────────────────────────────────────
  {
    id: 'ueberblick',
    icon: '👋',
    tab: null,
    title: 'Willkommen im Chatter-Portal',
    short: 'Dein Arbeitsplatz: Schicht starten, Models nachschlagen, Anfragen stellen.',
    body: [
      'Das Portal ist die Anlaufstelle für alles rund um deine Schicht. Du startest hier deine Schicht, siehst deinen Dienstplan, schlägst nach was bei „deinen" Models erlaubt ist, stellst Content-Anfragen und meldest dich beim Team.',
      'Alles was du hier machst, sieht das Team sofort — du musst nichts zusätzlich per Telegram melden. Umgekehrt erreichen dich Neuigkeiten über die Glocke unten rechts.',
      'Wenn du irgendwo nicht weiterweißt: Unten rechts über der Glocke sitzt ein „?" — dort findest du alle Erklärungen. Und neben jeder Bereichsüberschrift steht ein kleines „?" mit der Erklärung genau zu diesem Bereich.',
    ],
    watch: [
      'Das Portal ersetzt nicht die Absprache im Team-Chat — es ergänzt sie. Bei allem Dringenden: kurz schreiben.',
    ],
  },
  {
    id: 'tabs',
    icon: '🧭',
    tab: null,
    title: 'Die fünf Reiter',
    short: 'Heute · Models · Content · Organisation · Mehr — so ist alles sortiert.',
    body: [
      '📅 Heute — deine Schicht: Aufgaben, Dienstplan der nächsten 7 Tage, Schichtnotiz.',
      '🎬 Models — womit du arbeitest: Nachrichten-Vorschläge und die Steckbriefe deiner Models.',
      '📥 Content — Produktion: Custom-Anfragen stellen, Kunden-Historie, Content-Ideen.',
      '🗂️ Organisation — Planung: Abwesenheiten eintragen, Schicht zum Tausch anbieten.',
      '📚 Mehr — Nachschlagewerk: Guidelines, deine Stats, Bot-Befehle, Pinnwand-Verlauf, diese Hilfe.',
    ],
    watch: [
      'Der zuletzt gewählte Reiter wird gemerkt — beim nächsten Öffnen landest du wieder dort.',
      'Rote und lila Zahlen an den Reitern zeigen, wo etwas offen ist.',
    ],
  },

  // ── Schicht ──────────────────────────────────────────────────────────────
  {
    id: 'schichtleiste',
    icon: '🟢',
    tab: null,
    title: 'Ein- und Auschecken',
    short: 'Die Leiste ganz oben ist dein Stempeluhr-Ersatz.',
    body: [
      'Sobald du für heute eingeteilt bist, klebt oben eine Leiste mit deiner Schicht. „⚪ Schicht noch nicht gestartet" heißt: bitte einchecken. „🟢 Schicht aktiv" heißt: alles gut, das Team sieht dich als online.',
      'Einchecken kannst du ab 4 Stunden vor Schichtbeginn. Die Uhrzeiten rechnet das Portal automatisch in deine lokale Zeit um — auch wenn du gerade nicht in Deutschland bist.',
    ],
    steps: [
      'Oben auf „Schicht starten" tippen. Hast du an dem Tag mehrere Schichten, wähl vorher im Auswahlfeld die richtige — sonst bleibt der Knopf grau.',
      'Am Ende der Schicht auf „Schicht beenden" tippen. Es öffnet sich die Schichtübergabe.',
      'Übergabe: Steht etwas an, das die nächste Schicht wissen muss — ein angefangenes Gespräch, ein offener Custom, eine Besonderheit bei einem Model — schreib es dort hinein und wähl „Übergeben & beenden". Wenn nichts ansteht, „Ohne Übergabe beenden".',
      'Wer nach dir eincheckt, bekommt deine Übergabe angezeigt und muss sie mit „Gelesen & verstanden" bestätigen. Erst dann verschwindet sie.',
      'Zusätzlich geht sie sofort per Telegram raus: an die Leute, die laut Dienstplan die nächste Schicht übernehmen, und an Chris und Rey. Du musst also niemandem hinterherschreiben.',
    ],
    watch: [
      'Die Übergabe ist freiwillig — aber sie ist die einzige Stelle, an der die nächste Schicht sicher mitbekommt, was gerade läuft. Der Chat geht dabei leicht unter.',
      'Auch ohne Dashboard möglich: Im Telegram-Bot beendest du mit „/off" und deinem Text in einer Zeile, oder mit „/off" allein — dann fragt der Bot nach. Nachreichen geht mit „/uebergabe TEXT", bestätigen mit „/gelesen".',
      'Wartet eine Übergabe auf dich, siehst du sie direkt nach dem Einchecken. Klickst du das Fenster weg, kommst du über den pinken Hinweis „Übergabe der Vorschicht" wieder dran.',
      'Du bekommst nur die Übergaben zu sehen, die dich betreffen — also von der Schicht, die du übernimmst. Was andere sich untereinander weitergeben, taucht bei dir nicht auf.',
      'Was du übergibst, sehen auch Chris und Rey im Schicht-Log — inklusive der Angabe, wer sie gelesen hat.',
      'Wenn du das Auschecken vergisst: 1 Minute nach Schichtende checkt das Portal dich automatisch aus. Dabei kannst du keine Übergabe mehr schreiben — dann lieber vorher Bescheid geben.',
      'Bist du 15 Minuten nach Schichtbeginn noch nicht eingecheckt, bekommen Chris und Rey automatisch eine Telegram-Nachricht. Das ist kein Vorwurf, sondern nur die Erinnerung — aber ärgerlich, wenn du eigentlich längst arbeitest.',
      'Hast du für den Tag eine Abwesenheit eingetragen, kommt diese Erinnerung nicht.',
      'Auschecken lässt sich nicht rückgängig machen. Checkst du erneut ein, entsteht ein zweiter Eintrag.',
    ],
  },
  {
    id: 'cockpit',
    icon: '📊',
    tab: null,
    title: 'Deine Zahlen oben',
    short: 'Revenue, Buy Rate, Ø Antwortzeit und Nachrichten vom letzten ausgewerteten Tag.',
    body: [
      'Die vier Kacheln zeigen deinen letzten ausgewerteten Tag — darüber steht, von welchem Tag die Zahlen sind. Grün heißt: im guten Bereich.',
      'Buy Rate = wie viele deiner verschickten PPVs gekauft wurden. Ø Antw. = deine durchschnittliche Antwortzeit in Minuten:Sekunden.',
    ],
    watch: [
      'Die Zahlen kommen aus einem Export, den das Team täglich hochlädt — sie sind also nie live und nicht zwingend von gestern.',
      'Stehen dort „—" oder Nullen, fehlt schlicht noch der Upload. Das ist kein Fehler bei dir.',
    ],
  },
  {
    id: 'chips',
    icon: '⚡',
    tab: null,
    title: 'Die bunten Hinweise',
    short: 'Zeigen nur, wenn etwas offen ist — antippen springt direkt hin.',
    body: [
      'Unter den Zahlen tauchen farbige Hinweise auf: offene Aufgaben (rot), fehlende Schichtnotiz (orange), offene Custom-Anfragen (cyan), Übergabe der Vorschicht (pink). Ein Tipp darauf bringt dich direkt an die richtige Stelle.',
      'Ist nichts offen, siehst du dort auch nichts — das ist der Normalzustand, nicht ein Fehler.',
    ],
  },
  {
    id: 'shifts',
    icon: '📅',
    tab: 'heute',
    title: 'Meine Schichten – nächste 7 Tage',
    short: 'Dein Dienstplan mit lokalen Uhrzeiten und den Models je Schicht.',
    body: [
      'Hier stehen alle deine Einteilungen der nächsten 7 Tage. Die Uhrzeit wird in deiner lokalen Zeit angezeigt. Tipp auf eine Zeile, um zu sehen, mit welchen Models du in der Schicht arbeitest.',
      'Markierungen: „⚠ abweichend" = für diesen Tag gilt eine andere Uhrzeit als sonst. „🎓 Anlernen" = du wirst eingelernt. „👥 Co" = du arbeitest die ganze Schicht zusammen mit der genannten Person. „✂️ Geteilt" = ihr teilt euch die Schicht, jeder übernimmt einen Abschnitt. „🔔" = für die Schicht ist eine Erinnerung hinterlegt.',
      'Bei einer geteilten Schicht steht bei dir DEINE Zeit — nicht die volle Schichtzeit. Danach richtet sich auch, ab wann du einchecken kannst und wann das Portal dich automatisch auscheckt.',
    ],
    watch: [
      'Hier wird nur angezeigt, nicht eingecheckt — das läuft über die Leiste ganz oben.',
      'Steht bei „✂️ Geteilt" keine eigene Uhrzeit, hat das Team die Abschnitte noch nicht eingetragen. Dann gilt die normale Schichtzeit — im Zweifel kurz nachfragen.',
      'Steht „Kein veröffentlichter Plan", ist der Dienstplan für die Woche noch nicht freigegeben. Er erscheint automatisch, sobald das Team ihn veröffentlicht.',
    ],
  },
  {
    id: 'todos',
    icon: '📋',
    tab: 'heute',
    title: 'Meine Aufgaben',
    short: 'Was das Team dir persönlich zugeteilt hat.',
    body: [
      'Aufgaben, die auf deinen Namen laufen — mit Priorität und dem Namen dessen, der sie erstellt hat. Der Bereich erscheint nur, wenn es überhaupt Aufgaben gibt.',
    ],
    steps: [
      'Erledigt? Kästchen antippen. Das Team bekommt sofort eine Telegram-Nachricht.',
      'Du hast eine Rückfrage oder Anmerkung? „+ Rückmeldung" antippen und schreiben — auch das geht direkt ans Team.',
    ],
    watch: [
      'Sobald du das Portal offen hattest, gilt die Aufgabe automatisch als von dir gelesen. Abhaken musst du trotzdem selbst.',
      'Ein Häkchen lässt sich wieder entfernen, das löst keine Nachricht aus.',
    ],
  },
  {
    id: 'messages',
    icon: '📝',
    tab: 'heute',
    title: 'Schichtnotiz',
    short: 'Kurzer Übergabe-Text am Ende deiner Schicht.',
    body: [
      'Die Schichtnotiz ist die Übergabe an das Team und an die nächste Schicht: Was lief, was ist offen, was muss jemand wissen. Sie landet bei den Team-Notizen.',
      'Solange du eingecheckt bist und noch keine geschrieben hast, steht oben der orange Hinweis „Schichtnotiz fehlt".',
    ],
    steps: [
      'Model auswählen, Schicht auswählen, Text schreiben, „Notiz senden".',
    ],
    watch: [
      'Im Model-Auswahlfeld stehen oben auch deine Schichtnamen — nimm den echten Model-Namen weiter unten.',
      'Eine abgeschickte Notiz kannst du im Portal weder ändern noch löschen. Lieber einmal kurz gegenlesen.',
      'Es geht keine Telegram-Nachricht raus — die Notiz wird gelesen, aber nicht angekündigt.',
    ],
  },

  // ── Models ───────────────────────────────────────────────────────────────
  {
    id: 'models',
    icon: '🎬',
    tab: 'models',
    title: 'Meine Models',
    short: 'Der Steckbrief zu jedem Model: Preise, No Gos, Regeln, Services.',
    body: [
      'Für jedes Model, dem du zugeteilt bist, findest du hier alles Verbindliche: Preisstruktur, No Gos, Content-Regeln, Services, Einschränkungen, Reiseplan und Termine. Dazu die Social-Kanäle, offene Custom-Aufträge und anstehende Videos.',
      'Bei den Services steht mit Ja/Nein, ob Bewertungen, Audios, Video Chat und Telefonieren angeboten werden — inklusive Notizen dazu.',
    ],
    watch: [
      'Das ist die verbindliche Quelle. Im Zweifel gilt, was hier steht — nicht, was du dich zu erinnern glaubst.',
      'Nur lesbar; gepflegt wird es vom Team und vom Model selbst.',
      'Du siehst hier die Models, bei denen du als Hauptchatter eingeteilt bist. Wenn du nur zum Anlernen dabei bist, fehlt das Model in dieser Liste — frag dann deinen Hauptchatter.',
    ],
  },
  {
    id: 'suggestions',
    icon: '💬',
    tab: 'models',
    title: 'Nachrichten-Vorschläge',
    short: 'KI-Vorschläge passend zu Model, Anlass und Sprache.',
    body: [
      'Wähl Schicht, Model, Sprache und einen Anlass — dann bekommst du Textvorschläge, die zum Steckbrief des Models passen. Jeden Vorschlag kannst du kopieren, als „Nehm ich" markieren oder mit 👍/👎 bewerten.',
      'Die Bewertungen sind nicht Kosmetik: Gut bewertete Texte tauchen künftig eher wieder auf.',
    ],
    watch: [
      'Der Bereich erscheint nur, wenn er für dich freigeschaltet ist. Fehlt er und du hättest ihn gern: beim Team melden.',
      'Ein Freitext-Wunsch an die KI ist nicht vorgesehen — die Auswahl läuft über Schicht, Model, Anlass und Sprache.',
      'Eine Bewertung lässt sich nicht zurücknehmen.',
      'Vorschläge sind Vorschläge. Lies gegen, bevor du sie rausschickst — der Steckbrief des Models schlägt jeden Vorschlag.',
    ],
  },

  // ── Content ──────────────────────────────────────────────────────────────
  {
    id: 'content',
    icon: '📥',
    tab: 'content',
    title: 'Custom Content anfragen',
    short: 'Der Weg, wie ein Kundenwunsch beim Model landet.',
    body: [
      'Hier meldest du einen Kundenwunsch an: Videocall, Telefonat, Video, Sprachnachricht, Bild oder Sonstiges. Je nach Typ werden andere Felder eingeblendet.',
      'Unter dem Formular siehst du deine eigenen Anfragen der letzten 14 Tage samt Status: ● Neu, ⏳ Angefragt, ✓ Bestätigt, ✓ Erledigt, ✕ Abgelehnt.',
    ],
    steps: [
      'Typ wählen.',
      'Model/Profil wählen — das ist Pflicht und muss das richtige Profil sein, nicht nur das richtige Model.',
      'Kundennummer, Bezahlstatus und Preis eintragen.',
      'Wunsch des Kunden beschreiben — je genauer, desto weniger Rückfragen.',
      'Optional Outfit, Besonderheiten, Dringlichkeit und bis zu 5 Referenzbilder.',
      '„+ Anfrage senden" — Chris und Rey bekommen sofort eine Telegram-Nachricht.',
    ],
    watch: [
      'Der Senden-Knopf bleibt grau, solange Model und Wunschtext fehlen.',
      'Bei „Angezahlt" musst du den Anzahlungsbetrag eintragen — sonst wird nichts als bezahlt gewertet.',
      'Eine abgeschickte Anfrage kannst du nicht mehr ändern oder löschen. Statusänderungen macht das Team.',
      'Wenn das Senden fehlschlägt, bleibt dein Text stehen und es geht keine Nachricht raus. Nicht doppelt schicken, ohne oben nachzusehen.',
    ],
  },
  {
    id: 'history',
    icon: '📖',
    tab: 'content',
    title: 'Kunden-Historie',
    short: 'Was bei diesem Kunden bisher lief — auch von anderen Chattern.',
    body: [
      'Nach Kundennummer gruppiert siehst du alle bisherigen Custom-Anfragen zu deinen Models, inklusive der Anfragen anderer Chatter. Dazu, wie viel der Kunde schon bezahlt hat.',
      'Vor einer neuen Anfrage lohnt der Blick: Was hat der Kunde schon bekommen, was hat er bezahlt, was wurde abgelehnt.',
    ],
    steps: [
      'Im Suchfeld nach Kundennummer, Model oder Stichwort suchen.',
      'Gruppe aufklappen, um die einzelnen Anfragen zu sehen.',
      'Auf die Kundennummer tippen kopiert sie.',
    ],
    watch: ['Nur lesbar.'],
  },
  {
    id: 'ideas',
    icon: '💡',
    tab: 'content',
    title: 'Content-Ideen',
    short: 'Was dir im Chat fehlt — Wünsche ans Model weitergeben.',
    body: [
      'Wenn dir auffällt, dass etwas fehlt („zu wenig Videos in Dessous", „Kunden fragen ständig nach Audios"), trag es hier ein. Das Team sichtet die Ideen und gibt sie ans Model weiter.',
      'Deine eigenen Ideen der letzten 28 Tage stehen darunter, mit Status und ggf. einer Antwort vom Team.',
    ],
    steps: [
      'Model wählen, Kategorie (Bilder / Videos / Audio / Sonst), beschreiben was fehlt, Priorität setzen, „+ Idee einreichen".',
    ],
    watch: [
      'Es geht keine Telegram-Nachricht raus — eine Idee ist kein dringender Weg. Was eilt, gehört in den Chat.',
      'Ideen lassen sich nicht mehr ändern oder löschen und verschwinden nach 28 Tagen aus deiner Liste.',
    ],
  },

  // ── Organisation ─────────────────────────────────────────────────────────
  {
    id: 'absence',
    icon: '🌴',
    tab: 'orga',
    title: 'Ich bin nicht verfügbar am',
    short: 'Abwesenheiten eintragen — je früher, desto besser.',
    body: [
      'Hier meldest du, wann du nicht kannst. Du kannst einen ganzen Tag sperren oder nur einzelne Schichten.',
      'Richtwerte für den Vorlauf: 4+ Tage am Stück etwa 2 Wochen vorher, 3 Tage etwa 10 Tage vorher, 1–2 Tage etwa eine Woche vorher. Bei Krankheit natürlich sofort.',
    ],
    steps: [
      'Datum wählen.',
      'Grund eintragen (optional, hilft aber bei der Planung).',
      'Unter „Weg an:" entweder „Ganzer Tag" lassen oder die einzelnen Schichten antippen, an denen du weg bist.',
      '„+ Eintragen".',
    ],
    watch: [
      'Pro Eintrag ein Tag. Für eine Woche Urlaub also sieben Einträge — oder kurz beim Team melden.',
      'Das ✕ löscht einen Eintrag sofort und ohne Rückfrage.',
      'Ein Eintrag hier unterdrückt die automatische Erinnerung ans Team, wenn du an dem Tag nicht eincheckst.',
      'Die Vorlauf-Zeiten sind eine Bitte, keine technische Sperre — kurzfristig eintragen geht, macht aber Arbeit bei der Planung.',
    ],
  },
  {
    id: 'swap',
    icon: '🔄',
    tab: 'orga',
    title: 'Schicht abgeben',
    short: 'Eine eingeteilte Schicht zum Tausch anbieten.',
    body: [
      'Du kannst eine deiner Schichten der nächsten 7 Tage zum Tausch ausschreiben. Das Team sieht die Anfrage und bietet die Schicht anderen an.',
      'Darunter stehen deine letzten Anfragen mit Status: Offen, ✓ mit dem Namen dessen, der übernimmt, oder Abgeschlossen.',
    ],
    steps: [
      'Schicht im Auswahlfeld wählen.',
      'Grund eintragen (optional).',
      '„↔ Anfragen".',
    ],
    watch: [
      'Die Schicht gehört weiterhin dir, bis das Team sie jemand anderem zuteilt. Also bitte nicht einfach wegbleiben.',
      'Stornieren geht nur, solange der Status „Offen" ist. Sobald das Team reagiert hat, kommt eine Fehlermeldung.',
      'Es geht keine automatische Telegram-Nachricht raus. Wenn es eilt: zusätzlich kurz schreiben.',
    ],
  },
  {
    id: 'angebote',
    icon: '🙋',
    tab: null,
    title: 'Angebotene Schichten übernehmen',
    short: 'Wenn jemand eine Schicht abgibt, kannst du sie übernehmen.',
    body: [
      'Freie Schichten erscheinen als Popup beim Öffnen des Portals und zusätzlich in der Glocke unten rechts. Du antwortest mit „✓ Übernehmen", „? Vielleicht" oder „✕ Ablehnen".',
      'Manchmal hängen mehrere Models an einer Schicht — das ist dann ein Block und erscheint als eine Karte. Übernimmst du, übernimmst du alle Models dieser Schicht zusammen.',
    ],
    watch: [
      'Deine Antwort ist eine Rückmeldung, keine Zuteilung — final entscheidet das Team.',
      'Eine einmal gegebene Antwort lässt sich nicht zurücknehmen, und das Angebot verschwindet danach für dich.',
      '„Später" blendet das Popup nur bis zum nächsten Laden aus — das Angebot bleibt in der Glocke.',
    ],
  },

  // ── Kommunikation ────────────────────────────────────────────────────────
  {
    id: 'bell',
    icon: '🔔',
    tab: null,
    title: 'Die Glocke',
    short: 'Schichtangebote, Erinnerungen, neuer Dienstplan, Aufgaben, Ankündigungen.',
    body: [
      'Die Glocke unten rechts sammelt alles, was du wissen musst: offene Schichtangebote, „deine Schicht startet in X Minuten" (mit Knopf zum direkten Einchecken), neu veröffentlichte Dienstpläne, neue Aufgaben und neue Ankündigungen.',
      'Mit den Filtern oben kannst du auf Schichten, Aufgaben oder Team einschränken.',
    ],
    watch: [
      'Schichtangebote und Schichtstart-Erinnerungen bleiben ungelesen, bis du reagiert hast — „Alles gelesen" räumt sie absichtlich nicht weg.',
      'Gelesen wird erst gesetzt, wenn du die Glocke über den Pfeil oder das Glockensymbol schließt. Woanders hintippen zählt nicht.',
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    tab: null,
    title: 'Chat mit dem Team',
    short: 'Direkter Draht — dasselbe Gespräch wie über Telegram.',
    body: [
      'Der Knopf ganz unten rechts öffnet deinen Chat mit dem Team. Das ist derselbe Verlauf wie über den Telegram-Bot: Egal wo du schreibst, es landet im selben Gespräch.',
      'Das Team bekommt sofort eine Telegram-Benachrichtigung, wenn du hier schreibst.',
    ],
    watch: [
      'Nicht doppelt schreiben — einmal hier oder einmal über Telegram reicht, sonst kommt beides an.',
      'Nachrichten lassen sich nicht bearbeiten oder löschen.',
    ],
  },
  {
    id: 'pinnwand',
    icon: '📌',
    tab: null,
    title: 'Ankündigungen',
    short: 'Wichtiges vom Team, ganz oben im Portal.',
    body: [
      'Ganz oben erscheinen bis zu zwei aktuelle Ankündigungen. Mit „✓ Gelesen" nimmst du sie von deiner Pinnwand.',
    ],
    watch: [
      'Weggeklickt ist weggeklickt — nachlesen kannst du alles im Tab „Mehr" unter „Pinnwand-Verlauf".',
    ],
  },

  // ── Nachschlagen ─────────────────────────────────────────────────────────
  {
    id: 'guidelines',
    icon: '📚',
    tab: 'mehr',
    title: 'Guidelines',
    short: 'Die verbindlichen Regeln der Agentur, mit Bildern.',
    body: [
      'Hier stehen die allgemeinen Regeln — anders als die Model-Steckbriefe gelten sie für alle. Kapitel aufklappen zum Lesen, Bilder antippen für die Großansicht.',
    ],
    watch: [
      'Beim Einstieg einmal komplett durchlesen. Danach reicht Nachschlagen.',
    ],
  },
  {
    id: 'stats',
    icon: '📈',
    tab: 'mehr',
    title: 'Meine Stats',
    short: 'Deine Zahlen der laufenden Kalenderwoche.',
    body: [
      'Revenue des laufenden Monats, dazu Nachrichten, gesendete PPVs, Buy Rate und aktive Stunden der laufenden Woche ab Montag. Grün heißt: im guten Bereich.',
    ],
    watch: [
      'Wie oben: Die Zahlen stammen aus dem täglichen Export und sind nur so aktuell wie der letzte Upload.',
    ],
  },
  {
    id: 'bot',
    icon: '🤖',
    tab: 'mehr',
    title: 'Telegram-Bot',
    short: 'Ein- und Auschecken geht auch per Telegram.',
    body: [
      '/on startet deine Schicht, /off beendet sie, /start zeigt dir deine Telegram-ID. Das ist derselbe Check-in wie im Portal — du brauchst nicht beides.',
      'Praktisch, wenn du unterwegs bist und das Portal gerade nicht offen hast.',
    ],
    watch: [
      'Damit der Bot dich erkennt, muss deine Telegram-ID beim Team hinterlegt sein. Falls /on nicht wirkt: /start schicken und die ID ans Team geben.',
    ],
  },
]

export const HELP_BY_ID = Object.fromEntries(HELP_TOPICS.map(t => [t.id, t]))

// Reihenfolge der Einführungs-Tour. Bewusst kürzer als die Themenliste —
// erst das Nötigste zum Loslegen, der Rest steht über die ?-Symbole bereit.
export const TOUR_IDS = [
  'ueberblick',
  'schichtleiste',
  'cockpit',
  'tabs',
  'shifts',
  'messages',
  'models',
  'content',
  'absence',
  'bell',
]
