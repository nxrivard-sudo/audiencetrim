/**
 * Dedupe Pilot engine - contact-aware fuzzy dedupe + merge.
 * Pure JS (no Apps Script services) so it runs in Apps Script V8 and in Node for tests.
 * Port of exp-001/toolkit/csvclean.py.
 */
var DP_ALIASES = {
  name: ['name','full name','fullname','contact','contact name'],
  first: ['first','first name','firstname','given name'],
  last: ['last','last name','lastname','surname','family name'],
  company: ['company','company name','organization','organisation','org','business','account'],
  email: ['email','e-mail','email address','mail'],
  phone: ['phone','phone number','tel','telephone','mobile','cell'],
  location: ['location','city','address','city/state','region']
};
var DP_FREE = {'gmail.com':1,'yahoo.com':1,'hotmail.com':1,'outlook.com':1,'aol.com':1,'icloud.com':1,'live.com':1,'msn.com':1,'protonmail.com':1};
var DP_CORP = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|pllc|lp|llp)\b\.?/g;
var DP_EMAIL = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

function dpDetectColumns(headers) {
  var m = {};
  for (var key in DP_ALIASES) {
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i] || '').trim().toLowerCase();
      if (DP_ALIASES[key].indexOf(h) >= 0 && !(key in m)) { m[key] = i; }
    }
  }
  return m;
}
function dpWs(s) { return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
function dpStripAccents(s) { return s.normalize ? s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '') : s; }
function dpNormName(s) {
  s = dpWs(s); if (!s) return '';
  if (s === s.toUpperCase() || s === s.toLowerCase()) {
    s = s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, function (_, p, c) { return p + c.toUpperCase(); });
  }
  return s;
}
function dpNameKey(s) {
  s = dpStripAccents(String(s).toLowerCase()).replace(/\b(mr|mrs|ms|dr|jr|sr|ii|iii)\b\.?/g, '');
  return s.replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}
