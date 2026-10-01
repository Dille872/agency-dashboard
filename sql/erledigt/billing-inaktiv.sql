-- ============================================================================
-- v5.23.0 · Billing: Chatter „inaktiv ab Monat“
--
-- Wunsch Chris (01.10.): Chatter, die nicht mehr aktiv sind, bekommen ab dem
-- gewählten Monat keine Auszahlung mehr. Kunden kaufen trotzdem noch auf
-- ihren Namen (steht so in der Chatter-Datei) — das wird im Billing oben unter
-- „Nicht mit einberechnet“ gezeigt, aber nicht ausgezahlt.
-- Frühere Monate bleiben unverändert.
--
-- Eine neue Spalte, ändert keine vorhandenen Daten. Wiederholbar.
-- ============================================================================

alter table public.billing_settings add column if not exists inaktiv_ab text;   -- 'YYYY-MM' oder null

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'billing_settings_inaktiv_ab_check') then
    alter table public.billing_settings add constraint billing_settings_inaktiv_ab_check
      check (inaktiv_ab is null or inaktiv_ab ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  end if;
end $$;

-- Prüfen:
-- select person_name, percentage, inaktiv_ab from public.billing_settings where person_type = 'chatter' order by 1;
