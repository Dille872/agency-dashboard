// ─── CSV PARSING ─────────────────────────────────────────────────────────────

export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { headers: [], rows: [] }
  const headers = splitCSVLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cells = splitCSVLine(line)
    const row = {}
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? '' })
    rows.push(row)
  }
  return { headers, rows }
}

function splitCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

export function findHeaderIndex(headers, possibleNames) {
  const normalized = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  for (const name of possibleNames) {
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const idx = normalized.findIndex(h => h === norm)
    if (idx !== -1) return idx
  }
  for (const name of possibleNames) {
    const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const idx = normalized.findIndex(h => h.startsWith(norm) || norm.startsWith(h) || h.includes(norm))
    if (idx !== -1) return idx
  }
  return -1
}

// ─── NUMBER HELPERS ──────────────────────────────────────────────────────────

export function parseNumber(value) {
  if (value === undefined || value === null || value === '') return 0
  const cleaned = String(value).replace(/[$,\s%]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

export function safeDivide(a, b) {
  if (!b || b === 0) return 0
  return a / b
}

export function pctChange(current, previous) {
  if (!previous || previous === 0) return 0
  return ((current - previous) / Math.abs(previous)) * 100
}

// ─── FORMAT HELPERS ──────────────────────────────────────────────────────────

export function formatMoney(value) {
  if (value === undefined || value === null) return '$0'
  const abs = Math.abs(value)
  if (abs >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
  if (abs >= 1000) return `$${(value / 1000).toFixed(1)}k`
  return `$${value.toFixed(2)}`
}

export function formatDeltaPct(value) {
  if (!value || value === 0) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function formatShortDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function getWeekNumber(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const onejan = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7)
}

export function getMonthStr(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : ''
}

// ─── ROW PARSERS ─────────────────────────────────────────────────────────────

export function parseModelRow(rawRow, headers) {
  const vals = Object.values(rawRow)
  const g = (names) => {
    const idx = findHeaderIndex(headers, names)
    return idx !== -1 ? parseNumber(vals[idx]) : 0
  }
  const gStr = (names) => {
    const idx = findHeaderIndex(headers, names)
    return idx !== -1 ? String(vals[idx] || '').trim() : ''
  }

  const creator = gStr(['creator', 'name', 'model', 'model name'])
  if (!creator) return null

  const revenue = g(['total revenue', 'revenue', 'total rev'])
  const subs = g(['new subs', 'subs', 'new subscribers'])
  const newSubsRevenue = g(['new subs revenue', 'new sub revenue', 'new subs rev'])
  const recurringSubsRevenue = g(['rec. subs revenue', 'recurring subs revenue', 'rec subs revenue', 'recurring sub revenue'])
  const subsRevenue = (newSubsRevenue + recurringSubsRevenue) || g(['subs revenue', 'sub revenue'])
  const tipsRevenue = g(['tips revenue', 'tips', 'tip revenue'])
  const messageRevenue = g(['message revenue', 'msg revenue', 'messages revenue', 'chat revenue'])
  const sellingChats = g(['selling chats', 'selling chat', 'chats sold'])
  const avgSpend = g(['average fan spend', 'avg fan spend', 'avg spend', 'average spend'])
  const avgChatValue = safeDivide(messageRevenue, sellingChats)

  return {
    creator, revenue, subs, subsRevenue, newSubsRevenue,
    recurringSubsRevenue, tipsRevenue, messageRevenue,
    sellingChats, avgSpend, avgChatValue,
  }
}

export function parseChatterRow(rawRow, headers) {
  const vals = Object.values(rawRow)
  const g = (names) => {
    const idx = findHeaderIndex(headers, names)
    return idx !== -1 ? parseNumber(vals[idx]) : 0
  }
  const gStr = (names) => {
    const idx = findHeaderIndex(headers, names)
    return idx !== -1 ? String(vals[idx] || '').trim() : ''
  }

  const name = gStr(['name', 'chatter', 'chatter name', 'agent'])
  if (!name) return null

  const activeMinutes = g(['active time minutes', 'active time', 'active minutes'])
  const inactiveMinutes = g(['inactive time minutes', 'inactive time', 'inactive minutes'])
  const revenue = g(['total revenue', 'revenue', 'total rev'])
  const avgResponseSeconds = g(['avg response time seconds', 'avg response time', 'avg response', 'response time'])
  const sentMessages = g(['sent messages', 'messages sent', 'sent msgs'])
  const sentPPVs = g(['sent ppvs', 'ppvs sent', 'sent ppv'])
  const boughtPPVs = g(['bought ppvs', 'ppvs bought', 'bought ppv', 'purchased ppvs'])

  const activeHours = safeDivide(activeMinutes, 60)
  const revenuePerHour = activeMinutes > 0 ? revenue / (activeMinutes / 60) : 0
  const buyRate = safeDivide(boughtPPVs * 100, sentPPVs)
  const avgRevenuePerBoughtPPV = safeDivide(revenue, boughtPPVs)

  return {
    name, activeMinutes, inactiveMinutes, activeHours,
    revenue, revenuePerHour, avgResponseSeconds,
    sentMessages, sentPPVs, boughtPPVs, buyRate, avgRevenuePerBoughtPPV,
  }
}

// ─── ANALYTICS HELPERS ───────────────────────────────────────────────────────

export function getMonetizationType(row) {
  const total = row.revenue || 1
  const msgPct = (row.messageRevenue / total) * 100
  const subsPct = (row.subsRevenue / total) * 100
  const tipsPct = (row.tipsRevenue / total) * 100
  if (msgPct >= 70) return 'Msg-dominant'
  if (subsPct >= 40) return 'Subs-dominant'
  if (tipsPct >= 20) return 'Tips-dominant'
  return 'Balanced'
}

export function computeModelTrend(snapshots, creatorName) {
  const sorted = [...snapshots].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
  const vals = []
  for (const snap of sorted) {
    const row = snap.rows.find(r => r.creator === creatorName)
    if (row) vals.push(row.revenue)
  }
  if (vals.length < 2) return 'Seitwärts'
  const last = vals[vals.length - 1]
  const prev = vals[vals.length - 2]
  const pct = pctChange(last, prev)
  if (pct > 10) return 'Steigend'
  if (pct < -10) return 'Fallend'
  if (vals.length >= 3) {
    const diffs = vals.slice(-3).map((v, i, a) => i > 0 ? Math.abs(pctChange(v, a[i - 1])) : 0).slice(1)
    if (diffs.some(d => d > 25)) return 'Instabil'
  }
  return 'Seitwärts'
}

export function computeModelStatus(row, trend) {
  if (row.avgChatValue > 0 && row.avgChatValue < 3 && row.sellingChats > 10)
    return { status: 'Preisproblem', recommendation: 'Chat-Preise erhöhen' }
  if (trend === 'Steigend' && row.revenue > 100)
    return { status: 'Skalieren', recommendation: 'Budget erhöhen' }
  if (trend === 'Fallend')
    return { status: 'Beobachten', recommendation: 'Strategie prüfen' }
  if (trend === 'Instabil')
    return { status: 'Instabil', recommendation: 'Konsistenz verbessern' }
  return { status: 'Gemischt', recommendation: 'Weiter beobachten' }
}

export function computeChatterStatus(row, trend) {
  if (row.revenuePerHour < 10 && row.activeMinutes > 60)
    return { status: 'Activity Issue', recommendation: 'Zu wenig Output' }
  if (row.buyRate < 20 && row.sentPPVs > 5)
    return { status: 'Quality Issue', recommendation: 'Qualität pro Sale sinkt' }
  if (row.avgRevenuePerBoughtPPV < 8 && row.boughtPPVs > 3)
    return { status: 'Price Drop', recommendation: 'Verkauft mehr, aber billiger' }
  if (trend === 'Steigend')
    return { status: 'Strong', recommendation: 'Läuft stark' }
  return { status: 'Stabil', recommendation: 'Beobachten' }
}

export function computeHeatmapStatus(current, previous) {
  if (current === null || current === undefined) return { label: '·', color: '#2e2e5a' }
  if (!previous) return { label: 'B', color: '#f59e0b' }
  const pct = pctChange(current, previous)
  if (pct > 15) return { label: 'S', color: '#10b981' }
  if (pct < -15) return { label: 'K', color: '#ef4444' }
  return { label: 'B', color: '#f59e0b' }
}

export function getLast7Snapshots(snapshots, currentDate) {
  return [...snapshots]
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    .filter(s => s.businessDate <= currentDate)
    .slice(-7)
}

export function getPreviousSnapshot(snapshots, currentDate) {
  const sorted = [...snapshots]
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    .filter(s => s.businessDate < currentDate)
  return sorted.length > 0 ? sorted[sorted.length - 1] : null
}
