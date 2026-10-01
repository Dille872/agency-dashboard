-- ============================================================================
-- v4.59.0 · Funktion chatter_umbenennen(alt, neu)
-- Benennt einen Chatter in EINER Transaktion überall um — inklusive user_roles,
-- damit die Sicherheitsregeln (Vergleich über den Anzeigenamen) weiter passen.
-- Nur Admin/Manager. Bricht ab, wenn der neue Name schon vergeben ist.
-- Ändert KEINE CSV-Namen (chatter_aliases.csv_name, model_chatter_daily) —
-- die kommen aus den Exporten und bleiben, wie sie sind.
-- Schlägt irgendetwas fehl, wird ALLES zurückgerollt.
-- ============================================================================
create or replace function public.chatter_umbenennen(p_alt text, p_neu text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  alt text := btrim(coalesce(p_alt, ''));
  neu text := btrim(coalesce(p_neu, ''));
  ergebnis jsonb := '{}'::jsonb;
  n integer;
  z record;
begin
  if not (public.is_staff() and public.is_active_user()) then
    raise exception 'Keine Berechtigung';
  end if;
  if alt = '' or neu = '' then raise exception 'Name fehlt'; end if;
  if alt = neu then return jsonb_build_object('hinweis', 'unverändert'); end if;
  if not exists (select 1 from chatters_contact where name = alt) then
    raise exception 'Chatter "%" nicht gefunden', alt;
  end if;
  if exists (select 1 from chatters_contact where lower(name) = lower(neu) and name <> alt)
     or exists (select 1 from models_contact where lower(name) = lower(neu))
     or exists (select 1 from user_roles where lower(display_name) = lower(neu) and display_name <> alt) then
    raise exception 'Der Name "%" ist schon vergeben', neu;
  end if;

  -- Einfache Textspalten: (Tabelle, Spalte, Zusatzbedingung)
  for z in select * from (values
      ('chatters_contact','name',''),
      ('user_roles','display_name',''),
      ('absences','chatter_name',''),
      ('billing_settings','person_name',' and person_type = ''chatter'''),
      ('chatter_aliases','chatter_name',''),
      ('chatter_availability','chatter_name',''),
      ('chatter_targets','chatter_name',''),
      ('content_requests','chatter_name',''),
      ('content_ideas','created_by',''),
      ('message_suggestions','chatter',''),
      ('suggestion_stats','chatter',''),
      ('messages','model_name',' and contact_type = ''chatter'''),
      ('messages','read_by',''),
      ('notes','author',''),
      ('recurring_shifts','chatter',''),
      ('reminders','chatter_name',''),
      ('shift_logs','display_name',''),
      ('shift_swaps','requester_name',''),
      ('shift_swaps','accepted_by',''),
      ('shift_swaps','proposed_by',''),
      ('swap_reactions','chatter_name',''),
      ('survey_recipients','recipient_name',''),
      ('survey_responses','responder_name',''),
      ('todos','assigned_to',''),
      ('todos','completed_by',''),
      ('todos','created_by',''),
      ('watchlist','subjekt_name',' and subjekt_typ = ''chatter'''),
      ('password_resets','display_name',''),
      ('signup_invites','display_name','')
    ) as t(tab, col, extra)
  loop
    -- Spalte existiert nicht (mehr)? Überspringen statt abbrechen.
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = z.tab and column_name = z.col) then
      continue;
    end if;
    execute format('update public.%I set %I = $1 where %I = $2%s', z.tab, z.col, z.col, z.extra) using neu, alt;
    get diagnostics n = row_count;
    if n > 0 then ergebnis := ergebnis || jsonb_build_object(z.tab || '.' || z.col, n); end if;
  end loop;

  -- online_status: display_name ist eindeutig — evtl. Altzeile unter neuem Namen weg
  delete from online_status where display_name = neu;
  update online_status set display_name = neu where display_name = alt;
  get diagnostics n = row_count;
  if n > 0 then ergebnis := ergebnis || jsonb_build_object('online_status', n); end if;

  -- Text-Arrays in shift_logs
  update shift_logs set handover_ack = array_replace(handover_ack, alt, neu) where alt = any(handover_ack);
  get diagnostics n = row_count;
  if n > 0 then ergebnis := ergebnis || jsonb_build_object('shift_logs.handover_ack', n); end if;
  update shift_logs set handover_for = array_replace(handover_for, alt, neu) where alt = any(handover_for);
  get diagnostics n = row_count;
  if n > 0 then ergebnis := ergebnis || jsonb_build_object('shift_logs.handover_for', n); end if;

  -- JSON-Arrays (todos.read_by, announcements.archived_for)
  update todos set read_by = (select coalesce(jsonb_agg(case when e = to_jsonb(alt) then to_jsonb(neu) else e end), '[]'::jsonb)
                              from jsonb_array_elements(read_by) e)
   where jsonb_typeof(read_by) = 'array' and read_by ? alt;
  get diagnostics n = row_count;
  if n > 0 then ergebnis := ergebnis || jsonb_build_object('todos.read_by', n); end if;
  update announcements set archived_for = (select coalesce(jsonb_agg(case when e = to_jsonb(alt) then to_jsonb(neu) else e end), '[]'::jsonb)
                                           from jsonb_array_elements(archived_for) e)
   where jsonb_typeof(archived_for) = 'array' and archived_for ? alt;
  get diagnostics n = row_count;
  if n > 0 then ergebnis := ergebnis || jsonb_build_object('announcements.archived_for', n); end if;

  -- Dienstplan: chatter UND trainee in jeder Zelle, alle Wochen
  update schedule s set assignments = (
      select coalesce(jsonb_object_agg(k,
               case when jsonb_typeof(v2) = 'object' and v2->>'trainee' = alt
                    then jsonb_set(v2, '{trainee}', to_jsonb(neu)) else v2 end), '{}'::jsonb)
      from (select k, case when jsonb_typeof(v) = 'object' and v->>'chatter' = alt
                           then jsonb_set(v, '{chatter}', to_jsonb(neu)) else v end as v2
            from jsonb_each(s.assignments) as e(k, v)) x)
   where jsonb_typeof(s.assignments) = 'object'
     and exists (select 1 from jsonb_each(s.assignments) e(k, v)
                 where jsonb_typeof(v) = 'object' and (v->>'chatter' = alt or v->>'trainee' = alt));
  get diagnostics n = row_count;
  if n > 0 then ergebnis := ergebnis || jsonb_build_object('schedule (Wochen)', n); end if;

  insert into activity_log(actor, action, entity, detail)
  values (coalesce(public.my_display_name(), 'Admin'), 'chatter.rename', neu, 'vorher: ' || alt);

  return ergebnis;
end $$;
revoke all on function public.chatter_umbenennen(text, text) from public, anon;
grant execute on function public.chatter_umbenennen(text, text) to authenticated;
