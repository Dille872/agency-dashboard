// ── Texte des Social Media Managers, Deutsch / Englisch (v4.102.0) ─────────
//
// Nur diese Ansicht ist zweisprachig — Poster können im Ausland sitzen.
// Neue Texte IMMER in beiden Sprachen eintragen; fehlt einer, zeigt t() den
// deutschen Text (nie einen leeren Knopf).
//
// Inhalte, die Models frei eintippen (No Gos, Stil …), stehen nicht hier —
// die übersetzt die Edge Function „uebersetzen“ und merkt sie sich.

export const TEXTE = {
  de: {
    titel: 'Social Media Manager',
    hallo: 'Hallo {name} 👋',
    zusammenfassung: '{posten} zu posten · {fehlt} Video fehlt · {alt} seit über {tage} Tagen',
    tab_steuerung: 'Steuerung',
    tab_posten: 'Zu posten',
    tab_ueberblick: 'Überblick',
    tab_models: 'Models',
    kpi_posten: 'Video da, zu posten',
    kpi_fehlt: 'Drehzettel raus, Video fehlt',
    kpi_woche: 'gepostet in den letzten 7 Tagen',
    nichts_zu_posten: 'Gerade nichts zu posten. 🎉',
    video_da_seit: 'Video da · {seit}',
    sp_material: '1 · Material',
    sp_achten: '2 · Worauf achten',
    sp_posten: '3 · Posten auf',
    drehzettel: '📄 Drehzettel ansehen',
    video_laden: '⬇ Video laden',
    hochgeladen: 'Video von {wer} · {datum}',
    nogos: 'No Gos',
    einschraenkungen: 'Einschränkungen',
    stil: 'Stil',
    englisch: 'Englisch',
    keine_nogos: 'keine eingetragen',
    kein_ziel: 'Kein Ziel-Account festgelegt',
    anderer_account: 'Doch woanders gepostet?',
    account_aendern: 'Account ändern',
    reel_link: 'https://www.instagram.com/reel/…',
    gepostet_knopf: 'Gepostet ✓',
    speichert: 'Speichert …',
    fehler_reel: 'Bitte den Instagram-Link zum Reel einfügen.',
    fehler_account: 'Bitte den Account wählen.',
    nicht_gespeichert: 'Nicht gespeichert: {fehler}',
    abweichend: 'abweichend von {ziel}',
    sp_nr: 'Nr', sp_model: 'Model', sp_ziel: 'Posten auf', sp_titel: 'Titel', sp_stand: 'Stand', sp_seit: 'Seit',
    st_freigegeben: 'Drehzettel raus', st_gedreht: 'Video da', st_gepostet: 'gepostet',
    posten: 'posten', erinnern: 'erinnern', erinnert: '✓ erinnert', reel: 'Reel',
    rot_hinweis: 'Rot = Video fehlt seit mehr als {tage} Tagen.',
    rot_hinweis_erinnern: ' „Erinnern“ schickt dem Model eine Telegram-Nachricht.',
    heute: 'heute', gestern: 'gestern', tage: '{n} Tage',
    models_hinweis: 'Nur Models im Social-Media-Service. Keine Preise, kein Steckbrief — nur, was man zum Posten braucht.',
    keine_models: 'Noch kein Model im Social-Media-Service.',
    im_service_seit: 'Posting ab {datum}',
    im_service: 'im Service',
    instagram: 'Instagram',
    drehorte: 'Drehorte',
    mitspieler: 'Mitspieler',
    wiedererkennung: 'Erkennungszeichen',
    technik: 'Technik',
    drehrhythmus: 'Drehrhythmus',
    staerken: 'Stärken',
    reels: 'Reels',
    n_posten: '{n} zu posten', n_fehlt: '{n} fehlt', n_gepostet: '{n} gepostet',
    uebersetzt: 'automatisch übersetzt',
    original: 'Original',
    uebersetzung_fehlt: 'Übersetzung gerade nicht verfügbar, Originaltext wird gezeigt.',
    laedt: 'Lädt …',
    tabelle_fehlt: 'Datenbank noch nicht eingerichtet (sql/social-manager.sql).',
    erinnern_text: 'Hey {name} 👋 kleine Erinnerung: Für {nr} „{titel}“ fehlt noch dein Video. Link bitte im Portal unter „Social“ einfügen. Danke! 💛',
    erinnern_ohne_tg: 'Keine Telegram-ID hinterlegt.',
    erinnern_fehler: 'Telegram nicht angekommen.',
  },
  en: {
    titel: 'Social Media Manager',
    hallo: 'Hi {name} 👋',
    zusammenfassung: '{posten} to post · {fehlt} video missing · {alt} for more than {tage} days',
    tab_steuerung: 'Control',
    tab_posten: 'To post',
    tab_ueberblick: 'Overview',
    tab_models: 'Creators',
    kpi_posten: 'Video ready to post',
    kpi_fehlt: 'Script sent, video missing',
    kpi_woche: 'posted in the last 7 days',
    nichts_zu_posten: 'Nothing to post right now. 🎉',
    video_da_seit: 'Video ready · {seit}',
    sp_material: '1 · Material',
    sp_achten: '2 · Keep in mind',
    sp_posten: '3 · Post to',
    drehzettel: '📄 View script',
    video_laden: '⬇ Download video',
    hochgeladen: 'Video from {wer} · {datum}',
    nogos: 'No-gos',
    einschraenkungen: 'Restrictions',
    stil: 'Style',
    englisch: 'English',
    keine_nogos: 'none listed',
    kein_ziel: 'No target account set',
    anderer_account: 'Posted somewhere else?',
    account_aendern: 'Change account',
    reel_link: 'https://www.instagram.com/reel/…',
    gepostet_knopf: 'Posted ✓',
    speichert: 'Saving …',
    fehler_reel: 'Please paste the Instagram link to the reel.',
    fehler_account: 'Please choose the account.',
    nicht_gespeichert: 'Not saved: {fehler}',
    abweichend: 'differs from {ziel}',
    sp_nr: 'No.', sp_model: 'Creator', sp_ziel: 'Post to', sp_titel: 'Title', sp_stand: 'Status', sp_seit: 'Since',
    st_freigegeben: 'Script sent', st_gedreht: 'Video ready', st_gepostet: 'posted',
    posten: 'post', erinnern: 'remind', erinnert: '✓ reminded', reel: 'Reel',
    rot_hinweis: 'Red = video missing for more than {tage} days.',
    rot_hinweis_erinnern: ' “Remind” sends the creator a Telegram message.',
    heute: 'today', gestern: 'yesterday', tage: '{n} days',
    models_hinweis: 'Only creators in the social media service. No prices, no profile details — just what you need for posting.',
    keine_models: 'No creator in the social media service yet.',
    im_service_seit: 'Posting from {datum}',
    im_service: 'in service',
    instagram: 'Instagram',
    drehorte: 'Filming spots',
    mitspieler: 'Co-stars',
    wiedererkennung: 'Trademarks',
    technik: 'Gear',
    drehrhythmus: 'Filming rhythm',
    staerken: 'Strengths',
    reels: 'Reels',
    n_posten: '{n} to post', n_fehlt: '{n} missing', n_gepostet: '{n} posted',
    uebersetzt: 'auto-translated',
    original: 'Original',
    uebersetzung_fehlt: 'Translation not available right now, showing original text.',
    laedt: 'Loading …',
    tabelle_fehlt: 'Database not set up yet (sql/social-manager.sql).',
    // Nachricht ans Model bleibt deutsch — die Models sind deutschsprachig.
    erinnern_text: 'Hey {name} 👋 kleine Erinnerung: Für {nr} „{titel}“ fehlt noch dein Video. Link bitte im Portal unter „Social“ einfügen. Danke! 💛',
    erinnern_ohne_tg: 'No Telegram ID on file.',
    erinnern_fehler: 'Telegram message failed.',
  },
}

