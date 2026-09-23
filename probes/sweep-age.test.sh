#!/bin/bash
# SWEEP-AGE-V2 test: run a sweeper version against a fresh COPY of se_sbx with planted rows; print the fate of each.
# usage: sweep_test.sh <path-to-_sweep.cjs> <label>
set -e
SWEEP="$1"; LABEL="$2"; DB=sweep_test
C=social-engine-db-1
docker exec $C dropdb -U social --if-exists $DB
docker exec $C createdb -U social $DB
docker exec $C sh -c "pg_dump -U social se_sbx | psql -q -U social $DB" >/dev/null 2>&1
FRESH=$(node -e 'console.log((Date.now()-946684800000-5*60000).toString(36).padStart(8,"0"))')
OLD=$(node -e 'console.log((Date.now()-946684800000-3*3600000).toString(36).padStart(8,"0"))')
docker cp /root/gen/sweep_plant.sql $C:/tmp/sweep_plant.sql
docker exec $C psql -q -U social -d $DB -v fresh=$FRESH -v old=$OLD -f /tmp/sweep_plant.sql
# the sweep script must not see the live db: copy it next to the probes so its relative requires resolve
cp "$SWEEP" /root/social-engine/probes/_sweep_under_test.cjs
( cd /root/social-engine && SE_DB=$DB SWEEP_NOTIF=skip node probes/_sweep_under_test.cjs | grep -E "^[sweep]|abandoned" || true )
rm -f /root/social-engine/probes/_sweep_under_test.cjs
q() { docker exec $C psql -U social -d $DB -Atc "$1"; }
echo "[$LABEL] F fresh probe meet      : $(q "select status from meet where id='${FRESH}swtf0001'") · participant rows $(q "select count(*) from meet_participant where id='${FRESH}swtp0001'")"
echo "[$LABEL] O old probe meet        : $(q "select status from meet where id='${OLD}swto0001'") · participant rows $(q "select count(*) from meet_participant where id='${OLD}swtp0002'")"
echo "[$LABEL] T tester casual (1 plyr): $(q "select status from meet where id='${OLD}swtt0001'") · participant rows $(q "select count(*) from meet_participant where id='${OLD}swtp0003'")"
docker exec $C dropdb -U social $DB
