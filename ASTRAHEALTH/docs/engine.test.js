const E = require('./engine.js'); let fails = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
function run(sc, i = 0) { const s = new E.Session(); s.reset(i, sc); while (s.tick()); return s; }
for (let i = 0; i < 3; i++) { const s = run('normal', i);
  const bad = s.states.filter(x => x !== 'GREEN').length;
  ok(bad <= 2, `normal astro${i}: non-GREEN ticks=${bad}/${s.states.length}, alerts=${s.alerts.length}`); }
let s = run('anomaly'); let st = s.states;
ok(st[5] === 'GREEN' && st.includes('AMBER') && !st.includes('RED'), `anomaly: GREEN early, AMBER later, never RED -> first AMBER at ${st.indexOf('AMBER')}, final ${st.at(-1)}`);
ok(s.alerts.some(a => a.parameter === 'heart_rate' && a.category !== 'VITAL_RULE'), 'anomaly: heart-rate baseline/trend alert explains deviation');
s = run('high'); ok(s.states.slice(22, 32).every(x => x === 'RED'), 'high: RED during SpO2 test event');
ok(s.alerts.some(a => a.severity === 'RED' && a.category === 'VITAL_RULE' && /SpO/.test(a.explanation)), 'high: RED rule alert names SpO2 rule');
ok(s.alerts.filter(a => a.severity === 'RED' && a.parameter === 'spo2').length <= 4, 'high: duplicates suppressed (' + s.alerts.filter(a => a.parameter === 'spo2' && a.severity === 'RED').length + ' RED spo2 alerts over 18 ticks)');
s = run('offline');
ok(s.server.store.size === s.readings.length, `offline: all ${s.readings.length} records reached server (${s.server.store.size}), none lost`);
ok(s.queue.length === 0 && s.syncResult && s.syncResult.accepted === 30 && s.syncResult.duplicate === 1, 'offline: sync result ' + JSON.stringify(s.syncResult));
ok(s.alerts.some(a => a.local), 'offline: local alerts generated while offline');
ok(s.states[19] === null && s.alerts.some(a => a.category === 'DATA_QUALITY'), 'offline: sensor disconnect -> no GREEN, data-quality alert');
ok(s.csv().split('\n')[1].endsWith('SYNTHETIC'), 'csv export keeps source');
console.log(fails ? 'FAILURES ' + fails : 'ALL PASS'); process.exit(fails ? 1 : 0);
