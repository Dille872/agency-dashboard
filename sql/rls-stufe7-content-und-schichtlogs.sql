-- ============================================================================
-- RLS Stufe 7 — Sicherheits-Audit Stufe 2, Teil 3 (19.09.2026)
--   content_requests / custom_content: Chatter nur eigene + die ihrer
--     eingeteilten Models; Models nur eigene.
--   shift_logs: Chatter nur eigene Zeilen. Fremde Übergaben der letzten 16 h
--     kommen über die Funktion offene_uebergaben(), Bestätigen über
--     uebergabe_bestaetigen().
--
-- REIHENFOLGE (wichtig):
--   TEIL A ausführen  →  Frontend v4.56.0 deployen  →  TEIL B ausführen
-- Teil A legt nur Funktionen an und ändert nichts am Verhalten.
-- ============================================================================

-- ═════════════════════════ TEIL A — Funktionen ═════════════════════════════
begin;

-- Models, bei denen ich im Dienstplan stehe (Haupt-Chatter, Co, Trainee,
-- zweite Hälfte einer geteilten Schicht). Gleiches Fenster wie das Portal:
-- live geschaltete Wochen rund um heute.
create or replace function public.meine_model_namen()
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct mc.name), '{}')
  from public.schedule s
  cross join lateral jsonb_each(coalesce(s.assignments::jsonb, '{}'::jsonb)) as a(k, v)
  join public.models_contact mc on mc.id::text = split_part(a.k, '__', 1)
  where s.status = 'live'
    and s.week_start::date between (current_date - 13) and (current_date + 8)
    and jsonb_typeof(a.v) = 'object'
    and coalesce(a.v->>'chatter', '') <> '__FREI__'
    and lower(btrim(coalesce(public.my_display_name(), '')))
        in (lower(btrim(coalesce(a.v->>'chatter', ''))), lower(btrim(coalesce(a.v->>'trainee', ''))))
    and coalesce(public.my_display_name(), '') <> ''
$$;
revoke all on function public.meine_model_namen() from public, anon;
grant execute on function public.meine_model_namen() to authenticated;

-- Übergaben der letzten 16 Stunden (wie bisher im Portal). Wen eine Übergabe
-- angeht, filtert weiterhin das Portal.
create or replace function public.offene_uebergaben()
returns setof public.shift_logs
language sql stable security definer
set search_path = public
as $$
  select l.* from public.shift_logs l
  where public.is_active_user()
    and l.handover_text is not null
    and l.handover_at >= now() - interval '16 hours'
  order by l.handover_at desc
  limit 100
$$;
revoke all on function public.offene_uebergaben() from public, anon;
grant execute on function public.offene_uebergaben() to authenticated;

-- Lesebestätigung: hängt den eigenen Namen atomar an handover_ack an.
create or replace function public.uebergabe_bestaetigen(p_id text)
returns text[]
language plpgsql security definer
set search_path = public
as $$
declare ich text := public.my_display_name(); ergebnis text[];
begin
  if not public.is_active_user() or coalesce(ich, '') = '' then
    raise exception 'nicht berechtigt';
  end if;
  update public.shift_logs
     set handover_ack = array_append(coalesce(handover_ack, '{}'), ich)
   where id::text = p_id
     and handover_text is not null
     and handover_at >= now() - interval '48 hours'
     and not (ich = any(coalesce(handover_ack, '{}')))
  returning handover_ack into ergebnis;
  return ergebnis;
end $$;
revoke all on function public.uebergabe_bestaetigen(text) from public, anon;
grant execute on function public.uebergabe_bestaetigen(text) to authenticated;

commit;


-- ═════════════ TEIL B — Regeln (ERST NACH DEM DEPLOY VON v4.56.0) ════════════
begin;

-- content_requests
create policy anfragen_lesen on public.content_requests
  as restrictive for select to authenticated
  using ( (select public.darf_kontakte_pflegen())
          or chatter_name = (select public.my_display_name())
          or model_name   = (select public.my_display_name())
          or model_name   = any ((select public.meine_model_namen())) );
create policy anfragen_anlegen on public.content_requests
  as restrictive for insert to authenticated
  with check ( (select public.darf_kontakte_pflegen())
               or chatter_name = (select public.my_display_name()) );
create policy anfragen_aendern on public.content_requests
  as restrictive for update to authenticated
  using ( (select public.darf_kontakte_pflegen())
          or chatter_name = (select public.my_display_name())
          or model_name   = (select public.my_display_name()) )
  with check ( (select public.darf_kontakte_pflegen())
               or chatter_name = (select public.my_display_name())
               or model_name   = (select public.my_display_name()) );

-- custom_content
create policy custom_lesen on public.custom_content
  as restrictive for select to authenticated
  using ( (select public.darf_kontakte_pflegen())
          or model_name = (select public.my_display_name())
          or model_name = any ((select public.meine_model_namen())) );
create policy custom_anlegen on public.custom_content
  as restrictive for insert to authenticated
  with check ( (select public.darf_kontakte_pflegen())
               or model_name = (select public.my_display_name()) );
create policy custom_aendern on public.custom_content
  as restrictive for update to authenticated
  using ( (select public.darf_kontakte_pflegen()) or model_name = (select public.my_display_name()) )
  with check ( (select public.darf_kontakte_pflegen()) or model_name = (select public.my_display_name()) );

-- shift_logs
create policy schichtlog_lesen on public.shift_logs
  as restrictive for select to authenticated
  using ( (select public.darf_kontakte_pflegen()) or display_name = (select public.my_display_name()) );
create policy schichtlog_anlegen on public.shift_logs
  as restrictive for insert to authenticated
  with check ( (select public.darf_kontakte_pflegen()) or display_name = (select public.my_display_name()) );
create policy schichtlog_aendern on public.shift_logs
  as restrictive for update to authenticated
  using ( (select public.darf_kontakte_pflegen()) or display_name = (select public.my_display_name()) )
  with check ( (select public.darf_kontakte_pflegen()) or display_name = (select public.my_display_name()) );

commit;


-- ═════════════════════════════ RÜCKGÄNGIG ═══════════════════════════════════
-- drop policy if exists anfragen_lesen on public.content_requests;
-- drop policy if exists anfragen_anlegen on public.content_requests;
-- drop policy if exists anfragen_aendern on public.content_requests;
-- drop policy if exists custom_lesen on public.custom_content;
-- drop policy if exists custom_anlegen on public.custom_content;
-- drop policy if exists custom_aendern on public.custom_content;
-- drop policy if exists schichtlog_lesen on public.shift_logs;
-- drop policy if exists schichtlog_anlegen on public.shift_logs;
-- drop policy if exists schichtlog_aendern on public.shift_logs;
-- (Funktionen aus Teil A können bleiben — sie schaden nicht.)
