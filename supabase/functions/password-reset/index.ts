import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// v4.12.0 — „Passwort vergessen" mit Bestätigung durch einen Admin.
//
// Drei Aktionen in einer Funktion:
//   request  (offen)      Person fragt an        -> Zeile 'angefragt', Telegram an die Admins
//   approve  (nur Staff)  Admin gibt frei        -> Code + 60 Minuten Frist, Code an die Person
//   set      (offen)      Person setzt Passwort  -> braucht E-Mail + Code
//
// Deploy (NICHT über git), wird von nicht angemeldeten Leuten aufgerufen:
//   supabase functions deploy password-reset --no-verify-jwt
//
// Der Service-Role-Key bleibt hier drin. Weder die Anfrage noch das Setzen
// laufen über den Browser — sonst könnte man Codes auslesen.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('DB_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('DB_SERVICE_KEY')!
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''

// Chris und Rey — dieselben IDs wie in shift-alert und bei den Content-Anfragen.
const ADMIN_CHAT_IDS = ['1538601588', '528328429']

const MIN_PASSWORT = 10
const FRIST_MINUTEN = 60
const STAFF_ROLLEN = ['admin', 'manager']

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

const rest = (pfad: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${pfad}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      ...(init.headers || {}),
    },
  })

const auth = (pfad: string, init: RequestInit = {}) =>
  fetch(`${SUPABASE_URL}/auth/v1/${pfad}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      ...(init.headers || {}),
    },
  })

// Telegram darf nie den Ablauf blockieren — schlägt es fehl, läuft der Rest weiter.
async function telegram(chatId: string, text: string) {
  if (!BOT_TOKEN || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
  } catch { /* absichtlich geschluckt */ }
}

// GoTrue kennt keine Suche nach exakter Adresse, die über alle Versionen gleich
// funktioniert. Bei einem Team dieser Grösse ist eine Seite mit 1000 Einträgen
// unproblematisch.
async function findeUser(email: string) {
  const resp = await auth('admin/users?per_page=1000')
  if (!resp.ok) return null
  const data = await resp.json()
  const liste = data?.users || []
  return liste.find((u: { email?: string }) => (u.email || '').toLowerCase() === email) || null
}

async function istStaff(token: string) {
  const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` },
  })
  if (!userResp.ok) return null
  const caller = await userResp.json()
  if (!caller?.id) return null
  const rollenResp = await rest(`user_roles?user_id=eq.${caller.id}&select=role,roles,display_name`)
  const zeilen = await rollenResp.json()
  const zeile = Array.isArray(zeilen) ? zeilen[0] : null
  const rollen: string[] = zeile?.roles?.length ? zeile.roles : (zeile?.role ? [zeile.role] : [])
  if (!rollen.some((r) => STAFF_ROLLEN.includes(r))) return null
  return zeile?.display_name || caller.email?.split('@')[0] || 'Admin'
}

