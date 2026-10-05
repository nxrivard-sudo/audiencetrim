/* AudienceTrim UI (internal namespace: ListTrim). Everything runs locally; no network calls are made with user data. */
(function () {
  'use strict';
  var C = window.LT_CONFIG || {}, $ = function (id) { return document.getElementById(id); };
  var state = { files: [], result: null, pro: null };
  var PREVIEW = 5;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function audFromName(n) { return n.replace(/\.(zip|csv)$/i, '').replace(/[_-]?members_export_[0-9a-f]+/i, '').replace(/^(subscribed|unsubscribed|nonsubscribed|non_subscribed|cleaned)[_-]?/i, '').replace(/[_-]+/g, ' ').trim() || 'Audience'; }

  async function addFiles(list) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try {
        if (/\.zip$/i.test(f.name)) {
          var entries = await LTZip.readZip(await f.arrayBuffer()), aud = audFromName(f.name);
          entries.filter(function (e) { return /\.csv$/i.test(e.name) && !/(^|\/)sms\//i.test(e.name); }).forEach(function (e) { pushCSV(e.name, e.text, aud, f.name); });
        } else if (/\.csv$/i.test(f.name)) {
          var text = await f.text(), key = ListTrim.exportKey(f.name);
          pushCSV(f.name, text, key ? 'Audience ' + key.slice(0, 6) : audFromName(f.name), '');
        }
      } catch (e) { alert(f.name + ': ' + e.message); }
    }
    renderFiles();
  }
  function pushCSV(name, text, audience, zip) {
    var rows = ListTrim.parseCSV(text); if (!rows.length) return;
    var headers = rows[0];
    state.files.push({ name: (zip ? zip + ' › ' : '') + name.split('/').pop(), audience: audience, status: ListTrim.detectStatus(name, headers), headers: headers, rows: rows.slice(1) });
  }
  function renderFiles() {
    $('files').classList.toggle('hidden', !state.files.length);
    $('filesBody').innerHTML = state.files.map(function (f, i) {
      var opts = ['subscribed', 'unsubscribed', 'nonsubscribed', 'cleaned', 'archived', 'unknown'].map(function (s) { return '<option' + (s === f.status ? ' selected' : '') + '>' + s + '</option>'; }).join('');
      return '<tr><td>' + esc(f.name) + '</td><td><input type="text" data-i="' + i + '" class="aud" value="' + esc(f.audience) + '"></td><td><select data-i="' + i + '" class="st">' + opts + '</select></td><td>' + fmt(f.rows.length) + '</td></tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.aud'), function (el) { el.onchange = function () { state.files[+el.dataset.i].audience = el.value.trim() || 'Audience'; renderPrimary(); }; });
    Array.prototype.forEach.call(document.querySelectorAll('.st'), function (el) { el.onchange = function () { state.files[+el.dataset.i].status = el.value; }; });
    renderPrimary();
  }
  function renderPrimary() {
    var seen = {}; state.files.forEach(function (f) { seen[f.audience] = (seen[f.audience] || 0) + f.rows.length; });
    var names = Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; });
    $('primary').innerHTML = names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
  }
  function run() {
    var r = ListTrim.analyze(state.files, { archiveUnsubscribed: $('optUnsub').checked, archiveNonsubscribed: $('optNon').checked, primary: $('primary').value });
    state.result = r; var t = r.totals;
    $('results').classList.remove('hidden');
    $('kBefore').textContent = fmt(t.billableBefore); $('kAfter').textContent = fmt(t.billableAfter);
    $('kArch').textContent = fmt(t.archive); $('kPct').textContent = t.reductionPct + '% of billed contacts';
    var s = ListTrim.estimateSavings(t.billableBefore, t.billableAfter, +$('bill').value || 0);
    if (s.proportional != null) { $('kSave').textContent = '$' + fmt(s.proportional); $('kSaveNote').textContent = 'proportional to your $' + fmt(+$('bill').value) + '/mo bill; Mailchimp prices in tiers, so confirm on Billing'; }
    else { $('kSave').textContent = '-'; $('kSaveNote').textContent = 'enter your current monthly bill above for an estimate'; }
    var ref = !(s.refBefore && s.refAfter) ? '' : (s.refBefore[0] === s.refAfter[0] ? ('Before and after both fall in the same published Standard reference band (up to ' + fmt(s.refBefore[0]) + ' contacts ≈ $' + s.refBefore[1] + '/mo). Your actual saving depends on your exact tier; check Mailchimp Billing.') : ('Standard-plan reference: up to ' + fmt(s.refBefore[0]) + ' contacts ≈ $' + s.refBefore[1] + '/mo → up to ' + fmt(s.refAfter[0]) + ' ≈ $' + s.refAfter[1] + '/mo (published prices checked Sept 2026; your tier may differ).'));
    $('breakdown').innerHTML = [
      ['Cross-audience duplicates (same email billed again in another audience)', t.crossAudienceDuplicates],
      ['Unsubscribed contacts still billed' + ($('optUnsub').checked ? '' : ' (not archiving)'), t.unsubscribed],
      ['Non-subscribed contacts still billed' + ($('optNon').checked ? '' : ' (not archiving; tick the box to include)'), t.nonsubscribed],
      ['Unique billable people across all audiences', t.uniqueBillable],
      ['Invalid email syntax (worth checking)', t.invalidEmails],
      ['Possible same person with different emails (review only, not counted)', r.review.rows.length]
    ].map(function (x) { return '<tr><td>' + x[0] + '</td><td><b>' + fmt(x[1]) + '</b></td></tr>'; }).join('') + (ref ? '<tr><td colspan="2" class="note">' + esc(ref) + '</td></tr>' : '');
    $('audBody').innerHTML = r.audiences.map(function (a) { var c = a.counts; return '<tr><td>' + esc(a.name) + (a.name === r.primary ? ' <span class="note">(primary)</span>' : '') + '</td><td>' + fmt(c.subscribed) + '</td><td>' + fmt(c.unsubscribed) + '</td><td>' + fmt(c.nonsubscribed) + '</td><td>' + fmt(c.cleaned) + '</td><td><b>' + fmt(a.billable) + '</b></td></tr>'; }).join('');
    $('warns').innerHTML = r.warnings.map(esc).join('<br>');
    renderDownloads();
    if (window.LT_TRACK) window.LT_TRACK('scan', t.billableBefore);
  }
  function outputs() {
    var r = state.result; if (!r) return [];
    var list = r.archiveFiles.map(function (f) { return { label: 'Archive list: ' + f.audience + ' / ' + f.status + ' (' + fmt(f.count) + ')', filename: f.filename, header: f.header, rows: f.rows }; });
    list.push({ label: 'Combined one-audience file with tags (' + fmt(r.master.rows.length) + ')', filename: r.master.filename, header: r.master.header, rows: r.master.rows });
    if (r.review.rows.length) list.push({ label: 'Possible same person, different email (' + fmt(r.review.rows.length) + ')', filename: r.review.filename, header: r.review.header, rows: r.review.rows });
    if (r.invalid.rows.length) list.push({ label: 'Invalid emails (' + fmt(r.invalid.rows.length) + ')', filename: r.invalid.filename, header: r.invalid.header, rows: r.invalid.rows });
    return list;
  }
  function renderDownloads() {
    var pro = !!(state.pro && state.pro.ok), list = outputs();
    $('proState').textContent = pro ? 'Pro unlocked (' + state.pro.payload.p + (state.pro.payload.e < '2090' ? ', valid to ' + state.pro.payload.e : '') + ')' : 'Free preview: first ' + PREVIEW + ' rows of each file. Unlock to download everything.';
    $('licBox').classList.toggle('hidden', pro);
    $('dlBody').innerHTML = list.map(function (o, i) {
      return '<tr><td>' + esc(o.label) + '</td><td><a href="#" data-i="' + i + '" class="dl">' + (pro ? 'Download CSV' : 'Preview (' + Math.min(PREVIEW, o.rows.length) + ' rows)') + '</a>' + (pro ? '' : '<span class="lock">full file: Pro</span>') + '</td></tr>';
    }).join('') || '<tr><td>Nothing to archive. Your audiences look clean.</td></tr>';
    Array.prototype.forEach.call(document.querySelectorAll('.dl'), function (a) { a.onclick = function (e) { e.preventDefault(); download(list[+a.dataset.i], pro); }; });
  }
  function download(o, pro) {
    var rows = pro ? o.rows : o.rows.slice(0, PREVIEW);
    var name = pro ? o.filename : o.filename.replace(/\.csv$/, '__PREVIEW.csv');
    var blob = new Blob(['\ufeff' + ListTrim.toCSV(o.header, rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function unlock(key, quiet) {
    var res = await LTLicense.verifyKey(key);
    if (res.ok && (C.revoked || []).indexOf(res.payload.k) >= 0) res = { ok: false, why: 'This key was revoked. Contact support.' };
    if (res.ok) { state.pro = res; try { localStorage.setItem('lt_key', key.trim()); } catch (e) {} $('licMsg').textContent = ''; }
    else if (!quiet) $('licMsg').textContent = res.why;
    if (state.result) renderDownloads();
    return res;
  }
  function demo() {
    var F = ['Ana','Ben','Chloe','Dev','Eli','Fay','Gus','Hana','Ivan','Jo','Kai','Lena','Max','Nia','Omar','Pia','Raj','Sam','Tess','Uma'], L = ['Smith','Lee','Garcia','Kim','Patel','Nguyen','Brown','Lopez','Khan','Rossi'];
    function person(i) { var f = F[i % F.length], l = L[(i * 7) % L.length]; return [f.toLowerCase() + '.' + l.toLowerCase() + i + '@example.com', f, l]; }
    var H = ['Email Address', 'First Name', 'Last Name', 'MEMBER_RATING', 'LAST_CHANGED', 'LEID', 'EUID', 'TAGS'];
    function rows(a, b, extra) { var out = []; for (var i = a; i < b; i++) { var p = person(i); out.push(p.concat([String(1 + i % 5), '2026-09-01 10:00:00', String(i), 'e' + i, ''])); } return out.concat(extra || []); }
    state.files = [
      { name: 'demo › subscribed_members_export_aa11.csv', audience: 'Newsletter (demo)', status: 'subscribed', headers: H, rows: rows(0, 600) },
      { name: 'demo › unsubscribed_members_export_aa11.csv', audience: 'Newsletter (demo)', status: 'unsubscribed', headers: H.concat(['UNSUB_TIME']), rows: rows(600, 780) },
      { name: 'demo › cleaned_members_export_aa11.csv', audience: 'Newsletter (demo)', status: 'cleaned', headers: H.concat(['CLEAN_TIME']), rows: rows(780, 820) },
      { name: 'demo › subscribed_members_export_bb22.csv', audience: 'Customers (demo)', status: 'subscribed', headers: H, rows: rows(400, 750) },
      { name: 'demo › nonsubscribed_members_export_bb22.csv', audience: 'Customers (demo)', status: 'nonsubscribed', headers: H, rows: rows(900, 1000) }
    ];
    renderFiles();
  }
  function wireBuy() {
    var any = false;
    Array.prototype.forEach.call(document.querySelectorAll('.buy'), function (b) {
      var url = b.dataset.plan === 'agency' ? C.agencyUrl : C.soloUrl;
      if (url) { b.href = url; b.target = '_blank'; b.rel = 'noopener'; any = true; b.addEventListener('click', function () { if (window.LT_TRACK) window.LT_TRACK('buy-click-' + b.dataset.plan); }); }
      else { b.textContent = 'Checkout coming soon'; b.setAttribute('aria-disabled', 'true'); b.onclick = function (e) { e.preventDefault(); }; b.style.opacity = .5; }
    });
    $('billedAs').textContent = any && C.operator ? 'Secure checkout by Stripe. Sold by ' + C.operator + '. Billed as THE PICNIC COLLECTIVE on your card statement. Prices in USD.' : '';
    if (C.supportEmail) $('contact').innerHTML = 'Support: <a href="mailto:' + esc(C.supportEmail) + '">' + esc(C.supportEmail) + '</a>';
  }
  document.addEventListener('DOMContentLoaded', function () {
    var drop = $('drop'), input = $('file');
    drop.onclick = function () { input.click(); };
    drop.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') input.click(); };
    input.onchange = function () { var l = Array.prototype.slice.call(input.files); input.value = ''; addFiles(l); };
    drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = function () { drop.classList.remove('over'); };
    drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); addFiles(Array.prototype.slice.call(e.dataTransfer.files)); };
    $('demo').onclick = function (e) { e.preventDefault(); demo(); };
    $('run').onclick = run;
    $('reset').onclick = function () { state.files = []; state.result = null; renderFiles(); $('results').classList.add('hidden'); };
    $('licBtn').onclick = function () { unlock($('licKey').value); };
    wireBuy();
    var saved = null; try { saved = localStorage.getItem('lt_key'); } catch (e) {}
    if (saved) unlock(saved, true);
  });

  function syncAuditFocus() {
    try {
      document.documentElement.classList.toggle('audit-focus', location.hash === '#audit');
    } catch (e) {}
  }
  syncAuditFocus();
  window.addEventListener('hashchange', syncAuditFocus);

  window.LT_APP = { addFiles: addFiles, run: run, unlock: unlock, state: state, outputs: outputs, demo: demo };
})();
