import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import { setTheme, initTheme } from './theme'
import { APP_VERSION } from './version'
import SuggestionsAdmin from './components/SuggestionsAdmin'
import {
  Film, Users, BarChart3, FileText, CheckSquare, Palette, RefreshCw, MessageCircle,
  TrendingUp, Calendar, Globe, Settings as SettingsIcon, MoreHorizontal, Sun, Moon,
  Eye, ArrowLeftRight, DollarSign, Database, UserRound, CalendarDays, Zap, LayoutGrid,
} from 'lucide-react'
import LoginPage from './components/LoginPage'
import CalendarTab from './components/CalendarTab' // v4.60.0
import ModelsView from './components/ModelsView'
import ChattersView from './components/ChattersView'
import BriefingView from './components/BriefingView'
import NotesTab from './components/NotesTab'
import CommTab from './components/CommTab'
import ChatWidget from './components/ChatWidget'
import ActivityWidget from './components/ActivityWidget'
import AdminBell from './components/AdminBell'
import ScheduleTab from './components/ScheduleTab'
import ChatterPortal from './components/ChatterPortal'
import ModelPortal from './components/ModelPortal'
import ExportTab from './components/ExportTab'
import SettingsTab from './components/SettingsTab'
import BillingTab from './components/BillingTab'
import PerformanceTab from './components/PerformanceTab'
import TodoTab from './components/TodoTab'
import SocialTab from './components/SocialTab'
import SetPasswordPage from './components/SetPasswordPage'
import UploadBox from './components/UploadBox'
// v4.31.0: dritter Upload — Chatter-Umsatz je Model, siehe sql/model-chatter-daily.sql
import ModelChatterUpload from './components/ModelChatterUpload'
import DataStatusTab from './components/DataStatusTab'
import PresentationToggle from './components/PresentationToggle'
import Logo from './components/Logo'
// v4.71.0: Startseite am Handy — wer arbeitet, was wartet, was ist schief
import JetztView from './components/JetztView'
import { parseCSV, parseModelRow, parseChatterRow, todayISO } from './utils'
import { useFabPanels } from './fabPanel'
// v4.68.0: Ansicht in der Adresszeile + eine Quelle fuer die Tab-Rechte
import { routeLesen, routeSchreiben } from './route'
import { darfAufTab, startTab } from './zugang'

// Sprungziele, die CommTab ueber seine focus-Prop versteht (dort:
// activeSection). Was nicht hier steht, wird aus der URL ignoriert.
// v4.69.0: Die Navigation, an einer Stelle. Vorher stand die Tab-Liste
// dreimal im Render — Desktop-Primaer, Desktop-Mehr, Handy-Menue — und die
// Reihenfolgen waren schon auseinandergelaufen.
//
// Geschnitten nach "was tue ich gerade", nicht nach Technik:
//   Analyse = hinschauen · Kommunikation = reden · Zeit = planen
//   Verwaltung = pflegen · Einstellungen = einrichten
// Die tab-keys bleiben unveraendert, damit Rollenrechte (zugang.js) und
// Links (?tab=...) weiter passen. Nur die Einsortierung ist neu.
// badge nennt den Zaehler beim Namen; aufgeloest wird er im Render.
const BEREICHE = [
  { key: 'analyse', label: 'Analyse', Icon: BarChart3, tabs: [
    { key: 'models', label: 'Models', Icon: Film },
    { key: 'chatters', label: 'Chatters', Icon: Users },
    { key: 'briefing', label: 'Briefing', Icon: Eye },
    { key: 'performance', label: 'Performance', Icon: TrendingUp },
  ] },
  { key: 'kommunikation', label: 'Kommunikation', Icon: MessageCircle, tabs: [
    { key: 'models-comm', label: 'Creator', Icon: Palette, badge: 'unreadModelChanges' },
    { key: 'chatters-comm', label: 'Crew', Icon: RefreshCw, badge: 'openSwaps' },
    { key: 'chat', label: 'Chat', Icon: MessageCircle, badge: 'unreadChat' },
    { key: 'notes', label: 'Notizen', Icon: FileText, badge: 'unreadNotes' },
    { key: 'vorschlaege', label: 'Vorschläge', Icon: MessageCircle },
    { key: 'social', label: 'Social', Icon: Globe },
  ] },
  { key: 'zeit', label: 'Zeit', Icon: Calendar, tabs: [
    { key: 'schedule', label: 'Dienstplan', Icon: Calendar },
    { key: 'kalender', label: 'Kalender', Icon: CalendarDays },
    { key: 'todos', label: 'ToDos', Icon: CheckSquare, badge: 'openTodos' },
  ] },
  { key: 'verwaltung', label: 'Verwaltung', Icon: Database, tabs: [
    { key: 'datenstand', label: 'Daten', Icon: Database },
    { key: 'billing', label: 'Billing', Icon: DollarSign },
  ] },
  { key: 'einstellungen', label: 'Einstellungen', Icon: SettingsIcon, tabs: [
    { key: 'settings', label: 'Einstellungen', Icon: SettingsIcon },
  ] },
]
const BEREICH_VON_TAB = {}
for (const b of BEREICHE) for (const t of b.tabs) BEREICH_VON_TAB[t.key] = b.key

const SPRUNG_IN_COMM = {
  chatters: true, swaps: true, stats: true, shiftlog: true,
  models: true, 'content-requests': true, 'content-ideas': true, 'content-verlauf': true,
}

