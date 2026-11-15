(function () {
  const E = window.AstraEngine; const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- IndexedDB queue (falls back silently to memory-only if unavailable) ----
  const idb = (() => {
    let db = null; const open = new Promise(res => { try { const rq = indexedDB.open('astrahealth-demo', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('queue', { keyPath: 'uuid' }); rq.onsuccess = () => { db = rq.result; res(db); }; rq.onerror = () => res(null); } catch (e) { res(null); } });
    const tx = async (mode, fn) => { const d = await open; if (!d) return []; return new Promise(r => { const t = d.transaction('queue', mode); const out = fn(t.objectStore('queue')); t.oncomplete = () => r(out && out.result !== undefined ? out.result : []); t.onerror = () => r([]); }); };
    return { put: rec => tx('readwrite', s => s.put({ uuid: rec.uuid, tick: rec.tick, source: rec.source })), del: id => tx('readwrite', s => s.delete(id)), all: () => tx('readonly', s => s.getAll()) };
  })();

  const S = new E.Session(idb); let timer = null, scKey = 'normal', astroIdx = 0;
  const speed = 450;

  $('astro').innerHTML = E.ASTRONAUTS.map((a, i) => `<option value="${i}">${esc(a.code)} — ${esc(a.name)}</option>`).join('');
  $('scs').innerHTML = Object.keys(E.SCENARIOS).map(k => `<button class="sc" data-sc="${k}"><b>${esc(E.SCENARIOS[k].title)}</b><small>${esc(E.SCENARIOS[k].blurb)}</small></button>`).join('');

  function stop() { clearInterval(timer); timer = null; }
  function start() { if (timer) return; if (S.done) S.reset(astroIdx, scKey); timer = setInterval(() => { if (!S.tick()) stop(); render(); }, speed); render(); }
  function doReset() { stop(); S.reset(astroIdx, scKey); render(); }

  $('astro').onchange = e => { astroIdx = +e.target.value; doReset(); };
  $('scs').onclick = e => { const b = e.target.closest('.sc'); if (!b) return; scKey = b.dataset.sc; doReset(); };
  $('start').onclick = start; $('pause').onclick = () => { stop(); render(); }; $('reset').onclick = doReset;
  $('net').onclick = () => { S.setInternet(!S.net.internet); render(); };
  $('syncnow').onclick = () => { S.sync(); render(); };
  $('csv').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([S.csv()], { type: 'text/csv' })); a.download = `${S.astro.code}_SYNTHETIC_session.csv`; a.click(); };
  $('alerts').onclick = e => { const b = e.target.closest('button[data-id]'); if (!b) return; const al = S.alerts.find(x => x.id == b.dataset.id); if (!al) return;
    al.status = b.dataset.act === 'ack' ? 'ACKNOWLEDGED' : 'RESOLVED'; S.event(`Alert #${al.id} ${al.status.toLowerCase()} (${al.parameter})`); render(); };

  function chart(p) {
    const W = 300, H = 110, pad = 22; const data = S.readings.slice(-60).map(r => r[p]); const b = S.baseline[p]; const rl = E.RULES[p].red;
    const lo = Math.min(b.mean - 4 * b.std, rl[0] - 0.5, ...data.filter(v => v != null)), hi = Math.max(b.mean + 4 * b.std, ...data.filter(v => v != null));
    const hi2 = Math.max(hi, Math.min(rl[1], hi + (hi - lo) * 0.2)); const y = v => H - pad - (v - lo) / (hi2 - lo || 1) * (H - 2 * pad), x = i => pad + i * (W - pad - 8) / 59;
    let d = '', pen = false; data.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
    const band = `<rect x="${pad}" y="${y(b.mean + 3 * b.std)}" width="${W - pad - 8}" height="${Math.max(1, y(b.mean - 3 * b.std) - y(b.mean + 3 * b.std))}" fill="rgba(47,212,255,.12)"/>`;
    const lines = [rl[0], rl[1]].filter(v => v >= lo && v <= hi2).map(v => `<line x1="${pad}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="#ff4d5e" stroke-dasharray="4 3" opacity=".7"/><text x="2" y="${y(v) + 3}">${v}</text>`).join('');
    return `<div><div class="muted">${esc(E.LABELS[p])} (${E.UNITS[p]})</div><svg viewBox="0 0 ${W} ${H}" width="100%">${band}${lines}<path d="${d}" fill="none" stroke="#2fd4ff" stroke-width="1.8"/><text x="${pad}" y="${H - 4}">baseline mean ${b.mean.toFixed(1)}</text></svg></div>`;
  }

  function render() {
    const L = S.last; const total = E.SCENARIOS[S.sc].ticks;
    $('scs').querySelectorAll('.sc').forEach(b => b.classList.toggle('on', b.dataset.sc === scKey));
    $('prog').textContent = (timer ? 'Running' : S.done ? 'Complete' : S.t ? 'Paused' : 'Ready') + ` · ${S.t}/${total} readings (SIMULATED)`;
    $('start').textContent = S.done ? '▶ Replay' : '▶ Start';
    if (L) { const st = L.risk.state || 'NONE';
      $('status').innerHTML = `<span class="badge ${st}">${st === 'NONE' ? 'NO VALID DATA' : st}</span>
        <div style="margin-top:10px"><b>Suggested review action:</b> ${esc(L.risk.action)}</div>
        <div class="muted" style="margin-top:6px">Why:</div><ul class="r">${L.risk.reasons.slice(0, 5).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="chips"><span class="chip ${L.risk.dataQualityWarning ? 'warn' : 'good'}">Data quality: ${L.risk.dataQualityWarning ? 'WARNING (' + Math.round(L.analysis.quality * 100) + '% valid)' : 'OK'}</span>
        <span class="chip">Source: SIMULATED</span>${L.analysis.ml != null ? `<span class="chip">Multivariate score ${L.analysis.ml.toFixed(2)} (not a disease probability)</span>` : ''}</div>`;
      $('vitals').innerHTML = E.FEATURES.map(p => { const v = L.reading[p], b = S.baseline[p]; const z = v == null ? null : (v - b.mean) / Math.max(b.std, .02 * Math.abs(b.mean), 1e-6);
        return `<div class="vital"><small>${esc(E.LABELS[p])}</small><b>${v == null ? '—' : v.toFixed(p === 'temperature_c' ? 2 : 1)}</b> <span class="muted">${E.UNITS[p]}</span>
        <small class="z ${z != null && Math.abs(z) > 3 ? 'hi' : ''}">${z == null ? 'no data (not treated as normal)' : `z = ${z >= 0 ? '+' : ''}${z.toFixed(1)} vs own baseline`}</small><small>baseline ${b.mean.toFixed(1)} ± ${b.std.toFixed(1)}</small></div>`; }).join('');
      $('charts').innerHTML = ['heart_rate', 'spo2', 'temperature_c', 'systolic'].map(chart).join('');
    } else { $('status').innerHTML = '<span class="badge NONE">NOT STARTED</span><div class="muted" style="margin-top:8px">Pick a scenario and press <b>Start</b> — the whole tour takes under two minutes.</div>'; $('vitals').innerHTML = '<span class="muted">No data yet.</span>'; $('charts').innerHTML = ''; }
    const n = S.net;
    $('conn').innerHTML = `<span class="chip ${n.internet ? 'good' : 'bad'}">Internet: ${n.internet ? 'available' : 'UNAVAILABLE'}</span><span class="chip ${n.backend ? 'good' : 'bad'}">Backend: ${n.backend ? 'reachable' : 'unreachable'}</span><span class="chip ${n.sensor ? 'good' : 'bad'}">Sensor: ${n.sensor ? 'connected' : 'DISCONNECTED'}</span><span class="chip ${S.queue.length ? 'warn' : 'good'}">Pending sync: ${S.queue.length}</span>`;
    $('syncinfo').innerHTML = `Last sync: ${S.lastSync == null ? 'never' : 'at reading ' + S.lastSync}${S.syncResult ? `<br>Result: ${S.syncResult.accepted} accepted · ${S.syncResult.duplicate} duplicate · ${S.syncResult.rejected} rejected` : ''}<br>Server holds ${S.server.store.size} records (simulated).`;
    $('alerts').innerHTML = S.alerts.length ? S.alerts.slice(0, 30).map(a => `<div class="alert ${a.severity} ${a.status === 'ACKNOWLEDGED' ? 'ack' : ''} ${a.status === 'RESOLVED' ? 'res' : ''}">
      <b>${a.severity}</b> · ${esc(a.category)} · ${esc(a.parameter)} ${a.local ? '· <i>raised locally while offline</i>' : ''}<div>${esc(a.explanation)}</div>
      <div class="meta">Reading ${a.tick} · ${a.status} · SIMULATED · Suggested: ${esc(a.action)}</div>
      ${a.status === 'OPEN' ? `<button data-id="${a.id}" data-act="ack">Acknowledge</button>` : ''}${a.status !== 'RESOLVED' ? `<button data-id="${a.id}" data-act="res">Resolve</button>` : ''}</div>`).join('') : '<span class="muted">No alerts.</span>';
    $('log').innerHTML = S.log.map(l => `<div><span class="muted">[${l.t}]</span> ${esc(l.msg)}</div>`).join('');
  }
  render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
