-- v4.11.0 — Selbst-Registrierung mit Freischaltung
-- Admin schaltet eine E-Mail-Adresse frei, die Person legt ihr Passwort
-- auf der Anmeldeseite selbst fest. Kein Mailversand.
-- Diese Datei EINMAL im Supabase SQL-Editor ausfuehren.

create table if not exists public.signup_invites (
  id            bigint generated always as identity primary key,
  email         text        not null,
  display_name  text        not null,
  role          text        not null,
  roles         text[]      not null default '{}',
  note          text,
  expires_at    timestamptz not null default (now() + interval '14 days'),
  created_by    text,
  created_at    timestamptz not null default now(),
  used_at       timestamptz,
  user_id       uuid
);

create unique index if not exists signup_invites_email_open_idx
  on public.signup_invites (lower(email))
  where used_at is null;

create index if not exists signup_invites_email_idx
  on public.signup_invites (lower(email));

alter table public.signup_invites enable row level security;

drop policy if exists signup_invites_staff_select on public.signup_invites;
create policy signup_invites_staff_select on public.signup_invites
  for select using (is_staff());

drop policy if exists signup_invites_staff_insert on public.signup_invites;
create policy signup_invites_staff_insert on public.signup_invites
  for insert with check (is_staff());

drop policy if exists signup_invites_staff_update on public.signup_invites;
create policy signup_invites_staff_update on public.signup_invites
  for update using (is_staff()) with check (is_staff());

drop policy if exists signup_invites_staff_delete on public.signup_invites;
create policy signup_invites_staff_delete on public.signup_invites
  for delete using (is_staff());
