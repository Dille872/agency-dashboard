-- ════════════════════════════════════════════════════════════════════════════
-- v5.28.0 · Skript-Aufträge an die Storytellerin
-- ════════════════════════════════════════════════════════════════════════════
-- Admins können der Storytellerin Aufträge geben („2 neue Skripte für Sandra,
-- Thema Gym, bis Freitag“). Ein Auftrag ist eine Zeile in of_skripte mit
-- status = 'auftrag', erstellt_von = die Storytellerin, auftrag_von = wer ihn
-- gegeben hat. Sie öffnet ihn, schreibt die Schritte und schickt ihn wie
-- gewohnt zur Freigabe.
--
-- Mehrfach ausführbar. Ändert keine bestehenden Skripte.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.of_skripte add column if not exists auftrag_von   text;
alter table public.of_skripte add column if not exists auftrag_notiz text;

-- Neuer Status 'auftrag'
alter table public.of_skripte drop constraint if exists of_skripte_status_check;
alter table public.of_skripte add constraint of_skripte_status_check
  check (status in ('auftrag', 'entwurf', 'freigabe', 'zurueck', 'beim_model', 'hochgeladen', 'gebaut', 'verworfen'));

-- Storytellerin darf ihre Aufträge bearbeiten (lesen konnte sie eigene schon)
drop policy if exists of_skripte_st_aendern on public.of_skripte;
create policy of_skripte_st_aendern on public.of_skripte for update to authenticated
  using (public.hat_rolle('storyteller') and erstellt_von = public.my_display_name() and status in ('auftrag', 'entwurf', 'freigabe', 'zurueck'))
  with check (erstellt_von = public.my_display_name() and status in ('auftrag', 'entwurf', 'freigabe', 'zurueck'));

-- Schutz-Trigger: wie v5.27.0, plus Aufträge
create or replace function public.of_skripte_schuetzen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ich text := public.my_display_name();
  v   public.of_skripte;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_staff() then
      new.erstellt_von := ich;
      if new.status not in ('entwurf', 'freigabe') then new.status := 'entwurf'; end if;
      new.freigegeben_von := null; new.freigegeben_am := null;
      new.hochgeladen_am := null; new.gebaut_von := null; new.gebaut_am := null;
      new.schritte_erledigt := '{}'; new.zurueck_notiz := null; new.model_frage := null; new.of_titel := null;
      new.auftrag_von := null; new.auftrag_notiz := null;
    else
      new.erstellt_von := coalesce(new.erstellt_von, ich);
      if new.status = 'beim_model' then new.freigegeben_von := coalesce(new.freigegeben_von, ich); new.freigegeben_am := now(); end if;
    end if;
    new.erstellt_am := now(); new.aktualisiert_am := now();
    return new;
  end if;

  -- UPDATE
  if auth.uid() is null or public.is_staff() then
    v := new;
  elsif old.model_name = ich and old.status = 'beim_model' then
    -- Model: nur abhaken, OF-Titel, Frage, auf „hochgeladen“
    v := old;
    v.schritte_erledigt := new.schritte_erledigt;
    v.of_titel := new.of_titel;
    v.model_frage := new.model_frage;
    if new.status = 'hochgeladen' then v.status := 'hochgeladen'; end if;
  elsif public.hat_rolle('script_builder') and old.status in ('hochgeladen', 'gebaut') then
    -- Script Builder: nur „gebaut“ an/aus
    v := old;
    if new.status in ('hochgeladen', 'gebaut') then v.status := new.status; end if;
  elsif public.hat_rolle('storyteller') and old.erstellt_von = ich and old.status in ('auftrag', 'entwurf', 'freigabe', 'zurueck') then
    -- Storyteller: Inhalt ja, Verwaltungsfelder nein
    v := new;
    v.erstellt_von := old.erstellt_von; v.erstellt_am := old.erstellt_am;
    v.freigegeben_von := old.freigegeben_von; v.freigegeben_am := old.freigegeben_am;
    v.hochgeladen_am := old.hochgeladen_am; v.gebaut_von := old.gebaut_von; v.gebaut_am := old.gebaut_am;
    v.schritte_erledigt := old.schritte_erledigt; v.of_titel := old.of_titel; v.model_frage := old.model_frage;
    v.auftrag_von := old.auftrag_von; v.auftrag_notiz := old.auftrag_notiz;
    if v.status not in ('entwurf', 'freigabe') then v.status := old.status; end if;
  else
    raise exception 'Keine Berechtigung für dieses Skript';
  end if;

  v.id := old.id;
  v.erstellt_am := old.erstellt_am;
  if v.status = 'beim_model' and old.status <> 'beim_model' then
    v.freigegeben_von := coalesce(ich, v.freigegeben_von); v.freigegeben_am := now();
  end if;
  if v.status = 'hochgeladen' and old.status <> 'hochgeladen' and old.status <> 'gebaut' then v.hochgeladen_am := now(); end if;
  if v.status = 'gebaut' and old.status <> 'gebaut' then v.gebaut_von := ich; v.gebaut_am := now(); end if;
  if v.status = 'hochgeladen' and old.status = 'gebaut' then v.gebaut_von := null; v.gebaut_am := null; end if;
  v.aktualisiert_am := now();
  return v;
end $$;
