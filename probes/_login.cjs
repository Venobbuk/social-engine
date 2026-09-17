// mint the shared tester2 session once (see _session.cjs); exits 0 when a session is on file
require('./_session.cjs').getSession(1).then((c) => { console.log('session ok', c.name); process.exit(0); }).catch((e) => { console.log(String(e.message)); process.exit(1); });
