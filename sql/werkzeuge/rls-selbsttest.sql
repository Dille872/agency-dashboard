-- ============================================================================
-- RLS-Selbsttest · simuliert Fremde, gesperrte Accounts, Chatter, Model, Admin
-- ÄNDERT NICHTS: jeder Test läuft in einem eigenen Unter-Block, der am Ende
-- absichtlich zurückgerollt wird (auch erfolgreiche Schreibversuche).
-- Ergebnis: eine Tabelle mit ok = true/false pro Test.
-- ============================================================================

create or replace function pg_temp.probe(p_rolle text, p_uid uuid, p_sql text)
returns text language plpgsql as $f$
declare r text;
begin
  if p_rolle = 'authenticated' and p_uid is null then return 'KEIN USER GEFUNDEN'; end if;
  begin
    if p_rolle = 'anon' then
      execute 'set local role anon';
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
    end if;
    execute p_sql into r;
    raise exception 'ERGEBNIS:%', coalesce(r, 'null');   -- alles zurückrollen
  exception when others then
    if sqlerrm like 'ERGEBNIS:%' then return substr(sqlerrm, 10); end if;
    return 'FEHLER: ' || left(sqlerrm, 80);
  end;
end $f$;

with u as (
  select
    (select user_id from user_roles where display_name = 'Christian')  as offb,
    (select user_id from user_roles where display_name = 'Adam')       as susp,
    (select user_id from user_roles where display_name = 'Mario')      as chatter,
    (select user_id from user_roles where display_name = 'Chris')      as admin,
    m.user_id as model, m.display_name as model_name
  from (select ur.user_id, ur.display_name from user_roles ur
        join models_contact mc on mc.name = ur.display_name
        where ('model' = any(coalesce(ur.roles,'{}')) or ur.role = 'model')
          and coalesce(ur.status,'active') not in ('suspended','offboarded')
        order by ur.display_name limit 1) m
),
t(nr, wer, test, erwartet, ergebnis) as (
  select 1,'Fremder (ohne Login)','Dienstplan lesen','zu',        pg_temp.probe('anon', null, 'select count(*)::text from schedule') from u
  union all select 2,'Fremder (ohne Login)','Nachrichten lesen','zu', pg_temp.probe('anon', null, 'select count(*)::text from messages') from u
  union all select 3,'Fremder (ohne Login)','Umsätze lesen','zu',     pg_temp.probe('anon', null, 'select count(*)::text from model_snapshots') from u

  union all select 10,'Offboarded (Christian)','Dienstplan lesen','0', pg_temp.probe('authenticated', offb, 'select count(*)::text from schedule') from u
  union all select 11,'Offboarded (Christian)','Notizen lesen','0',    pg_temp.probe('authenticated', offb, 'select count(*)::text from notes') from u
  union all select 12,'Offboarded (Christian)','Schicht-Logs lesen','0', pg_temp.probe('authenticated', offb, 'select count(*)::text from shift_logs') from u
  union all select 13,'Offboarded (Christian)','Nachrichten lesen','0', pg_temp.probe('authenticated', offb, 'select count(*)::text from messages') from u
  union all select 14,'Offboarded (Christian)','Content-Anfragen lesen','0', pg_temp.probe('authenticated', offb, 'select count(*)::text from content_requests') from u
  union all select 15,'Offboarded (Christian)','Abwesenheit eintragen','FEHLER', pg_temp.probe('authenticated', offb,
      $q$with x as (insert into absences(chatter_name,date_from,date_to,reason,source) values ('Christian','2099-01-01','2099-01-01','rls-test','chatter') returning 1) select count(*)::text from x$q$) from u
  union all select 16,'Stillgelegt (Adam)','Dienstplan lesen','0',     pg_temp.probe('authenticated', susp, 'select count(*)::text from schedule') from u

  union all select 20,'Chatter (Mario)','Dienstplan lesen','>0',       pg_temp.probe('authenticated', chatter, 'select count(*)::text from schedule') from u
  union all select 21,'Chatter (Mario)','Schicht-Logs lesen','>0',     pg_temp.probe('authenticated', chatter, 'select count(*)::text from shift_logs') from u
  union all select 22,'Chatter (Mario)','Model-Boards lesen','>0',     pg_temp.probe('authenticated', chatter, 'select count(*)::text from model_board') from u
  union all select 23,'Chatter (Mario)','Eigene Abwesenheit eintragen','1', pg_temp.probe('authenticated', chatter,
      $q$with x as (insert into absences(chatter_name,date_from,date_to,reason,source) values ('Mario','2099-01-01','2099-01-01','rls-test','chatter') returning 1) select count(*)::text from x$q$) from u
  union all select 24,'Chatter (Mario)','Ankündigung archivieren (Update)','>=0', pg_temp.probe('authenticated', chatter,
      'with x as (update announcements set archived_for = archived_for where id = (select id from announcements order by id desc limit 1) returning 1) select count(*)::text from x') from u
  union all select 25,'Chatter (Mario)','Telegram-ID eines Models ändern','0', pg_temp.probe('authenticated', chatter,
      'with x as (update models_contact set telegram_id = telegram_id returning 1) select count(*)::text from x') from u
  union all select 26,'Chatter (Mario)','Alias anlegen','FEHLER', pg_temp.probe('authenticated', chatter,
      $q$with x as (insert into model_aliases(model_name,csv_name) values ('__rls_test__','__rls_test__') returning 1) select count(*)::text from x$q$) from u
  union all select 27,'Chatter (Mario)','Umsätze direkt lesen','0',   pg_temp.probe('authenticated', chatter, 'select count(*)::text from chatter_snapshots') from u
  union all select 28,'Chatter (Mario)','Eigene Umsätze per RPC','>=0', pg_temp.probe('authenticated', chatter, 'select count(*)::text from public.get_my_chatter_snapshots()') from u

  union all select 30,'Model ('||model_name||')','Eigenen Status setzen','1', pg_temp.probe('authenticated', model,
      format('with x as (update models_contact set status = status where name = %L returning 1) select count(*)::text from x', model_name)) from u
  union all select 31,'Model ('||model_name||')','Status anderer Models ändern','0', pg_temp.probe('authenticated', model,
      format('with x as (update models_contact set status = status where name <> %L returning 1) select count(*)::text from x', model_name)) from u
  union all select 32,'Model ('||model_name||')','Alias anlegen','FEHLER', pg_temp.probe('authenticated', model,
      $q$with x as (insert into model_aliases(model_name,csv_name) values ('__rls_test__','__rls_test__') returning 1) select count(*)::text from x$q$) from u
  union all select 33,'Model ('||model_name||')','Umsätze direkt lesen','0', pg_temp.probe('authenticated', model, 'select count(*)::text from model_snapshots') from u
  union all select 34,'Model ('||model_name||')','Eigene Umsätze per RPC','>0', pg_temp.probe('authenticated', model, 'select count(*)::text from public.get_my_model_snapshots()') from u

  union all select 40,'Admin (Chris)','Umsätze lesen','>0',            pg_temp.probe('authenticated', admin, 'select count(*)::text from model_snapshots') from u
  union all select 41,'Admin (Chris)','Alias anlegen','1',             pg_temp.probe('authenticated', admin,
      $q$with x as (insert into model_aliases(model_name,csv_name) values ('__rls_test__','__rls_test__') returning 1) select count(*)::text from x$q$) from u
  union all select 42,'Admin (Chris)','Model-Kontakte ändern','>0',   pg_temp.probe('authenticated', admin,
      'with x as (update models_contact set last_contacted = last_contacted returning 1) select count(*)::text from x') from u
  union all select 43,'Admin (Chris)','Rollenliste lesen','>0',        pg_temp.probe('authenticated', admin, 'select count(*)::text from user_roles') from u
)
select nr, wer, test, erwartet, ergebnis,
  case
    when erwartet = 'zu'     then ergebnis = '0' or ergebnis like 'FEHLER%'
    when erwartet = 'FEHLER' then ergebnis like 'FEHLER%'
    when erwartet = '>0'     then ergebnis ~ '^\d+$' and ergebnis::bigint > 0
    when erwartet = '>=0'    then ergebnis ~ '^\d+$'
    else ergebnis = erwartet
  end as ok
from t order by nr;