function codeErzeugen() {
  // 6 Ziffern aus dem Krypto-Zufall — kein Math.random.
  const bytes = new Uint32Array(1)
  crypto.getRandomValues(bytes)
  return String(bytes[0] % 1_000_000).padStart(6, '0')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const body = await req.json().catch(() => ({}))
    const aktion = String(body.action || '')
    const email = String(body.email || '').trim().toLowerCase()

    // ── 1) Anfrage stellen ────────────────────────────────────────────────
    if (aktion === 'request') {
      if (!email) return json({ error: 'E-Mail fehlt.' }, 400)

      // Antwort ist IMMER dieselbe, egal ob es das Konto gibt. Sonst liesse
      // sich hier durchprobieren, welche Adressen im System sind.
      const antwort = {
        ok: true,
        message: 'Die Anfrage ist beim Team. Sobald sie freigegeben ist, bekommst du einen Code — danach kannst du hier dein neues Passwort setzen.',
      }

      const offenResp = await rest(
        `password_resets?email=eq.${encodeURIComponent(email)}&status=neq.verbraucht&select=id,status&limit=1`,
      )
      const offen = await offenResp.json()
      if (Array.isArray(offen) && offen.length > 0) return json(antwort)

      const user = await findeUser(email)
      // Kein Konto? Dann legen wir auch keine Zeile an — sonst stünden im
      // Dashboard Anfragen zu Adressen, die es gar nicht gibt.
      if (!user) return json(antwort)

      const rollenResp = await rest(`user_roles?user_id=eq.${user.id}&select=display_name`)
      const rollen = await rollenResp.json()
      const name = (Array.isArray(rollen) ? rollen[0]?.display_name : null) || email

      await rest('password_resets', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ email, user_id: user.id, display_name: name, status: 'angefragt' }),
      })

      for (const id of ADMIN_CHAT_IDS) {
        await telegram(id, `🔑 <b>${name}</b> hat ein neues Passwort angefragt.\n\nFreigeben unter Einstellungen → Team.`)
      }
      return json(antwort)
    }

    // ── 2) Freigeben (nur Staff) ──────────────────────────────────────────
    if (aktion === 'approve') {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
      if (!token) return json({ error: 'Nicht angemeldet' }, 401)
      const adminName = await istStaff(token)
      if (!adminName) return json({ error: 'Keine Berechtigung' }, 403)

      const id = Number(body.id)
      if (!id) return json({ error: 'Keine Anfrage angegeben.' }, 400)

      const zeileResp = await rest(`password_resets?id=eq.${id}&select=*&limit=1`)
      const zeilen = await zeileResp.json()
      const zeile = Array.isArray(zeilen) ? zeilen[0] : null
      if (!zeile) return json({ error: 'Anfrage nicht gefunden.' }, 404)
      if (zeile.status === 'verbraucht') return json({ error: 'Diese Anfrage ist schon erledigt.' }, 409)

      const code = codeErzeugen()
      const frist = new Date(Date.now() + FRIST_MINUTEN * 60_000).toISOString()

      const upd = await rest(`password_resets?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          status: 'freigegeben', code, expires_at: frist,
          approved_at: new Date().toISOString(), approved_by: adminName,
        }),
      })
      if (!upd.ok) return json({ error: 'Freigabe fehlgeschlagen.' }, 500)

      // Code direkt an die Person, wenn wir ihre Telegram-ID kennen.
      let perTelegram = false
      for (const tabelle of ['chatters_contact', 'models_contact']) {
        if (perTelegram) break
        const kResp = await rest(
          `${tabelle}?name=eq.${encodeURIComponent(zeile.display_name || '')}&select=telegram_id&limit=1`,
        )
        const k = await kResp.json()
        const tgId = Array.isArray(k) ? k[0]?.telegram_id : null
        if (tgId) {
          await telegram(String(tgId),
            `🔑 Dein Code zum Zurücksetzen: <b>${code}</b>\n\nGib ihn auf der Anmeldeseite unter „Passwort vergessen" ein. Gültig ${FRIST_MINUTEN} Minuten.`)
          perTelegram = true
        }
      }

      await rest('activity_log', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          actor: adminName, action: 'user.pwreset',
          entity: zeile.display_name || zeile.email,
          detail: perTelegram ? 'Code per Telegram geschickt' : 'Code zum Weitergeben',
        }),
      }).catch(() => {})

      return json({ ok: true, code, per_telegram: perTelegram, expires_at: frist })
    }

    // ── 3) Neues Passwort setzen ──────────────────────────────────────────
    if (aktion === 'set') {
      const code = String(body.code || '').trim()
      const password = String(body.password || '')
      if (!email || !code || !password) return json({ error: 'E-Mail, Code und Passwort werden gebraucht.' }, 400)
      if (password.length < MIN_PASSWORT) {
        return json({ error: `Das Passwort muss mindestens ${MIN_PASSWORT} Zeichen haben.` }, 400)
      }

      const zeileResp = await rest(
        `password_resets?email=eq.${encodeURIComponent(email)}&status=eq.freigegeben&select=*&limit=1`,
      )
      const zeilen = await zeileResp.json()
      const zeile = Array.isArray(zeilen) ? zeilen[0] : null

      if (!zeile) {
        return json({ error: 'Für diese Adresse ist gerade nichts freigegeben. Stell zuerst eine Anfrage — oder frag beim Team nach.' }, 403)
      }
      if (zeile.expires_at && new Date(zeile.expires_at) < new Date()) {
        return json({ error: 'Der Code ist abgelaufen. Stell bitte eine neue Anfrage.' }, 403)
      }
      if (String(zeile.code) !== code) {
        return json({ error: 'Der Code stimmt nicht.' }, 403)
      }

      const upd = await auth(`admin/users/${zeile.user_id}`, {
        method: 'PUT',
        body: JSON.stringify({ password }),
      })
      if (!upd.ok) {
        const fehler = await upd.json().catch(() => ({}))
        return json({ error: fehler?.msg || 'Passwort konnte nicht gesetzt werden.' }, 400)
      }

      await rest(`password_resets?id=eq.${zeile.id}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'verbraucht', used_at: new Date().toISOString(), code: null }),
      })

      await rest('activity_log', {
        method: 'POST',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          actor: zeile.display_name || email, action: 'user.pwset',
          entity: zeile.display_name || email, detail: 'hat ein neues Passwort gesetzt',
        }),
      }).catch(() => {})

      return json({ ok: true })
    }

    return json({ error: 'Unbekannte Aktion.' }, 400)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
