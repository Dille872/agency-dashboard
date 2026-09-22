-- ============================================================================
-- v4.95.0 · Model-Steckbrief „Über mich“ + Einführung für Models
--
-- Eine Zeile je Model. antworten = die Fragen aus dem Fragenkatalog (jsonb,
-- Feldnamen siehe src/steckbrief.js). Angebot, Preise, No Gos bleiben in
-- model_board — hier nichts doppelt.
--
-- einfuehrung_status:
--   null      keine Einführung angefordert
--   'offen'   vom Team geschickt (oder beim Anlegen vorgemerkt)
--   'laeuft'  Model hat angefangen
--   'fertig'  abgeschlossen (fertig_am)
--
-- WER DARF WAS
--   Lesen:    jeder aktive Login (Chatter sollen es lesen — Fan-Version).
--   Anlegen/Ändern: Staff, Kontakt-Pfleger (darf_kontakte_pflegen) oder das
--             Model selbst für die EIGENE Zeile (model_name = my_display_name()).
--   Löschen:  nur Staff.
-- Dazu wie überall die restrictive Policy aktiv_erforderlich.
--
-- Wiederholbar. Rückbau: drop table public.model_steckbrief;
-- ============================================================================

create table if not exists public.model_steckbrief (
  model_name           text primary key,
  antworten            jsonb not null default '{}'::jsonb,
  einfuehrung_status   text check (einfuehrung_status in ('offen', 'laeuft', 'fertig')),
  einfuehrung_schritt  text,
  geschickt_am         timestamptz,
  geschickt_von        text,
  fertig_am            timestamptz,
  aktualisiert_am      timestamptz not null default now(),
  aktualisiert_von     text
);

alter table public.model_steckbrief enable row level security;

drop policy if exists steckbrief_lesen    on public.model_steckbrief;
drop policy if exists steckbrief_anlegen  on public.model_steckbrief;
drop policy if exists steckbrief_aendern  on public.model_steckbrief;
drop policy if exists steckbrief_loeschen on public.model_steckbrief;
drop policy if exists aktiv_erforderlich  on public.model_steckbrief;

create policy steckbrief_lesen on public.model_steckbrief for select to authenticated
  using (true);

create policy steckbrief_anlegen on public.model_steckbrief for insert to authenticated
  with check (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy steckbrief_aendern on public.model_steckbrief for update to authenticated
  using      (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name())
  with check (public.is_staff() or public.darf_kontakte_pflegen() or model_name = public.my_display_name());

create policy steckbrief_loeschen on public.model_steckbrief for delete to authenticated
  using (public.is_staff());

create policy aktiv_erforderlich on public.model_steckbrief as restrictive for all to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Prüfen (sollte 5 Policies zeigen):
-- select policyname, permissive, cmd from pg_policies where tablename = 'model_steckbrief';
