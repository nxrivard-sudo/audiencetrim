/* ListTrim offline license check. Keys are ECDSA P-256 signatures made with a PRIVATE key kept off the site.
 * Only the PUBLIC verification key ships here, so keys cannot be forged from this file. */
(function (root) {
  'use strict';
  var PUBLIC_JWK = {"kty":"EC","crv":"P-256","x":"h2XZC0RAq5yp1aMem4KGSge9VLUeuJIku0duE6G3TwY","y":"LA_Yy9W3MfOZJCS3KF-6fw2KCajyh9_VM3L8B-PaUqk"}; // public verification key only
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var bin = (typeof atob === 'function') ? atob(s) : Buffer.from(s, 'base64').toString('binary');
    var out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  }
  /* key format: LT1.<base64url(JSON payload)>.<base64url(P-1363 signature)>; payload {p:'SOLO'|'AGENCY', e:'YYYY-MM-DD', k:'id'} */
  async function verifyKey(key, today) {
    try {
      key = String(key || '').trim();
      var parts = key.split('.');
      if (parts.length !== 3 || parts[0] !== 'LT1') return { ok: false, why: 'Key format not recognised.' };
      var subtle = (root.crypto && root.crypto.subtle) || require('crypto').webcrypto.subtle;
      var pub = await subtle.importKey('jwk', PUBLIC_JWK, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      var signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
      var good = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64urlToBytes(parts[2]), signed);
      if (!good) return { ok: false, why: 'Key signature is not valid.' };
      var p = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
      var d = today || new Date().toISOString().slice(0, 10);
      if (p.e && p.e < d) return { ok: false, why: 'Key expired on ' + p.e + '.', payload: p };
      return { ok: true, payload: p };
    } catch (e) { return { ok: false, why: 'Key check failed: ' + e.message }; }
  }
  var api = { verifyKey: verifyKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LTLicense = api;
})(typeof window !== 'undefined' ? window : globalThis);
