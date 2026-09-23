-- plants on a COPY of se_sbx (never the live db). :fresh / :old are 8-char aidx time prefixes.
\set ON_ERROR_STOP on
create temp table tm as select * from meet where id = (select "meetId" from meet_participant order by id limit 1);
create temp table tp as select * from meet_participant where "meetId" = (select id from tm) order by id limit 1;

-- F: fresh probe meet + a participant (a running lane's fixture)
update tm set id = :'fresh' || 'swtf0001', "referenceCode" = 'swt00001', name = '[probe] SWT fresh', status = 'active', flags = '{}';
insert into meet select * from tm;
update tp set id = :'fresh' || 'swtp0001', "meetId" = :'fresh' || 'swtf0001';
insert into meet_participant select * from tp;

-- O: old probe meet + a participant (litter that must go)
update tm set id = :'old' || 'swto0001', "referenceCode" = 'swt00002', name = '[probe] SWT old';
insert into meet select * from tm;
update tp set id = :'old' || 'swtp0002', "meetId" = :'old' || 'swto0001';
insert into meet_participant select * from tp;

-- T: a real tester's casual game, one player, waiting for an opponent (old, so only the guestMeets rule protects it)
update tm set id = :'old' || 'swtt0001', "referenceCode" = 'swt00003', name = 'Evening casual', flags = '{casual}';
insert into meet select * from tm;
update tp set id = :'old' || 'swtp0003', "meetId" = :'old' || 'swtt0001', "displayName" = 'Real Tester';
insert into meet_participant select * from tp;