function dpCompanyKey(s) {
  s = dpStripAccents(String(s || '').toLowerCase()).replace(/&/g, ' and ');
  s = s.replace(DP_CORP, '').replace(/[^a-z0-9 ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}
function dpNormEmail(s) { return dpWs(s).toLowerCase().replace(/^mailto:/, '').replace(/^[<;,. ]+|[<>;,. ]+$/g, ''); }
function dpEmailOk(s) { return DP_EMAIL.test(s) && s.indexOf('..') < 0; }
function dpNormPhone(s, country) {
  var raw = dpWs(s); if (!raw) return { v: '', err: '' };
  var ext = '', m = raw.match(/(?:ext\.?|x|#)\s*(\d{1,6})\s*$/i);
  if (m) { ext = m[1]; raw = raw.slice(0, m.index); }
  var d = raw.replace(/\D/g, ''), e;
  if (/^\s*\+/.test(raw)) e = '+' + d;
  else if (country === 'US' && d.length === 10) e = '+1' + d;
  else if (country === 'US' && d.length === 11 && d[0] === '1') e = '+' + d;
  else return { v: raw, err: 'unparsed' };
  if (country === 'US' && e.indexOf('+1') === 0 && (e.length !== 12 || '01'.indexOf(e[2]) >= 0)) return { v: raw, err: 'invalid' };
  return { v: e + (ext ? ' x' + ext : ''), err: '' };
}
/** similarity in [0,1] = 1 - Levenshtein distance / longer length */
function dpSim(a, b) {
  if (!a || !b) return 0; if (a === b) return 1;
  var n = a.length, m = b.length, prev = new Array(m + 1), cur = new Array(m + 1), i, j;
  for (j = 0; j <= m; j++) prev[j] = j;
  for (i = 1; i <= n; i++) {
    cur[0] = i;
    for (j = 1; j <= m; j++) {
      var c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
    }
    var t = prev; prev = cur; cur = t;
  }
  return 1 - prev[m] / Math.max(n, m);
}
function dpNamesCompatible(a, b) {
  if (!a || !b) return true;
  if (dpSim(a, b) >= 0.8) return true;
  var pa = a.split(' '), pb = b.split(' ');
  return pa[pa.length - 1] === pb[pb.length - 1] && dpSim(pa[0], pb[0]) >= 0.8;
}

/**
 * @param {Array<Array>} rows  data rows (no header)
 * @param {Array} headers
 * @param {Object} opts {threshold:0.88, review:0.80, country:'US', mapping:{} optional}
 * @return {Object} {mapping, clean:[...], report:[...], review:[...], invalid:[...], stats:{}}
 */
function dpRun(rows, headers, opts) {
  opts = opts || {};
  var TH = opts.threshold || 0.88, RV = opts.review || 0.80, country = opts.country || 'US';
  var map = opts.mapping || dpDetectColumns(headers);
  function g(r, k) { return (k in map) ? r[map[k]] : ''; }
  var recs = [], invalid = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var name = dpNormName(g(r, 'name') || (dpWs(g(r, 'first')) + ' ' + dpWs(g(r, 'last'))));
    var comp = dpWs(g(r, 'company')), em = dpNormEmail(g(r, 'email')), ph = dpNormPhone(g(r, 'phone'), country);
    var emOk = !!em && dpEmailOk(em);
    if (em && !emOk) invalid.push({ row: i + 2, field: 'email', value: String(g(r, 'email')), issue: 'invalid syntax' });
    if (ph.err) invalid.push({ row: i + 2, field: 'phone', value: String(g(r, 'phone')), issue: ph.err });
    recs.push({ i: i, name: name, nk: dpNameKey(name), company: comp, ck: dpCompanyKey(comp), email: em, emOk: emOk,
      phone: ph.v, phd: ph.err ? '' : ph.v.split(' x')[0].replace(/\D/g, ''), loc: dpWs(g(r, 'location')) });
  }
  var n = recs.length, parent = [], reason = {}, review = [];
  for (i = 0; i < n; i++) parent[i] = i;
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function link(x, y, why, conf) {
    var a = find(x), b = find(y); if (a === b) return;
    parent[Math.max(a, b)] = Math.min(a, b);
    if (!(x in reason)) reason[x] = [why, conf]; if (!(y in reason)) reason[y] = [why, conf];
  }
  var by = {};
  recs.forEach(function (r) {
    if (r.emOk) (by['e|' + r.email] = by['e|' + r.email] || []).push(r.i);
    if (r.phd && r.phd.length >= 10) (by['p|' + r.phd] = by['p|' + r.phd] || []).push(r.i);
  });
  Object.keys(by).forEach(function (k) {
    var ids = by[k];
    for (var j = 1; j < ids.length; j++) {
      var a = recs[ids[0]], b = recs[ids[j]];
      if (k[0] === 'e') {
        if (dpNamesCompatible(a.nk, b.nk)) link(a.i, b.i, 'same email', 1.0);
        else review.push([a.i, b.i, 0, 'same email, different names (shared mailbox?)']);
      } else if (dpSim(a.nk, b.nk) >= 0.8 || (a.ck && a.ck === b.ck && dpSim(a.nk, b.nk) >= 0.6)) {
        link(a.i, b.i, 'same phone + name/company', 0.97);
      }
    }
  });
  var blocks = {};
  recs.forEach(function (r) {
    var keys = {}, dom = r.emOk ? r.email.split('@')[1] : '';
    if (r.ck) keys['c|' + r.ck.slice(0, 6)] = 1;
    if (dom && !DP_FREE[dom]) keys['d|' + dom] = 1;
    if (r.nk) { var p = r.nk.split(' '); keys['n|' + p[p.length - 1].slice(0, 4) + p[0].slice(0, 1)] = 1; }
    Object.keys(keys).forEach(function (k) { (blocks[k] = blocks[k] || []).push(r.i); });
  });
  var seen = {};
  Object.keys(blocks).forEach(function (k) {
    var ids = blocks[k]; if (ids.length > 400) return;
    for (var x = 0; x < ids.length; x++) for (var y = x + 1; y < ids.length; y++) {
      var p = recs[ids[x]], q = recs[ids[y]], key = p.i + ':' + q.i;
      if (seen[key]) continue; seen[key] = 1;
      var ns;
      if (p.emOk && q.emOk && p.email !== q.email && p.email.split('@')[0] !== q.email.split('@')[0]) {
        ns = dpSim(p.nk, q.nk);
        if (ns >= 0.95 && p.ck && p.ck === q.ck) review.push([p.i, q.i, ns, 'same name+company, different emails']);
        continue;
      }
      ns = dpSim(p.nk, q.nk);
      var cs = (p.ck && q.ck) ? dpSim(p.ck, q.ck) : 0.5, score = 0.7 * ns + 0.3 * cs;
      if (score >= TH && ns >= 0.85) link(p.i, q.i, 'fuzzy name ' + ns.toFixed(2) + '/company ' + cs.toFixed(2), Math.round(score * 1000) / 1000);
      else if (score >= RV && ns >= 0.75) review.push([p.i, q.i, Math.round(score * 1000) / 1000, 'name ' + ns.toFixed(2) + '/company ' + cs.toFixed(2)]);
    }
  });
  var clusters = {}, order = [];
  recs.forEach(function (r) { var f = find(r.i); if (!clusters[f]) { clusters[f] = []; order.push(f); } clusters[f].push(r); });
  order.sort(function (a, b) { return a - b; });
  var F = ['name', 'company', 'email', 'phone', 'loc'], clean = [], report = [];
  function score(r) { var s = r.emOk ? 1 : 0; F.forEach(function (f) { if (r[f]) s++; }); return s; }
  order.forEach(function (root, cid) {
    var mem = clusters[root].slice().sort(function (a, b) { return (score(b) - score(a)) || (a.i - b.i); });
    var best = {}; F.forEach(function (f) { best[f] = mem[0][f]; });
    mem.slice(1).forEach(function (r) { F.forEach(function (f) { if (!best[f] && r[f]) best[f] = r[f]; }); });
    var altE = {}, altP = {};
    mem.forEach(function (r) { if (r.emOk && r.email !== best.email) altE[r.email] = 1; if (r.phone && r.phone !== best.phone) altP[r.phone] = 1; });
    var src = mem.map(function (r) { return r.i + 2; }).sort(function (a, b) { return a - b; });
    clean.push([cid + 1, best.name, best.company, best.email, best.phone, best.loc, Object.keys(altE).sort().join('; '), Object.keys(altP).sort().join('; '), src.join(';'), mem.length]);
    mem.forEach(function (r, idx) {
      var rs = (mem.length > 1 && reason[r.i]) ? reason[r.i] : ['unique', 1];
      report.push([r.i + 2, cid + 1, idx === 0, rs[0], rs[1]]);
    });
  });
  report.sort(function (a, b) { return a[0] - b[0]; });
  var rv = review.filter(function (t) { return find(t[0]) !== find(t[1]); }).map(function (t) {
    var a = recs[t[0]], b = recs[t[1]];
    return [t[0] + 2, t[1] + 2, t[2], t[3], a.name, b.name, a.company, b.company, a.email, b.email];
  });
  return {
    mapping: map,
    cleanHeader: ['cluster_id', 'name', 'company', 'email', 'phone', 'location', 'alt_emails', 'alt_phones', 'source_rows', 'merged_count'],
    clean: clean,
    reportHeader: ['input_row', 'cluster_id', 'kept_as_primary', 'match_reason', 'confidence'],
    report: report,
    reviewHeader: ['row_a', 'row_b', 'score', 'why', 'name_a', 'name_b', 'company_a', 'company_b', 'email_a', 'email_b'],
    review: rv,
    invalid: invalid,
    stats: { input: n, output: clean.length, merged: n - clean.length, review: rv.length, invalid: invalid.length }
  };
}
if (typeof module !== 'undefined') module.exports = { dpRun: dpRun, dpSim: dpSim, dpDetectColumns: dpDetectColumns };
