-- ══════════════════════════════════════════════════════════════════════════
-- v5.36.0 · „⚡ Wartet auf euch“ für Admins
--
-- Zwei Dinge sieht der Browser nicht selbst, weil sie in auth.users stehen:
--   1) Wer ist „aktiv“, kann sich aber nicht einloggen (banned_until in der
--      Zukunft) — der Fall vom 27.09.
--   2) Wer hat ein Login-Konto, aber keinen fertigen Eintrag in user_roles
--      (keine Rolle oder kein Name) — sieht sonst nur „nicht eingerichtet“.
--
-- admin_konten_pruefen()   → listet beides, nur für Admins
-- admin_konto_einrichten() → gibt so einem Konto Name + Rolle.
--                            Füllt nur LÜCKEN, überschreibt nie vorhandene
--                            Werte. Admin/Manager lassen sich hier nicht
--                            vergeben (das bleibt in Team & Rechte).
--
-- Ändert keine Daten beim Ausführen. Kann mehrfach ausgeführt werden.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.admin_konten_pruefen()
returns table (art text, user_id uuid, email text, name text, seit timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select 'gesperrt'::text, u.id, u.email::text, r.display_name, u.banned_until
  from auth.users u
  join public.user_roles r on r.user_id = u.id
  where public.hat_rolle('admin')
    and u.deleted_at is null
    and u.banned_until is not null and u.banned_until > now()
    and coalesce(r.status, 'active') not in ('suspended', 'offboarded')
  union all
  select 'ohne_rolle'::text, u.id, u.email::text,
         coalesce(nullif(r.display_name, ''), u.raw_user_meta_data->>'full_name'), u.created_at
  from auth.users u
  left join public.user_roles r on r.user_id = u.id
  where public.hat_rolle('admin')
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and (r.user_id is null
         or coalesce(r.display_name, '') = ''
         or (r.role is null and coalesce(array_length(r.roles, 1), 0) = 0))
$$;
revoke all on function public.admin_konten_pruefen() from public, anon;
grant execute on function public.admin_konten_pruefen() to authenticated;

create or replace function public.admin_konto_einrichten(p_user uuid, p_name text, p_rolle text)
returns text language plpgsql security definer set search_path = public, auth as $$
declare
  n text := btrim(coalesce(p_name, ''));
begin
  if not public.hat_rolle('admin') then raise exception 'Keine Berechtigung'; end if;
  if n = '' then raise exception 'Name fehlt'; end if;
  if p_rolle is null or p_rolle in ('admin', 'manager') then
    raise exception 'Admin/Manager bitte in Team & Rechte vergeben';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'Konto nicht gefunden'; end if;

  if exists (select 1 from public.user_roles where user_id = p_user) then
    -- nur Lücken füllen
    update public.user_roles set
      display_name = coalesce(nullif(display_name, ''), n),
      role  = coalesce(role, p_rolle),
      roles = case when coalesce(array_length(roles, 1), 0) = 0 then array[coalesce(role, p_rolle)] else roles end
    where user_id = p_user;
  else
    insert into public.user_roles (user_id, role, roles, display_name, status)
    values (p_user, p_rolle, array[p_rolle], n, 'active');
  end if;

  -- Kontakt-Eintrag wie bei der Selbst-Registrierung (falls noch keiner da ist)
  if p_rolle = 'chatter' and not exists (select 1 from public.chatters_contact where lower(name) = lower(n)) then
    insert into public.chatters_contact (name) values (n);
  elsif p_rolle = 'model' and not exists (select 1 from public.models_contact where lower(name) = lower(n)) then
    insert into public.models_contact (name) values (n);
  end if;
  return 'ok';
end $$;
revoke all on function public.admin_konto_einrichten(uuid, text, text) from public, anon;
grant execute on function public.admin_konto_einrichten(uuid, text, text) to authenticated;

-- Kontrolle (im SQL-Editor gibt es keinen eingeloggten Admin, daher nur prüfen,
-- ob beide Funktionen da sind — Ergebnis: 2)
select count(*) from pg_proc where proname in ('admin_konten_pruefen', 'admin_konto_einrichten');