// ── Handy: untere Leiste (v4.71.0) ──────────────────────────────────────────
// Dieselbe Grenze wie .hide-mobile / .tabs-mobile-btn in index.css.
// Die Leiste selbst blendet CSS ein und aus (.leiste-mobil) — istHandy()
// entscheidet nur die Startansicht beim ersten Laden.
const HANDY_MAX = 768
const istHandy = () => {
  try { return window.matchMedia(`(max-width: ${HANDY_MAX}px)`).matches } catch { return false }
}
// Vier Plaetze, mehr passt nicht mit Daumen-Abstand. Crew und Chat sind die
// beiden Orte, an denen tagsueber etwas passiert; alles andere liegt hinter
// "Mehr" — dort dieselben fuenf Bereiche wie am Desktop (BEREICHE).
// Jetzt ist kein Bereich, sondern die Startseite, und steht deshalb nicht in
// BEREICHE: am Desktop gibt es sie nur ueber ?tab=jetzt.
const LEISTE = [
  { key: 'jetzt', label: 'Jetzt', Icon: Zap },
  { key: 'chatters-comm', label: 'Crew', Icon: RefreshCw, badge: 'openSwaps' },
  { key: 'chat', label: 'Chat', Icon: MessageCircle, badge: 'unreadChat' },
]
// Ref-Callback statt useEffect: App hat vor dem Render mehrere fruehe returns
// (Portale, Login), ein Hook an dieser Stelle waere nicht erlaubt. React ruft
// die Funktion beim Einhaengen mit dem Element und beim Aushaengen mit null.
const leisteMerken = (el) => {
  try { document.documentElement.classList.toggle('mit-leiste', !!el) } catch {}
}

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [needsPassword, setNeedsPassword] = useState(false)

  // v4.68.0: Startansicht kommt aus der Adresszeile, damit Links, Reload und
  // der Zurueck-Button funktionieren. Geprueft wird sie, sobald die Rolle
  // feststeht (Effekt weiter unten).
  // v4.71.0: Am Handy startet man ohne Vorgabe im Jetzt-Screen statt in der
  // Models-Tabelle, die auf 390 px ohnehin nur quer scrollt.
  const [activeTab, setActiveTab] = useState(() => routeLesen().tab || (istHandy() ? 'jetzt' : 'models'))
  // Der erste Schreibvorgang ersetzt den History-Eintrag statt einen neuen
  // anzulegen — sonst braeuchte das erste Zurueck zwei Klicks.
  const routeErsetzen = useRef(true)
  const routeGeprueft = useRef(false)
  // Sprungbefehl aus dem Aufruf festhalten: der Sync-Effekt unten raeumt
  // ziel/id schon beim ersten Rendern aus der Adresszeile, die Rolle steht
  // aber erst ein paar Renderdurchgaenge spaeter fest.
  const routeStart = useRef(routeLesen())
  // v3.9.0: Mobile + Dropdown
  const [moreOpen, setMoreOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [businessDate, setBusinessDate] = useState(todayISO())
  const [modelSnapshots, setModelSnapshots] = useState([])
  const [chatterSnapshots, setChatterSnapshots] = useState([])
  // v4.31.0: Zaehler, der Upload-Kachel und Datenstand-Seite zum Neuladen zwingt.
  // model_chatter_daily liegt bewusst NICHT im App-State — die Tabelle waechst
  // taeglich um ~100 Zeilen und wird nur an zwei Stellen gebraucht.
  const [einzelReload, setEinzelReload] = useState(0)
  const [dataLoading, setDataLoading] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [unreadNotes, setUnreadNotes] = useState(0)
  const [unreadModelChanges, setUnreadModelChanges] = useState(0)
  const [openSwaps, setOpenSwaps] = useState(0)
  const [unreadCustomContent, setUnreadCustomContent] = useState(0)
  const [openTodos, setOpenTodos] = useState(0)
  const [unreadChat, setUnreadChat] = useState(0)
  const fab = useFabPanels()   // v4.1.0: nur ein schwebendes Fenster gleichzeitig
  const [commFocus, setCommFocus] = useState(null) // v3.65.0: Sprung-Ziel aus dem Aktivitäts-Feed
  const [userRole, setUserRole] = useState(null)
  const [accountBlocked, setAccountBlocked] = useState(null) // v3.18.0: {status, note} wenn stillgelegt/offboarded
  const [userDisplayName, setUserDisplayName] = useState('')
  const [viewMode, setViewMode] = useState('auto')
  const [theme, setThemeState] = useState(() => initTheme())
  const lastNoteCheck = useRef(null)
  // v3.79.0: Refs halten die AKTUELLEN Werte für das 30s-Intervall und Realtime-Callbacks.
  // Ohne sie bleibt deren Closure auf dem Initialwert (leer) hängen (Stale Closure) —
  // dadurch feuerte der Online-Heartbeat nie und Model-Badges blieben auf 0.
  const userDisplayNameRef = useRef('')
  const userRoleRef = useRef(null)
  useEffect(() => { userDisplayNameRef.current = userDisplayName }, [userDisplayName])
  useEffect(() => { userRoleRef.current = userRole }, [userRole])
  // v4.52.0: Im eigenen Chatter-Portal meldet das Portal selbst den Schicht-
  // Status. Der Admin-Heartbeat hier würde ihn sonst alle 30 s auf false setzen.
  const viewModeRef = useRef('auto')
  useEffect(() => { viewModeRef.current = viewMode }, [viewMode])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setThemeState(next)
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      // v3.41.0: Session-Referenz nur bei echtem Login/Logout ändern.
      // Supabase feuert beim Zurückwechseln zum Browser-Tab ein TOKEN_REFRESHED-Event –
      // ohne diesen Guard würde das ganze Dashboard neu laden (und z.B. getippte Chat-Texte löschen).
      setSession(prev => (prev?.user?.id === newSession?.user?.id ? prev : newSession))
      if (event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED') {
        setNeedsPassword(event === 'PASSWORD_RECOVERY')
      }
      if (event === 'SIGNED_IN' && window.location.hash.includes('type=invite')) {
        setNeedsPassword(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Load data from Supabase ───────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    // v4.24.0: loadAllData() erst NACH der Rollenpruefung — und nur fuer Staff.
    // Vorher lief es unmittelbar nach dem Login fuer jeden Account und lieferte
    // saemtliche Umsaetze aller Models und Chatter an den Browser aus.
    loadUserRole().then(res => {
      if (res && needsSnapshots(res.role, res.roles)) loadAllData()
    })
    loadBadgeCounts()
    const interval = setInterval(() => {
      loadBadgeCounts()
      // Send heartbeat so admin shows as online in chatter list
      // Wichtig: nur wenn userDisplayName gesetzt ist — sonst kein Heartbeat
      // (verhindert dass Email-Usernames in online_status landen)
      // v3.89.0: Chatter NICHT hier upserten – deren shift_online verwaltet der
      // ChatterPortal-Check-in. Sonst überschreibt dieser Heartbeat den Check-in
      // alle 30s auf false → shift-alert hält jeden für "nicht eingecheckt".
      if (session?.user && userDisplayNameRef.current && userRoleRef.current !== 'chatter' && viewModeRef.current !== 'mein-chatter') {
        supabase.from('online_status').upsert({
          display_name: userDisplayNameRef.current,
          last_seen: new Date().toISOString(),
          // v4.52.0: shift_online NICHT mehr mitsenden. Ein Admin, der im eigenen
          // Portal eingecheckt hat und zurück ins Dashboard wechselt, wäre sonst
          // nach 30 s wieder „nicht eingecheckt" (Schicht-Alarm!). Beim Upsert
          // bleibt eine nicht genannte Spalte unverändert.
        }, { onConflict: 'display_name' }).then(() => {})
      }
    }, 30000)
    // v3.65.0: Chat-/Badge-Zähler live — bei Nachrichten-Änderungen sofort neu laden
    // (statt nur alle 30s per Intervall). Gedrosselt gegen Event-Bursts.
    let badgeT = 0
    const bumpBadges = () => { clearTimeout(badgeT); badgeT = setTimeout(loadBadgeCounts, 400) }
    const badgeChannel = supabase.channel('badge-messages-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, bumpBadges)
      .subscribe()
    return () => { clearInterval(interval); clearTimeout(badgeT); supabase.removeChannel(badgeChannel) }
  }, [session?.user?.id]) // v3.41.0: nur bei echtem User-Wechsel laden, nicht bei jedem Token-Refresh

  const [userRoles, setUserRoles] = useState([])

  // ── Adresszeile ⇄ Ansicht (v4.68.0) ───────────────────────────────────────
  // Warum Query statt Hash und was ziel/id bedeuten: src/route.js.
  useEffect(() => {
    // Chatter- und Model-Portal haben keine Tabs — dort bleibt die Adresszeile
    // sauber. Beim Vorschau-Modus eines Admins greift das bewusst nicht.
    const imPortal = (userRole === 'chatter' || userRole === 'model') && viewMode !== 'admin'
    if (!userRole || imPortal) { routeSchreiben({ tab: null }, { ersetzen: true }); return }
    routeSchreiben({ tab: activeTab }, { ersetzen: routeErsetzen.current })
    routeErsetzen.current = false
  }, [activeTab, userRole, viewMode])

  useEffect(() => {
    const beiZurueck = () => {
      const r = routeLesen()
      routeErsetzen.current = true   // aus der History kommend nichts Neues pushen
      setActiveTab(r.tab || 'models')
    }
    window.addEventListener('popstate', beiZurueck)
    return () => window.removeEventListener('popstate', beiZurueck)
  }, [])

  // Sobald die Rolle feststeht: den Tab aus der URL pruefen — ein
  // weitergeleiteter Link darf niemandem eine Seite oeffnen, die seine Rolle
  // nicht sehen darf — und einen mitgegebenen Sprungbefehl einmal ausfuehren.
  useEffect(() => {
    if (!userRole || routeGeprueft.current) return
    routeGeprueft.current = true
    const r = routeStart.current
    // v4.71.0: Auch die Handy-Startansicht (jetzt) ist nicht fuer jede Rolle da —
    // ohne Vorgabe aus der Adresszeile bekommt man dann die Startansicht der Rolle.
    if (!r.tab && !darfAufTab(userRole, userRoles, activeTab)) {
      routeErsetzen.current = true
      setActiveTab(startTab(userRole, userRoles))
      return
    }
    if (r.tab && !darfAufTab(userRole, userRoles, r.tab)) {
      routeErsetzen.current = true
      setActiveTab(startTab(userRole, userRoles))
      return
    }
    if (!r.ziel) return
    if (SPRUNG_IN_COMM[r.ziel]) setCommFocus({ section: r.ziel, id: r.id, ts: Date.now() })
  }, [userRole, userRoles])

  // v4.24.0: Nur Admin/Manager brauchen die Umsatz-Snapshots im App-State.
  // Chatter- und Model-Portal laden ihre eigenen Zahlen selbst und gefiltert;
  // dienstplan/creator_manager/social_media kommen laut canAccess() nie an die
  // Tabs, die Snapshots anzeigen (models, chatters, briefing, performance).
  // Vorher lud loadAllData() fuer JEDEN eingeloggten User die komplette
  // Umsatzhistorie aller Models und Chatter in den Browser.
  const needsSnapshots = (role, roles) => {
    const all = [role, ...(Array.isArray(roles) ? roles : [])]
    return all.includes('admin') || all.includes('manager')
  }

  // v4.55.0: Wirksame Rolle aus BEIDEN Spalten bestimmen (roles-Array + alte
  // role-Spalte), nach Rang. Vorher entschied allein `role`: wer per SQL nur
  // `roles` bekam, sah „nicht eingerichtet"; wer ['chatter','admin'] hatte, aber
  // role='chatter', landete im Chatter-Portal.
  const RANG = ['admin', 'manager', 'dienstplan', 'creator_manager', 'model', 'chatter']
  const wirksameRolle = (role, roles) => {
    const alle = [...(Array.isArray(roles) ? roles : []), role].filter(Boolean)
    return RANG.find(r => alle.includes(r)) || alle[0] || null
  }

  // Gibt {role, roles} zurueck, oder null wenn der Account gesperrt/unvollstaendig
  // ist — in dem Fall werden bewusst gar keine Daten nachgeladen.
  const loadUserRole = async () => {
    try {
      const { data, error: rollenFehler } = await supabase
        .from('user_roles').select('*').eq('user_id', session.user.id).maybeSingle()
      // v4.55.0: Netz-/Serverfehler ist nicht „nicht eingerichtet"
      if (rollenFehler) throw rollenFehler
      // Wichtig: KEIN Email-Fallback mehr — der erzeugt Doubletten in online_status
      // (mario.stegmeir vs Mario). Wenn kein display_name in user_roles → Eintrag fehlt.
      const name = data?.display_name
      const rolle = data ? wirksameRolle(data.role, data.roles) : null
      if (data && name && rolle) {
        // v3.18.0: Account-Status prüfen — stillgelegte/offboardete User dürfen nicht ins Dashboard
        if (data.status === 'suspended' || data.status === 'offboarded') {
          setAccountBlocked({ status: data.status, note: data.status_note || null })
          setUserRole(rolle) // damit der Lade-Screen endet
          setUserDisplayName(name)
          return null // kein online_status-Heartbeat, keine Daten für gesperrte User
        }
        setAccountBlocked(null)
        const roles = [...new Set([...(data.roles || []), data.role].filter(Boolean))]
        setUserRole(rolle)
        setUserRoles(roles)
        setUserDisplayName(name)
        // v3.89.0: Chatter hier NICHT upserten (siehe Heartbeat oben) – sonst
        // wird ihr Check-in-Flag beim Laden/Reload auf false gesetzt.
        if (!roles.includes('chatter')) {
          await supabase.from('online_status').upsert({
            display_name: name,
            last_seen: new Date().toISOString(),
            shift_online: false,
          }, { onConflict: 'display_name' })
        }
        return { role: rolle, roles }
      } else {
        // v3.57.0: Kein sauberer user_roles-Eintrag (fehlende Rolle oder fehlender
        // display_name). Früher wurde hier still auf 'chatter' zurückgefallen — dadurch
        // sahen falsch/nicht eingerichtete Accounts (z.B. ein Model ohne Rolle) unbemerkt
        // die Chatter-Ansicht. Jetzt: klarer Hinweis statt stiller Fehlzuordnung.
        console.warn('user_roles unvollständig für', session.user.id, { hasRow: !!data, name: data?.display_name, role: data?.role, roles: data?.roles })
        setAccountBlocked({ status: 'not_setup', note: null })
        setUserRole('blocked') // Sentinel != null, damit der Lade-Screen endet
        setUserRoles([])
        setUserDisplayName(null)
        return null
      }
    } catch (err) {
      console.error('loadUserRole error:', err)
      // v4.55.0: kein stiller Rückfall auf 'chatter' mehr (landete ohne Namen im
      // Chatter-Portal) — stattdessen klarer Hinweis mit Neu-Laden.
      setAccountBlocked({ status: 'load_error', note: null })
      setUserRole('blocked')
      setUserRoles([])
      setUserDisplayName(null)
      return null
    }
  }

  const loadBadgeCounts = async () => {
    const { count: msgCount } = await supabase
      .from('messages').select('*', { count: 'exact', head: true })
      .eq('direction', 'in').eq('read', false)
    setUnreadMessages(msgCount || 0)

    const lastVisit = lastNoteCheck.current
    if (lastVisit) {
      const { count: noteCount } = await supabase
        .from('notes').select('*', { count: 'exact', head: true })
        .gt('created_at', lastVisit)
        .neq('author', session?.user?.email?.split('@')[0])
      setUnreadNotes(noteCount || 0)
    }

    // Model board changes
    const { count: modelCount } = await supabase
      .from('model_board_activity').select('*', { count: 'exact', head: true })
      .eq('read', false)

    // Unread custom content for admin
    const { count: ccCount } = await supabase
      .from('custom_content').select('*', { count: 'exact', head: true })
      .eq('read_by_admin', false)

    // New content requests
    const { count: reqCount } = await supabase
      .from('content_requests').select('*', { count: 'exact', head: true })
      .eq('status', 'neu')

    // Unread MODEL TICKETS (message_type set) — gehört zum Creator-Badge
    const { count: modelTicketCount } = await supabase
      .from('messages').select('*', { count: 'exact', head: true })
      .eq('direction', 'in').eq('read', false).eq('contact_type', 'model')
      .not('message_type', 'is', null)

    // Unread CHATTER TICKETS (message_type set) — gehört zum Crew-Badge
    const { count: chatterTicketCount } = await supabase
      .from('messages').select('*', { count: 'exact', head: true })
      .eq('direction', 'in').eq('read', false).eq('contact_type', 'chatter')
      .not('message_type', 'is', null)

    // Unread CHAT (message_type IS NULL, beide contact_types ohne unknown) — gehört zum Chat-Badge
    // Wir zählen Threads (unique sender), nicht einzelne Nachrichten
    const { data: chatUnreadRows } = await supabase
      .from('messages').select('model_name, contact_type')
      .eq('direction', 'in').eq('read', false)
      .in('contact_type', ['model', 'chatter'])
      .is('message_type', null)
    const uniqueThreads = new Set((chatUnreadRows || []).map(r => `${r.contact_type}:${r.model_name}`))
    setUnreadChat(uniqueThreads.size)

    setUnreadModelChanges((modelCount || 0) + (ccCount || 0) + (reqCount || 0) + (modelTicketCount || 0))

    // Unread custom content for model portal
    if (userRoleRef.current === 'model' && userDisplayNameRef.current) {
      const { count: modelCcCount } = await supabase
        .from('custom_content').select('*', { count: 'exact', head: true })
        .eq('model_name', userDisplayNameRef.current)
        .eq('read_by_model', false)
        .eq('completed', false)
      setUnreadCustomContent(modelCcCount || 0)
    }

    // Open todos: Badge zeigt nur Aufgaben wo NIEMAND von uns Admins gelesen hat
    const { data: openTodosData } = await supabase
      .from('todos').select('read_by')
      .eq('completed', false)
    const unreadTodoCount = (openTodosData || []).filter(t => {
      const readBy = Array.isArray(t.read_by) ? t.read_by : []
      return !readBy.includes('Chris') && !readBy.includes('Rey')
    }).length
    setOpenTodos(unreadTodoCount)

    // Open swaps: nur ungelesene (seen_by_admin=false) zählen + Chatter-Tickets
    // v3.28.3: Blöcke (gleiche block_id) als 1 zählen statt jede Model-Zeile
    const { data: openSwapRows } = await supabase
      .from('shift_swaps').select('id, block_id')
      .eq('status', 'offen')
      .eq('seen_by_admin', false)
    const swapCount = new Set((openSwapRows || []).map(s => s.block_id || ('id:' + s.id))).size
    setOpenSwaps(swapCount + (chatterTicketCount || 0))
  }

  const loadAllData = async () => {
    setDataLoading(true)
    try {
      const [{ data: models }, { data: chatters }] = await Promise.all([
        supabase.from('model_snapshots').select('*').order('business_date', { ascending: true }),
        supabase.from('chatter_snapshots').select('*').order('business_date', { ascending: true }),
      ])

      const parsedModels = (models || []).map(s => ({
        businessDate: s.business_date,
        fileName: s.file_name,
        uploadedAt: s.uploaded_at,
        rows: s.rows,
      }))
      const parsedChatters = (chatters || []).map(s => ({
        businessDate: s.business_date,
        fileName: s.file_name,
        uploadedAt: s.uploaded_at,
        rows: s.rows,
      }))

      setModelSnapshots(parsedModels)
      setChatterSnapshots(parsedChatters)

      // Auto-select latest date
      const allDates = [
        ...parsedModels.map(s => s.businessDate),
        ...parsedChatters.map(s => s.businessDate),
      ].sort()
      if (allDates.length > 0) setBusinessDate(allDates[allDates.length - 1])
    } catch (err) {
      console.error('Fehler beim Laden:', err)
    }
    setDataLoading(false)
  }

  // ── Upsert snapshot to Supabase ───────────────────────────────────────────
  const upsertModelSnapshot = async (snap) => {
    const { error } = await supabase.from('model_snapshots').upsert({
      business_date: snap.businessDate,
      file_name: snap.fileName,
      uploaded_at: snap.uploadedAt,
      rows: snap.rows,
      user_id: session.user.id,
    }, { onConflict: 'business_date' })
    if (error) console.error('Upsert model error:', error)
  }

  const upsertChatterSnapshot = async (snap) => {
    const { error } = await supabase.from('chatter_snapshots').upsert({
      business_date: snap.businessDate,
      file_name: snap.fileName,
      uploaded_at: snap.uploadedAt,
      rows: snap.rows,
      user_id: session.user.id,
    }, { onConflict: 'business_date' })
    if (error) console.error('Upsert chatter error:', error)
  }

  const handleModelUpload = useCallback(async (fileName, text) => {
    const { headers, rows: rawRows } = parseCSV(text)
    const rows = rawRows.map(r => parseModelRow(r, headers)).filter(Boolean)
    if (rows.length === 0) {
      alert('Keine gültigen Daten in der Model-CSV gefunden.')
      return
    }
    const snap = { businessDate, fileName, uploadedAt: new Date().toISOString(), rows }
    await upsertModelSnapshot(snap)
    setModelSnapshots(prev => {
      const updated = prev.filter(s => s.businessDate !== businessDate)
      return [...updated, snap].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    })
  }, [businessDate, session])

  const handleChatterUpload = useCallback(async (fileName, text) => {
    const { headers, rows: rawRows } = parseCSV(text)
    const rows = rawRows.map(r => parseChatterRow(r, headers)).filter(Boolean)
    if (rows.length === 0) {
      alert('Keine gültigen Daten in der Chatter-CSV gefunden.')
      return
    }
    const snap = { businessDate, fileName, uploadedAt: new Date().toISOString(), rows }
    await upsertChatterSnapshot(snap)
    setChatterSnapshots(prev => {
      const updated = prev.filter(s => s.businessDate !== businessDate)
      return [...updated, snap].sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    })
  }, [businessDate, session])

  const clearAllData = async () => {
    if (!window.confirm('Alle Daten löschen? Kann nicht rückgängig gemacht werden.')) return
    await Promise.all([
      supabase.from('model_snapshots').delete().neq('id', 0),
      supabase.from('chatter_snapshots').delete().neq('id', 0),
      // v4.31.0: die Einzeldateien haengen am selben business_date und muessen mit weg
      supabase.from('model_chatter_daily').delete().neq('id', 0),
    ])
    setModelSnapshots([])
    setChatterSnapshots([])
    setEinzelReload(n => n + 1)
    setBusinessDate(todayISO())
  }

  const deleteDay = async (date) => {
    if (!window.confirm(`Tag ${date} löschen? Alle drei Quellen (Model-CSV, Chatter-CSV, Model-Einzeldateien) für diesen Tag werden gelöscht.`)) return
    await supabase.from('model_snapshots').delete().eq('business_date', date)
    await supabase.from('chatter_snapshots').delete().eq('business_date', date)
    // v4.31.0: sonst blieben verwaiste Chatter-x-Model-Zeilen ohne Vergleichsdatei stehen
    await supabase.from('model_chatter_daily').delete().eq('business_date', date)
    setEinzelReload(n => n + 1)
    setModelSnapshots(prev => prev.filter(s => s.businessDate !== date))
    setChatterSnapshots(prev => prev.filter(s => s.businessDate !== date))
    const remaining = allDates.filter(d => d !== date)
    if (remaining.length > 0) setBusinessDate(remaining[0])
    else setBusinessDate(todayISO())
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (authLoading || (session && userRole === null)) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
      Daten werden geladen...
    </div>
  )

  if (!session) return <LoginPage />

  // v3.18.0: Zugang gesperrt (stillgelegt / offboarded) · v3.57.0: + nicht eingerichtet
  if (accountBlocked) {
    const suspended = accountBlocked.status === 'suspended'
    const notSetup = accountBlocked.status === 'not_setup'
    const ladeFehler = accountBlocked.status === 'load_error'
    const icon = ladeFehler ? '📡' : notSetup ? '⚠️' : suspended ? '⏸️' : '📦'
    const title = ladeFehler ? 'Verbindung fehlgeschlagen' : notSetup ? 'Account nicht korrekt eingerichtet' : suspended ? 'Zugang vorübergehend stillgelegt' : 'Zugang deaktiviert'
    const message = ladeFehler
      ? 'Dein Zugang konnte gerade nicht geladen werden. Bitte lade die Seite neu.'
      : notSetup
      ? 'Deinem Konto ist noch keine Rolle zugewiesen. Bitte wende dich an deine Agentur-Leitung, damit dein Zugang eingerichtet wird.'
      : suspended
        ? 'Dein Konto ist aktuell pausiert. Bitte wende dich an deine Agentur-Leitung, wenn du wieder einsteigen möchtest.'
        : 'Dein Konto wurde deaktiviert. Bei Fragen wende dich bitte an deine Agentur-Leitung.'
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'var(--font-sans)' }}>
        <div style={{ maxWidth: 420, textAlign: 'center', background: 'var(--bg-card)', border: '1px solid #1e1e3a', borderRadius: 16, padding: '36px 32px' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>{icon}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
            {title}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: accountBlocked.note ? 14 : 24 }}>
            {message}
          </div>
          {accountBlocked.note && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic', background: 'var(--bg-card2)', border: '1px solid #1e1e3a', borderRadius: 8, padding: '10px 12px', marginBottom: 24 }}>
              „{accountBlocked.note}"
            </div>
          )}
          {ladeFehler && (
            <button onClick={() => window.location.reload()} style={{ padding: '10px 22px', borderRadius: 8, background: '#7c3aed', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginRight: 8 }}>
              Neu laden
            </button>
          )}
          <button onClick={handleLogout} style={{ padding: '10px 22px', borderRadius: 8, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Abmelden
          </button>
        </div>
      </div>
    )
  }

  if (needsPassword) return <SetPasswordPage onDone={() => setNeedsPassword(false)} />

  // v4.24.0: Nur diese Tabs zeigen Snapshot-Daten. Das "Noch keine Daten"-Gate
  // im Main-Bereich galt vorher fuer ALLE Tabs — ein dienstplan-User haette nach
  // der Umstellung (keine Snapshots mehr fuer Nicht-Staff) statt seines
  // Dienstplans den Leer-Screen gesehen. Betraf auch heute schon jeden, der sich
  // vor dem ersten CSV-Upload einloggt.
  const SNAPSHOT_TABS = ['models', 'chatters', 'briefing', 'performance']

  // Role permissions
  const showChatterPortal = userRole !== null && ((userRole === 'chatter' && viewMode !== 'admin') || viewMode === 'chatter' || viewMode === 'mein-chatter')
  const showModelPortal = userRole !== null && ((userRole === 'model' && viewMode !== 'admin') || viewMode === 'model')
  const isAdmin = userRole === 'admin'
  const isManager = userRole === 'admin' || userRole === 'manager'

  // Tab access per role
  const isSocialMedia = userRoles.includes('social_media')
  const hasRole = (r) => userRole === r || userRole === 'admin'

  // v4.68.0: Regeln liegen in src/zugang.js, damit der Routing-Effekt oben
  // dieselbe Pruefung benutzt wie die Tab-Leiste hier.
  const canAccess = (tab) => darfAufTab(userRole, userRoles, tab)

  if (showModelPortal) return (
    <ModelPortal
      session={session}
      displayName={isAdmin || userRole === 'manager' ? 'Vorschau' : userDisplayName}
      onSwitchToAdmin={(isAdmin || isManager) ? () => setViewMode('admin') : null}
      isPreview={isAdmin || userRole === 'manager'}
      unreadCustomContent={unreadCustomContent}
      onMarkCustomContentRead={() => setUnreadCustomContent(0)}
    />
  )

  // v4.52.0: Admins/Manager haben zwei Chatter-Ansichten:
  //   'chatter'      = Vorschau eines anderen Chatters (schreibt nichts automatisch)
  //   'mein-chatter' = das EIGENE Portal, wie ein Chatter es sieht
  // key erzwingt einen frischen Aufbau beim Umschalten, damit kein Zustand
  // (Check-in, Intervalle) von der einen in die andere Ansicht rutscht.
  const eigenesPortal = viewMode === 'mein-chatter'
  if (showChatterPortal) return (
    <ChatterPortal
      key={eigenesPortal ? 'mein' : (isManager ? 'vorschau' : 'chatter')}
      session={session}
      displayName={userDisplayName}
      onSwitchToAdmin={(isAdmin || isManager) ? () => setViewMode('admin') : null}
      isSocialMedia={isSocialMedia}
      isPreview={(isAdmin || isManager) && !eigenesPortal}
      onSwitchToOwn={isManager ? () => setViewMode('mein-chatter') : null}
      onSwitchToPreview={isManager ? () => setViewMode('chatter') : null}
    />
  )

  // Non-admin roles that work in dashboard
  if (userRole === 'dienstplan' && viewMode !== 'admin') {
    // v4.68.0: ersetzen statt pushen — ein erzwungener Wechsel darf keinen
    // History-Eintrag anlegen, sonst landet Zurueck in einer Schleife.
    if (activeTab !== 'schedule' && activeTab !== 'chatters-comm') { routeErsetzen.current = true; setActiveTab('schedule') }
  }
  if (userRole === 'creator_manager' && viewMode !== 'admin') {
    if (activeTab !== 'models-comm') { routeErsetzen.current = true; setActiveTab('models-comm') }
  }

  const currentModelSnap = modelSnapshots.find(s => s.businessDate === businessDate)
  const currentChatterSnap = chatterSnapshots.find(s => s.businessDate === businessDate)
  const allDates = [...new Set([
    ...modelSnapshots.map(s => s.businessDate),
    ...chatterSnapshots.map(s => s.businessDate),
  ])].sort().reverse()

  // ── Navigation (v4.69.0) ──────────────────────────────────────────────────
  // BEREICHE oben in der Datei sagt, was es gibt; hier wird daraus gefiltert,
  // was diese Rolle sehen darf, und die Zaehler werden aufgeloest.
  const BADGES = { unreadModelChanges, openSwaps, unreadChat, openTodos, unreadNotes }
  const badgeVon = (tab) => (tab.badge ? (BADGES[tab.badge] || 0) : 0)
  const sichtbareBereiche = BEREICHE
    .map(b => ({ ...b, tabs: b.tabs.filter(t => canAccess(t.key)) }))
    .filter(b => b.tabs.length > 0)
  // v4.71.0: Jetzt gehoert zu keinem Bereich — dann ist auch keiner markiert.
  const aktiverBereich = activeTab === 'jetzt' ? null : (BEREICH_VON_TAB[activeTab] || 'analyse')
  const offenerBereich = sichtbareBereiche.find(b => b.key === aktiverBereich)
  const offeneTabs = offenerBereich ? offenerBereich.tabs : []

  // Beim Oeffnen verschwinden die Badges — Verhalten unveraendert aus v3.9.
  const oeffneTab = (key) => {
    setActiveTab(key)
    setMoreOpen(false)
    if (key === 'models-comm') setUnreadModelChanges(0)
    if (key === 'chatters-comm') setOpenSwaps(0)
    if (key === 'notes') { lastNoteCheck.current = new Date().toISOString(); setUnreadNotes(0) }
  }
  // Ein Bereich fuehrt auf seinen ersten Tab. Ist man schon drin, passiert
  // nichts — sonst wuerde ein Klick auf "Analyse" von Performance wegspringen.
  const oeffneBereich = (b) => {
    if (b.key === aktiverBereich) return
    if (b.tabs[0]) oeffneTab(b.tabs[0].key)
  }

  // ── Datenstand (v4.69.0) ──────────────────────────────────────────────────
  // Der Upload steht seit v4.69.0 unter Verwaltung statt als Dauerstreifen
  // unter der Kopfzeile. Oben bleibt nur, was wirklich oben hingehoert: die
  // Meldung, dass heute etwas FEHLT. An allen anderen Tagen ist sie still.
  // Die Zahlen eines Tages kommen erst am Morgen danach — am 20. wird der 19.
  // hochgeladen. "Heute fehlt was" waere deshalb fast immer wahr und die
  // Anzeige binnen einer Woche blinder Alarm. Gemessen wird an GESTERN: liegt
  // fuer den Vortag beides vor (oder schon fuer heute), ist alles in Ordnung.
  const heuteISO = todayISO()
  const gesternISO = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
  const tagVollstaendig = (d) => modelSnapshots.some(s => s.businessDate === d)
    && chatterSnapshots.some(s => s.businessDate === d)
  const datenHeuteOk = tagVollstaendig(gesternISO) || tagVollstaendig(heuteISO)
  const fehlenderTag = tagVollstaendig(gesternISO) ? heuteISO : gesternISO

  // ── Handy-Leiste (v4.71.0) ────────────────────────────────────────────────
  // Nur fuer Admin/Manager: dienstplan und creator_manager haben ein, zwei Tabs
  // und brauchen keine Navigation, schon gar keinen Jetzt-Screen mit Umsaetzen.
  const mitLeiste = isManager && canAccess('jetzt')
  const mehrZahl = (openTodos || 0) + (unreadModelChanges || 0) + (unreadNotes || 0)
  const aufLeiste = LEISTE.some(l => l.key === activeTab)
  // Aus dem Jetzt-Screen heraus: wie ein Klick in der Navigation, plus
  // Sprungziel (Schichttausch) und — beim fehlenden Datenstand — gleich den
  // richtigen Tag einstellen, wie der Knopf oben rechts.
  const oeffneVonJetzt = (tab, focus) => {
    if (tab === 'datenstand' && !datenHeuteOk) setBusinessDate(fehlenderTag)
    oeffneTab(tab)
    if (focus) setCommFocus({ ...focus, ts: Date.now() })
    window.scrollTo(0, 0)
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* v4.14.0: Inkognito-Schalter — bewusst HIER und nicht mehr in main.jsx.
          Dort lag er über allem, also auch über Login, Chatter- und Model-Portal.
          Diese Stelle wird nur erreicht, wenn wirklich das Admin-Dashboard läuft:
          Login, Sperr-Screen, Passwort-Seite und beide Portale sind vorher schon
          per return abgehandelt. */}
      <PresentationToggle />
      {/* SurveyModal wird in ChatterPortal/ModelPortal selbst gerendert */}
      {/* ── HEADER ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(7,7,16,0.97)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 8,
        minHeight: 56,
      }}>
        {/* Left */}
        <div onClick={() => setActiveTab('models')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer' }}>
          {/* v4.7.0: Logo liegt jetzt in src/components/Logo.jsx — dieselbe Datei
              nutzen Chatter-Portal, Model-Portal, Login und Passwort-Seite. */}
          <div style={{ width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Logo size={28} />
          </div>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Thirteen 87 Collective</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6, letterSpacing: '0.05em', display: 'inline' }} className="hide-mobile">Agency Dashboard</span>
          </div>
          {allDates.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', background: 'var(--bg-card)', padding: '2px 7px', borderRadius: 4, border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
              {allDates.length}T
            </span>
          )}
        </div>
        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
          {/* v4.69.0: still wenn alles da ist, laut wenn nicht. Ein Klick
              springt in den Upload — und stellt gleich den heutigen Tag ein. */}
          {canAccess('datenstand') && (
            <button
              onClick={() => { if (!datenHeuteOk) setBusinessDate(fehlenderTag); oeffneTab('datenstand') }}
              title={datenHeuteOk ? 'Model- und Chatter-Datei des letzten Tages sind da' : `Fuer ${fehlenderTag} fehlt mindestens eine Datei — hier hochladen`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: 700,
                background: datenHeuteOk ? 'transparent' : 'rgba(245,158,11,0.12)',
                border: `1px solid ${datenHeuteOk ? 'var(--border)' : 'rgba(245,158,11,0.5)'}`,
                color: datenHeuteOk ? 'var(--text-secondary)' : '#f59e0b',
              }}>
              <Database size={13} strokeWidth={2.4} />
              <span className="hide-sm">{datenHeuteOk ? 'Daten aktuell' : `Daten fehlen: ${fehlenderTag.slice(8, 10)}.${fehlenderTag.slice(5, 7)}.`}</span>
            </button>
          )}
          {/* v4.69.0: Bereichszeile. Die Unterpunkte des offenen Bereichs
              stehen in einem eigenen Streifen direkt unter der Kopfzeile. */}
          <div className="tabs-desktop" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {sichtbareBereiche.map(b => {
              const aktiv = b.key === aktiverBereich
              const zahl = b.tabs.reduce((n, t) => n + badgeVon(t), 0)
              return (
                <button key={b.key} onClick={() => oeffneBereich(b)} style={{
                  padding: '6px 12px', borderRadius: 8,
                  background: aktiv ? '#7c3aed' : 'transparent',
                  color: aktiv ? '#fff' : (zahl > 0 ? '#f59e0b' : 'var(--text-secondary)'),
                  fontWeight: 600, fontSize: 13, transition: 'all 0.15s',
                  border: `1px solid ${aktiv ? '#7c3aed' : (zahl > 0 ? 'rgba(245,158,11,0.4)' : 'var(--border)')}`,
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                  whiteSpace: 'nowrap', fontFamily: 'inherit',
                }}>
                  <b.Icon size={14} strokeWidth={2.2} />
                  <span>{b.label}</span>
                  {zahl > 0 && !aktiv && (
                    <span style={{ background: '#f59e0b', color: '#000', fontSize: 10, fontWeight: 800, borderRadius: 10, padding: '1px 6px', lineHeight: 1.4 }}>{zahl}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* v3.9.0: Mobile Burger — v4.71.0: nicht mehr bei Admin/Manager,
              dort oeffnet "Mehr" in der unteren Leiste dasselbe Menue. */}
          {!mitLeiste && (
          <button className="tabs-mobile-btn" onClick={() => setMobileMenuOpen(true)} style={{
            display: 'none', padding: '6px 10px', borderRadius: 8,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit',
            alignItems: 'center', gap: 6,
          }}>
            <MoreHorizontal size={16} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Menü</span>
          </button>
          )}

          {/* v4.55.0: Ansicht-Wechsel nur für Admin/Manager — dienstplan/creator_manager
              landeten sonst ohne Rückweg im echten Chatter-Portal */}
          {isManager && (<>
          <button onClick={() => setViewMode('chatter')} title="Chatter-Ansicht" style={{
            fontSize: 12, padding: '6px 10px', borderRadius: 6,
            background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)',
            color: '#06b6d4', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <Eye size={13} />
            <span className="hide-mobile">Chatter</span>
          </button>
          <button onClick={() => setViewMode('model')} title="Model-Ansicht" style={{
            fontSize: 12, padding: '6px 10px', borderRadius: 6,
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            color: '#f59e0b', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <Eye size={13} />
            <span className="hide-mobile">Model</span>
          </button>
          {/* v4.52.1: rechts neben Chatter/Model, Icon statt Emoji */}
          {isManager && (
            <button onClick={() => setViewMode('mein-chatter')} title="Dein eigenes Chatter-Portal (Schichten, Check-in, Vorschläge)" style={{
              fontSize: 12, padding: '6px 10px', borderRadius: 6,
              background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
              color: '#10b981', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <UserRound size={13} />
              <span className="hide-mobile">Mein Portal</span>
            </button>
          )}
          </>)}
          <button onClick={handleLogout} title="Abmelden" style={{
            fontSize: 12, padding: '5px 10px', borderRadius: 6,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
          }}>↩</button>
          <button onClick={toggleTheme} title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'} style={{
            padding: '5px 10px', borderRadius: 6,
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            display: 'inline-flex', alignItems: 'center',
          }}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      {/* v4.69.0: Handy-Menue — dieselbe Einteilung wie am Desktop, nur
          untereinander. Vorher hingen hier 16 gleichrangige Eintraege. */}
      {mobileMenuOpen && (
        <div onClick={() => setMobileMenuOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            background: 'var(--bg-card)', width: 'min(300px, 85vw)',
            borderLeft: '1px solid var(--border)', padding: 16,
            display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Navigation</span>
              <button onClick={() => setMobileMenuOpen(false)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                fontSize: 20, cursor: 'pointer', padding: 4, fontFamily: 'inherit',
              }}>✕</button>
            </div>
            {sichtbareBereiche.map(b => {
              const tabs = b.tabs.filter(t => canAccess(t.key))
              return (
                <div key={b.key} style={{ marginBottom: 10 }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: 'var(--text-secondary)', padding: '6px 12px 4px', display: 'flex', alignItems: 'center', gap: 7,
                  }}>
                    <b.Icon size={12} strokeWidth={2.4} />
                    {b.label}
                  </div>
                  {tabs.map(tab => {
                    const zahl = badgeVon(tab)
                    return (
                      <button key={tab.key} onClick={() => { oeffneTab(tab.key); setMobileMenuOpen(false) }} style={{
                        padding: '10px 12px', borderRadius: 6,
                        background: activeTab === tab.key ? '#7c3aed' : 'transparent',
                        color: activeTab === tab.key ? '#fff' : (zahl > 0 ? '#f59e0b' : 'var(--text-primary)'),
                        fontWeight: 600, fontSize: 14, border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                        fontFamily: 'inherit', width: '100%',
                      }}>
                        <tab.Icon size={16} strokeWidth={2.2} />
                        <span style={{ flex: 1 }}>{tab.label}</span>
                        {zahl > 0 && (
                          <span style={{ background: '#f59e0b', color: '#000', fontSize: 10, fontWeight: 800, borderRadius: 10, padding: '1px 6px' }}>{zahl}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── v4.69.0: UNTERZEILE ──
          Zeigt die Unterpunkte des offenen Bereichs. Hier stand bis v4.68 der
          Dauerstreifen mit Business Date und den drei Upload-Kacheln; der
          liegt jetzt unter Verwaltung → Daten. */}
      <div className="tabs-desktop" style={{
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
      }}>
        {offenerBereich && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--text-muted)', marginRight: 8,
          }}>{offenerBereich.label}</span>
        )}
        {offeneTabs.length > 1 && offeneTabs.map(tab => {
          const aktiv = activeTab === tab.key
          const zahl = badgeVon(tab)
          return (
            <button key={tab.key} onClick={() => oeffneTab(tab.key)} style={{
              padding: '6px 12px', borderRadius: 7,
              background: aktiv ? 'var(--bg-card2)' : 'transparent',
              color: aktiv ? 'var(--text-primary)' : (zahl > 0 ? '#f59e0b' : 'var(--text-secondary)'),
              border: `1px solid ${aktiv ? 'var(--border-bright)' : 'transparent'}`,
              fontWeight: aktiv ? 700 : 500, fontSize: 12.5, cursor: 'pointer',
              fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            }}>
              <tab.Icon size={13} strokeWidth={2.2} />
              <span>{tab.label}</span>
              {zahl > 0 && !aktiv && (
                <span style={{ background: '#f59e0b', color: '#000', fontSize: 10, fontWeight: 800, borderRadius: 10, padding: '1px 6px' }}>{zahl}</span>
              )}
            </button>
          )
        })}
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{APP_VERSION}</span>
      </div>

      {/* ── MAIN ── */}
      <main style={{ padding: '16px', maxWidth: 1600, margin: '0 auto' }}>
        {dataLoading ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '80px 0', fontSize: 14 }}>Daten werden geladen...</div>
        ) : SNAPSHOT_TABS.includes(activeTab) && modelSnapshots.length === 0 && chatterSnapshots.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 48, opacity: 0.3 }}>📊</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-secondary)' }}>Noch keine Daten vorhanden</div>
            <div style={{ fontSize: 14, textAlign: 'center' }}>Wähle ein Business Date und lade CSV-Dateien hoch.</div>
          </div>
        ) : activeTab === 'jetzt' ? (
          <JetztView
            modelSnapshots={modelSnapshots}
            zaehler={{ openSwaps, unreadChat, openTodos, unreadModelChanges, unreadNotes }}
            canAccess={canAccess}
            onOpen={oeffneVonJetzt}
            datenOk={datenHeuteOk}
            fehlenderTag={fehlenderTag}
          />
        ) : activeTab === 'models' ? (
          <ModelsView selectedDate={businessDate} modelSnapshots={modelSnapshots} chatterSnapshots={chatterSnapshots} onDateChange={setBusinessDate} />
        ) : activeTab === 'chatters' ? (
          <ChattersView selectedDate={businessDate} chatterSnapshots={chatterSnapshots} onDateChange={setBusinessDate} />
        ) : activeTab === 'briefing' ? (
          <BriefingView modelSnapshots={modelSnapshots} chatterSnapshots={chatterSnapshots} />
        ) : activeTab === 'kalender' ? (
          <CalendarTab userDisplayName={userDisplayName} />
        ) : activeTab === 'notes' ? (
          <NotesTab session={session} userDisplayName={userDisplayName} />
        ) : activeTab === 'nachrichten' ? (
          <CommTab key="nachrichten" session={session} section="nachrichten" displayName={userDisplayName} />
        ) : activeTab === 'models-comm' ? (
          <CommTab key="models-comm" session={session} section="models" displayName={userDisplayName} focus={commFocus} />
        ) : activeTab === 'chatters-comm' ? (
          <CommTab key="chatters-comm" session={session} section="chatters" displayName={userDisplayName} focus={commFocus} />
        ) : activeTab === 'chat' ? (
          <CommTab key="chat" session={session} section="chat" displayName={userDisplayName} />
        ) : activeTab === 'performance' ? (
          <PerformanceTab modelSnapshots={modelSnapshots} chatterSnapshots={chatterSnapshots} />
        ) : activeTab === 'todos' ? (
          <TodoTab session={session} userDisplayName={userDisplayName} />
        ) : activeTab === 'social' ? (
          <SocialTab session={session} userDisplayName={userDisplayName} userRole={userRole} />
        ) : activeTab === 'billing' ? (
          <BillingTab />
        ) : activeTab === 'vorschlaege' ? (
          <SuggestionsAdmin />
        ) : activeTab === 'datenstand' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* v4.69.0: Hier ist der Upload zuhause — zusammen mit der Anzeige,
                was schon drin ist. Beides macht man ohnehin in einem Zug. */}
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
              padding: 14, display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 150 }}>
                <label style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Business Date</label>
                <input type="date" value={businessDate} onChange={e => setBusinessDate(e.target.value)} />
                {allDates.length > 0 && (
                  <select value={businessDate} onChange={e => setBusinessDate(e.target.value)} style={{
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', padding: '6px 8px', borderRadius: 6,
                    fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', outline: 'none',
                  }}>
                    {allDates.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                )}
                {(currentModelSnap || currentChatterSnap) && (
                  <button onClick={() => deleteDay(businessDate)} style={{
                    padding: '5px 9px', background: 'transparent',
                    border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(239,68,68,0.7)',
                    borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }} title={`Tag ${businessDate} loeschen`}>🗑 Tag löschen</button>
                )}
              </div>
              <div className="upload-row-compact" style={{ display: 'flex', gap: 8, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                <UploadBox
                  label="Daily Model"
                  onFile={handleModelUpload}
                  lastFileName={currentModelSnap?.fileName}
                  lastDate={currentModelSnap?.uploadedAt ? new Date(currentModelSnap.uploadedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null}
                />
                <UploadBox
                  label="Daily Chatter"
                  onFile={handleChatterUpload}
                  lastFileName={currentChatterSnap?.fileName}
                  lastDate={currentChatterSnap?.uploadedAt ? new Date(currentChatterSnap.uploadedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null}
                />
                {/* v4.31.0: Model-Einzeldateien. Braucht die Model-CSV desselben Tages als
                    Nachschlagewerk — daran werden die Dateien ueber ihre Summe erkannt. */}
                <ModelChatterUpload
                  key={`mcu_${businessDate}_${einzelReload}`}
                  businessDate={businessDate}
                  modelRows={currentModelSnap?.rows || []}
                  session={session}
                  onSaved={() => setEinzelReload(n => n + 1)}
                />
              </div>
            </div>
            <DataStatusTab key={`ds_${einzelReload}`} modelSnapshots={modelSnapshots} chatterSnapshots={chatterSnapshots} />
          </div>
        ) : activeTab === 'settings' ? (
          <SettingsTab />
        ) : (
          <ScheduleTab session={session} userDisplayName={userDisplayName} />
        )}
      </main>

      {/* ── v4.71.0: UNTERE LEISTE (nur Handy, nur Admin/Manager) ──
          CSS blendet sie ab 769 px aus (.leiste-mobil). Solange sie im DOM
          haengt, traegt <html> die Klasse mit-leiste — daran haengen der
          Abstand unter dem Inhalt und die Hoehe der schwebenden Knoepfe. */}
      {mitLeiste && (
        <nav className="leiste-mobil" ref={leisteMerken} aria-label="Hauptnavigation">
          {LEISTE.map(l => {
            const aktiv = activeTab === l.key
            const zahl = l.badge ? (BADGES[l.badge] || 0) : 0
            return (
              <button key={l.key} onClick={() => { oeffneTab(l.key); window.scrollTo(0, 0) }}
                aria-current={aktiv ? 'page' : undefined}
                className={aktiv ? 'aktiv' : undefined}>
                <span className="leiste-icon">
                  <l.Icon size={20} strokeWidth={aktiv ? 2.4 : 2} aria-hidden="true" />
                  {zahl > 0 && <span className="leiste-zahl">{zahl > 99 ? '99+' : zahl}</span>}
                </span>
                <span>{l.label}</span>
              </button>
            )
          })}
          <button onClick={() => setMobileMenuOpen(true)} className={!aufLeiste ? 'aktiv' : undefined}
            aria-label={mehrZahl > 0 ? `Mehr, ${mehrZahl} offen` : 'Mehr'}>
            <span className="leiste-icon">
              <LayoutGrid size={20} strokeWidth={!aufLeiste ? 2.4 : 2} aria-hidden="true" />
              {mehrZahl > 0 && <span className="leiste-punkt" />}
            </span>
            <span>Mehr</span>
          </button>
        </nav>
      )}

      {/* v3.61.0: Chat als schwebende Bubble (nur Admin/Manager) */}
      {(isAdmin || isManager) && (
        <>
          {/* v4.1.0: Es ist immer nur EINES der drei Fenster offen — der Zustand
              liegt hier oben statt in jedem Widget einzeln. Escape schließt. */}
          <ChatWidget session={session} displayName={userDisplayName} unread={unreadChat}
            isOpen={fab.active === 'chat'} onToggle={(v) => fab.set('chat', v)} />
          <ActivityWidget onNavigate={(tab, focus) => { setActiveTab(tab); if (focus) setCommFocus({ ...focus, ts: Date.now() }) }}
            isOpen={fab.active === 'activity'} onToggle={(v) => fab.set('activity', v)} />
          {/* v3.97.0: dritte Glocke — was die ANDEREN Admins gemacht haben */}
          <AdminBell me={userDisplayName} onNavigate={(tab) => setActiveTab(tab)}
            chatterSnapshots={chatterSnapshots} modelSnapshots={modelSnapshots}
            isOpen={fab.active === 'admin'} onToggle={(v) => fab.set('admin', v)} />
        </>
      )}
    </div>
  )
}
