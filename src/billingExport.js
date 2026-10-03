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

// ── PDF-Abrechnungen ───────────────────────────────────────────────────────
function seiteModel(z, monat, k) {
  const zeile = (l, v, fett) => `<tr${fett ? ' class="fett"' : ''}><td>${l}</td><td>${dollar(v)}</td>${k ? `<td>${euro(v * k)}</td>` : ''}</tr>`
  return `
  <section class="seite">
    <div class="kopf"><div><div class="firma">Thirteen 87 Collective</div><div class="klein">Abrechnung ${esc(monatText(monat))}</div></div><div class="art">Model</div></div>
    <h1>${esc(z.name)}</h1>
    <table>
      <tr><th>Umsatz</th><th>USD</th>${k ? '<th>EUR</th>' : ''}</tr>
      ${zeile('Subscriptions', z.rev.subs)}${zeile('Chat / PPV', z.rev.chat)}${zeile('Tips', z.rev.tips)}${zeile('Umsatz gesamt', z.rev.total, true)}
    </table>
    ${z.x ? `<table>
      <tr><th>Aufteilung · Agentur ${esc(satzModel(z.s))}</th><th>USD</th>${k ? '<th>EUR</th>' : ''}</tr>
      ${zeile('Berechnungsbasis', z.x.base)}${zeile('Anteil Agentur', z.x.agentur)}${zeile('Anteil Model', z.x.model, true)}
    </table>` : '<p class="hinweis">Für dieses Model ist noch kein Satz hinterlegt.</p>'}
    <p class="klein">${k ? `Umrechnung: 1 $ = ${String(k).replace('.', ',')} € (Kurs ${esc(monatText(monat))}). ` : ''}Grundlage: tägliche Umsatzdaten aus CreatorHero, ${esc(monatText(monat))}.</p>
    <div class="fuss">Erstellt am ${new Date().toLocaleDateString('de-DE')} · Thirteen 87 Collective</div>
  </section>`
}

function seiteChatter(z, monat, k) {
  const zeile = (l, v, fett) => `<tr${fett ? ' class="fett"' : ''}><td>${l}</td><td>${dollar(v)}</td>${k ? `<td>${euro(v * k)}</td>` : ''}</tr>`
  return `
  <section class="seite">
    <div class="kopf"><div><div class="firma">Thirteen 87 Collective</div><div class="klein">Abrechnung ${esc(monatText(monat))}</div></div><div class="art">Chatter</div></div>
    <h1>${esc(z.name)}</h1>
    <table>
      <tr><th>Umsatz</th><th>USD</th>${k ? '<th>EUR</th>' : ''}</tr>
      ${zeile('Chat Revenue', z.rev.chat)}${zeile('Umsatz gesamt', z.rev.total)}
    </table>
    ${z.x ? `<table>
      <tr><th>Auszahlung · ${esc(satzChatter(z.s))}</th><th>USD</th>${k ? '<th>EUR</th>' : ''}</tr>
      ${zeile('Berechnungsbasis', z.x.base)}${zeile('Auszahlung', z.x.auszahlung, true)}
    </table>` : '<p class="hinweis">Für diesen Chatter ist noch kein Satz hinterlegt.</p>'}
    <p class="klein">${k ? `Umrechnung: 1 $ = ${String(k).replace('.', ',')} € (Kurs ${esc(monatText(monat))}). ` : ''}Grundlage: tägliche Chatter-Daten aus CreatorHero, ${esc(monatText(monat))}.</p>
    <div class="fuss">Erstellt am ${new Date().toLocaleDateString('de-DE')} · Thirteen 87 Collective</div>
  </section>`
}

export function abrechnungenDrucken({ art, zeilen, monat, kurs }) {
  const k = kurs ? Number(kurs) : null
  const seiten = zeilen.map(z => art === 'model' ? seiteModel(z, monat, k) : seiteChatter(z, monat, k)).join('')
  const titel = zeilen.length === 1 ? `Abrechnung ${zeilen[0].name} ${monat}` : `Abrechnungen ${art === 'model' ? 'Models' : 'Chatter'} ${monat}`
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; color: #1b1b2b; margin: 0; }
    .seite { page-break-after: always; padding: 4px 2px; }
    .seite:last-child { page-break-after: auto; }
    .kopf { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #7c3aed; padding-bottom: 10px; margin-bottom: 18px; }
    .firma { font-size: 15pt; font-weight: 800; color: #2a1660; }
    .art { font-size: 9pt; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #7c3aed; border: 1px solid #c4b5fd; border-radius: 6px; padding: 3px 8px; }
    h1 { font-size: 22pt; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 18px; font-size: 11pt; }
    th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; color: #4c1d95; background: #f5f3ff; padding: 7px 10px; }
    th:not(:first-child), td:not(:first-child) { text-align: right; width: 22%; }
    td { padding: 7px 10px; border-bottom: 1px solid #ece9f5; font-variant-numeric: tabular-nums; }
    tr.fett td { font-weight: 800; font-size: 12pt; border-top: 2px solid #c4b5fd; }
    .klein { font-size: 9pt; color: #6b6b80; }
    .hinweis { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 9px 12px; font-size: 10pt; }
    .fuss { margin-top: 30px; font-size: 8.5pt; color: #9a9ab0; border-top: 1px solid #eee; padding-top: 6px; }
    .leiste { position: sticky; top: 0; background: #2a1660; color: #fff; padding: 10px 14px; display: flex; gap: 10px; align-items: center; font-size: 13px; }
    .leiste button { background: #fff; color: #2a1660; border: none; border-radius: 8px; padding: 7px 14px; font-weight: 800; cursor: pointer; }
    @media print { .leiste { display: none; } }
  </style></head><body>
    <div class="leiste"><span style="flex:1">${esc(titel)} · ${zeilen.length} Seite${zeilen.length === 1 ? '' : 'n'} · Drucken → „Als PDF sichern“</span><button onclick="window.print()">Drucken / als PDF</button></div>
    ${seiten}
    <script>setTimeout(function(){ window.print() }, 400)</script>
  </body></html>`
  const w = window.open('', '_blank')
  if (!w) { alert('Bitte Pop-ups für das Dashboard erlauben, dann nochmal versuchen.'); return }
  w.document.open(); w.document.write(html); w.document.close()
}
