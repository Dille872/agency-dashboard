-- ============================================================================
-- v4.105.0 · Accounts als „nicht betreut“ markieren
--
-- Ein Model kann viele Instagram-Accounts im Board haben (Julia: 8), die
-- Agentur betreut aber nur einige davon mit Skripten. Nicht betreute Accounts
-- landen in der Social-Steuerung in einem eingeklappten Bereich, zählen nicht
-- als „ohne Poster“, stehen beim Hochladen nicht zur Auswahl und gehen NICHT
-- als service_accounts an Lyra. Im Board bleiben sie unverändert.
--
-- Gespeichert als Liste von @handles in model_social_service.nicht_betreut.
-- Nur Agentur (steht im Schutz-Trigger).
--
-- Wiederholbar. Löscht und überschreibt keine Daten.
-- ============================================================================

alter table public.model_social_service add column if not exists nicht_betreut text[] not null default '{}';

-- Schutz-Trigger: nicht_betreut gehört zur Agentur (Rest wie in social-manager.sql)
create or replace function public.social_service_agenturfelder_schuetzen()
returns trigger language plpgsql as $$
begin
  if public.is_staff() or public.darf_kontakte_pflegen() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.service_aktiv   := false;
    new.posting_ab      := null;
    new.angefordert_am  := null;
    new.angefordert_von := null;
    new.account_notizen := '{}'::jsonb;
    new.nicht_betreut   := '{}';
  else
    new.service_aktiv    := old.service_aktiv;
    new.posting_ab       := old.posting_ab;
    new.angefordert_am   := old.angefordert_am;
    new.angefordert_von  := old.angefordert_von;
    new.account_notizen  := old.account_notizen;
    new.nicht_betreut    := old.nicht_betreut;
  end if;
  return new;
end $$;

-- Lyra: service_accounts ohne die nicht betreuten Accounts
create or replace view lyra.model_social_profil as
select p.model_name,
       p.schluessel,
       p.antwort,
       case jsonb_typeof(p.antwort)
         when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(p.antwort) x)
         when 'string' then p.antwort #>> '{}'
         else p.antwort::text
       end as antwort_text,
       p.geaendert_am
from public.model_social_profil p
where p.antwort is not null
union all
select s.model_name, 'service_aktiv',
       to_jsonb(case when s.service_aktiv then 'ja' else 'nein' end),
       case when s.service_aktiv then 'ja' else 'nein' end,
       s.aktualisiert_am
from public.model_social_service s
union all
select b.model_name, 'service_accounts',
       jsonb_agg(distinct b.handle),
       string_agg(distinct b.handle, ', '),
       null::timestamptz
from (
  select model_name,
         coalesce('@' || substring(content from '(?i)instagram\.com/([^/?#]+)'), trim(content)) as handle
  from public.model_board
  where category = 'social_media'
    and lower(trim(title)) = 'instagram'
    and nullif(trim(content), '') is not null
) b
join public.model_social_service s on s.model_name = b.model_name
where not (b.handle = any(s.nicht_betreut))
group by b.model_name
union all
select s.model_name, 'posting_ab',
       to_jsonb(s.posting_ab::text),
       s.posting_ab::text,
       s.aktualisiert_am
from public.model_social_service s
where s.posting_ab is not null;

alter view lyra.model_social_profil owner to postgres;
grant select on lyra.model_social_profil to lyra_readonly;

-- Prüfen:
-- select model_name, nicht_betreut from model_social_service;
