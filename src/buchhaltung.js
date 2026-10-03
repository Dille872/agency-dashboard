// ── Buchhaltung (v5.37.0) ──────────────────────────────────────────────────
// Ablauf: Admin gibt eine Abrechnung frei (Monat oder freier Zeitraum) → je
// Chatter eine Zeile in chatter_abrechnungen mit den Beträgen von DIESEM
// Moment (spätere Änderungen an Prozenten/Kurs verändern sie nicht) → Chatter
// lädt seine Rechnung hoch → Admin drückt „Bezahlt“ (Datum + Betrag).
// Die Rechnung rechnet exakt wie Billing (billingRechnung.js).

import { supabase } from './supabase'
import { sendTelegramMessage, notifyAdmins } from './telegram'
import { chatterVerteilen, chatterRechnung, istInaktiv } from './billingRechnung'
import { chatterNachricht, zeitraumText, abrechnungenPdf } from './billingExport'

export const STATUS = {
  offen:    { label: 'Rechnung fehlt',     farbe: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  rechnung: { label: 'Rechnung da',        farbe: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  klaerung: { label: 'Klärung',            farbe: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  bezahlt:  { label: 'Bezahlt',            farbe: '#34d399', bg: 'rgba(16,185,129,0.15)' },
}

export const euro = (v) => v == null || v === '' ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
export const dollar = (v) => v == null ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $'
export const datum = (iso) => iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
export const datumZeit = (iso) => iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
export const heuteIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
export const monatName = (m) => new Date(m + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
export const fehltTabelle = (error) => !!error && /chatter_abrechnungen|does not exist|schema cache/i.test(error.message || '')

const letzterTagVon = (monat) => { const [y, m] = monat.split('-').map(Number); return `${monat}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }

// Zeile aus der Datenbank → Form, die billingExport (PDF/Nachricht) erwartet
export const alsBillingZeile = (a) => ({
  name: a.chatter_name,
  s: a.prozent != null ? { percentage: Number(a.prozent), include_chat: a.nur_chat !== false } : null,
  rev: { chat: Number(a.umsatz_chat_usd || 0), total: Number(a.umsatz_gesamt_usd || 0) },
  x: a.auszahlung_usd != null ? { base: Number(a.basis_usd || 0), auszahlung: Number(a.auszahlung_usd) } : null,
})

export async function abrechnungPdf(a) {
  return abrechnungenPdf({ art: 'chatter', zeilen: [alsBillingZeile(a)], monat: a.monat, kurs: a.kurs, bis: a.bis, von: a.frei ? a.von : null })
}

// ── Laden ───────────────────────────────────────────────────────────────────
export async function abrechnungenLaden(chatter = null) {
  let q = supabase.from('chatter_abrechnungen').select('*').order('von', { ascending: false }).order('chatter_name')
  if (chatter) q = q.eq('chatter_name', chatter)
  return q
}

// Vorschau für die Freigabe: dieselbe Rechnung wie in Billing
export async function vorschauRechnen({ monat, von, bis, frei }) {
  const ab = frei ? von : `${monat}-01`
  const ende = frei ? bis : letzterTagVon(monat)
  const bezug = frei ? bis.slice(0, 7) : monat
  const [c, s, al, snaps, kurse, vorhanden] = await Promise.all([
    supabase.from('chatters_contact').select('name, active, telegram_id').order('name'),
    supabase.from('billing_settings').select('*').eq('person_type', 'chatter'),
    supabase.from('chatter_aliases').select('*'),
    supabase.from('chatter_snapshots').select('rows,business_date').gte('business_date', ab).lte('business_date', ende),
    supabase.from('billing_kurse').select('*').eq('monat', bezug),
    supabase.from('chatter_abrechnungen').select('chatter_name').eq('von', ab).eq('bis', ende),
  ])
  if (vorhanden.error && fehltTabelle(vorhanden.error)) return { fehler: 'Datenbank fehlt noch: einmal sql/buchhaltung.sql ausführen.' }
  const chatters = c.data || []
  const settings = s.data || []
  const { proPerson } = chatterVerteilen(chatters, al.data || [], snaps.data || [])
  const kurs = kurse.data?.[0] ? Number(kurse.data[0].usd_eur) : null
  const schon = new Set((vorhanden.data || []).map(x => x.chatter_name))
  const tage = new Set((snaps.data || []).map(x => x.business_date)).size
  const zeilen = chatters.map(ch => {
    const st = settings.find(x => x.person_name === ch.name)
    const rev = proPerson[ch.name] || { chat: 0, total: 0 }
    const x = chatterRechnung(st, rev, bezug)
    return { name: ch.name, telegram: ch.telegram_id || null, s: st, rev, x, inaktiv: istInaktiv(st, bezug), schon: schon.has(ch.name) }
  }).filter(z => z.x && z.x.auszahlung > 0 && !z.inaktiv)
  return { zeilen, kurs, ab, ende, bezug, tage }
}

export async function freigeben({ vorschau, auswahl, frei, wer, telegram }) {
  const { zeilen, kurs, ab, ende, bezug } = vorschau
  const gewaehlt = zeilen.filter(z => auswahl.has(z.name) && !z.schon)
  if (!gewaehlt.length) return { anzahl: 0, gesendet: 0 }
  const bezeichnung = frei ? zeitraumText(bezug, ende, ab) : monatName(bezug)
  const rows = gewaehlt.map(z => ({
    chatter_name: z.name, monat: bezug, von: ab, bis: ende, frei: !!frei, bezeichnung,
    umsatz_chat_usd: round(z.rev.chat), umsatz_gesamt_usd: round(z.rev.total), basis_usd: round(z.x.base),
    prozent: z.s.percentage, nur_chat: !!z.s.include_chat, auszahlung_usd: round(z.x.auszahlung),
    kurs, betrag_eur: kurs ? round(z.x.auszahlung * kurs) : null, freigegeben_von: wer || null,
  }))
  // ignoreDuplicates: was es für Person + Zeitraum schon gibt, bleibt unangetastet
  const { error } = await supabase.from('chatter_abrechnungen').upsert(rows, { onConflict: 'chatter_name,von,bis', ignoreDuplicates: true })
  if (error) return { error }
  let gesendet = 0
  if (telegram) {
    for (const z of gewaehlt) {
      if (!z.telegram) continue
      const text = chatterNachricht(z, bezug, kurs, ende, frei ? ab : null)
        .replace(/\nThirteen 87$/, '') + `\n🧾 Bitte schreib deine Rechnung und lade sie im Dashboard hoch (Startseite → „Rechnung“).${linkZeile()}\n\nThirteen 87`
      const r = await sendTelegramMessage(z.telegram, text).catch(() => null)
      if (r?.ok) gesendet++
    }
  }
  return { anzahl: rows.length, gesendet }
}
const round = (v) => Math.round(Number(v || 0) * 100) / 100
const linkZeile = () => { try { return `\n<a href="${window.location.origin}/">Dashboard öffnen</a>` } catch { return '' } }

async function telegramVonChatter(name) {
  const { data } = await supabase.from('chatters_contact').select('telegram_id').eq('name', name).maybeSingle()
  return data?.telegram_id || null
}
const escHtml = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Rechnung hochladen (Chatter selbst oder Admin für ihn) ───────────────────
export async function rechnungHochladen(a, datei, { betrag = null, durchAdmin = false, wer = '' } = {}) {
  if (!datei) return { error: { message: 'Keine Datei gewählt.' } }
  if (datei.size > 15 * 1024 * 1024) return { error: { message: 'Datei ist größer als 15 MB.' } }
  const endung = (String(datei.name).match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'pdf').toLowerCase()
  const pfad = `${a.chatter_name}/${a.id}-${Date.now()}.${endung}`
  const up = await supabase.storage.from('rechnungen').upload(pfad, datei, { contentType: datei.type || (endung === 'pdf' ? 'application/pdf' : 'image/jpeg'), upsert: false })
  if (up.error) return { error: up.error }
  const url = supabase.storage.from('rechnungen').getPublicUrl(pfad).data.publicUrl
  const felder = { rechnung_url: url, rechnung_name: String(datei.name).slice(0, 120) }
  if (betrag != null && betrag !== '') felder.rechnung_betrag = Number(String(betrag).replace(/\./g, '').replace(',', '.')) || null
  const { error } = await supabase.from('chatter_abrechnungen').update(felder).eq('id', a.id)
  if (error) return { error }
  if (!durchAdmin) {
    try { await notifyAdmins(`🧾 <b>${escHtml(a.chatter_name)}</b> hat die Rechnung für ${escHtml(a.bezeichnung || a.monat)} hochgeladen${felder.rechnung_betrag ? ` (${euro(felder.rechnung_betrag)})` : ''}.${linkAdmin()}`) } catch { /* nur Hinweis */ }
  }
  void wer
  return {}
}
const linkAdmin = () => { try { return `\n<a href="${window.location.origin}/?tab=buchhaltung">Zur Buchhaltung</a>` } catch { return '' } }

// ── Admin-Aktionen ─────────────────────────────────────────────────────────
export async function alsBezahlt(a, { am, betrag, telegram = true }) {
  const b = betrag == null || betrag === '' ? null : Number(String(betrag).replace(/\./g, '').replace(',', '.'))
  const { error } = await supabase.from('chatter_abrechnungen').update({ status: 'bezahlt', bezahlt_am: am || heuteIso(), bezahlt_betrag: Number.isFinite(b) ? b : null }).eq('id', a.id)
  if (error) return { error }
  let info = ''
  if (telegram) {
    const tg = await telegramVonChatter(a.chatter_name)
    if (tg) {
      const r = await sendTelegramMessage(tg, `✅ Deine Rechnung für ${escHtml(a.bezeichnung || a.monat)} ist bezahlt.\nÜberwiesen am ${datum(am || heuteIso())}${Number.isFinite(b) && b ? ` · ${euro(b)}` : ''}\n\nThirteen 87`).catch(() => null)
      info = r?.ok ? 'Chatter per Telegram informiert' : 'Telegram ging nicht raus'
    } else info = 'Chatter hat keine Telegram-ID'
  }
  return { info }
}

export async function bezahltZurueck(a) {
  return supabase.from('chatter_abrechnungen').update({ status: a.rechnung_url ? 'rechnung' : 'offen' }).eq('id', a.id)
}

export async function klaerung(a, notiz) {
  const n = String(notiz || '').trim()
  const { error } = await supabase.from('chatter_abrechnungen').update({ status: 'klaerung', klaerung_notiz: n || null }).eq('id', a.id)
  if (error) return { error }
  const tg = await telegramVonChatter(a.chatter_name)
  if (!tg) return { info: 'Chatter hat keine Telegram-ID, bitte selbst Bescheid geben' }
  const r = await sendTelegramMessage(tg, `🧾 Zu deiner Rechnung für ${escHtml(a.bezeichnung || a.monat)} gibt es eine Rückfrage:\n\n${escHtml(n || 'Bitte melde dich kurz.')}\n\nDu kannst im Dashboard eine neue Rechnung hochladen.${linkZeile()}\n\nThirteen 87`).catch(() => null)
  return { info: r?.ok ? 'Chatter per Telegram informiert' : 'Telegram ging nicht raus' }
}

export async function erinnern(liste) {
  let gesendet = 0, ohne = 0
  for (const a of liste) {
    const tg = await telegramVonChatter(a.chatter_name)
    if (!tg) { ohne++; continue }
    const r = await sendTelegramMessage(tg, `🧾 Kleine Erinnerung: Deine Rechnung für ${escHtml(a.bezeichnung || a.monat)} fehlt noch.\nAuf die Rechnung: ${a.betrag_eur != null ? euro(a.betrag_eur) : dollar(a.auszahlung_usd)}\n\nBitte im Dashboard hochladen (Startseite → „Rechnung“).${linkZeile()}\n\nThirteen 87`).catch(() => null)
    if (r?.ok) { gesendet++; await supabase.from('chatter_abrechnungen').update({ erinnert_am: new Date().toISOString() }).eq('id', a.id) }
  }
  return { gesendet, ohne }
}

export async function zurueckziehen(a) {
  return supabase.from('chatter_abrechnungen').delete().eq('id', a.id)
}
