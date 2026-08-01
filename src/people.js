import { supabase } from './supabase'

// v4.16.0 — Eine Wahrheit dafür, wer nicht mehr dabei ist.
//
// Das Problem, das dahintersteckt: Es gab zwei getrennte Merker.
//   user_roles.status            'active' | 'suspended' | 'offboarded'
//   chatters_contact.active      true | false | null
//   models_contact.active        true | false | null
//
// Beim Offboarden wurden beide gesetzt — aber die zweite Zeile über
// `.eq('name', display_name)`. Trifft der Name nicht exakt, ändert Supabase
// null Zeilen und meldet trotzdem KEINEN Fehler. Ergebnis: Die Person
// verschwindet aus der Mitgliederliste, bleibt aber im Dienstplan und in der
// Empfängerliste des Telegram-Versands stehen. Genau diese Abweichung ist
// aufgefallen.
//
// Deshalb: Listen fragen ab jetzt zusätzlich hier nach. Der Abgleich läuft über
// den kleingeschriebenen Namen, damit „Sandra" und „sandra" dasselbe sind.
//
// Wichtig: Das ersetzt das Feld `active` NICHT — es ergänzt es. `active` ist
// weiterhin der Schalter für Kontakte ohne eigenen Login (die vom Telegram-Bot
// angelegten), die gar keinen user_roles-Eintrag haben.

export async function ladeInaktiveNamen() {
  const { data, error } = await supabase.from('user_roles').select('display_name, status')
  if (error) return new Set()
  return new Set(
    (data || [])
      .filter(u => u.status && u.status !== 'active')
      .map(u => String(u.display_name || '').trim().toLowerCase())
      .filter(Boolean),
  )
}

// Bequemer Filter für Listen aus *_contact: raus, wenn active === false ODER
// der Name zu einem stillgelegten/offboardeten Account gehört.
export function ohneInaktive(liste, inaktiveNamen) {
  return (liste || []).filter(x =>
    x.active !== false && !inaktiveNamen.has(String(x.name || '').trim().toLowerCase()),
  )
}
