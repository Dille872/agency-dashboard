// src/activity.js
// v3.97.0 — Protokoll für Admin-Aktionen.
//
// Warum überhaupt: Aktionen wie "Nachricht rausgeschickt" oder "Aufgabe verteilt"
// lassen sich aus den Tabellen ableiten (`messages.sent_by`, `todos.created_by`).
// Für Dienstplan, Guidelines, Rollen und Steckbriefe geht das NICHT — dort wird
// beim Speichern der alte Stand überschrieben, ohne dass jemand festhält, wer es war.
// Diese Datei schreibt genau solche Aktionen in `activity_log`.
//
// Regel: Protokollieren darf NIE den eigentlichen Ablauf blockieren. Jeder Fehler
// wird geschluckt und nur in der Konsole vermerkt.

import { supabase } from './supabase'

let cachedActor = null

// Anzeigename des eingeloggten Users. Reihenfolge wie im restlichen Dashboard:
// full_name aus den Metadaten, sonst der Teil vor dem @ der E-Mail.
async function getActor() {
  if (cachedActor) return cachedActor
  try {
    const { data } = await supabase.auth.getUser()
    const u = data?.user
    cachedActor =
      u?.user_metadata?.full_name ||
      u?.user_metadata?.name ||
      (u?.email ? u.email.split('@')[0] : null) ||
      'Unbekannt'
  } catch {
    cachedActor = 'Unbekannt'
  }
  return cachedActor
}

// Nach einem Benutzerwechsel den gemerkten Namen verwerfen
export function resetActivityActor() { cachedActor = null }

/**
 * Eine Aktion protokollieren.
 * @param {string} action  Technischer Schlüssel, z.B. 'schedule.publish'
 * @param {object} opts    { entity, detail, meta }
 *   entity — worauf sich die Aktion bezieht ("KW 32", "Chiara")
 *   detail — Klartext für die Anzeige in der Glocke
 *   meta   — optionales JSON für spätere Auswertungen
 */
export async function logActivity(action, { entity = null, detail = null, meta = null } = {}) {
  try {
    const actor = await getActor()
    const { error } = await supabase.from('activity_log').insert({ actor, action, entity, detail, meta })
    if (error) console.error('logActivity:', error.message)
  } catch (e) {
    console.error('logActivity fehlgeschlagen:', e)
  }
}

// Klartext-Vorlagen — hier zentral, damit Glocke und Schreibstellen nicht auseinanderlaufen
export const ACTION_LABELS = {
  'schedule.edit': 'hat den Dienstplan bearbeitet',
  'schedule.publish': 'hat den Dienstplan veröffentlicht',
  'schedule.unpublish': 'hat den Dienstplan zurückgezogen',
  'schedule.autoplan': 'hat den Dienstplan automatisch erzeugt',
  'guideline.create': 'hat eine Guideline angelegt',
  'guideline.edit': 'hat eine Guideline bearbeitet',
  'guideline.delete': 'hat eine Guideline gelöscht',
  'user.roles': 'hat Rollen geändert',
  'user.status': 'hat einen Account-Status geändert',
  'user.invite': 'hat eine E-Mail zur Registrierung freigeschaltet',
  'user.invite.revoke': 'hat eine Freischaltung zurückgezogen',
  'user.selfsignup': 'hat sich selbst registriert',
  'bot.message': 'hat eine Bot-Nachricht geändert',
  'suggestions.basics': 'hat die KI-Basics geändert',
  'persona.edit': 'hat einen Steckbrief bearbeitet',
  'occasion.edit': 'hat die Anlässe geändert',
  'customcontent.status': 'hat einen Custom bearbeitet',
  'customcontent.payment': 'hat eine Zahlung eingetragen',
  'customcontent.reminder': 'hat einen Custom-Reminder geschickt',
}
