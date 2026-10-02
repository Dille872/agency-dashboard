-- ============================================================================
-- v5.25.0 · „Wirkung“ auch für Poster, Cutter und Models
--
-- Wunsch Chris (02.10.): Noah, Alina & Co. sollen die Aufrufe ihrer Reels
-- selbst mitverfolgen können, die Models (Sandra, Lina, Julia …) ebenfalls.
--
-- Lesen der Messwerte bisher: Team, Freigabe, Poster des Accounts.
-- Neu dazu: Cutter des Accounts, wer ein Einzelrecht auf dem Account hat
-- (Reiter „Rechte“), und das Model selbst für seine eigenen Accounts.
-- Nur lesen — eintragen bleibt bei der Pipeline.
--
-- Voraussetzung: reel-ohne-skript.sql, social-schnitt.sql, social-rechte.sql.
-- Wiederholbar. Ändert keine Daten.
-- ============================================================================

-- Gehört der Account zum eingeloggten Model? (über die Instagram-Links in seinem Board —
-- falls die Pipeline model_name einmal nicht mitschickt)
create or replace function public.model_hat_insta(p_account text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.model_board b
    where b.model_name = public.my_display_name() and b.category = 'social_media'
      and lower(public.insta_handle(b.content)) = lower(trim(p_account))
  )
$$;
grant execute on function public.model_hat_insta(text) to authenticated;

drop policy if exists messwerte_lesen on public.reel_messwerte;
create policy messwerte_lesen on public.reel_messwerte for select to authenticated
  using (public.is_staff() or public.darf_kontakte_pflegen() or public.darf_social_freigeben()
         or public.poster_hat_account(model_name, account)
         or public.cutter_hat_account(model_name, account)
         or public.social_recht_hat(model_name, account)
         or model_name = public.my_display_name()
         or public.model_hat_insta(account));

-- Prüfen:
-- select pg_get_expr(polqual, polrelid) from pg_policy where polname = 'messwerte_lesen';
