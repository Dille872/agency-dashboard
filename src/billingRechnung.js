// ── Billing-Rechnung (v5.37.0) ─────────────────────────────────────────────
// Aus BillingTab.jsx herausgezogen, damit die Buchhaltung exakt dieselbe
// Rechnung benutzt (Zuordnung CSV → Person, Satz, „inaktiv ab“). Inhalt unverändert.

export function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// v4.49.0: Zeilengetriebene Zuordnung — jede CSV-Zeile geht an höchstens EINEN
// Empfänger. Vorher wurde je Person mit includes() in beide Richtungen gesucht:
// „Max" bekam den Umsatz von „Maximilian" dazu, „Lena" den von „Helena", und
// zwei Accounts, die sich nur im Emoji unterscheiden („Chiara Sophie 💓/🍒"),
// wurden nach norm() gleich. Siehe claude/model-portal-doppelzaehlung.md.
//
// Reihenfolge je Zeile:
//   1. exakter Alias (csv_name, nur getrimmt)
//   2. normalisierter Alias — nur wenn er genau EINER Person gehört
//   3. Personenname selbst (normalisiert) — nur wenn eindeutig
// Alles andere landet sichtbar unter „Nicht zugeordnet" statt still bei
// irgendwem oder nirgends.
export function baueZuordnung(personen, aliasListe, aliasFeld) {
  const exakt = new Map()      // csv_name (trim) -> person
  const normMap = new Map()    // norm(csv_name) -> Set(person)
  const add = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v) }
  for (const a of aliasListe) {
    const csv = String(a.csv_name || '').trim()
    const person = a[aliasFeld]
    if (!csv || !person) continue
    exakt.set(csv, person)
    add(normMap, norm(csv), person)
  }
  const nameMap = new Map()    // norm(personenname) -> Set(person)
  for (const p of personen) add(nameMap, norm(p), p)

  return (rohName) => {
    const roh = String(rohName || '').trim()
    if (!roh) return { person: null, grund: 'leer' }
    if (exakt.has(roh)) return { person: exakt.get(roh) }
    const n = norm(roh)
    const perAlias = normMap.get(n)
    if (perAlias) {
      if (perAlias.size === 1) return { person: [...perAlias][0] }
      return { person: null, grund: 'mehrdeutig: ' + [...perAlias].join(' / ') }
    }
    const perName = nameMap.get(n)
    if (perName) {
      if (perName.size === 1) return { person: [...perName][0] }
      return { person: null, grund: 'mehrdeutig: ' + [...perName].join(' / ') }
    }
    return { person: null, grund: 'kein Alias' }
  }
}

// v5.22.0: Verteilung der CSV-Zeilen auf Personen (vorher inline im useMemo)
export function modelVerteilen(models, aliases, snaps) {
  const finde = baueZuordnung(models.map(m => m.name), aliases, 'model_name')
  const proPerson = {}
  const offen = {}
  for (const snap of snaps) {
    for (const row of snap.rows || []) {
      const roh = row.creator || row.name || ''
      const werte = {
        subs: (row.newSubsRevenue || 0) + (row.recurringSubsRevenue || 0),
        chat: row.messageRevenue || 0,
        tips: row.tipsRevenue || 0,
        total: row.revenue || 0,
      }
      const { person, grund } = finde(roh)
      const ziel = person
        ? (proPerson[person] ||= { subs: 0, chat: 0, tips: 0, total: 0 })
        : (offen[String(roh).trim() || '(leer)'] ||= { subs: 0, chat: 0, tips: 0, total: 0, grund })
      for (const k of ['subs', 'chat', 'tips', 'total']) ziel[k] += werte[k]
    }
  }
  return { proPerson, offen }
}
export function chatterVerteilen(chatters, chatterAliases, chatSnaps) {
  const finde = baueZuordnung(chatters.map(c => c.name), chatterAliases, 'chatter_name')
  const proPerson = {}
  const offen = {}
  for (const snap of chatSnaps) {
    for (const row of snap.rows || []) {
      const roh = row.name || row.chatter || ''
      // Summen-/Aggregatzeilen (Name enthält '*') nicht verteilen — wie in PerformanceTab
      if (String(roh).includes('*')) continue
      const rev = row.revenue || 0
      const { person, grund } = finde(roh)
      const ziel = person
        ? (proPerson[person] ||= { chat: 0, total: 0 })
        : (offen[String(roh).trim() || '(leer)'] ||= { chat: 0, total: 0, grund })
      ziel.chat += rev
      ziel.total += rev
    }
  }
  return { proPerson, offen }
}
// Anteile aus Einstellung + Umsatz
export function modelRechnung(s, rev) {
  if (!s) return null
  let base = 0
  if (s.include_subs) base += rev.subs
  if (s.include_chat) base += rev.chat
  if (s.include_tips) base += rev.tips
  const agentur = base * (s.percentage / 100)
  return { base, agentur, model: rev.total - agentur }
}
// v5.23.0: Chatter „inaktiv ab Monat“ — ab dann keine Auszahlung (Umsatz läuft trotzdem auf den Namen)
export const istInaktiv = (s, monat) => !!(s && s.inaktiv_ab && monat >= s.inaktiv_ab)
export function chatterRechnung(s, rev, monat = null) {
  if (!s) return null
  if (monat && istInaktiv(s, monat)) return null
  const base = s.include_chat ? rev.chat : rev.total
  return { base, auszahlung: base * (s.percentage / 100) }
}
export const monatGrenzen = (month) => {
  const [y, m] = month.split('-').map(Number)
  const nextY = m === 12 ? y + 1 : y
  const nextM = m === 12 ? 1 : m + 1
  return [month + '-01', nextY + '-' + String(nextM).padStart(2, '0') + '-01']
}
