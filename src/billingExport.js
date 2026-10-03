// ── Billing-Export (v5.33.0) ───────────────────────────────────────────────
// Excel: CSV mit Semikolon und deutschem Komma, öffnet sich direkt in Excel/Numbers.
// PDF:   fertige Abrechnung pro Person (eine Seite je Person), druckt im Browser
//        → „Als PDF sichern“. Keine zusätzliche Bibliothek nötig.
//
// zeilen kommen fertig gerechnet aus BillingTab:
//   Models:  { name, s, rev: { subs, chat, tips, total }, x: { base, agentur, model } | null }
//   Chatter: { name, s, rev: { chat, total }, x: { base, auszahlung } | null }

const zahl = (v) => Number(v || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dollar = (v) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const euro = (v) => zahl(v) + ' €'
const monatText = (m) => new Date(m + '-15').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function csvLaden(name, kopf, zeilen) {
  const zelle = (v) => {
    const t = typeof v === 'number' ? zahl(v) : String(v ?? '')
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const text = '﻿' + [kopf, ...zeilen].map(r => r.map(zelle).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const satzModel = (s) => s ? `${s.percentage} % (${[s.include_subs && 'Subs', s.include_chat && 'Chat', s.include_tips && 'Tips'].filter(Boolean).join(' + ') || '—'})` : 'kein Satz'
const satzChatter = (s) => s ? `${s.percentage} % von ${s.include_chat ? 'Chat Revenue' : 'Gesamt'}` : 'kein Satz'

export function excelModels(zeilen, monat, kurs) {
  const k = kurs ? Number(kurs) : null
  const kopf = ['Model', 'Satz', 'Subs $', 'Chat $', 'Tips $', 'Gesamt $', 'Basis $', 'Agentur $', 'Model $', ...(k ? ['Agentur €', 'Model €'] : [])]
  const rows = zeilen.map(z => [z.name, satzModel(z.s), z.rev.subs, z.rev.chat, z.rev.tips, z.rev.total, z.x ? z.x.base : '', z.x ? z.x.agentur : '', z.x ? z.x.model : '',
    ...(k ? [z.x ? z.x.agentur * k : '', z.x ? z.x.model * k : ''] : [])])
  const s = (f) => zeilen.reduce((t, z) => t + (f(z) || 0), 0)
  rows.push(['Summe', '', s(z => z.rev.subs), s(z => z.rev.chat), s(z => z.rev.tips), s(z => z.rev.total), s(z => z.x?.base), s(z => z.x?.agentur), s(z => z.x?.model),
    ...(k ? [s(z => z.x?.agentur) * k, s(z => z.x?.model) * k] : [])])
  if (k) rows.push([], [`Kurs ${monatText(monat)}: 1 $ = ${String(k).replace('.', ',')} €`])
  csvLaden(`Billing-Models-${monat}.csv`, kopf, rows)
}

export function excelChatter(zeilen, monat, kurs) {
  const k = kurs ? Number(kurs) : null
  const kopf = ['Chatter', 'Satz', 'Chat Revenue $', 'Gesamt $', 'Basis $', 'Auszahlung $', ...(k ? ['Auszahlung €'] : [])]
  const rows = zeilen.map(z => [z.name, satzChatter(z.s), z.rev.chat, z.rev.total, z.x ? z.x.base : '', z.x ? z.x.auszahlung : '', ...(k ? [z.x ? z.x.auszahlung * k : ''] : [])])
  const s = (f) => zeilen.reduce((t, z) => t + (f(z) || 0), 0)
  rows.push(['Summe', '', s(z => z.rev.chat), s(z => z.rev.total), s(z => z.x?.base), s(z => z.x?.auszahlung), ...(k ? [s(z => z.x?.auszahlung) * k] : [])])
  if (k) rows.push([], [`Kurs ${monatText(monat)}: 1 $ = ${String(k).replace('.', ',')} €`])
  csvLaden(`Billing-Chatter-${monat}.csv`, kopf, rows)
}

// ── PDF-Abrechnungen (v5.34.0: echte PDF-Datei zum Herunterladen) ─────────
// Vorher: Druckfenster. Jetzt erzeugt jsPDF direkt eine Datei, eine Seite je Person.
const datumKurz = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
export function zeitraumText(monat, bis) {
  const [y, m] = monat.split('-').map(Number)
  const letzter = new Date(y, m, 0).getDate()
  const ende = bis && bis.startsWith(monat) ? bis : `${monat}-${String(letzter).padStart(2, '0')}`
  return `01.${String(m).padStart(2, '0')}.–${datumKurz(ende)}`
}
const usd = (v) => zahl(v) + ' $'

export async function abrechnungenPdf({ art, zeilen, monat, kurs, bis }) {
  const { jsPDF } = await import('jspdf')
  const k = kurs ? Number(kurs) : null
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const B = 210, L = 18, R = B - 18
  const lila = [124, 58, 237], dunkel = [42, 22, 96], grau = [110, 110, 128]
  const zeitraum = zeitraumText(monat, bis)

  const tabelle = (y, kopf, reihen) => {
    doc.setFillColor(245, 243, 255); doc.rect(L, y - 5, R - L, 8, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(76, 29, 149)
    doc.text(kopf.toUpperCase(), L + 3, y)
    doc.text('USD', k ? R - 45 : R - 3, y, { align: 'right' })
    if (k) doc.text('EUR', R - 3, y, { align: 'right' })
    y += 8
    for (const [label, wert, fett] of reihen) {
      doc.setFont('helvetica', fett ? 'bold' : 'normal'); doc.setFontSize(fett ? 11.5 : 10.5); doc.setTextColor(27, 27, 43)
      if (fett) { doc.setDrawColor(196, 181, 253); doc.setLineWidth(0.5); doc.line(L, y - 5.5, R, y - 5.5) }
      doc.text(label, L + 3, y)
      doc.text(usd(wert), k ? R - 45 : R - 3, y, { align: 'right' })
      if (k) doc.text(euro(wert * k), R - 3, y, { align: 'right' })
      doc.setDrawColor(236, 233, 245); doc.setLineWidth(0.2); doc.line(L, y + 2.5, R, y + 2.5)
      y += 8.5
    }
    return y + 6
  }

  zeilen.forEach((z, i) => {
    if (i) doc.addPage()
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...dunkel)
    doc.text('Thirteen 87 Collective', L, 22)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...grau)
    doc.text(`Abrechnung ${monatText(monat)} · Zeitraum ${zeitraum}`, L, 28)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...lila)
    doc.text(art === 'model' ? 'MODEL' : 'CHATTER', R, 22, { align: 'right' })
    doc.setDrawColor(...lila); doc.setLineWidth(0.9); doc.line(L, 32, R, 32)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(27, 27, 43)
    doc.text(String(z.name), L, 46)
    let y = 60
    if (art === 'model') {
      y = tabelle(y, 'Umsatz', [['Subscriptions', z.rev.subs], ['Chat / PPV', z.rev.chat], ['Tips', z.rev.tips], ['Umsatz gesamt', z.rev.total, true]])
      if (z.x) y = tabelle(y, `Aufteilung · Agentur ${satzModel(z.s)}`, [['Berechnungsbasis', z.x.base], ['Anteil Agentur', z.x.agentur], ['Anteil Model', z.x.model, true]])
    } else {
      y = tabelle(y, 'Umsatz', [['Chat Revenue', z.rev.chat], ['Umsatz gesamt', z.rev.total]])
      if (z.x) y = tabelle(y, `Auszahlung · ${satzChatter(z.s)}`, [['Berechnungsbasis', z.x.base], ['Auszahlung', z.x.auszahlung, true]])
    }
    if (!z.x) {
      doc.setFillColor(255, 251, 235); doc.rect(L, y - 5, R - L, 10, 'F')
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120, 90, 0)
      doc.text(`Für ${art === 'model' ? 'dieses Model' : 'diesen Chatter'} ist noch kein Satz hinterlegt.`, L + 3, y + 1)
      y += 14
    }
    if (z.x && k) {
      const betrag = art === 'model' ? z.x.model : z.x.auszahlung
      doc.setFillColor(236, 253, 245); doc.roundedRect(L, y - 4, R - L, 14, 2, 2, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(6, 95, 70)
      doc.text(art === 'model' ? 'Dein Anteil in Euro' : 'Auf die Rechnung', L + 4, y + 5)
      doc.text(euro(betrag * k), R - 4, y + 5, { align: 'right' })
      y += 20
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...grau)
    doc.text(`${k ? `Umrechnung: 1 $ = ${String(k).replace('.', ',')} € (Kurs ${monatText(monat)}). ` : 'Ohne Euro-Kurs: Beträge in USD. '}Grundlage: tägliche Daten aus CreatorHero.`, L, y)
    doc.setFontSize(8); doc.setTextColor(160, 160, 176)
    doc.text(`Erstellt am ${new Date().toLocaleDateString('de-DE')} · Thirteen 87 Collective`, L, 285)
  })
  const name = zeilen.length === 1
    ? `Abrechnung-${String(zeilen[0].name).replace(/[^\wäöüÄÖÜß.-]+/g, '_')}-${monat}.pdf`
    : `Abrechnungen-${art === 'model' ? 'Models' : 'Chatter'}-${monat}.pdf`
  doc.save(name)
}

// ── Nachricht an den Chatter: Umsatz & was auf die Rechnung kommt ──────────
export function chatterNachricht(z, monat, kurs, bis) {
  const k = kurs ? Number(kurs) : null
  const vorname = String(z.name).split(' ')[0]
  const zeilen = [
    `Hi ${vorname} 👋`,
    '',
    `deine Abrechnung für ${monatText(monat)} (${zeitraumText(monat, bis)}):`,
    '',
    `Chat Revenue: ${usd(z.rev.chat)}`,
  ]
  if (z.s && !z.s.include_chat) zeilen.push(`Umsatz gesamt: ${usd(z.rev.total)}`)
  if (z.x) {
    zeilen.push(`Dein Satz: ${z.s.percentage} % vom ${z.s.include_chat ? 'Chat Revenue' : 'Gesamtumsatz'}`)
    zeilen.push(`Auszahlung: ${usd(z.x.auszahlung)}`)
    if (k) {
      zeilen.push(`Kurs: 1 $ = ${String(k).replace('.', ',')} €`)
      zeilen.push('', `👉 Auf deine Rechnung: ${euro(z.x.auszahlung * k)}`)
    } else {
      zeilen.push('', '👉 Der Euro-Betrag folgt, sobald der Kurs feststeht.')
    }
  }
  zeilen.push('', 'Bei Fragen melde dich gern. Danke für deinen Einsatz! 💜', 'Thirteen 87')
  return zeilen.join('\n')
}
