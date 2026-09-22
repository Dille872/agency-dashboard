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
      'Am Handy stehen die Bereiche unten in einer Leiste (Heute, Models, Content, Orga, Mehr) — oben ist dann mehr Platz für den Inhalt.',
      '📅 Heute — deine Schicht: Aufgaben, Mein Kalender, Dienstplan der nächsten 7 Tage, Schichtnotiz.',
      '🎬 Models — womit du arbeitest: Nachrichten-Vorschläge und die Steckbriefe deiner Models.',
      '📥 Content — Produktion: Custom-Anfragen stellen, Kunden-Historie, Content-Ideen.',
      '🗂️ Organisation — Planung: deine nächsten 7 Tage auf einen Blick, „Ich kann nicht“ eintragen, Schicht abgeben.',
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
      'Unter dem Schichtnamen stehen die Models dieser Schicht mit ihrem Zustand — online, Pause, nicht da oder auf Reise. So weißt du schon vor dem Start, woran du bist.',
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
  // v4.67.1: Team-Kalender im Portal
  {
    id: 'kalender',
    icon: '🗓',
    tab: 'heute',
    title: 'Mein Kalender – nächste 7 Tage',
    short: 'Aufgaben, Events und Termine für dich – in deiner eigenen Uhrzeit.',
    body: [
      'Hier stehen alle Einträge aus dem Team-Kalender, die für dich gedacht sind: Aufgaben (z. B. eine Massennachricht nach einem Stream), Events der Models, Team-Termine und Erinnerungen. Du siehst nur, was für dich oder für das ganze Team eingetragen ist.',
      'Alle Uhrzeiten stehen in DEINER Zeit. Tipp auf eine Uhrzeit, dann siehst du zusätzlich die deutsche Zeit.',
      'Markierungen: „↳ Folgeaufgabe zu …" = gehört zu einem Event (z. B. direkt nach Stream-Ende). „🔁" = wiederholt sich regelmäßig. Bei Aufgaben läuft ein Countdown bis zur Fälligkeit.',
      'Neue Einträge kommen zusätzlich per Telegram und stehen in der Glocke unter „Neu im Kalender". Ist eine Erinnerung eingestellt, kommt sie kurz vorher per Telegram.',
    ],
    steps: [
      'Aufgabe erledigt? → „✓ Erledigt" antippen. Chris und Rey bekommen sofort Bescheid. Versehentlich getippt? „↺ doch nicht".',
      'Klappt etwas nicht oder wird es später? → 💬 antippen (bei Events/Terminen „💬 Rückmeldung"), kurz schreiben, „An Chris & Rey senden". Deine Rückmeldung steht danach unter dem Eintrag.',
      'Optional: „📲 Im Handy-Kalender" → „Abo einrichten". iPhone: „In Apple Kalender abonnieren" → „Abonnieren". Android: „Link kopieren" und am Computer auf calendar.google.com unter „Weitere Kalender → + → Per URL" einfügen. Danach stehen deine Aufgaben und Schichten auch im Kalender deines Handys.',
    ],
    watch: [
      'Aufgaben bitte immer abhaken: Ist eine Aufgabe 2 Stunden nach Fälligkeit noch offen, kommt eine Erinnerung per Telegram — nach 12 Stunden bekommen Chris und Rey eine Meldung.',
      'Deine Rückmeldungen sehen nur Chris, Rey und du — die anderen Chatter nicht.',
      'Der Handy-Kalender ist nur zum Lesen und aktualisiert mit Verzögerung (iPhone meist unter 1 Std., Google bis zu 1 Tag). Abhaken geht nur hier im Portal. Den Link nicht weitergeben — wer ihn hat, sieht deine Einträge. „Neuen Link erzeugen" macht den alten sofort ungültig.',
      'Die Uhrzeiten stimmen nur, wenn deine Zeitzone stimmt — siehe „Deine Zeitzone".',
    ],
  },
  {
    id: 'app',
    icon: '📲',
    tab: 'mehr',
    title: 'Als App aufs Handy',
    short: 'Icon auf den Home-Bildschirm – öffnet im Vollbild wie eine App.',
    body: [
      'Das Portal lässt sich wie eine App auf den Home-Bildschirm legen: eigenes Icon, keine Browserleiste, ein Tipp zum Öffnen. Unter „Mehr“ → „Als App aufs Handy“ steht die Anleitung für iPhone und Android.',
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
    id: 'zeitzone',
    icon: '🕒',
    tab: null,
    title: 'Deine Zeitzone',
    short: 'Einmal bestätigen – danach stimmen alle Uhrzeiten für dich.',
    body: [
      'Das Portal rechnet Kalender, Glocke und Telegram-Erinnerungen in deine Uhrzeit um. Die Zeitzone kommt aus der Uhr deines Geräts — nicht aus dem Internet. Ein VPN ändert daran also nichts.',
    ],
    steps: [
      'Beim ersten Öffnen steht oben „Deine Zeitzone: … — stimmt das?". Passt es: „Ja, stimmt" tippen.',
      'Passt es nicht: „Andere wählen" und die richtige Zone aussuchen.',
      'Bist du verreist und dein Handy zeigt eine andere Zone an, fragt das Portal nach: umstellen, behalten oder andere wählen.',
    ],
    watch: [
      'Solange du nichts bestätigt hast, bekommst du Telegram-Uhrzeiten in deutscher Zeit.',
      'Oben steht danach klein „Zeitzone: … ändern" — darüber kannst du sie jederzeit wechseln.',
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
      'Model und Schicht antippen, Text schreiben, „Notiz senden".',
    ],
    watch: [
      'Die Models deiner heutigen Schichten stehen als Chips vorne, alle anderen unter „Anderes …“. Bist du eingecheckt, ist deine Schicht schon ausgewählt.',
      'Eine abgeschickte Notiz kannst du im Portal weder ändern noch löschen. Lieber einmal kurz gegenlesen.',
      'Es geht keine Telegram-Nachricht raus — die Notiz wird gelesen, aber nicht angekündigt.',
    ],
  },

  // ── Models ───────────────────────────────────────────────────────────────
  {
    id: 'heutemodels',
    icon: '✈️',
    tab: 'heute',
    title: 'Deine Models heute',
    short: 'Jedes Model deiner Schicht auf einen Blick: Zustand, Reise, Termine, Preise, No Gos.',
    body: [
      'Ganz oben im Tab „Heute" steht für jedes Model deiner Schicht eine Karte. Oben rechts auf der Karte der Zustand: Online (gerade im Dashboard), Pause oder Nicht da (mit Uhrzeit, wenn das Model eine gesetzt hat), Offline oder Auf Reise.',
      'Neben dem Namen steht, wie spät es gerade beim Model ist — das Portal nimmt die Zeitzone vom Gerät des Models, auf Reisen stellt sie sich also mit um.',
      'Ist ein Model auf Reise, steht der Reiseplan groß oben auf der Karte: wohin, bis wann, was während der Reise geht und was nicht, und — falls eingetragen — ein Satz, den du Fans sagen kannst. Darunter: was diese Woche ansteht (Termine, Videos, Reisen), offene Custom-Aufträge, Preise, No Gos, Einschränkungen und Services.',
      'Hat sich seit deiner letzten Schicht etwas geändert, kommt beim Öffnen einmal ein Fenster „Bevor du loslegst" mit allen Änderungen. Mit „Gelesen" ist es weg — auch auf deinen anderen Geräten.',
      'Der gelbe Kasten „Neu seit deiner letzten Schicht" zeigt, was am Board geändert wurde, seit du das letzte Mal ausgecheckt hast. Geänderte Preise und No Gos sind zusätzlich mit NEU markiert.',
      'Bist du eingecheckt, siehst du die Models deiner laufenden Schicht. Sonst die Models aller heutigen Schichten — und hast du heute keine Schicht (mehr), die Models deiner nächsten Schicht. Am Handy wechselst du oben zwischen den Models.',
    ],
    steps: [
      'Vor dem Start einmal alle Karten durchschauen — vor allem den gelben Kasten und Reisen.',
      '„Ganzes Board" öffnet den kompletten Steckbrief im Tab „Models".',
    ],
    watch: [
      'Die Karte zeigt eine Auswahl. Verbindlich ist das ganze Board — wenn etwas fehlt oder unklar ist, dort nachsehen.',
      'Den Zustand setzt das Model selbst. Steht dort „Offline", heißt das nur, dass es gerade nicht im Dashboard ist.',
    ],
  },
  {
    id: 'wermachtwas',
    icon: '🧩',
    tab: 'models',
    title: 'Wer macht was',
    short: 'Alle deine Models nebeneinander: Angebot, Preise, No Gos.',
    body: [
      'Betreust du mehrere Models, stehen sie hier in einer Tabelle nebeneinander: was sie anbieten (✓ / ✕), ihre Preise und ihre No Gos. So musst du nicht zwischen den Boards hin- und herspringen.',
      'Ist ein Model gerade auf Reise und hat etwas unter „geht nicht" angetippt, steht dort „✕ (Reise)" — auch wenn es das sonst anbietet.',
      'Die Suche oben filtert alle Zeilen, z. B. nach „Füße" oder „Video". Einen Namen antippen öffnet das ganze Board dieses Models darunter.',
    ],
    watch: [
      '„–" heißt: nicht eingetragen — nicht automatisch erlaubt. Im Zweifel im ganzen Board nachsehen oder fragen.',
      'Bei nur einem Model wird die Tabelle nicht angezeigt.',
    ],
  },
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
      'Du siehst hier die Models, bei denen du von gestern bis in 7 Tagen im Dienstplan stehst — als Hauptchatter, Co oder zum Anlernen. Fehlt ein Model, bist du in diesem Zeitraum dort nicht eingetragen.',
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
    short: 'Der Weg, wie ein Kundenwunsch beim Model landet — in 4 kurzen Schritten.',
    body: [
      '„+ Neue Custom-Anfrage" öffnet ein Fenster mit vier Schritten: Was → Für wen → Was genau → Preis & Zeit. Oben siehst du immer, wo du bist; mit ‹ geht es zurück.',
      'Bei „Für wen?" steht sofort, was beim Model gilt: ob es gerade auf Reise ist und was dann nicht geht, ob es die Art laut Board überhaupt anbietet, ab-Preis und No Gos. Trägst du die Kundennummer ein, siehst du, ob der Kunde bei diesem Model schon bestellt hat.',
      'Unter dem Knopf stehen deine Anfragen der letzten 14 Tage. Oben filterst du nach Offen, Bestätigt, Erledigt oder Alle.',
    ],
    steps: [
      'Art antippen: Video, Bilder, Sprachnachricht, Videocall, Telefonat oder Sonstiges.',
      'Model antippen (und bei mehreren Accounts den richtigen Account), optional Kundennummer.',
      'Länge bzw. Anzahl antippen, den Wunsch des Kunden beschreiben, Outfit und Besonderheiten antippen oder selbst schreiben, optional bis zu 5 Referenzbilder.',
      'Preis, Bezahlstand und „Bis wann?" wählen, die Zusammenfassung gegenlesen und „Anfrage senden". Chris und Rey bekommen sofort eine Telegram-Nachricht.',
    ],
    watch: [
      '„Weiter" bleibt grau, solange in einem Schritt das Nötigste fehlt (Model und Account, Wunsch des Kunden).',
      'Bei „Angezahlt" musst du den Anzahlungsbetrag eintragen — sonst wird nichts als bezahlt gewertet.',
      'Eine abgeschickte Anfrage kannst du nicht mehr ändern oder löschen. Statusänderungen macht das Team.',
      'Wenn das Senden fehlschlägt, bleibt das Fenster mit deinen Eingaben offen und es geht keine Nachricht raus. Nicht doppelt schicken, ohne in der Liste nachzusehen.',
      'Schließt du das Fenster ohne zu senden, bleiben deine Eingaben erhalten, bis du die Seite neu lädst.',
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
      '„💡 Neue Content-Idee“ antippen — ein Fenster fährt von unten hoch.',
      'Model antippen (deine Models stehen vorne), Kategorie wählen, beschreiben was fehlt, Dringlichkeit antippen, „💡 Idee einreichen“.',
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
    title: 'Ich kann nicht',
    short: 'Abwesenheiten eintragen — je früher, desto besser.',
    body: [
      'Oben im Reiter Organisation stehen deine nächsten 7 Tage: die nächste Schicht groß, darunter ein Streifen mit einem Kästchen pro Tag. Farbige Buchstaben sind deine Schichten (V/F/S/N), 🌴 heißt eingetragen weg, ↔ heißt Tausch läuft. Tag antippen zeigt, was ansteht.',
      'Mit „🌴 Ich kann nicht“ meldest du, wann du nicht kannst — einen ganzen Tag, mehrere Tage am Stück oder nur einzelne Schichten.',
      'Richtwerte für den Vorlauf stehen unter „Wie früh eintragen?“: 4+ Tage die Woche etwa 2 Wochen vorher, 3 Tage etwa 10 Tage, 1–2 Tage etwa eine Woche. Bei Krankheit natürlich sofort.',
    ],
    steps: [
      '„🌴 Ich kann nicht“ antippen (oder einen Tag im Streifen und dann „An diesem Tag kann ich nicht“).',
      'Zeitraum per Schnellwahl (Heute, Morgen, Wochenende, Nächste Woche) oder über Von / Bis wählen.',
      'Unter „Weg an“ „Ganzer Tag“ lassen oder die Schichten antippen, an denen du weg bist.',
      'Grund antippen (Krank, Urlaub …) oder selbst schreiben.',
      'Unten steht, welche eingeteilten Schichten betroffen sind. Dann „🌴 Eintragen“.',
    ],
    watch: [
      'Die gewählten Schichten unter „Weg an“ gelten für jeden Tag im Zeitraum.',
      'Das ✕ an einem Eintrag löscht ihn nach einer Rückfrage — danach giltst du wieder als verfügbar.',
      'Ein Eintrag hier unterdrückt die automatische Erinnerung ans Team, wenn du an dem Tag nicht eincheckst.',
      'Die Vorlauf-Zeiten sind eine Bitte, keine Sperre. Bei kurzfristigen Einträgen erinnert das Fenster daran, dem Team zusätzlich zu schreiben.',
    ],
  },
  {
    id: 'swap',
    icon: '🔄',
    tab: 'orga',
    title: 'Schicht abgeben',
    short: 'Eine eingeteilte Schicht zum Tausch anbieten.',
    body: [
      'Du kannst eine deiner Schichten der nächsten 7 Tage zum Tausch anbieten. Das Team sieht die Anfrage und bietet die Schicht anderen an.',
      'Unter „Meine Tausch-Anfragen“ stehen deine Anfragen mit Status: Wartet aufs Team, ✓ mit dem Namen dessen, der übernimmt, oder Abgeschlossen.',
    ],
    steps: [
      '„↔️ Schicht abgeben“ antippen (oder im Streifen einen Tag und dort „↔ abgeben“).',
      'Schicht antippen, optional einen Grund wählen.',
      '„↔ Anfrage senden“.',
    ],
    watch: [
      'Die Schicht gehört weiterhin dir, bis das Team sie jemand anderem zuteilt. Also bitte nicht einfach wegbleiben.',
      'Für eine Schicht mit laufender Anfrage geht keine zweite („läuft schon“).',
      'Stornieren (✕) geht nur, solange die Anfrage aufs Team wartet.',
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
      'Die Glocke unten rechts sammelt alles, was du wissen musst: offene Schichtangebote, „deine Schicht startet in X Minuten" (mit Knopf zum direkten Einchecken), neu veröffentlichte Dienstpläne, neue Aufgaben, neue Einträge in deinem Kalender („Neu im Kalender") und neue Ankündigungen.',
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
      'Oben im Reiter Mehr: Revenue des laufenden Monats groß, darunter Nachrichten, gesendete PPVs, Buy Rate und aktive Stunden der laufenden Woche ab Montag.',
      'Der Balken zeigt, wie weit du vom guten Bereich weg bist (Nachrichten 200, PPVs 50, Buy Rate 25 %, aktiv 5 h). Grün heißt: erreicht. Oben rechts steht, wie viele der vier Werte im Grünen sind.',
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
  'heutemodels',
  'shifts',
  'kalender',
  'zeitzone',
  'messages',
  'models',
  'content',
  'absence',
  'bell',
]
