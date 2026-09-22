import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

// ── Model-Steckbrief „Über mich“ (v4.95.0) ─────────────────────────────────
//
// Die Fragen stammen aus Chris' Fragenkatalog „Model Infos“ (PDF) plus
// Ergänzungen (Schuhgröße, Haustiere, Führerschein, Chat-Stil …).
//
// Grundsatz: Alles hier ist die FAN-VERSION. Die Chatter lesen es und erzählen
// es so den Fans. Deshalb sehen alle Chatter alles, und alles geht in den
// CreatorHero-Text (Knopf im Admin). Angebot, Preise und No Gos liegen weiter
// im Board (model_board) — die Einführung zeigt dafür den Board-Steckbrief an,
// nichts wird doppelt gespeichert.
//
// Tabelle model_steckbrief (sql/model-steckbrief.sql), eine Zeile je Model:
//   antworten              jsonb  { feldKey: 'Text' | ['Chip', …] }
//   einfuehrung_status     null | 'offen' (geschickt) | 'laeuft' | 'fertig'
//   einfuehrung_schritt    zuletzt offener Schritt (zum Weitermachen)
//   geschickt_am/_von, fertig_am, aktualisiert_am/_von
//
// Feldtypen: text (einzeilig), lang (mehrzeilig), chips (eins), multi (mehrere),
// beide Chip-Arten mit „+ eigenes“. pflicht = ohne Antwort kein „Weiter“.

const STERNZEICHEN = ['Widder', 'Stier', 'Zwillinge', 'Krebs', 'Löwe', 'Jungfrau', 'Waage', 'Skorpion', 'Schütze', 'Steinbock', 'Wassermann', 'Fische']
const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

