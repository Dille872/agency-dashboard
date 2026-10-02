// ── Rollen: eine Quelle für Einstellungen und „Team & Rechte“ (v5.27.0) ────
// Vorher direkt in SettingsTab.jsx. Neue Rolle = hier eintragen + in die
// passende Gruppe + Check-Constraint in Supabase (siehe sql/…-Dateien).

export const ROLES = [
  { key: 'admin', label: 'Admin', color: '#7c3aed', desc: 'Alles', punkte: ['Alles, inkl. Einstellungen, Billing, Export', 'Rechte vergeben'] },
  { key: 'manager', label: 'Manager', color: '#06b6d4', desc: 'Alles außer Einstellungen & Export', punkte: ['Alles außer Einstellungen, Billing & Export'] },
  { key: 'dienstplan', label: 'Dienstplan', color: '#10b981', desc: 'Nur Dienstplan & Crew', punkte: ['Dienstplan & Crew bearbeiten', 'Team-Kalender'] },
  { key: 'creator_manager', label: 'Creator Mgr', color: '#f59e0b', desc: 'Nur Creator Tab', punkte: ['Kommunikation mit den Models (Creator)', 'Team-Kalender'] },
  { key: 'chatter', label: 'Chatter', color: '#a78bfa', desc: 'Nur Chatter Portal', punkte: ['Chatter-Portal: Schichten, Models, Stats'] },
  { key: 'model', label: 'Model', color: '#ef4444', desc: 'Nur Model Portal', punkte: ['Model-Portal: Board, Kalender, Umsatz, Videos, Social'] },
  // v5.1.0: Social-Team klar benannt. Der Schlüssel social_media bleibt (Datenbank), heißt aber „Poster“.
  { key: 'social_media', label: '📱 Poster', color: '#ec4899', desc: 'Postet freigegebene Reels — nur die Accounts, die ihm in der Steuerung zugeteilt sind', punkte: ['Freigegebene Reels posten & als gepostet markieren', 'nur zugeteilte Accounts'], zuteilung: true },
  { key: 'cutter', label: '✂️ Cutter', color: '#a855f7', desc: 'Schneidet Rohvideos — nur die Accounts, die ihm in der Steuerung zugeteilt sind', punkte: ['Rohvideos schneiden & hochladen', 'nur zugeteilte Accounts'], zuteilung: true },
  { key: 'social_leitung', label: '🧭 Social-Leitung', color: '#f97316', desc: 'Ganzer Social-Media-Bereich für alle Models (Steuerung, Freigabe, Zuteilen, Wirkung) — sonst nichts', punkte: ['Ganzer Social-Bereich, alle Models', 'sonst nichts'] },
  // v5.27.0: Content
  { key: 'storyteller', label: '✍️ Storyteller', color: '#c084fc', desc: 'Schreibt Skripte Schritt für Schritt für Models — gehen erst nach eurer Freischaltung ans Model', punkte: ['Skripte mit Schritten für Models schreiben', 'gehen erst nach eurer Freischaltung ans Model'] },
  { key: 'script_builder', label: '🧩 Script Builder', color: '#22d3ee', desc: 'Baut die Skripte in CreatorHero — bekommt Bescheid, wenn ein Model etwas hochgeladen oder ein Video eingetragen hat', punkte: ['Bekommt Telegram, wenn ein Model hochgeladen / ein Video eingetragen hat', 'baut die Skripte in CreatorHero und hakt ab'] },
  // Altname bis v5.0.0, wird mit sql/social-leitung.sql zu social_leitung. Nicht mehr auswählbar.
  { key: 'social_freigabe', label: 'Social-Freigabe (alt)', color: '#f97316', desc: 'veraltet, wird zur Social-Leitung', alt: true },
]

// v5.1.0: Rollen in Gruppen, damit man durchblickt · v5.27.0: + Content
export const ROLLEN_GRUPPEN = [
  { key: 'team', titel: 'Team', hinweis: 'Arbeiten im Dashboard', keys: ['admin', 'manager', 'dienstplan', 'creator_manager'] },
  { key: 'portale', titel: 'Portale', hinweis: 'Eigenes Portal', keys: ['chatter', 'model'] },
  { key: 'social', titel: '📱 Social Media', hinweis: 'Zusatzrollen, auch zu Chatter kombinierbar. Welche Accounts: Social Media → Steuerung / Rechte', keys: ['social_media', 'cutter', 'social_leitung'] },
  { key: 'content', titel: '✍️ Content', hinweis: 'Zusatzrollen, auch zu Chatter kombinierbar', keys: ['storyteller', 'script_builder'] },
]

// Hauptrolle (Spalte role) = höchste Rolle nach Rang
export const ROLLEN_RANG = ['admin', 'manager', 'dienstplan', 'creator_manager', 'model', 'chatter']
export const rolle = (k) => ROLES.find(r => r.key === k)
export const rollenVon = (u) => [...new Set([...(u?.roles || []), u?.role].filter(Boolean))]
export const hauptrolle = (liste) => ROLLEN_RANG.find(r => liste.includes(r)) || liste[0]
