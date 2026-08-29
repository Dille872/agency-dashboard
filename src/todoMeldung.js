/**
 * v4.43.0 — Abhaken und Melden entkoppeln.
 *
 * Vorher hing der Telegram-Versand direkt am Haken: jeder Klick auf „erledigt"
 * schickte sofort eine Nachricht, und weil der Versand vor dem State-Update
 * lief (und die Empfänger nacheinander abgearbeitet wurden), bewegte sich der
 * Haken erst Sekunden später. Wer sich verklickte oder unschlüssig hin und her
 * hakte, löste jedes Mal erneut eine Meldung aus.
 *
 * Jetzt gilt:
 *
 * 1. Der Haken sitzt sofort (optimistisch) — die Datenbank folgt.
 * 2. Die Meldung wartet 20 Sekunden. In der Zeit steht ein „Nicht melden"
 *    daneben; auch das Zurücknehmen des Hakens bricht sie ab.
 * 3. Pro Aufgabe geht höchstens EINE Meldung raus. Das entscheidet nicht der
 *    Browser, sondern die Datenbank: `notified_at` wird bedingt von NULL auf
 *    einen Zeitstempel gesetzt, und nur wer diese eine Zeile trifft, sendet.
 *    Damit kann auch niemand anders dieselbe Aufgabe ein zweites Mal melden.
 *
 * Bewusst so: Die Frist ist ein Fenster zum Zurücknehmen, keine
 * Bestätigungspflicht. Wer abhakt und weiterklickt, hat gemeldet — beim
 * Verlassen der Ansicht wird eine offene Meldung deshalb sofort ausgeführt,
 * nicht verworfen.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

export const MELDE_FRIST_MS = 20000

export function useTodoMeldung({ displayName, sende, patchLokal, fristMs = MELDE_FRIST_MS }) {
  // [{ id, titel, sekunden }] — für den Hinweis. Die id behält ihren
  // ursprünglichen Typ; über Object.keys wäre aus einer Zahl ein String
  // geworden und „Nicht melden" hätte den Timer nicht mehr gefunden.
  const [wartend, setWartend] = useState([])
  // id -> { timeout, ende, todo }
  const timers = useRef(new Map())

  // Callbacks über Refs: der Timer feuert später und würde sonst auf der
  // Fassung von damals hängenbleiben (stale closure).
  const sendeRef = useRef(sende); sendeRef.current = sende
  const patchRef = useRef(patchLokal); patchRef.current = patchLokal
  const nameRef = useRef(displayName); nameRef.current = displayName

  const vergiss = useCallback((id) => {
    const e = timers.current.get(id)
    if (e) clearTimeout(e.timeout)
    timers.current.delete(id)
    setWartend(prev => prev.some(w => w.id === id) ? prev.filter(w => w.id !== id) : prev)
  }, [])

  /** Frist abgelaufen (oder Ansicht wird verlassen): jetzt wirklich melden. */
  const ausfuehren = useCallback(async (id) => {
    const e = timers.current.get(id)
    if (!e) return
    vergiss(id)
    // Der Guard liegt in der Datenbank, nicht im Browser: nur wenn die Aufgabe
    // noch als erledigt gilt UND noch nie gemeldet wurde, trifft das Update eine
    // Zeile. `.select()` ist Pflicht — ohne Treffer meldet Supabase keinen Fehler.
    const { data, error } = await supabase
      .from('todos')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', id).eq('completed', true).is('notified_at', null)
      .select('id')
    if (error) { console.error('Meldung konnte nicht vermerkt werden:', error.message); return }
    if (!data || data.length === 0) return   // schon gemeldet oder wieder geöffnet
    patchRef.current?.(id, { notified_at: new Date().toISOString() })
    try { await sendeRef.current?.(e.todo) } catch (err) { console.error('Telegram-Fehler:', err) }
  }, [vergiss])

  /** „Nicht melden" — der Haken bleibt, nur die Nachricht entfällt. */
  const nichtMelden = useCallback((id) => vergiss(id), [vergiss])

  const abhaken = useCallback(async (todo) => {
    const completed = !todo.completed
    const patch = {
      completed,
      completed_by: completed ? nameRef.current : null,
      completed_at: completed ? new Date().toISOString() : null,
    }
    // Sofort sichtbar. Die Datenbank läuft hinterher, nicht der Haken.
    patchRef.current?.(todo.id, patch)

    const { error } = await supabase.from('todos').update(patch).eq('id', todo.id)
    if (error) {
      patchRef.current?.(todo.id, {
        completed: todo.completed,
        completed_by: todo.completed_by ?? null,
        completed_at: todo.completed_at ?? null,
      })
      alert('Konnte nicht gespeichert werden: ' + error.message)
      return
    }

    // Wieder geöffnet: eine wartende Meldung ist damit hinfällig.
    if (!completed) { vergiss(todo.id); return }
    // Einmal gemeldet ist gemeldet — auch nach erneutem Öffnen und Abhaken.
    if (todo.notified_at) return
    if (timers.current.has(todo.id)) return

    const ende = Date.now() + fristMs
    const timeout = setTimeout(() => ausfuehren(todo.id), fristMs)
    timers.current.set(todo.id, { timeout, ende, todo: { ...todo, ...patch } })
    setWartend(prev => [
      ...prev.filter(w => w.id !== todo.id),
      { id: todo.id, titel: todo.title, sekunden: Math.ceil(fristMs / 1000) },
    ])
  }, [fristMs, vergiss, ausfuehren])

  // Countdown für die Anzeige. Läuft nur, solange überhaupt etwas wartet.
  const laeuft = wartend.length > 0
  useEffect(() => {
    if (!laeuft) return
    const iv = setInterval(() => {
      setWartend(prev => prev.map(w => {
        const e = timers.current.get(w.id)
        if (!e) return w
        return { ...w, sekunden: Math.max(0, Math.ceil((e.ende - Date.now()) / 1000)) }
      }))
    }, 500)
    return () => clearInterval(iv)
  }, [laeuft])

  // Ansicht wird verlassen: offene Meldungen sofort ausführen statt sie
  // stillschweigend fallen zu lassen. Wer abhakt und weiterklickt, hat gemeldet.
  const ausfuehrenRef = useRef(ausfuehren); ausfuehrenRef.current = ausfuehren
  useEffect(() => () => {
    for (const id of [...timers.current.keys()]) ausfuehrenRef.current(id)
  }, [])

  return { abhaken, nichtMelden, wartend }
}