export const SCHRITTE = [
  {
    key: 'willkommen', titel: 'Willkommen', icon: '👋', felder: [],
  },
  {
    key: 'basics', titel: 'Basics', icon: '🙋‍♀️', unter: 'Das erfahren deine Fans über dich.',
    felder: [
      { key: 'fan_name', label: 'Name für Fans', typ: 'text', ph: 'z. B. Elina' },
      { key: 'spitznamen', label: 'Spitznamen', typ: 'text', ph: 'z. B. Eli, Lina' },
      { key: 'alter', label: 'Alter', typ: 'text', ph: 'z. B. 23', pflicht: true, halb: true },
      { key: 'geburtstag', label: 'Geburtstag', typ: 'text', ph: 'z. B. 14.03.', halb: true },
      { key: 'sternzeichen', label: 'Sternzeichen', typ: 'chips', optionen: STERNZEICHEN },
      { key: 'region', kurz: 'Wohnt in', label: 'Wo wohnst du (ungefähr)?', typ: 'text', ph: 'z. B. Süddeutschland, NRW', tipp: 'Bundesland oder Region reicht, keine Stadt', pflicht: true },
      { key: 'herkunft', kurz: 'Herkunft', label: 'Herkunft / kultureller Background', typ: 'text', ph: 'z. B. deutsch-italienisch' },
      { key: 'sprachen', kurz: 'Sprachen', label: 'Sprachen, in denen du mit Fans schreibst', typ: 'multi', optionen: ['Deutsch', 'Englisch', 'Spanisch', 'Französisch', 'Italienisch', 'Türkisch', 'Russisch', 'Polnisch'] },
      { key: 'beziehung', kurz: 'Beziehung', label: 'Beziehungsstatus', typ: 'chips', optionen: ['Single', 'Vergeben', 'Verheiratet', 'Kompliziert', 'Sag ich nicht'], pflicht: true },
      { key: 'beziehung_fans', kurz: 'Fans wird erzählt', label: 'Was wird Fans dazu erzählt?', typ: 'lang', ph: 'z. B. „offiziell Single“, Freund nie erwähnen', pflicht: true },
      { key: 'wohnen', label: 'Wohnsituation', typ: 'chips', optionen: ['Allein', 'WG', 'Mit Partner', 'Bei den Eltern'] },
      { key: 'haustiere', kurz: 'Haustiere', label: 'Haustiere (mit Namen)', typ: 'text', ph: 'z. B. Katze Luna, Hund Bruno' },
      { key: 'auto', kurz: 'Auto/Führerschein', label: 'Auto / Führerschein', typ: 'chips', optionen: ['Führerschein + Auto', 'Führerschein, kein Auto', 'Kein Führerschein'] },
      { key: 'auto_info', kurz: 'Auto', label: 'Welches Auto?', typ: 'text', ph: 'optional' },
    ],
  },
  {
    key: 'koerper', titel: 'Körper & Aussehen', icon: '📏',
    felder: [
      { key: 'groesse', label: 'Größe', typ: 'text', ph: 'z. B. 168 cm', halb: true },
      { key: 'gewicht', label: 'Gewicht', typ: 'text', ph: 'z. B. 55 kg', halb: true },
      { key: 'kleidergroesse', label: 'Kleidergröße', typ: 'chips', optionen: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
      { key: 'bh', kurz: 'BH', label: 'BH-Größe', typ: 'text', ph: 'z. B. 75C', halb: true },
      { key: 'schuhgroesse', label: 'Schuhgröße', typ: 'text', ph: 'z. B. 38', halb: true },
      { key: 'augen', label: 'Augenfarbe', typ: 'chips', optionen: ['Blau', 'Grün', 'Braun', 'Grau', 'Haselnuss'] },
      { key: 'haare', label: 'Haare (Farbe & Länge)', typ: 'text', ph: 'z. B. blond, lang' },
      { key: 'haare_natur', label: 'Haarfarbe', typ: 'chips', optionen: ['Natur', 'Gefärbt'] },
      { key: 'brille', label: 'Brille / Kontaktlinsen', typ: 'chips', optionen: ['Nein', 'Brille', 'Kontaktlinsen', 'Beides'] },
      { key: 'intim', label: 'Intimbereich', typ: 'chips', optionen: ['Rasiert', 'Getrimmt', 'Natürlich'] },
      { key: 'tattoos', kurz: 'Tattoos', label: 'Tattoos (was und wo)', typ: 'lang', ph: 'z. B. Rose am Unterarm' },
      { key: 'piercings', label: 'Piercings', typ: 'text', ph: 'z. B. Nase, Bauchnabel' },
      { key: 'narben', kurz: 'Narben', label: 'Sichtbare Narben (wo)', typ: 'text' },
      { key: 'merkmale', kurz: 'Merkmale', label: 'Körperliche Merkmale, die wir wissen sollten', typ: 'lang', ph: 'z. B. Po-Fokus, Sommersprossen, Körperschmuck' },
    ],
  },
  {
    key: 'interessen', titel: 'Interessen & Lieblingssachen', icon: '🎮',
    felder: [
      { key: 'hobbys', label: 'Hobbys', typ: 'lang' },
      { key: 'sport', label: 'Sport', typ: 'multi', optionen: ['Gym', 'Laufen', 'Yoga', 'Pilates', 'Tanzen', 'Schwimmen', 'Reiten', 'Kampfsport', 'Kein Sport'] },
      { key: 'games', label: 'Games', typ: 'text' },
      { key: 'buecher', kurz: 'Liest gern', label: 'Was liest du gern?', typ: 'text' },
      { key: 'kultur', kurz: 'Kultur', label: 'Kulturell', typ: 'multi', optionen: ['Natur', 'Geschichte', 'Burgen', 'Museen', 'Wissenschaft', 'Kunst', 'Konzerte', 'Festivals'] },
      { key: 'filme', kurz: 'Filme', label: 'Lieblingsfilme', typ: 'text' },
      { key: 'serien', kurz: 'Serien', label: 'Lieblingsserien', typ: 'text' },
      { key: 'genres', kurz: 'Genres', label: 'Lieblingsgenres', typ: 'multi', optionen: ['Horror', 'Komödie', 'Romantik', 'Action', 'Thriller', 'Fantasy', 'Sci-Fi', 'Anime', 'Doku', 'Reality-TV', 'True Crime'] },
      { key: 'musik', label: 'Musik', typ: 'text', ph: 'Genres, Lieblingskünstler' },
      { key: 'essen', kurz: 'Lieblingsessen', label: 'Lieblingsessen', typ: 'text' },
      { key: 'getraenk', kurz: 'Lieblingsgetränk', label: 'Lieblingsgetränk', typ: 'text' },
      { key: 'essen_nicht', kurz: 'Isst nicht', label: 'Was geht beim Essen gar nicht?', typ: 'text' },
      { key: 'allergien', kurz: 'Allergien', label: 'Allergien / Unverträglichkeiten', typ: 'text' },
      { key: 'lieblingsort', label: 'Lieblingsort', typ: 'text' },
      { key: 'traumreise', label: 'Traumreiseziel', typ: 'text' },
      { key: 'verreist', kurz: 'War schon in', label: 'Wo warst du schon?', typ: 'text', ph: 'für Urlaubsgeschichten' },
      { key: 'wochenende', kurz: 'Wochenende', label: 'Was machst du am Wochenende?', typ: 'lang' },
    ],
  },
  {
    key: 'persoenlichkeit', titel: 'Persönlichkeit & Background', icon: '✨',
    felder: [
      { key: 'persoenlichkeit', kurz: 'Persönlichkeit', label: 'Wie würdest du deine Persönlichkeit beschreiben?', typ: 'lang' },
      { key: 'werte', kurz: 'Werte', label: 'Welche Werte sind dir wichtig?', typ: 'text' },
      { key: 'angewohnheiten', label: 'Angewohnheiten', typ: 'text', ph: 'z. B. ehrlich, direkt, perfektionistisch' },
      { key: 'alkohol', label: 'Alkohol', typ: 'chips', optionen: ['Nein', 'Selten', 'Gelegentlich', 'Gern'] },
      { key: 'alkohol_was', kurz: 'Trinkt', label: 'Wenn ja, was?', typ: 'text', ph: 'z. B. Aperol, Wein' },
      { key: 'rauchen', label: 'Rauchen / Dampfen', typ: 'chips', optionen: ['Nein', 'Rauche', 'Dampfe', 'Beides'] },
      { key: 'job', kurz: 'Job', label: 'Was machst du beruflich? (Story für Fans)', typ: 'text' },
      { key: 'job_frueher', kurz: 'Früher', label: 'Was hast du früher gearbeitet?', typ: 'text' },
      { key: 'ausbildung', kurz: 'Ausbildung', label: 'Ausbildung / Qualifikationen', typ: 'text' },
    ],
  },
  {
    key: 'chatstil', titel: 'Dein Chat-Stil', icon: '💬', unter: 'Damit die Chatter so klingen wie du.',
    felder: [
      { key: 'fans_nennen', kurz: 'Nennt Fans', label: 'Wie nennst du Fans?', typ: 'text', ph: 'z. B. Babe, Süßer, Schatz' },
      { key: 'emojis_menge', label: 'Emojis', typ: 'chips', optionen: ['Kaum', 'Normal', 'Viele'] },
      { key: 'emojis', kurz: 'Lieblings-Emojis', label: 'Lieblings-Emojis', typ: 'text', ph: 'z. B. 😘 🙈 🔥' },
      { key: 'saetze', kurz: 'Typische Sätze', label: 'Typische Sätze oder Wörter', typ: 'lang', ph: 'z. B. „hehe“, „na du“' },
      { key: 'laenge', kurz: 'Schreibt', label: 'Wie schreibst du?', typ: 'chips', optionen: ['Kurz & knapp', 'Mittel', 'Ausführlich'] },
      { key: 'ton', label: 'Ton', typ: 'multi', optionen: ['Locker', 'Frech', 'Süß', 'Witzig', 'Romantisch', 'Dominant', 'Schüchtern'] },
      { key: 'dialekt', kurz: 'Dialekt/Slang', label: 'Dialekt / Slang', typ: 'text', ph: 'z. B. leicht bayerisch' },
    ],
  },
  {
    key: 'sexualitaet', titel: 'Sexualität & Grenzen', icon: '🔥', unter: 'Für deine Positionierung. Nur, was du willst.',
    felder: [
      { key: 'geht_klar', kurz: 'Geht klar', label: 'Welche Inhalte machst du gern / gehen klar?', typ: 'lang' },
      { key: 'manchmal', kurz: 'Nur manchmal', label: 'Was machst du nur selten oder manchmal?', typ: 'lang' },
      { key: 'rollen', kurz: 'Rollen', label: 'Rollen & Dynamiken', typ: 'multi', optionen: ['Sub', 'Brat', 'Dominant', 'Switch', 'Girlfriend-Experience', 'Vanilla'] },
      { key: 'praktiken', kurz: 'Praktiken', label: 'Welche Praktiken magst du?', typ: 'lang' },
      { key: 'vorlieben', kurz: 'Vorlieben', label: 'Spezielle Vorlieben', typ: 'lang' },
      { key: 'richtung', label: 'Richtung', typ: 'multi', optionen: ['Süß', 'Dark', 'Edgy', 'Nerdy', 'Dominant', 'Devot', 'Girl next door', 'Elegant'] },
      { key: 'aesthetik', label: 'Ästhetik', typ: 'multi', optionen: ['Metal', 'Gothic', 'Nerd', 'Tattoo-Look', 'Sporty', 'Glam', 'E-Girl', 'Boho'] },
      { key: 'outfits', kurz: 'Outfits/Fetisch', label: 'Outfits, Stile, Fetisch-Themen', typ: 'lang' },
      { key: 'signature', kurz: 'Signature-Look', label: 'Dein Signature-Look', typ: 'text' },
      { key: 'partner', kurz: 'Partner-Content', label: 'Content mit Partner: was darf erwähnt werden, was nicht?', typ: 'lang' },
      { key: 'cam', kurz: 'Cam/Live', label: 'Machst du Cam / Live?', typ: 'chips', optionen: ['Ja', 'Nein', 'Vielleicht'], pflicht: true },
      { key: 'dirty_talk', kurz: 'Dirty Talk', label: 'Dirty Talk in Voice / Video?', typ: 'chips', optionen: ['Voice', 'Video', 'Beides', 'Nein'], pflicht: true },
      { key: 'treffen', kurz: 'Usertreffen', label: 'Usertreffen?', typ: 'chips', optionen: ['Nein', 'Ja'], pflicht: true },
      { key: 'gesicht', kurz: 'Gesicht zeigen', label: 'Gesicht zeigen?', typ: 'chips', optionen: ['Ja', 'Nein', 'Teilweise'], pflicht: true },
      { key: 'niemals', kurz: 'Niemals', label: 'Was willst du niemals zeigen oder machen?', typ: 'lang', pflicht: true },
    ],
  },
  {
    key: 'angebot', titel: 'Angebot, Preise & No Gos', icon: '💰', unter: 'Das kommt direkt in dein Board.',
    board: true,
    felder: [
      { key: 'kommt_an', kurz: 'Kommt gut an', label: 'Was kommt bei Fans gut an?', typ: 'lang' },
      { key: 'wuensche', kurz: 'Setzt gern um', label: 'Wünsche, die du gern umsetzt', typ: 'lang', ph: 'z. B. bestimmte Outfits' },
      { key: 'custom_dauer', kurz: 'Customs in', label: 'Wie schnell kannst du Customs umsetzen?', typ: 'chips', optionen: ['1–2 Tage', '3–5 Tage', '1 Woche', 'Länger'] },
    ],
  },
  {
    key: 'kommunikation', titel: 'Kommunikation & Alltag', icon: '📅',
    felder: [
      { key: 'komm_nogos', kurz: 'Kommunikations-No-Gos', label: 'Absolute Kommunikations-No-Gos', typ: 'lang' },
      { key: 'themen_nie', kurz: 'Beantwortet nie', label: 'Themen, die du niemals beantwortest', typ: 'lang' },
      { key: 'user_nicht', kurz: 'Will nicht', label: 'Welche User willst du nicht haben?', typ: 'lang' },
      { key: 'woche', kurz: 'Typische Woche', label: 'Wie sieht deine typische Woche aus?', typ: 'lang' },
      { key: 'tage_gut', kurz: 'Gut erreichbar', label: 'Gut erreichbar an', typ: 'multi', optionen: TAGE },
      { key: 'tage_schlecht', kurz: 'Nicht erreichbar', label: 'Komplett ungeeignet', typ: 'multi', optionen: TAGE },
      { key: 'flexibel', kurz: 'Flexibel', label: 'Wie flexibel bist du?', typ: 'chips', optionen: ['Sehr', 'Mittel', 'Wenig'] },
      { key: 'zeitzone', kurz: 'Zeitzone', label: 'Zeitzone / Land', typ: 'text', ph: 'z. B. Deutschland' },
    ],
  },
]

export const FRAGE_SCHRITTE = SCHRITTE.filter(s => s.felder.length || s.board)
export const ALLE_FELDER = SCHRITTE.flatMap(s => s.felder)

export const hatWert = (v) => Array.isArray(v) ? v.length > 0 : !!String(v ?? '').trim()
// Kurzes Etikett für Anzeige und Export (Frage-Labels sind fürs Ausfüllen)
export const etikett = (f) => f.kurz || f.label.replace(/\?$/, '')
export const wertText = (v) => Array.isArray(v) ? v.join(', ') : String(v ?? '').trim()

// Pflichtfelder eines Schritts, die noch leer sind
export function fehlendePflicht(schritt, antworten = {}) {
  return schritt.felder.filter(f => f.pflicht && !hatWert(antworten[f.key]))
}

// Wie viele Felder sind ausgefüllt?
export function fortschritt(antworten = {}) {
  const gesamt = ALLE_FELDER.length
  const voll = ALLE_FELDER.filter(f => hatWert(antworten[f.key])).length
  return { voll, gesamt }
}

// ── Laden / Speichern ──
// Fehlt die Tabelle (SQL noch nicht gelaufen), liefert laden `fehlt: true`
// und die Oberfläche blendet alles aus, statt zu stören.
export async function steckbriefLaden(name) {
  const { data, error } = await supabase.from('model_steckbrief').select('*').eq('model_name', name).maybeSingle()
  if (error) return { fehlt: true, zeile: null, fehler: error }
  return { fehlt: false, zeile: data || null }
}

export async function steckbriefSpeichern(name, felder, wer) {
  const { error } = await supabase.from('model_steckbrief').upsert({
    model_name: name, ...felder, aktualisiert_am: new Date().toISOString(), aktualisiert_von: wer || null,
  }, { onConflict: 'model_name' })
  return error || null
}

// Mehrere auf einmal (Chatter-Portal, Admin)
export function useSteckbriefe(namen) {
  const [map, setMap] = useState({})
  const [fehlt, setFehlt] = useState(false)
  const schluessel = (namen || []).slice().sort().join('|')
  const laden = useCallback(async () => {
    if (!schluessel) { setMap({}); return }
    const { data, error } = await supabase.from('model_steckbrief').select('*').in('model_name', schluessel.split('|'))
    if (error) { setFehlt(true); return }
    setFehlt(false)
    setMap(Object.fromEntries((data || []).map(z => [z.model_name, z])))
  }, [schluessel])
  useEffect(() => { laden() }, [laden])
  return { map, fehlt, neuLaden: laden }
}

// ── Text für CreatorHero ──
// Alle ausgefüllten Felder, nach Themen. Aus dem Board kommen Angebot (ja/nein)
// und No Gos dazu — KEINE Preise.
const ANGEBOT_LABEL = { custom: 'Custom', sexting: 'Sexting', bewertungen: 'Bewertungen', audios: 'Audios', video_chat: 'Videocall', telefonieren: 'Telefonieren' }

export function creatorHeroText(name, antworten = {}, { services = {}, nogos = [] } = {}) {
  const a = antworten
  const zeilen = []
  const kopf = [a.fan_name || name, hatWert(a.alter) ? wertText(a.alter) : null, hatWert(a.geburtstag) ? `Geburtstag ${wertText(a.geburtstag)}` : null].filter(Boolean).join(' · ')
  zeilen.push(kopf.toUpperCase())
  for (const s of FRAGE_SCHRITTE) {
    const teile = s.felder
      .filter(f => !['fan_name', 'alter', 'geburtstag'].includes(f.key) && hatWert(a[f.key]))
      .map(f => `${etikett(f)}: ${wertText(a[f.key])}`)
    if (s.board) {
      const ja = Object.entries(services).filter(([, v]) => v?.enabled === true).map(([k]) => ANGEBOT_LABEL[k] || k)
      const nein = Object.entries(services).filter(([, v]) => v?.enabled === false).map(([k]) => ANGEBOT_LABEL[k] || k)
      if (ja.length) teile.unshift(`Bietet an: ${ja.join(', ')}`)
      if (nein.length) teile.splice(ja.length ? 1 : 0, 0, `Nicht: ${nein.join(', ')}`)
      if (nogos.length) teile.push(`No Gos: ${nogos.map(n => n.title).join(', ')}`)
    }
    if (!teile.length) continue
    zeilen.push('', `— ${s.titel.toUpperCase()} —`, ...teile)
  }
  return zeilen.join('\n')
}
