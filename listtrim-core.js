/* AudienceTrim core (internal namespace: ListTrim): pure functions, no DOM. Runs in the browser and in Node (tests).
 * Input: Mailchimp audience exports (CSV per status). Output: billing audit + archive lists.
 * Nothing leaves the user's device. */
(function (root) {
  'use strict';
  var STATUS_ORDER = { subscribed: 0, nonsubscribed: 1, unknown: 2, unsubscribed: 3, cleaned: 4 };
  var BILLABLE = { subscribed: 1, unsubscribed: 1, nonsubscribed: 1, unknown: 1 }; // cleaned/archived are not billed
  var EMAIL_RE = /^[A-Za-z0-9._%+\-']+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var rows = [], r = [], f = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { r.push(f); f = ''; }
      else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f !== '' || r.length) { r.push(f); rows.push(r); }
    return rows.filter(function (x) { return !(x.length === 1 && x[0] === ''); });
  }
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) || /^[=+\-@]/.test(v) ? '"' + (/^[=+\-@]/.test(v) ? "'" : '') + v.replace(/"/g, '""') + '"' : v; }
  function toCSV(header, rows) { return [header].concat(rows).map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

  function detectStatus(filename, headers) {
    var n = String(filename || '').toLowerCase().split('/').pop();
    if (/non[\s_\-]?subscribed/.test(n)) return 'nonsubscribed';
    if (/unsubscribed/.test(n)) return 'unsubscribed';
    if (/cleaned/.test(n)) return 'cleaned';
    if (/archived/.test(n)) return 'archived';
    if (/subscribed/.test(n)) return 'subscribed';
    var h = (headers || []).map(function (x) { return String(x).trim().toUpperCase(); });
    if (h.indexOf('UNSUB_TIME') >= 0) return 'unsubscribed';
    if (h.indexOf('CLEAN_TIME') >= 0) return 'cleaned';
    return 'unknown';
  }
  function exportKey(filename) { // members_export_<hash> groups loose CSVs from one audience export
    var m = String(filename || '').match(/members_export_([0-9a-f]+)/i); return m ? m[1].toLowerCase() : '';
  }
  function findCol(headers, names) {
    var h = headers.map(function (x) { return String(x).trim().toLowerCase(); });
    for (var i = 0; i < names.length; i++) { var j = h.indexOf(names[i]); if (j >= 0) return j; }
    return -1;
  }
  function normEmail(s) { return String(s || '').replace(/\u00a0/g, ' ').trim().toLowerCase(); }

  /* files: [{audience, status, headers, rows, name}]
   * opts: { archiveUnsubscribed: true, archiveNonsubscribed: false, primary: '<audience name>' | undefined } */
  function analyze(files, opts) {
    opts = opts || {};
    var archUnsub = opts.archiveUnsubscribed !== false, archNon = !!opts.archiveNonsubscribed;
    var audiences = {}, recs = [], warnings = [];
    files.forEach(function (f) {
      if (f.status === 'archived') { warnings.push(f.name + ': archived contacts are not billed, so they were skipped.'); return; }
      var ei = findCol(f.headers, ['email address', 'email', 'e-mail', 'email_address']);
      if (ei < 0) { warnings.push(f.name + ': no "Email Address" column, so the file was skipped.'); return; }
      var A = audiences[f.audience] = audiences[f.audience] || { name: f.audience, counts: { subscribed: 0, unsubscribed: 0, nonsubscribed: 0, cleaned: 0, unknown: 0 }, billable: 0 };
      if (f.status === 'unknown') warnings.push(f.name + ': status not in the file name, so it was treated as billable (unknown).');
      var euidI = findCol(f.headers, ['euid']), ratingI = findCol(f.headers, ['member_rating']);
      var fnI = findCol(f.headers, ['first name', 'fname']), lnI = findCol(f.headers, ['last name', 'lname']), phI = findCol(f.headers, ['phone number', 'phone']);
      f.rows.forEach(function (row, idx) {
        var em = normEmail(row[ei]);
        if (!em) return;
        A.counts[f.status] = (A.counts[f.status] || 0) + 1;
        if (BILLABLE[f.status]) A.billable++;
        recs.push({ audience: f.audience, status: f.status, email: em, rawEmail: row[ei], valid: EMAIL_RE.test(em) && em.indexOf('..') < 0,
          euid: euidI >= 0 ? row[euidI] : '', rating: ratingI >= 0 ? +row[ratingI] || 0 : 0,
          first: fnI >= 0 ? row[fnI] : '', last: lnI >= 0 ? row[lnI] : '', phone: phI >= 0 ? row[phI] : '',
          file: f.name, line: idx + 2, row: row, headers: f.headers });
      });
    });
    var audNames = Object.keys(audiences).sort(function (a, b) { return audiences[b].billable - audiences[a].billable || (a < b ? -1 : 1); });
    var primary = opts.primary && audiences[opts.primary] ? opts.primary : audNames[0];
    var rank = {}; audNames.forEach(function (n, i) { rank[n] = n === primary ? -1 : i; });

    // Same email appearing twice inside one audience+status (shouldn't happen in Mailchimp exports; counted once).
    var billable = recs.filter(function (r) { return BILLABLE[r.status]; });
    var byEmail = {};
    billable.forEach(function (r) { (byEmail[r.email] = byEmail[r.email] || []).push(r); });
    var archive = [], keepers = {};
    Object.keys(byEmail).forEach(function (em) {
      var list = byEmail[em].slice().sort(function (a, b) {
        return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (rank[a.audience] - rank[b.audience]) || (b.rating - a.rating);
      });
      var keep = list[0]; keepers[em] = keep;
      var multiAud = {}; list.forEach(function (r) { multiAud[r.audience] = 1; });
      var isDupAcross = Object.keys(multiAud).length > 1;
      list.forEach(function (r, i) {
        var reasons = [];
        if (i > 0) reasons.push(r.audience === keep.audience ? 'duplicate row in same audience' : 'also in "' + keep.audience + '" (' + keep.status + ')');
        if (r.status === 'unsubscribed' && archUnsub) reasons.push('unsubscribed (still billed)');
        if (r.status === 'nonsubscribed' && archNon) reasons.push('non-subscribed (still billed)');
        if (reasons.length) archive.push({ rec: r, reasons: reasons, dup: i > 0 && isDupAcross });
      });
    });
    var uniqueBillable = Object.keys(byEmail).length;
    var totalBillable = billable.length;
    var dupCount = archive.filter(function (a) { return a.dup; }).length;
    var unsubCount = billable.filter(function (r) { return r.status === 'unsubscribed'; }).length; // all billed unsubscribed
    var nonCount = billable.filter(function (r) { return r.status === 'nonsubscribed'; }).length; // all billed non-subscribed
    var invalid = billable.filter(function (r) { return !r.valid; });
    var after = totalBillable - archive.length;

    // Archive files, one per audience + status (Mailchimp archives per audience)
    var groups = {};
    archive.forEach(function (a) { var k = a.rec.audience + '|' + a.rec.status; (groups[k] = groups[k] || []).push(a); });
    var archiveFiles = Object.keys(groups).sort().map(function (k) {
      var g = groups[k], aud = g[0].rec.audience, st = g[0].rec.status;
      return { audience: aud, status: st, count: g.length,
        filename: 'archive__' + slug(aud) + '__' + st + '.csv',
        header: ['Email Address', 'First Name', 'Last Name', 'Status', 'Why archive', 'Source file', 'Source line'],
        rows: g.map(function (a) { return [a.rec.rawEmail.trim(), a.rec.first, a.rec.last, st, a.reasons.join('; '), a.rec.file, a.rec.line]; }) };
    });

    // Combined master file (one row per unique billable email) for "combine audiences into one primary audience + tags"
    var master = { filename: 'combined_primary_audience.csv', header: ['Email Address', 'First Name', 'Last Name', 'Phone Number', 'Best status', 'TAGS', 'Source audiences'], rows: [] };
    Object.keys(byEmail).sort().forEach(function (em) {
      var list = byEmail[em], k = keepers[em], auds = {};
      list.forEach(function (r) { auds[r.audience] = 1; });
      var first = k.first, last = k.last, phone = k.phone;
      list.forEach(function (r) { if (!first && r.first) first = r.first; if (!last && r.last) last = r.last; if (!phone && r.phone) phone = r.phone; });
      var tags = Object.keys(auds).sort().map(function (a) { return 'from:' + a; }).join(',');
      master.rows.push([k.rawEmail.trim(), first, last, phone, k.status, tags, Object.keys(auds).sort().join('; ')]);
    });

    // Possible same person with different emails (review only, never counted in savings): reuse the Dedupe Pilot engine
    var review = { filename: 'review_possible_same_person.csv', header: [], rows: [] };
    if (root.dpRun || (typeof require === 'function')) {
      try {
        var dpRun = root.dpRun || require('./engine.js').dpRun;
        var subs = Object.keys(keepers).map(function (e) { return keepers[e]; }).filter(function (r) { return r.status === 'subscribed'; });
        if (subs.length > 60000) warnings.push('Possible-same-person check skipped (more than 60,000 subscribed contacts). Exact duplicate and unsubscribed counts are unaffected.');
        if (subs.length && subs.length <= 60000) {
          var out = dpRun(subs.map(function (r) { return [r.first + ' ' + r.last, r.rawEmail, r.phone]; }), ['Name', 'Email', 'Phone'], {});
          review.header = ['Email A', 'Audience A', 'Email B', 'Audience B', 'Name A', 'Name B', 'Why', 'Score'];
          review.rows = out.review.filter(function (t) { return t[8] !== t[9]; }).map(function (t) {
            var a = subs[t[0] - 2], b = subs[t[1] - 2];
            return [a.rawEmail, a.audience, b.rawEmail, b.audience, t[4], t[5], t[3], t[2]];
          });
          // same-phone/fuzzy-name merges with different emails also go to review
          var byCl = {}; out.report.forEach(function (x) { (byCl[x[1]] = byCl[x[1]] || []).push(x[0] - 2); });
          Object.keys(byCl).forEach(function (c) {
            var ids = byCl[c]; if (ids.length < 2) return;
            for (var j = 1; j < ids.length; j++) { var a = subs[ids[0]], b = subs[ids[j]];
              if (a.email !== b.email) review.rows.push([a.rawEmail, a.audience, b.rawEmail, b.audience, (a.first + ' ' + a.last).trim(), (b.first + ' ' + b.last).trim(), 'same phone or near-identical name', '']); }
          });
        }
      } catch (e) { warnings.push('Possible-same-person check skipped: ' + e.message); }
    }

    return {
      primary: primary,
      audiences: audNames.map(function (n) { return audiences[n]; }),
      totals: { billableBefore: totalBillable, billableAfter: after, uniqueBillable: uniqueBillable, archive: archive.length,
        crossAudienceDuplicates: dupCount, unsubscribed: unsubCount, nonsubscribed: nonCount, invalidEmails: invalid.length,
        cleaned: recs.filter(function (r) { return r.status === 'cleaned'; }).length,
        reductionPct: totalBillable ? Math.round(1000 * archive.length / totalBillable) / 10 : 0 },
      archiveFiles: archiveFiles, master: master, review: review,
      invalid: { filename: 'invalid_emails.csv', header: ['Email Address', 'Audience', 'Status', 'Source file', 'Source line'], rows: invalid.map(function (r) { return [r.rawEmail, r.audience, r.status, r.file, r.line]; }) },
      warnings: warnings
    };
  }

  // Published Mailchimp Standard reference points (SendFox, prices checked 2026-09-22; coldmailer.ai for 10k). Tiers between points are not published here.
  var STANDARD_REF = [[5000, 100], [10000, 135], [15000, 230], [50000, 450], [100000, 800]];
  function estimateSavings(before, after, currentBill) {
    var res = { proportional: null, refBefore: null, refAfter: null };
    if (currentBill > 0 && before > 0) res.proportional = Math.round(currentBill * (before - after) / before);
    function ref(n) { for (var i = 0; i < STANDARD_REF.length; i++) if (n <= STANDARD_REF[i][0]) return STANDARD_REF[i]; return null; }
    res.refBefore = ref(before); res.refAfter = ref(after);
    return res;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'audience'; }

  var api = { parseCSV: parseCSV, toCSV: toCSV, detectStatus: detectStatus, exportKey: exportKey, analyze: analyze, estimateSavings: estimateSavings, STANDARD_REF: STANDARD_REF, slug: slug };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ListTrim = api;
})(typeof window !== 'undefined' ? window : globalThis);