// Feste Auswahl-Chips aus dem Fragebogen (src/socialProfil.js) — die werden
// direkt übersetzt, nicht über die KI.
export const CHIPS_EN = {
  'Küche': 'Kitchen', 'Wohnzimmer': 'Living room', 'Schlafzimmer': 'Bedroom', 'Bad': 'Bathroom',
  'Garten': 'Garden', 'Balkon': 'Balcony', 'Pool': 'Pool', 'Auto': 'Car', 'Draußen in der Nähe': 'Outdoors nearby',
  'Mimik': 'Facial expressions', 'Reden': 'Talking', 'Tanzen': 'Dancing', 'Witzig sein': 'Being funny',
  'Lip-Sync': 'Lip sync', 'Posen': 'Posing', 'Storytelling': 'Storytelling', 'Kochen': 'Cooking', 'Sport': 'Sports',
  'Stativ': 'Tripod', 'Ringlicht': 'Ring light', 'Mikro': 'Microphone', 'Nichts davon': 'None of these',
}

const SPEICHER = 'sm_sprache'
export function spracheLaden() {
  try { const s = localStorage.getItem(SPEICHER); return s === 'en' ? 'en' : 'de' } catch { return 'de' }
}
export function spracheMerken(s) {
  try { localStorage.setItem(SPEICHER, s) } catch { /* egal */ }
}

export function macheT(sprache) {
  const tab = TEXTE[sprache] || TEXTE.de
  return (key, werte = {}) => {
    let s = tab[key] ?? TEXTE.de[key] ?? key
    for (const [k, v] of Object.entries(werte)) s = s.split(`{${k}}`).join(String(v))
    return s
  }
}
