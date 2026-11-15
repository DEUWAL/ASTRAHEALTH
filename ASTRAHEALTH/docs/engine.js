/* ASTRAHEALTH browser demo engine. JavaScript port of the backend's rules / baseline / risk / alert logic.
   ALL DATA IS SYNTHETIC. Not medical advice. The multivariate score is a simple distance measure used in
   this browser demo in place of the backend's Isolation Forest. */
(function (root) {
  const FEATURES = ['heart_rate', 'spo2', 'temperature_c', 'resp_rate', 'systolic', 'diastolic'];
  const UNITS = { heart_rate: 'bpm', spo2: '%', temperature_c: '°C', resp_rate: '/min', systolic: 'mmHg', diastolic: 'mmHg' };
  const LABELS = { heart_rate: 'Heart rate', spo2: 'SpO₂', temperature_c: 'Temperature', resp_rate: 'Resp. rate', systolic: 'Systolic BP', diastolic: 'Diastolic BP' };
  const PLAUSIBLE = { heart_rate: [20, 250], spo2: [50, 100], temperature_c: [30, 45], resp_rate: [3, 60], systolic: [50, 260], diastolic: [30, 160] };
  // Prototype thresholds, NOT clinical limits.
  const RULES = {
    heart_rate: { amber: [50, 120], red: [40, 140] }, spo2: { amber: [94, 100], red: [90, 100] },
    temperature_c: { amber: [35.5, 38.0], red: [35.0, 39.0] }, resp_rate: { amber: [10, 24], red: [8, 30] },
    systolic: { amber: [90, 150], red: [80, 180] }, diastolic: { amber: [50, 95], red: [40, 120] },
  };
  const CFG = { z: 3.0, trendZ: 2.0, window: 12, escalate: 60, minQuality: 0.67, cooldownTicks: 6, multi: 2.2, tickMinutes: 5 };
  const ASTRONAUTS = [
    { code: 'AST-001', name: 'Cmdr. Nova Reyes (fictional)', base: { heart_rate: 62, spo2: 98, temperature_c: 36.7, resp_rate: 14, systolic: 118, diastolic: 76 } },
    { code: 'AST-002', name: 'Dr. Kai Okafor (fictional)', base: { heart_rate: 68, spo2: 97, temperature_c: 36.6, resp_rate: 15, systolic: 122, diastolic: 79 } },
    { code: 'AST-003', name: 'Eng. Mira Lindqvist (fictional)', base: { heart_rate: 58, spo2: 98, temperature_c: 36.8, resp_rate: 13, systolic: 112, diastolic: 72 } },
  ];
  const NOISE = { heart_rate: 2.5, spo2: 0.4, temperature_c: 0.12, resp_rate: 0.8, systolic: 3.0, diastolic: 2.2 };

  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r) { const u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function genReading(base, tick, r, mods) {
    const out = {}; const phase = 2 * Math.PI * ((tick * CFG.tickMinutes / 60) % 24) / 24;
    FEATURES.forEach(p => {
      let v = base[p] + gauss(r) * NOISE[p];
      if (p === 'heart_rate') v += 3 * Math.sin(phase - Math.PI / 2);
      if (p === 'temperature_c') v += 0.15 * Math.sin(phase - Math.PI / 2);
      out[p] = v;
    });
    out.spo2 = Math.min(out.spo2, 100);
    if (mods) Object.keys(mods).forEach(p => { if (p.startsWith('__')) return; out[p] = mods[p] === null ? null : (mods.__abs && mods.__abs[p] ? mods[p] : out[p] + mods[p]); });
    return out;
  }
  function history(base, n, seed) { const r = rng(seed); const h = []; for (let i = 0; i < n; i++) h.push(genReading(base, i, r)); return h; }

  function validate(reading) {
    const clean = {}, issues = []; let valid = 0;
    FEATURES.forEach(p => {
      const v = reading[p];
      if (v === null || v === undefined || Number.isNaN(v)) { clean[p] = null; issues.push({ parameter: p, issue: 'missing' }); return; }
      const [lo, hi] = PLAUSIBLE[p];
      if (v < lo || v > hi) { clean[p] = null; issues.push({ parameter: p, issue: 'implausible', value: v }); return; }
      clean[p] = v; valid++;
    });
    if (reading.sensor_connected === false) issues.push({ parameter: 'sensor', issue: 'disconnected' });
    return { clean, issues, quality: valid / FEATURES.length };
  }
  function evalRules(valid) {
    const hits = [];
    Object.keys(RULES).forEach(p => {
      const v = valid[p]; if (v === null || v === undefined) return;
      for (const sev of ['red', 'amber']) {
        const [lo, hi] = RULES[p][sev];
        if (v < lo || v > hi) { hits.push({ parameter: p, severity: sev.toUpperCase(), value: v, basis: 'configured_rule', rule: `${LABELS[p]} ${v.toFixed(1)} ${UNITS[p]} outside configured ${sev} range [${lo}, ${hi}]` }); break; }
      }
    });
    return hits;
  }
  function baselineOf(hist) {
    const out = {};
    FEATURES.forEach(p => {
      const s = hist.map(h => h[p]).filter(v => v !== null && v !== undefined);
      const n = s.length, mean = s.reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
      const sorted = [...s].sort((a, b) => a - b);
      out[p] = { n, mean, std, median: sorted[Math.floor(n / 2)], min: sorted[0], max: sorted[n - 1], sufficient: n >= 30 };
    });
    return out;
  }
  const bstd = b => Math.max(b.std, 0.02 * Math.abs(b.mean), 1e-6);
  const zOf = (v, b) => (v - b.mean) / bstd(b);

  function analyze(reading, baseline, recent) {
    const { clean, issues, quality } = validate(reading);
    const valid = {}; FEATURES.forEach(p => { if (clean[p] !== null) valid[p] = clean[p]; });
    const findings = evalRules(valid);
    const dev = [];
    Object.keys(valid).forEach(p => {
      const b = baseline[p]; const z = zOf(valid[p], b);
      dev.push({ parameter: p, value: valid[p], baseline_mean: b.mean, z });
      if (Math.abs(z) > CFG.z) findings.push({ parameter: p, severity: 'AMBER', basis: 'individual_baseline', value: valid[p], rule: `${LABELS[p]} is ${z >= 0 ? '+' : ''}${z.toFixed(1)} std from this astronaut's own baseline (mean ${b.mean.toFixed(1)})` });
    });
    if (recent.length >= CFG.window) {
      FEATURES.forEach(p => {
        const vals = recent.slice(-CFG.window).map(r => r[p]).filter(v => v !== null && v !== undefined);
        if (vals.length < CFG.window / 2) return;
        const ma = vals.reduce((a, b) => a + b, 0) / vals.length; const d = zOf(ma, baseline[p]);
        if (Math.abs(d) > CFG.trendZ) findings.push({ parameter: p, severity: 'AMBER', basis: 'trend', value: ma, rule: `${LABELS[p]} ${CFG.window}-reading moving average drifted ${d >= 0 ? '+' : ''}${d.toFixed(1)} std from baseline` });
      });
    }
    let ml = null;
    if (Object.keys(valid).length >= 3) {
      ml = Math.sqrt(dev.reduce((a, d) => a + d.z * d.z, 0) / dev.length);
      if (ml > CFG.multi) { const top = [...dev].sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 2).map(d => `${LABELS[d.parameter]} (z=${d.z.toFixed(1)})`).join(', ');
        findings.push({ parameter: 'multivariate', severity: 'AMBER', basis: 'ml_model', value: ml, rule: `Multivariate distance score ${ml.toFixed(2)} exceeds ${CFG.multi}; largest deviations: ${top}` }); }
    }
    return { timestamp: reading.timestamp, measurements: valid, deviations: dev, findings, ml, quality, issues,
      anomaly_detected: findings.length > 0, reason: findings.map(f => f.rule).join('; ') || 'No deviation detected' };
  }
  const ACTIONS = { GREEN: 'Normal monitoring status. Continue routine monitoring.', AMBER: 'Review recommended: medical officer should review flagged parameters.', RED: 'High-priority review required: contact the medical officer per crew protocol.' };
  function assess(a, recentStates) {
    const dq = a.quality < CFG.minQuality || a.issues.some(i => i.issue === 'disconnected' || i.issue === 'implausible');
    if (!Object.keys(a.measurements).length) return { state: null, dataQualityWarning: true, reasons: ['No valid measurements; status cannot be assessed.'], action: 'Check sensor connection. Missing data is not treated as normal.' };
    let state = 'GREEN', reasons = [];
    if (a.findings.some(f => f.severity === 'RED')) { state = 'RED'; reasons = a.findings.filter(f => f.severity === 'RED').map(f => f.rule); }
    else if (a.findings.length) { state = 'AMBER'; reasons = a.findings.map(f => f.rule); }
    if (state === 'AMBER') { let n = 0; for (let i = recentStates.length - 1; i >= 0; i--) { if (recentStates[i] === 'AMBER' || recentStates[i] === 'RED') n++; else break; }
      if (n + 1 >= CFG.escalate) { state = 'RED'; reasons.push(`${n + 1} consecutive abnormal assessments (escalation threshold ${CFG.escalate})`); } }
    return { state, dataQualityWarning: dq, reasons: reasons.length ? reasons : ['No deviations.'], action: ACTIONS[state] };
  }
  const CAT = { configured_rule: 'VITAL_RULE', individual_baseline: 'BASELINE_DEVIATION', ml_model: 'ANOMALY_MODEL', trend: 'TREND' };
  function buildAlerts(code, a, risk) {
    const out = a.findings.map(f => ({ astronaut: code, severity: f.severity, category: CAT[f.basis], parameter: f.parameter, explanation: f.rule, action: risk.action, key: `${code}|${f.parameter}|${CAT[f.basis]}|${f.severity}` }));
    if (risk.dataQualityWarning) out.push({ astronaut: code, severity: 'AMBER', category: 'DATA_QUALITY', parameter: 'data_quality', explanation: 'Missing, implausible or disconnected-sensor data: ' + a.issues.map(i => `${i.parameter}:${i.issue}`).join(', '), action: risk.action, key: `${code}|data_quality|DATA_QUALITY|AMBER` });
    return out;
  }

  /* ---------- Scenarios (each tick = 5 simulated minutes) ---------- */
  const SCENARIOS = {
    normal: { title: '1 · Normal health', ticks: 40, blurb: 'Simulated readings stay near the personal baseline → GREEN.' },
    anomaly: { title: '2 · Anomaly detection', ticks: 55, blurb: 'Heart rate and temperature drift gradually; the detector flags the deviation from this astronaut\'s own baseline → AMBER.' },
    high: { title: '3 · High-priority alert', ticks: 40, blurb: 'A configured test rule is triggered (SpO₂ drop) → RED with the rule and suggested review action.' },
    offline: { title: '4 · Offline mission', ticks: 60, blurb: 'Communication is lost; monitoring continues locally, records queue in IndexedDB, then sync after reconnection.' },
  };
  function mods(sc, t) {
    if (sc === 'anomaly' && t >= 12) { const k = Math.min(1, (t - 12) / 40); return { heart_rate: 34 * k, temperature_c: 0.5 * k }; }
    if (sc === 'high' && t >= 22) return { spo2: -12 };
    if (sc === 'offline') { if (t >= 26 && t < 30) return { spo2: -5.5 }; if (t >= 18 && t < 21) return { heart_rate: null, spo2: null, temperature_c: null, resp_rate: null, systolic: null, diastolic: null, __sensor: false }; }
    return null;
  }

  function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }

  /* Simulated server: idempotent on client UUID */
  class FakeServer {
    constructor() { this.store = new Map(); this.up = true; }
    receive(rec) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(rec.uuid || '')) return 'rejected';
      if (this.store.has(rec.uuid)) return 'duplicate';
      this.store.set(rec.uuid, rec); return 'accepted';
    }
  }

  class Session {
    constructor(storage) { this.storage = storage || { put() {}, del() {}, all: async () => [] }; this.reset(0, 'normal'); }
    reset(astroIdx, sc) {
      this.astro = ASTRONAUTS[astroIdx]; this.sc = sc; this.t = 0; this.r = rng(1000 + astroIdx * 7 + sc.length);
      this.hist = history(this.astro.base, 576, 42 + astroIdx); this.baseline = baselineOf(this.hist);
      this.readings = []; this.states = []; this.alerts = []; this.log = []; this.queue = []; this.server = new FakeServer();
      this.net = { internet: true, backend: true, sensor: true }; this.lastSync = null; this.syncResult = null; this.last = null; this.done = false; this.nextAlertId = 1;
      this.storage.all().then(rows => rows.forEach(x => this.storage.del(x.uuid))).catch(() => {});
      this.event(`Scenario "${SCENARIOS[sc].title}" ready for ${this.astro.code}. All readings are SIMULATED (synthetic).`);
    }
    event(msg) { this.log.unshift({ t: this.t, msg }); if (this.log.length > 200) this.log.pop(); }
    setInternet(on) { if (this.net.internet === on) return; this.net.internet = on; this.event(on ? 'Network restored.' : 'Network lost — switching to local monitoring.'); if (on) this.sync(); }
    sync() {
      if (!this.net.internet || !this.net.backend) return;
      if (!this.queue.length) { this.lastSync = this.t; return; }
      const res = { accepted: 0, duplicate: 0, rejected: 0 }; const first = this.queue[0];
      const remaining = [];
      this.queue.forEach(rec => { const s = this.server.receive(rec); res[s]++; if (s === 'rejected') remaining.push(rec); else this.storage.del(rec.uuid); });
      const replay = first ? this.server.receive(first) : null; if (replay) res[replay]++; // idempotency demo: re-send first record
      this.queue = remaining; this.lastSync = this.t; this.syncResult = res;
      this.event(`Synchronized: ${res.accepted} accepted, ${res.duplicate} duplicate (idempotent, not re-inserted), ${res.rejected} rejected. Replay of first record was ${replay}.`);
    }
    tick() {
      const total = SCENARIOS[this.sc].ticks; if (this.done) return false;
      const t = this.t; const m = mods(this.sc, t);
      if (this.sc === 'offline') { if (t === 10) this.setInternet(false); if (t === 40) this.setInternet(true); }
      if (this.sc === 'high' && t === 22) this.event('TEST EVENT: configured SpO₂ rule is about to be triggered (simulated).');
      if (this.sc === 'anomaly' && t === 12) this.event('TEST EVENT: gradual simulated drift begins (heart rate, temperature).');
      const reading = genReading(this.astro.base, t + 576, this.r, m);
      reading.timestamp = t; reading.sensor_connected = !(m && m.__sensor === false);
      this.net.sensor = reading.sensor_connected;
      const a = analyze(reading, this.baseline, this.readings);
      const risk = assess(a, this.states);
      const alerts = buildAlerts(this.astro.code, a, risk).filter(n => !this.alerts.some(o => o.status !== 'RESOLVED' && o.key === n.key && t - o.tick < CFG.cooldownTicks));
      const seen = new Set(); alerts.forEach(al => { if (seen.has(al.key)) return; seen.add(al.key);
        this.alerts.unshift({ ...al, id: this.nextAlertId++, tick: t, status: 'OPEN', local: !this.net.internet, simulated: true });
        this.event(`ALERT ${al.severity}${!this.net.internet ? ' (local, offline)' : ''}: ${al.explanation}`); });
      const rec = { uuid: uuid(), tick: t, reading, state: risk.state, source: 'SYNTHETIC' };
      if (this.net.internet && this.net.backend) { this.server.receive(rec); } else { this.queue.push(rec); this.storage.put(rec); }
      if (this.last && this.last.risk.state !== risk.state) this.event(`Status changed ${this.last.risk.state || 'NO DATA'} → ${risk.state || 'NO DATA'}`);
      this.readings.push(reading); this.states.push(risk.state); this.last = { reading, analysis: a, risk };
      this.t++; if (this.t >= total) { if (this.sc === 'offline' && this.queue.length) this.sync(); this.done = true; this.event('Scenario complete.'); }
      return !this.done;
    }
    csv() { const rows = ['timestamp_tick,parameter,value,unit,source']; this.readings.forEach((r, i) => FEATURES.forEach(p => { if (r[p] !== null && r[p] !== undefined) rows.push(`${i},${p},${r[p].toFixed(2)},${UNITS[p]},SYNTHETIC`); })); return rows.join('\n'); }
  }

  const api = { FEATURES, UNITS, LABELS, RULES, CFG, ASTRONAUTS, SCENARIOS, Session, validate, evalRules, baselineOf, analyze, assess, buildAlerts, history, rng, uuid, FakeServer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AstraEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
