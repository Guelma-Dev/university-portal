(function () {
    'use strict';

    const NS = 'pn_cache:';
    const GENERIC_UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

    const AUTH_HOST = 'https://progres.mesrs.dz';
    const API_HOST = 'https://api-webetu.mesrs.dz';
    const BASE = API_HOST + '/api/infos';
    const BUS_HOST = 'https://mybus.mesrs.dz';
    const ONOU_HOST = 'https://gs-api.onou.dz';
    const GS_SECRET = 'pUzHUW2WX54uCzhO8JC2eQ6g1Ol21upw';
    const LIVE_ORIGIN = 'https://university-portal-gv78.onrender.com';

    const DEFAULT_LAT = 36.4627;
    const DEFAULT_LNG = 7.4350;
    const NEARBY_LIMIT = 15;

    const TTL = {
        grades: 15 * 60,
        cards: 30 * 60,
        academic: 30 * 60,
        banner: 3 * 3600,
        wilaya: 12 * 3600,
        residence: 12 * 3600,
        gs: 20 * 3600,
        depots: 60 * 60,
    };

    const STATUS_AR = {
        AVAILABLE: 'متاح',
        SEATED: 'متواجد',
        NOT_AVAILABLE: 'غير متاح',
        IN_SERVICE: 'في الخدمة',
        ON_WAY: 'في الطريق',
        CONFIRMED: 'مؤكد',
        CANCELED: 'ملغي',
        CANCELED_NA: 'ملغي',
    };

    const TRANSPORT_STATUS_MAP = {
        'traitement': 'قيد الدراسة',
        'approuvee': 'مقبولة',
        'noNapprouvee': 'غير مقبولة',
    };

    const QUITUS_KEYS = ['sit_dep', 'sit_bf', 'sit_bc', 'sit_ru', 'sit_brs'];

    const PREF_DEFAULTS = { enabled: false, breakfast: true, lunch: true, dinner: true, depot: null, hour: 5 };

    const PENV = {
        enc: new TextEncoder(),
        dec: new TextDecoder(),
    };

    function active() {
        try {
            return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        } catch (e) {
            return false;
        }
    }

    function platform() {
        try {
            const p = window.Capacitor.getPlatform();
            if (p === 'android' || p === 'ios') return p;
        } catch (e) {}
        return (
            (navigator.userAgent.indexOf('Android') !== -1 && navigator.userAgent.indexOf('Capacitor') !== -1)
                ? 'android'
                : (navigator.userAgent.indexOf('iOS') !== -1 && navigator.userAgent.indexOf('Capacitor') !== -1)
                    ? 'ios'
                    : 'web'
        );
    }

    const PN = (window.PortalNative = window.PortalNative || {});
    PN.active = active();
    PN.platform = platform();
    PN.ready = false;
    PN.authenticate = null;
    PN.release = release;
    PN.ping = ping;

    function _uuidV4() {
        try {
            return (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : _legacyUuid();
        } catch (e) {
            return _legacyUuid();
        }
    }

    function _legacyUuid() {
        let s = '';
        for (let i = 0; i < 32; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
        return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-' + '8ab9'[Math.floor(Math.random() * 4)] + s.slice(17, 20) + '-' + s.slice(20);
    }

    async function _hmacSha256(keyBytes, message) {
        const imp = await window.crypto.subtle.importKey(
            'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const sig = await window.crypto.subtle.sign('HMAC', imp, PENV.enc.encode(message));
        const bytes = new Uint8Array(sig);
        let hex = '';
        for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
        return hex;
    }

    async function _signGs(bodyStr) {
        const ts = String(Math.floor(Date.now() / 1000));
        const nonce = _uuidV4().replace(/-/g, '');
        const secret = PENV.enc.encode(GS_SECRET);
        const sig = await _hmacSha256(secret, ts + '|' + nonce + '|' + bodyStr);
        return { 'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': sig };
    }

    function _jsonCompact(obj) {
        return JSON.stringify(obj, function (k, v) { return v; }, 0)
            .replace(/:\s+/g, ':')
            .replace(/,\s+/g, ',');
    }

    function _b64ToBytes(b64) {
        try {
            const bin = atob(String(b64));
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        } catch (e) {
            return null;
        }
    }

    function _bytesToText(bytes) {
        return PENV.dec.decode(bytes);
    }

    function _bytesToB64(bytes) {
        const CH = 0x8000;
        let s = '';
        if (typeof window !== 'undefined' && window.btoa) {
            for (let i = 0; i < bytes.length; i += CH) {
                s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
            }
            return window.btoa(s);
        }
        return '';
    }

    function _mq(bytes) {
        if (!bytes || bytes.length < 3) return '';
        if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
        return '';
    }

    function _decodeImage(bytes) {
        if (!bytes) return null;
        const direct = _mq(bytes);
        if (direct) return { mime: direct, bytes: bytes };
        const text = _bytesToText(bytes).trim();
        if (!text) return null;
        const decoded = _b64ToBytes(text);
        if (!decoded) return null;
        const mime = _mq(decoded);
        return mime ? { mime: mime, bytes: decoded } : null;
    }

    function _jsonParse(text) {
        if (text === null || text === undefined || text === '') return null;
        try { return JSON.parse(text); } catch (e) { return null; }
    }

    function _jwtClaims(token) {
        if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return {};
        try {
            const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const pad = part + '='.repeat((4 - (part.length % 4)) % 4);
            const raw = decodeURIComponent(escape(atob(pad)));
            const obj = JSON.parse(raw);
            return obj && typeof obj === 'object' ? obj : {};
        } catch (e) {
            return {};
        }
    }

    function _splitFrAr(value) {
        const text = String(value == null ? '' : value).trim();
        if (text.indexOf('#') !== -1) {
            const i = text.indexOf('#');
            return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
        }
        return [text, ''];
    }

    function _asNum(value) {
        try { return Number(value); } catch (e) { return null; }
    }

    function _asFloat(value) {
        const n = _asNum(value);
        return Number.isFinite(n) ? n : null;
    }

    function _asInt(value) {
        const n = _asNum(value);
        return Number.isFinite(n) ? Math.trunc(n) : null;
    }

    function _caps() {
        const C = window.Capacitor;
        if (!C) return null;
        if (C.Plugins && C.Plugins.MinistryHttp) return { ministry: C.Plugins.MinistryHttp };
        return null;
    }

    function _hostOnly(u) {
        try {
            const x = new URL(u);
            return x.host + x.pathname;
        } catch (e) {
            return String(u).slice(0, 120);
        }
    }

    function _errMsg(e) {
        if (!e) return 'unknown';
        const m = e && e.message ? e.message : String(e);
        return String(m).slice(0, 200);
    }

    PN.log = function (rec) {
        try {
            const L = PN.logs || (PN.logs = []);
            if (L.length > 64) L.shift();
            rec.time = new Date().toISOString().slice(11, 23);
            L.push(rec);
            if (window.console && console.log) {
                console.log('[PN]', rec.kind, String(rec.url || ''), '->', rec.status != null ? rec.status : (rec.error || 'ok'));
            }
        } catch (e) {}
    };
    PN.diag = function () {
        return {
            active: active(),
            ready: PN.ready,
            platform: platform(),
            plugs: {
                capacitor: !!window.Capacitor,
                capacitorHttp: !!_capHttp(),
                ministry: !!_caps(),
            },
            logs: (PN.logs || []).slice(-24),
        };
    };

    function _capHttp() {
        const C = window.Capacitor;
        if (!C) return null;
        let http = C.Plugins && C.Plugins.CapacitorHttp;
        if (!http && C.Http) http = C.Http;
        return http || null;
    }

    function _httpFallback(method, url, headers, bodyText) {
        const head = Object.assign({}, headers);
        if (bodyText != null && bodyText !== '') head['Content-Length'] = String(PENV.enc.encode(bodyText).length);
        return fetch(url, { method: method, headers: head, body: bodyText || null }).then(function (r) {
            return r.arrayBuffer().then(function (buf) {
                const bytes = new Uint8Array(buf);
                const mime = _mq(bytes);
                const asImage = mime;
                const text = asImage ? '' : PENV.dec.decode(bytes);
                let ct = asImage || '';
                if (!ct && r.headers) {
                    try {
                        ct = typeof r.headers.get === 'function' ? (r.headers.get('content-type') || '') : (r.headers['content-type'] || '');
                    } catch (e) {}
                }
                return {
                    status: r.status,
                    ct: ct,
                    text: text,
                    bytes: asImage ? bytes : null,
                    raw: bytes,
                };
            });
        }).catch(function (err) {
            PN.log({ kind: 'http-error', url: _hostOnly(url), method: method, status: null, error: _errMsg(err) });
            throw err;
        });
    }

    function _http(method, url, headers, bodyText) {
        const isOnou = String(url).indexOf('gs-api.onou.dz') !== -1;
        const isElearning = String(url).indexOf('elearning.univ-guelma.dz') !== -1;
        const isDspace = /(^|\.)dspace\./.test(String(url));
        const m = _caps();
        if ((isOnou || isElearning || isDspace) && m && typeof m.ministry.relaxed === 'function') {
            PN.log({ kind: 'http', url: _hostOnly(url), method: method, via: 'ministry' });
            return m.ministry.relaxed({
                method: method,
                url: url,
                headers: headers || {},
                body: bodyText != null ? bodyText : '',
            }).then(function (res) {
                const status = (res && res.status) || 0;
                const ct = (res && res.headers && res.headers['content-type']) || '';
                return { status: status, ct: ct, text: (res && res.body) || '', bytes: null };
            }).catch(function (err) {
                PN.log({ kind: 'http-error', url: _hostOnly(url), method: method, via: 'ministry', error: _errMsg(err) });
                throw err;
            });
        }
        const cap = _capHttp();
        if (cap && typeof cap.request === 'function') {
            if (isOnou) PN.log({ kind: 'gs-transport-strict', url: _hostOnly(url), method: method });
            const opt = {
                method: method,
                url: url,
                headers: headers,
                connectTimeout: 30000,
                readTimeout: 45000,
            };
            if (bodyText != null && bodyText !== '') opt.data = bodyText;
            return cap.request(opt).then(function (r) {
                const status = (r && r.status) || 0;
                PN.log({ kind: 'http', url: _hostOnly(url), method: method, status: status });
                if (!status) {
                    PN.log({ kind: 'http-dropped', url: _hostOnly(url), method: method, error: 'CapacitorHttp returned status 0' });
                    return null;
                }
                let data = r && r.data;
                let text = data;
                if (data == null) {
                    text = '';
                } else if (typeof data === 'string') {
                    text = data;
                } else if (typeof data === 'object') {
                    try { text = JSON.stringify(data); } catch (e) { text = String(data); }
                } else {
                    text = String(data);
                }
                let ct = '';
                if (r && r.headers) {
                    const hs = r.headers;
                    if (typeof hs === 'function' && typeof hs.get === 'function') {
                        try { ct = hs.get('content-type') || ''; } catch (e) {}
                    } else if (typeof hs === 'object') {
                        ct = hs['content-type'] || hs['Content-Type'] || hs['contentType'] || ct;
                    }
                }
                return { status: status, ct: ct, text: text, bytes: null };
            }).then(function (res) {
                if (res) return res;
                PN.log({ kind: 'http-fallback', url: _hostOnly(url), method: method });
                return _httpFallback(method, url, headers, bodyText);
            }).catch(function (err) {
                PN.log({ kind: 'http-error', url: _hostOnly(url), method: method, error: _errMsg(err) });
                return _httpFallback(method, url, headers, bodyText);
            });
        }
        return _httpFallback(method, url, headers, bodyText);
    }

    function _httpBinary(method, url, headers, bodyText) {
        const cap = _capHttp();
        if (cap && typeof cap.request === 'function') {
            const opt = {
                method: method,
                url: url,
                headers: headers,
                responseType: 'arraybuffer',
                connectTimeout: 30000,
                readTimeout: 45000,
            };
            if (bodyText != null && bodyText !== '') opt.data = bodyText;
            return cap.request(opt).then(function (r) {
                const status = (r && r.status) || 0;
                PN.log({ kind: 'http', url: _hostOnly(url), method: method, status: status });
                if (!status) return null;
                const raw = _b64ToBytes(r && r.data);
                return { status: status, ct: '', raw: raw };
            }).then(function (res) {
                if (res) return res;
                PN.log({ kind: 'http-fallback', url: _hostOnly(url), method: method, binary: 1 });
                return _httpBinaryFallback(method, url, headers, bodyText);
            }).catch(function (err) {
                PN.log({ kind: 'http-error', url: _hostOnly(url), method: method, error: _errMsg(err) });
                return _httpBinaryFallback(method, url, headers, bodyText);
            });
        }
        return _httpBinaryFallback(method, url, headers, bodyText);
    }

    function _httpBinaryFallback(method, url, headers, bodyText) {
        PN.log({ kind: 'http', url: _hostOnly(url), method: method, via: 'fetch-binary' });
        return fetch(url, { method: method, headers: headers, body: bodyText || null }).then(function (r) {
            return r.arrayBuffer().then(function (buf) {
                return { status: r.status, ct: '', raw: new Uint8Array(buf) };
            });
        }).catch(function (err) {
            PN.log({ kind: 'http-error', url: _hostOnly(url), method: method, binary: 1, error: _errMsg(err) });
            throw err;
        });
    }

    function _resp(status, text, ct, bytes) {
        const ok = status >= 200 && status < 300;
        const bodyText = () => (text != null ? text : (bytes ? _bytesToText(bytes) : ''));
        return {
            ok: ok,
            status: status,
            headers: ct ? { 'content-type': ct } : {},
            json: function () { return Promise.resolve().then(function () { return _jsonParse(bodyText()); }); },
            text: function () { return Promise.resolve(bodyText()); },
            arrayBuffer: function () {
                return Promise.resolve().then(function () {
                    if (bytes) return bytes.buffer.slice(0);
                    return PENV.enc.encode(bodyText()).buffer;
                });
            },
            blob: function () {
                return Promise.resolve().then(function () {
                    if (bytes) return new Blob([bytes.buffer.slice(0)], { type: ct || 'application/octet-stream' });
                    return new Blob([PENV.enc.encode(bodyText())], { type: ct || 'text/plain' });
                });
            },
        };
    }

    function _jsonResp(status, dataObj) {
        let text = '';
        try { text = JSON.stringify(dataObj); } catch (e) { text = String(dataObj); }
        return _resp(status, text, 'application/json; charset=utf-8', null);
    }

    function _errResp(status, msg) {
        return _jsonResp(status, { error: msg });
    }

    function _extraHeaders(token, dia) {
        const claims = _jwtClaims(token);
        const headers = { authorization: token, 'User-Agent': GENERIC_UA, Accept: 'application/json' };
        const ind = claims.idIndividu;
        if (ind != null) headers['x-ind-id'] = String(ind);
        let d = dia;
        if (!d) {
            const dias = String(claims.dias || '').split(',')[0].trim();
            d = dias;
        }
        if (d && String(d).length <= 40) headers['x-dia-id'] = String(d);
        return headers;
    }

    function _cacheGet(key, ttl) {
        try {
            const raw = window.localStorage.getItem(NS + key);
            if (!raw) return null;
            const rec = JSON.parse(raw);
            if (!rec || !rec.t) return null;
            if (ttl && (Date.now() - rec.t) > ttl * 1000) return null;
            return rec.v;
        } catch (e) {
            return null;
        }
    }

    function _cacheSet(key, value) {
        try {
            window.localStorage.setItem(NS + key, JSON.stringify({ t: Date.now(), v: value }));
        } catch (e) {}
    }

    function _cacheDel(key) {
        try { window.localStorage.removeItem(NS + key); } catch (e) {}
    }

    function _session() {
        try {
            const fns = window.getProgresSession;
            if (typeof fns === 'function') return fns() || null;
        } catch (e) {}
        return null;
    }

    function _uuidFromReq(q, body) {
        let u = q.get('uuid') || '';
        if (!u && body && typeof body === 'object' && body.uuid) u = String(body.uuid);
        return u.trim();
    }

    function _diaFromReq(q, body) {
        let d = q.get('dia') || '';
        if (!d && body && typeof body === 'object' && body.dia != null) d = String(body.dia);
        return d.trim();
    }

    async function _upstreamGet(path, token, dia, uuid_retry) {
        const headers = _extraHeaders(token, dia);
        const r = await _http('GET', BASE + path, headers, null);
        if (uuid_retry && r.status === 404) {
            const r2 = await _http('GET', BASE + path + uuid_retry, headers, null);
            return { status: r2.status, text: r2.text };
        }
        return { status: r.status, text: r.text };
    }

    async function _readJson(method, url, headers, bodyText) {
        if (method === 'DELETE') {
            const r = await _http('DELETE', url, headers, bodyText);
            return { status: r.status, text: r.text };
        }
        if (method === 'POST') {
            const h = Object.assign({ 'Content-Type': 'application/json' }, headers);
            const r = await _http('POST', url, h, bodyText);
            return { status: r.status, text: r.text };
        }
        const r = await _http('GET', url, headers, null);
        return { status: r.status, text: r.text };
    }

    function _parseBody(body) {
        return _jsonParse(body);
    }

    function _sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function _proxyApi(path, urlText, init) {
        const qsIdx = urlText.indexOf('?');
        const target = LIVE_ORIGIN + path + (qsIdx !== -1 ? urlText.slice(qsIdx) : '');
        const method = String((init && init.method) || 'GET').toUpperCase();
        const headers = Object.assign({}, (init && init.headers) || {});
        let bodyText = null;
        if (init && init.body != null) {
            if (typeof init.body === 'string') {
                bodyText = init.body;
            } else if (init.body instanceof Uint8Array) {
                bodyText = _bytesToText(init.body);
            } else {
                try { bodyText = JSON.stringify(init.body); } catch (e) { bodyText = null; }
            }
        }
        try {
            if (path.indexOf('/files/') === 0) {
                const r = await _httpBinary(method, target, headers, bodyText);
                return _resp(r.status, '', r.ct || 'application/octet-stream', r.raw);
            }
            const r = await _http(method, target, headers, bodyText);
            if (r.bytes) return _resp(r.status, '', r.ct || 'image/jpeg', r.bytes);
            return _resp(r.status, r.text, r.ct || 'application/json; charset=utf-8', null);
        } catch (e) {
            PN.log({ kind: 'proxy-error', url: _hostOnly(target), method: method, error: _errMsg(e) });
            return _resp(502, JSON.stringify({ error: 'تعذر الاتصال بالخادم، حاول لاحقاً', debug: _errMsg(e) }), 'application/json; charset=utf-8', null);
        }
    }

    const ROUTERS = {};

    ROUTERS.resp = _resp;
    ROUTERS.json = _jsonResp;
    ROUTERS.err = _errResp;

    function _route(reqUrl, init) {
        const url = new URL(reqUrl);
        const p = url.pathname;
        const method = String((init && init.method) || 'GET').toUpperCase();
        let bodyText = null;
        let body = null;
        if (init && init.body) {
            if (typeof init.body === 'string') {
                bodyText = init.body;
                body = _parseBody(init.body);
            } else if (init.body instanceof URLSearchParams) {
                bodyText = init.body.toString();
            }
        }

        if (p === '/api/progres/login' && method === 'POST') {
            return _routeLogin(body, bodyText);
        }
        let m;
        if ((m = /^\/api\/progres\/cards$/.exec(p))) return _routeProgresGet(method, '/bac/{u}/dias', url, 'cards');
        if ((m = /^\/api\/progres\/transcripts\/(\d+)$/.exec(p))) return _routeProgresGet(method, '/bac/{u}/dias/{id}/periode/bilans', url, 'bilans', m[1]);
        if ((m = /^\/api\/progres\/exams\/(\d+)$/.exec(p))) return _routeProgresGet(method, '/planningSession/dia/{id}/noteExamens', url, 'exams', m[1]);
        if ((m = /^\/api\/progres\/cc\/(\d+)$/.exec(p))) return _routeProgresGet(method, '/controleContinue/dia/{id}/notesCC', url, 'cc', m[1]);
        if ((m = /^\/api\/progres\/annual\/(\d+)$/.exec(p))) return _routeProgresGet(method, '/bac/{u}/dia/{id}/annuel/bilan', url, 'annual', m[1]);
        if ((m = /^\/api\/progres\/photo$/.exec(p))) return _routePhoto(url);
        if ((m = /^\/api\/progres\/logo\/(\d+)$/.exec(p))) return _routeLogo(m[1], url);
        if ((m = /^\/api\/progres\/me$/.exec(p))) return _routeMe(url);

        if ((m = /^\/api\/academic\/(quitus|dettes|absences|exclusions|conges|emploi|transport|setram|hebergement|banner)$/.exec(p))) {
            return _routeAcademicGet(m[1], url);
        }
        if (p === '/api/academic/recours' && method === 'POST') return _routeRecours(body);
        if (p === '/api/academic/hebergement-renew' && method === 'POST') return _routeHebergementRenew(body);

        if (p === '/api/onou/context' && method === 'GET') return _routeOnouContext(url);
        if (p === '/api/onou/reservations' && method === 'GET') return _routeOnouReservations(url);
        if (p === '/api/onou/reserve' && method === 'POST') return _routeOnouReserve(body);
        if ((m = /^\/api\/onou\/reservations\/(\d+)$/.exec(p)) && method === 'DELETE') return _routeOnouDelete(m[1], url);
        if (p === '/api/onou/prefs' && method === 'GET') return _routePrefsGet(url);
        if (p === '/api/onou/prefs' && method === 'POST') return _routePrefsSet(body);

        if (p === '/api/bus/nearby' && method === 'GET') return _routeBusNearby(url);
        if (p === '/api/bus/search' && method === 'GET') return _routeBusSearch(url);
        if ((m = /^\/api\/bus\/starts\/(\d+)$/.exec(p)) && method === 'GET') return _routeBusStarts(m[1], url);

        return null;
    }

    async function _routeLogin(body, bodyText) {
        const username = body && typeof body.username === 'string' ? body.username.trim() : '';
        const password = body ? body.password : '';
        if (!username || !password || username.length > 50 || String(password).length > 100 || typeof password !== 'string') {
            return _errResp(400, 'أدخل اسم المستخدم وكلمة المرور');
        }
        try {
            const r = await _http('POST', AUTH_HOST + '/api/authentication/v1/', {
                'Content-Type': 'application/json',
                'User-Agent': GENERIC_UA,
                Accept: 'application/json',
                'Connection': 'close',
            }, JSON.stringify({ username: username, password: password }));
            if (r.status === 200) {
                const data = _parseBody(r.text);
                if (data && data.token && data.uuid) {
                    _cacheDel('gs:' + data.uuid);
                    _cacheDel('wilaya:' + data.uuid);
                    _cacheDel('residence:' + data.uuid);
                }
                return _resp(r.status, r.text, 'application/json; charset=utf-8', r.bytes);
            }
            if (r.status === 400 || r.status === 401) {
                return _resp(r.status, r.text, 'application/json; charset=utf-8', r.bytes);
            }
            if (!r.status) {
                PN.log({ kind: 'login-failed', error: 'upstream status 0' });
                return _jsonResp(502, { error: 'تعذر الاتصال بخوادم الوزارة، تحقق من الإنترنت', debug: 'upstream status 0' });
            }
            PN.log({ kind: 'login-failed', error: 'upstream status ' + r.status, url: _hostOnly(AUTH_HOST) });
            return _jsonResp(502, { error: 'خوادم الوزارة غير متاحة حالياً — حاول بعد قليل', debug: 'upstream status ' + r.status });
        } catch (e) {
            PN.log({ kind: 'login-failed', error: _errMsg(e), url: _hostOnly(AUTH_HOST) });
            return _jsonResp(502, { error: 'تعذر الاتصال بخوادم الوزارة، تحقق من الإنترنت', debug: _errMsg(e) });
        }
    }

    async function _routeProgresGet(method, pattern, url, kind, id) {
        if (method !== 'GET') return _errResp(405, 'method not allowed');
        const session = _session();
        if (!session || !session.uuid) return _errResp(401, 'جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول');
        const uuid = String(session.uuid);
        const token = String(session.token || '');
        if (!token) return _errResp(401, 'جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول');
        const claims = _jwtClaims(token);
        const firstDia = String(claims.dias || '').split(',')[0].trim();
        const cacheKey = kind + ':' + uuid + (id ? ':' + id : '');
        const cached = _cacheGet(cacheKey, kind === 'cards' ? TTL.cards : TTL.grades);
        if (cached) return _resp(200, JSON.stringify(cached), 'application/json; charset=utf-8', null);
        const path = pattern.replace('{u}', encodeURIComponent(uuid)).replace('{id}', String(id));
        try {
            const r = await _upstreamGet(path, token, firstDia);
            if (r.status === 401) return _errResp(401, 'انتهت صلاحية جلسة الوزارة، أعد تسجيل الدخول');
            if (r.status !== 200) return _errResp(r.status === 404 ? 404 : 502, r.status === 404 ? 'لا توجد بيانات متوفرة' : 'تعذر جلب البيانات من خوادم الوزارة، حاول لاحقاً');
            const data = _parseBody(r.text);
            if (data === null) return _errResp(502, 'استجابة غير صالحة من خوادم الوزارة');
            _cacheSet(cacheKey, data);
            return _resp(200, JSON.stringify(data), 'application/json; charset=utf-8', null);
        } catch (e) {
            return _errResp(502, 'خوادم الوزارة غير متاحة حالياً، حاول لاحقاً');
        }
    }

    async function _routeMe(url) {
        const session = _session();
        if (!session || !session.uuid) return _errResp(401, 'جلسة غير صالحة');
        const r = await _http('GET', BASE + '/bac/' + encodeURIComponent(session.uuid) + '/individu', _extraHeaders(session.token || ''), null);
        return _resp(r.status, r.text, 'application/json; charset=utf-8', r.bytes);
    }

    async function _routePhoto(url) {
        const session = _session();
        if (!session || !session.uuid) return _errResp(401, 'طلب غير صالح');
        try {
            const r = await _httpBinary('GET', AUTH_HOST + '/api/infos/image/' + encodeURIComponent(session.uuid), {
                authorization: String(session.token || ''),
                'User-Agent': GENERIC_UA,
            }, null);
            if (r.status !== 200) return _errResp(404, 'غير متوفر');
            const img = _decodeImage(r.raw);
            if (!img) return _errResp(404, 'غير متوفر');
            return _resp(200, '', img.mime, img.bytes);
        } catch (e) {
            return _errResp(502, 'خوادم الوزارة غير متاحة حالياً');
        }
    }

    async function _routeLogo(etabId, url) {
        const session = _session();
        if (!session) return _errResp(401, 'طلب غير صالح');
        try {
            const r = await _httpBinary('GET', AUTH_HOST + '/api/infos/logoEtablissement/' + etabId, {
                authorization: String(session.token || ''),
                'User-Agent': GENERIC_UA,
            }, null);
            if (r.status !== 200) return _errResp(404, 'غير متوفر');
            const img = _decodeImage(r.raw) || { mime: 'image/png', bytes: r.raw };
            return _resp(200, '', img.mime, img.bytes);
        } catch (e) {
            return _errResp(502, 'خوادم الوزارة غير متاحة حالياً');
        }
    }

    async function _routeAcademicGet(route, url) {
        const session = _session();
        if (!session || !session.uuid) return _errResp(401, 'جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول');
        const uuid = String(session.uuid);
        const token = String(session.token || '');
        if (!token) return _errResp(401, 'جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول');
        const dia = (url.searchParams.get('dia') || '').trim();
        const cacheKey = 'acad:' + uuid + ':' + route + ':' + dia;
        const cached = _cacheGet(cacheKey, route === 'banner' ? TTL.banner : TTL.academic);
        if (cached) return _resp(200, JSON.stringify(cached), 'application/json; charset=utf-8', null);

        let path;
        if (route === 'quitus') path = '/bac/' + encodeURIComponent(uuid) + '/quitus';
        else if (route === 'dettes') path = '/dettes/' + encodeURIComponent(uuid);
        else if (route === 'absences') path = '/bac/' + encodeURIComponent(uuid) + '/absences';
        else if (route === 'exclusions') path = '/bac/' + encodeURIComponent(uuid) + '/exclusions';
        else if (route === 'conges') path = '/bac/' + encodeURIComponent(uuid) + '/conges';
        else if (route === 'emploi') path = '/seanceEmploi/inscription/' + encodeURIComponent(dia);
        else if (route === 'transport') path = '/demandeTransport/' + encodeURIComponent(uuid) + '/' + encodeURIComponent(dia);
        else if (route === 'setram') path = '/getCardeTransportSetram/' + encodeURIComponent(uuid) + '/' + encodeURIComponent(dia);
        else if (route === 'hebergement') path = '/bac/' + encodeURIComponent(uuid) + '/demandesHebregement';
        else if (route === 'banner') path = '/bannerInformations';
        else return _errResp(404, 'لا يوجد');

        if (['emploi', 'transport', 'setram'].indexOf(route) !== -1 && !dia) return _errResp(400, 'dia مطلوب');

        try {
            const retrySuffix = route === 'banner' ? null : '/' + encodeURIComponent(uuid);
            const r = await _upstreamGet(path, token, dia, retrySuffix);
            if (r.status === 401) return _errResp(401, 'انتهت صلاحية جلسة الوزارة، أعد تسجيل الدخول');
            if (r.status === 404) return _errResp(404, 'لا توجد بيانات متوفرة');
            if (r.status !== 200) return _errResp(502, 'تعذر جلب البيانات من خوادم الوزارة، حاول لاحقاً');
            let data = _parseBody(r.text);
            if (data === null) return _errResp(502, 'استجابة غير صالحة من خوادم الوزارة');
            if (route === 'quitus' && data && typeof data === 'object' && !Array.isArray(data)) {
                let valid = 0;
                for (let i = 0; i < QUITUS_KEYS.length; i++) {
                    const item = data[QUITUS_KEYS[i]];
                    if (item && typeof item === 'object' && String(item.statut || '').toLowerCase() === 'validee') valid++;
                }
                data.completion = { valid: valid, total: QUITUS_KEYS.length, percent: Math.round(valid * 100 / QUITUS_KEYS.length) };
            } else if (route === 'dettes' && Array.isArray(data)) {
                data = data.filter(Boolean);
            } else if (route === 'conges') {
                const items = Array.isArray(data) ? data : [];
                let validee = 0;
                for (let i = 0; i < items.length; i++) {
                    if (items[i] && typeof items[i] === 'object' && String(items[i].statut || '').toLowerCase() === 'validee') validee++;
                }
                data = { items: items, summary: { validee: validee, nonValidee: items.length - validee } };
            } else if (route === 'transport' && data && typeof data === 'object') {
                const st = data.statut || data.traitement;
                if (typeof st === 'string') data.statusLabel = TRANSPORT_STATUS_MAP[st.toLowerCase()] || st;
                data.statusMap = TRANSPORT_STATUS_MAP;
            }
            _cacheSet(cacheKey, data);
            return _resp(200, JSON.stringify(data), 'application/json; charset=utf-8', null);
        } catch (e) {
            return _errResp(502, 'خوادم الوزارة غير متاحة حالياً، حاول لاحقاً');
        }
    }

    async function _routeRecours(body) {
        const session = _session();
        if (!session || !session.uuid) return _errResp(401, 'جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول');
        const uuid = String(session.uuid);
        const token = String(session.token || '');
        if (!token) return _errResp(401, 'جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول');
        if (!body || typeof body !== 'object') return _errResp(400, 'بيانات غير صحيحة');
        const dia = String((body.dia || body.dia == null ? '' : body.dia) || '').trim();
        const mcId = body.mcId;
        const motif = body.motif;
        const kind = body.kind;
        if (!dia || String(dia).length > 40) return _errResp(400, 'dia مطلوب');
        if (typeof mcId !== 'number' || typeof mcId === 'boolean' || !Number.isInteger(mcId)) return _errResp(400, 'mcId يجب أن يكون رقماً صحيحاً');
        if (motif !== 1 && motif !== 2) return _errResp(400, 'motif يقبل القيمة 1 أو 2 فقط');
        if (kind !== 'exam' && kind !== 'cc') return _errResp(400, "kind يقبل القيمة 'exam' أو 'cc' فقط");
        const seg = kind === 'exam' ? 'noteExamens' : 'noteCC';
        const path = '/api/infos/' + seg + '/dia/' + encodeURIComponent(dia) + '/' + String(mcId) + '/recours/' + String(motif);
        try {
            const r = await _http('POST', API_HOST + path, _extraHeaders(token, dia), null);
            return _resp(r.status, r.text, 'text/plain', null);
        } catch (e) {
            return _errResp(502, 'خوادم الوزارة غير متاحة حالياً، حاول لاحقاً');
        }
    }

    async function _routeHebergementRenew(body) {
        const session = _session();
        if (!session || !session.uuid) return _errResp(401, 'جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول');
        const uuid = String(session.uuid);
        const token = String(session.token || '');
        if (!token) return _errResp(401, 'جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول');
        if (!body || typeof body !== 'object') return _errResp(400, 'بيانات غير صحيحة');
        const residenceId = String(body.residenceId || '').trim();
        if (!/^\d+$/.test(residenceId) || residenceId.length > 20) return _errResp(400, 'residenceId غير صالح');
        const path = '/api/infos/demanderRenouvellementHebregement/' + encodeURIComponent(uuid) + '/' + residenceId;
        try {
            const r = await _http('POST', API_HOST + path, _extraHeaders(token), null);
            return _resp(r.status, r.text, 'text/plain', null);
        } catch (e) {
            return _errResp(502, 'خوادم الوزارة غير متاحة حالياً، حاول لاحقاً');
        }
    }

    async function _resolveWilaya(token, dia) {
        const cacheKey = 'wilaya:' + dia;
        const cached = _cacheGet(cacheKey, TTL.wilaya);
        if (cached != null) return cached;
        const r = await _upstreamGet('/wilayaInscription/' + encodeURIComponent(dia), token, dia);
        if (r.status !== 200) throw new Error('wilaya-fetch-failed');
        const data = _parseBody(r.text);
        let wilaya;
        if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                const item = data[i];
                if (item && typeof item === 'object') {
                    for (let ki = 0; ki < ['idWilaya', 'wilaya', 'idWillaya', 'codeWilaya', 'code', 'id'].length; ki++) {
                        const v = item[['idWilaya', 'wilaya', 'idWillaya', 'codeWilaya', 'code', 'id'][ki]];
                        if (v != null) { wilaya = v; break; }
                    }
                    if (wilaya != null) break;
                }
            }
        } else if (data && typeof data === 'object') {
            for (let ki = 0; ki < ['idWilaya', 'wilaya', 'idWillaya', 'codeWilaya', 'code', 'id'].length; ki++) {
                const v = data[['idWilaya', 'wilaya', 'idWillaya', 'codeWilaya', 'code', 'id'][ki]];
                if (v != null) { wilaya = v; break; }
            }
        } else if (data != null) {
            wilaya = data;
        }
        if (wilaya == null) throw new Error('تعذر تحديد ولاية الإقامة');
        _cacheSet(cacheKey, wilaya);
        return wilaya;
    }

    async function _resolveResidence(u, token, given) {
        if (given) return given;
        const cacheKey = 'residence:' + u;
        const cached = _cacheGet(cacheKey, TTL.residence);
        if (cached != null) return cached;
        const r = await _upstreamGet('/bac/' + encodeURIComponent(u) + '/demandesHebregement', token, u);
        if (r.status !== 200) throw new Error('residence-fetch-failed');
        let data = _parseBody(r.text);
        if (!Array.isArray(data)) data = data && typeof data === 'object' ? [data] : [];
        const year = String(new Date().getFullYear());
        let picked = null;
        for (let i = 0; i < data.length; i++) {
            const item = data[i];
            if (item && typeof item === 'object' && year !== '' && String(item.idAnneeAcademique || '').indexOf(year) !== -1) {
                picked = item;
                break;
            }
        }
        if (!picked && data.length && data[0] && typeof data[0] === 'object') picked = data[0];
        const res = picked && picked.idResidance != null ? picked.idResidance : null;
        if (res == null) throw new Error('تعذر تحديد مكان الإقامة');
        _cacheSet(cacheKey, res);
        return res;
    }

    async function _gsMethod(method, path, gsToken, body, params) {
        const bodyStr = body != null ? _jsonCompact(body) : '';
        const attempt = async (headers) => {
            let url = ONOU_HOST + path + (params ? '?' + Object.keys(params).map(function (k) {
                return encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]));
            }).join('&') : '');
            const r = await _http(method, url, headers, body != null ? bodyStr : null);
            if (!r || !r.status) throw new Error('تعذر الوصول لخدمة الوجبات');
            if (r.status >= 500) {
                const snip = String(r.text || '').replace(/\s+/g, ' ').slice(0, 140);
                throw new Error('gs-' + r.status + (snip ? ' :: ' + snip : ''));
            }
            return { status: r.status, text: r.text || '' };
        };
        let headers = await (async function () {
            const sign = await _signGs(bodyStr);
            const h = {
                'X-Timestamp': sign['X-Timestamp'],
                'X-Nonce': sign['X-Nonce'],
                'X-Signature': sign['X-Signature'],
                'User-Agent': GENERIC_UA,
                Accept: 'application/json',
            };
            if (gsToken) h.authorization = 'Bearer ' + gsToken;
            if (body != null) h['Content-Type'] = 'application/json';
            return h;
        })();
        try {
            return await attempt(headers);
        } catch (e) {
            PN.log({ kind: 'gs-transient', path: path, error: _errMsg(e) });
            await _sleep(400);
            const again = await _signGs(bodyStr);
            headers['X-Timestamp'] = again['X-Timestamp'];
            headers['X-Nonce'] = again['X-Nonce'];
            headers['X-Signature'] = again['X-Signature'];
            return attempt(headers);
        }
    }

    async function _getGsToken(u, token, wilaya, residence) {
        const cacheKey = 'gs:' + u;
        const cached = _cacheGet(cacheKey, TTL.gs);
        if (cached && cached.token) return cached.token;
        const r = await _gsMethod('POST', '/api/loginpwebetu', null, {
            uuid: u, wilaya: wilaya, residence: residence, token: token,
        });
        if (r.status >= 400) {
            throw new Error('خطأ من خدمة الوجبات (' + r.status + ')');
        }
        const data = _parseBody(r.text);
        const gs = data && data.token ? data.token : null;
        if (!gs) throw new Error('تعذر تسجيل الدخول إلى خدمة الوجبات');
        _cacheSet(cacheKey, { token: gs });
        return gs;
    }

    async function _buildCtx(u, dia, residence) {
        const session = _session();
        if (!session || !session.token) throw new Error('session-expired');
        const token = String(session.token);
        const claims = _jwtClaims(token);
        const firstDia = String(claims.dias || '').split(',')[0].trim();
        dia = String(dia || '').trim() || firstDia;
        if (!dia) throw new Error('تعذر تحديد رقم التسجيل (dia)', 400);
        const wilaya = await _resolveWilaya(token, dia);
        const res = await _resolveResidence(u, token, residence);
        const gs = await _getGsToken(u, token, wilaya, res);
        return { u: u, token: token, gs: gs, dia: dia, wilaya: wilaya, residence: res };
    }

    async function _fetchDepots(ctx) {
        const r = await _gsMethod('GET', '/api/getdepotres', ctx.gs, null, {
            uuid: ctx.u, wilaya: ctx.wilaya, residence: ctx.residence, token: ctx.gs,
        });
        if (r.status >= 400) throw new Error('خطأ من خدمة الوجبات (' + r.status + ')');
        let data = _parseBody(r.text);
        if (data && typeof data === 'object' && Array.isArray(data.depots)) data = data.depots;
        else if (!Array.isArray(data)) data = [];
        return data;
    }

    function _toErrorText(status) {
        return status === 401
            ? 'انتهت صلاحية جلسة الوزارة، أعد تسجيل الدخول'
            : 'خوادم الوزارة غير متاحة حالياً، حاول لاحقاً';
    }

    async function _routeOnouContext(url) {
        const u = _uuidFromReq(url.searchParams, null);
        if (!u) return _errResp(400, 'uuid مطلوب');
        const dia = (url.searchParams.get('dia') || '').trim();
        const residence = (url.searchParams.get('residence') || '').trim() || null;
        try {
            let ctx = await _buildCtx(u, dia, residence);
            const cacheKey = 'depots:' + u + ':' + ctx.wilaya + ':' + ctx.residence;
            let depots = _cacheGet(cacheKey, TTL.depots);
            if (depots == null) {
                try {
                    depots = await _fetchDepots(ctx);
                } catch (e) {
                    _cacheDel('gs:' + u);
                    ctx = await _buildCtx(u, dia, residence);
                    depots = await _fetchDepots(ctx);
                }
                if (depots && depots.length) _cacheSet(cacheKey, depots);
            }
            return _jsonResp(200, {
                wilaya: ctx.wilaya,
                residence: ctx.residence,
                dia: ctx.dia,
                depots: depots || [],
            });
        } catch (e) {
            return _errResp(_session() ? 502 : 401, e && e.message ? e.message : 'خدمة الوجبات غير متاحة حالياً');
        }
    }

    function _normalizeReservations(items) {
        const out = [];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!it || typeof it !== 'object') continue;
            out.push({
                id: it.id,
                date_reserve: it.date_reserve,
                mealtype_fr: it.mealtype_fr,
                idDepot: it.idDepot,
                depot_fr: it.depot_fr,
                candelete: it.candelete != null ? it.candelete : it.canDelete,
            });
        }
        return out;
    }

    async function _fetchReservations(ctx, page) {
        const r = await _gsMethod('GET', '/api/meal-reservations/student', ctx.gs, null, {
            uuid: ctx.u, wilaya: ctx.wilaya, residence: ctx.residence, token: ctx.gs, page: String(page || 1),
        });
        if (r.status >= 400) throw new Error('خطأ من خدمة الوجبات (' + r.status + ')');
        let data = _parseBody(r.text);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            const inner = data.data;
            if (inner && typeof inner === 'object') {
                if (Array.isArray(inner.data)) data = inner.data;
                else if (Array.isArray(inner)) data = inner;
                else data = [];
            } else if (Array.isArray(inner)) {
                data = inner;
            } else {
                data = [];
            }
        }
        return Array.isArray(data) ? data : [];
    }

    async function _routeOnouReservations(url) {
        const u = _uuidFromReq(url.searchParams, null);
        if (!u) return _errResp(400, 'uuid مطلوب');
        const dia = (url.searchParams.get('dia') || '').trim();
        try {
            let ctx = await _buildCtx(u, dia, null);
            try {
                return _jsonResp(200, _normalizeReservations(await _fetchReservations(ctx, 1)));
            } catch (e) {
                _cacheDel('gs:' + u);
                ctx = await _buildCtx(u, dia, null);
                return _jsonResp(200, _normalizeReservations(await _fetchReservations(ctx, 1)));
            }
        } catch (e) {
            return _errResp(_session() ? 502 : 401, e && e.message ? e.message : 'خدمة الوجبات غير متاحة حالياً');
        }
    }

    async function _routeOnouReserve(body) {
        if (!body || typeof body !== 'object') return _errResp(400, 'بيانات غير صحيحة');
        const u = String(body.uuid || '').trim();
        if (!u) return _errResp(400, 'uuid مطلوب');
        let menu_type;
        try { menu_type = parseInt(body.menu_type, 10); } catch (e) { menu_type = NaN; }
        if (menu_type !== 1 && menu_type !== 2 && menu_type !== 3) return _errResp(400, 'نوع الوجبة غير صحيح');
        const depot = body.idDepot;
        const dates = body.dates;
        if (depot == null || !Array.isArray(dates) || !dates.length) return _errResp(400, 'بيانات الحجز ناقصة');
        const cleanDates = [];
        for (let i = 0; i < dates.length; i++) {
            const s = String(dates[i]).trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return _errResp(400, 'صيغة تاريخ غير صالحة');
            cleanDates.push(s);
        }
        const dia = body.dia != null ? String(body.dia) : '';
        try {
            const ctx = await _buildCtx(u, dia, body.residence != null ? String(body.residence) : null);
            const details = cleanDates.map(function (d) {
                return _jsonCompact({ date_reserve: d, menu_type: menu_type, idDepot: depot });
            });
            const r = await _gsMethod('POST', '/api/reservemeal', ctx.gs, {
                uuid: u, wilaya: ctx.wilaya, residence: ctx.residence, token: ctx.gs, details: details,
            }, null);
            if (r.status >= 400) return _errResp(502, 'تعذر إتمام الحجز، حاول لاحقاً');
            const data = _parseBody(r.text);
            if (data != null) return _resp(r.status, JSON.stringify(data), 'application/json; charset=utf-8', null);
            return _resp(r.status, r.text, 'application/json; charset=utf-8', null);
        } catch (e) {
            return _errResp(_session() ? 502 : 401, e && e.message ? e.message : 'خدمة الوجبات غير متاحة حالياً');
        }
    }

    async function _routeOnouDelete(rid, url) {
        const u = _uuidFromReq(url.searchParams, null);
        if (!u) return _errResp(400, 'uuid مطلوب');
        const dia = (url.searchParams.get('dia') || '').trim();
        try {
            const ctx = await _buildCtx(u, dia, null);
            const r = await _gsMethod('DELETE', '/api/reservemeal/' + String(rid), ctx.gs, {
                uuid: u, wilaya: ctx.wilaya, residence: ctx.residence, token: ctx.gs,
            }, null);
            if (r.status >= 400) return _errResp(502, 'تعذر إلغاء الحجز، حاول لاحقاً');
            const data = _parseBody(r.text);
            if (data != null) return _resp(r.status, JSON.stringify(data), 'application/json; charset=utf-8', null);
            return _resp(r.status, r.text, 'application/json; charset=utf-8', null);
        } catch (e) {
            return _errResp(_session() ? 502 : 401, e && e.message ? e.message : 'خدمة الوجبات غير متاحة حالياً');
        }
    }

    function _prefsKey(u) { return 'onou_prefs:' + u; }

    function _routePrefsGet(url) {
        const u = _uuidFromReq(url.searchParams, null);
        if (!u) return _errResp(400, 'uuid مطلوب');
        let prefs;
        try {
            const raw = window.localStorage.getItem(_prefsKey(u));
            prefs = raw ? Object.assign({}, PREF_DEFAULTS, JSON.parse(raw)) : Object.assign({}, PREF_DEFAULTS);
        } catch (e) {
            prefs = Object.assign({}, PREF_DEFAULTS);
        }
        prefs.uuid = u;
        return _jsonResp(200, prefs);
    }

    function _routePrefsSet(body) {
        if (!body || typeof body !== 'object') return _errResp(400, 'بيانات غير صحيحة');
        const u = String(body.uuid || '').trim();
        if (!u) return _errResp(400, 'uuid مطلوب');
        const depot = body.depot;
        const hourRaw = body.hour == null ? 5 : body.hour;
        let hour;
        try { hour = parseInt(hourRaw, 10); } catch (e) { hour = NaN; }
        if (!isFinite(hour) || hour < 0 || hour > 23) return _errResp(400, 'الساعة يجب أن تكون بين 0 و 23');
        const prefs = {
            enabled: !!body.enabled,
            breakfast: !!body.breakfast,
            lunch: !!body.lunch,
            dinner: !!body.dinner,
            depot: depot == null || depot === '' ? null : depot,
            hour: hour,
        };
        try {
            window.localStorage.setItem(_prefsKey(u), JSON.stringify(prefs));
        } catch (e) {}
        return _jsonResp(200, { message: 'تم حفظ تفضيلات الحجز التلقائي' });
    }

    function _normalizeLine(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var fr, ar;
        const n = _splitFrAr(raw.name_fr);
        fr = n[0];
        ar = n[1];
        if (!ar) ar = String(raw.name_ar || '').trim();
        const st = _splitFrAr(raw.start);
        const en = _splitFrAr(raw.end);
        return {
            id: raw.id,
            name_fr: fr,
            name_ar: ar,
            start_fr: st[0],
            start_ar: st[1],
            end_fr: en[0],
            end_ar: en[1],
            agency_name: String(raw.agency_name || '').trim(),
            distance_m: _asFloat(raw.distance),
            lat: _asFloat(raw.lat),
            lng: _asFloat(raw.lng),
        };
    }

    function _extractLines(payload) {
        let rows;
        if (payload && typeof payload === 'object') {
            rows = payload.data;
        } else if (Array.isArray(payload)) {
            rows = payload;
        } else {
            rows = null;
        }
        if (!Array.isArray(rows)) throw new Error('unexpected payload');
        const lines = [];
        for (let i = 0; i < rows.length; i++) {
            const L = _normalizeLine(rows[i]);
            if (L) lines.push(L);
        }
        lines.sort(function (a, b) {
            if (a.distance_m == null && b.distance_m == null) return 0;
            if (a.distance_m == null) return 1;
            if (b.distance_m == null) return -1;
            return a.distance_m - b.distance_m;
        });
        return lines;
    }

    function _normalizeStop(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const n = _splitFrAr(raw.name_fr);
        let ar = n[1];
        if (!ar) ar = String(raw.name_ar || '').trim();
        return { name_fr: n[0], name_ar: ar, is_station: !!raw.is_station };
    }

    function _normalizeDeparture(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const statusRaw = String(raw.status || '').trim().toLowerCase();
        const stops = [];
        for (let i = 0; i < (raw.stops || []).length; i++) {
            const s = _normalizeStop(raw.stops[i]);
            if (s) stops.push(s);
        }
        return {
            time: String(raw.time || '').trim(),
            bus: String(raw.bus || '').trim(),
            status: raw.status,
            status_ar: STATUS_AR[statusRaw] != null ? STATUS_AR[statusRaw] : String(raw.status || '').trim(),
            stops: stops,
        };
    }

    async function _busGet(path, q) {
        const params = q.size ? q : null;
        const url = BUS_HOST + path + (params ? '?' + params.toString() : '');
        const r = await _http('GET', url, { 'User-Agent': GENERIC_UA, Accept: 'application/json' }, null);
        if (r.status !== 200) throw new Error('bus-http-' + r.status);
        const data = _parseBody(r.text);
        if (data === null) throw new Error('bus-invalid');
        return data;
    }

    async function _routeBusNearby(url) {
        let lat = DEFAULT_LAT;
        let lng = DEFAULT_LNG;
        const latRaw = (url.searchParams.get('lat') || '').trim();
        const lngRaw = (url.searchParams.get('lng') || '').trim();
        if (latRaw || lngRaw) {
            const la = Number(latRaw);
            const ln = Number(lngRaw);
            if (!isFinite(la) || !isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
                return _errResp(400, 'إحداثيات غير صحيحة');
            }
            lat = la;
            lng = ln;
        }
        try {
            const payload = await _busGet('/api/nearby-lines', new URLSearchParams({ lat: String(lat), lng: String(lng) }));
            return _jsonResp(200, { data: _extractLines(payload).slice(0, NEARBY_LIMIT) });
        } catch (e) {
            return _errResp(502, 'خوادم النقل غير متاحة حالياً، حاول لاحقاً');
        }
    }

    async function _routeBusSearch(url) {
        const q = (url.searchParams.get('q') || '').trim();
        if (q.length < 2 || q.length > 60) return _errResp(400, 'أدخل كلمة بحث بين حرفين وستين حرفاً');
        try {
            const payload = await _busGet('/api/searchlines/' + encodeURIComponent(q), new URLSearchParams());
            return _jsonResp(200, { data: _extractLines(payload) });
        } catch (e) {
            return _errResp(502, 'خوادم النقل غير متاحة حالياً، حاول لاحقاً');
        }
    }

    async function _routeBusStarts(lineId, url) {
        let page = 1;
        const pageRaw = url.searchParams.get('page');
        if (pageRaw != null) {
            page = parseInt(pageRaw, 10);
            if (!isFinite(page)) return _errResp(400, 'رقم صفحة غير صالح');
            if (page < 1) page = 1;
        }
        try {
            const payload = await _busGet('/api/starts/' + String(lineId), new URLSearchParams({ page: String(page) }));
            let body = payload && payload.data && typeof payload.data === 'object' ? payload.data : {};
            let rows = body.data;
            let meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
            if (!Array.isArray(rows)) rows = [];
            const departures = [];
            for (let i = 0; i < rows.length; i++) {
                const d = _normalizeDeparture(rows[i]);
                if (d) departures.push(d);
            }
            const cur = _asInt(meta.current_page);
            const last = _asInt(meta.last_page);
            const per = _asInt(meta.per_page);
            return _jsonResp(200, {
                data: departures,
                meta: {
                    current_page: cur != null ? cur : page,
                    last_page: last != null ? last : page,
                    per_page: per != null ? per : null,
                },
            });
        } catch (e) {
            return _errResp(502, 'خوادم النقل غير متاحة حالياً، حاول لاحقاً');
        }
    }

    let authResolve;
    let authPromise;
    let authDone = false;

    function auth() {
        const na = active();
        if (na) {
            PN.active = na;
            PN.platform = platform();
        }
        if (!na) return Promise.resolve(false);
        if (authDone) return Promise.resolve(PN.ready);
        if (authPromise) return authPromise;
        authPromise = new Promise(function (resolve) {
            authResolve = resolve;
            _authenticate();
        });
        return authPromise;
    }

    function _finish(ok) {
        PN.ready = ok;
        authDone = true;
        if (authResolve) {
            authResolve(ok);
            authResolve = null;
        }
    }

    async function _authenticate() {
        if (!active()) {
            _finish(false);
            return;
        }
        const cap = window.Capacitor;
        const okFn = cap && cap.Plugins && cap.Plugins.SplashScreen && cap.Plugins.SplashScreen.hide
            ? function () {
                try { cap.Plugins.SplashScreen.hide(); } catch (e) {}
            }
            : null;
        await ping();
        if (okFn) okFn();
        _finish(true);
    }

    async function ping() {
        const session = _session();
        if (!session || !session.token) return true;
        const cap = _capHttp();
        const A = AUTH_HOST;
        const ok = function (r) { return r && r.status != null; };
        for (let attempt = 0; attempt < 3; attempt++) {
            let success = false;
            try {
                if (cap && typeof cap.request === 'function') {
                    const r = await cap.request({
                        method: 'GET',
                        url: A + '/api/infos/image/null',
                        headers: { authorization: String(session.token), 'User-Agent': GENERIC_UA },
                        connectTimeout: 8000,
                        readTimeout: 8000,
                    });
                    success = ok(r);
                } else {
                    const r = await fetch(A + '/api/infos/image/null', { headers: { authorization: String(session.token) } });
                    success = !!r;
                }
            } catch (e) {
                success = false;
            }
            if (success) return true;
            await new Promise(function (r) { setTimeout(r, 1200); });
        }
        return false;
    }

    function release(prepFn) {
        PN.activate = function () {};
        if (typeof prepFn === 'function') {
            try { prepFn(); } catch (e) {}
        }
    }

    auth();
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', function () {
            auth();
        }, { once: true });
    }
    PN.authenticate = auth;

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        window.fetch = function (input, init) {
            let urlText;
            try {
                urlText = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
                if (urlText.charAt(0) === '/') urlText = window.location.origin + urlText;
                new URL(urlText);
            } catch (e) {
                return originalFetch(input, init);
            }
            const isLocal = (function () {
                try { return new URL(urlText).origin === window.location.origin; } catch (e) { return false; }
            })();
            if (!active() || !isLocal) return originalFetch(input, init);
            let p;
            try { p = new URL(urlText).pathname; } catch (e) {
                return originalFetch(input, init);
            }
            if (!/^\/api\/(progres|academic|onou|bus)\//.test(p)) {
                if (/^\/api\//.test(p)) {
                    return _proxyApi(p, urlText, init || {});
                }
                return originalFetch(input, init);
            }
            return auth().then(function () {
                if (!PN.ready) return originalFetch(input, init);
                try {
                    const routed = _route(urlText, init || {});
                    if (routed) return routed;
                } catch (e) {}
                return originalFetch(input, init);
            });
        };
    }

    // ============================================
    // E-LEARNING LIBRARY — Moodle Master-Token Bridge
    // ============================================
    const MOODLE_BASE = 'https://elearning.univ-guelma.dz/webservice/rest/server.php';
    // Master web-service token of the university's Moodle platform.
    // Fetches public course catalog + resources. While it stays at the
    // placeholder the library runs on bundled mock data for testing.
    // NOTE: embedded token = anyone with the APK can read what this account
    // can read; never fetches user-level/personal endpoints.
    const MOODLE_MASTER_TOKEN = 'b53b00b3fa0e4a77f5fb3086affd9a1d';

    function _moodleConfigured() {
        return typeof MOODLE_MASTER_TOKEN === 'string' && MOODLE_MASTER_TOKEN && MOODLE_MASTER_TOKEN !== 'YOUR_TOKEN_HERE';
    }

    function _moodleCall(wsfunction, params) {
        const chunks = [
            'moodlewsrestformat=json',
            'wstoken=' + encodeURIComponent(MOODLE_MASTER_TOKEN),
            'wsfunction=' + encodeURIComponent(wsfunction),
        ];
        if (params) {
            Object.keys(params).forEach(function (k) {
                chunks.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
            });
        }
        const url = MOODLE_BASE + '?' + chunks.join('&');
        // Always GET: Moodle's WS answers catalog functions reliably from the
        // query string, and the GET path travels cleanly through the
        // relaxed-TLS client on device (a POST body turned into
        // application/json by the bridge confused the server and hung the UI).
        const p = _http('GET', url, { Accept: 'application/json' }, null);
        return p.then(function (res) {
            if (!res || !res.status) throw new Error('moodle-null');
            if (res.status !== 200) throw new Error('moodle-http-' + res.status);
            let data;
            try {
                data = _jsonParse(res.text);
            } catch (e) {
                throw new Error('moodle-parse');
            }
            if (data && data.exception) {
                const msg = data.errorcode || data.message || 'moodle-error';
                PN.log({ kind: 'moodle-error', ws: wsfunction, error: String(msg) });
                throw new Error(String(msg));
            }
            return data;
        });
    }

    let _moodleUserId = null;
    let _moodleMyPromise = null;

    // The enrolment-scoped list of courses this account is actually enrolled
    // in. Moodle only grants file access inside enrolled courses, so this is
    // the ground truth for what the library can really open. Pure read-only.
    function _moodleMyCourses() {
        if (_moodleMyPromise) return _moodleMyPromise;
        _moodleMyPromise = (function () {
            let userid = _moodleUserId;
            const step1 = userid ? Promise.resolve({ userid: userid }) : _moodleCall('core_webservice_get_site_info', {});
            return step1.then(function (info) {
                userid = _moodleUserId = info && Number(info.userid);
                if (!userid) return [];
                return _moodleCall('core_enrol_get_users_courses', { userid: userid });
            }).then(function (courses) {
                const out = (courses && courses.filter) ? courses : [];
                return out.map(function (c) {
                    return {
                        id: Number(c.id),
                        category: Number(c.category) || 0,
                        name: String(c.fullname || c.shortname || ''),
                        short: String(c.shortname || ''),
                    };
                });
            }).catch(function (e) {
                _moodleMyPromise = null;
                throw e;
            });
        })();
        return _moodleMyPromise;
    }

    // Called after a successful self-enrolment flow so the badge list and any
    // per-course lookups reflect the new enrolment on the next read.
    function _moodleInvalidate() { _moodleMyPromise = null; }

    const MoodleService = {
        isConfigured: _moodleConfigured,

        // Public catalog lookups ONLY — never personal / user data.
        getCategories: function () {
            return _moodleCall('core_course_get_categories', {});
        },
        getCoursesByField: function (field, value) {
            return _moodleCall('core_course_get_courses_by_field', { field: field, value: value });
        },
        getCourseContents: function (courseid) {
            return _moodleCall('core_course_get_contents', { courseid: courseid });
        },
        getCourseEnrolMethods: function (courseid) {
            return _moodleCall('core_enrol_get_course_enrolment_methods', { courseid: courseid });
        },
        invalidateEnrolment: _moodleInvalidate,
        // Which courses this account can actually open (enrolments). Used to
        // tell "not enrolled" apart from "no files uploaded yet".
        // The result is never displayed beyond a badge on the course.
        getMyCourses: _moodleMyCourses,
    };

    PN._internals = {
        http: _http,
        httpBinary: _httpBinary,
        json: _jsonParse,
        claims: _jwtClaims,
        sign: _signGs,
        route: _route,
        extraHeaders: _extraHeaders,
    };
    // E-Learning file transport: base64 via relaxed TLS on device (expired
    // cert), WebView fetch elsewhere.
    function _b64ToUint8(b64) {
        if (!b64) return new Uint8Array(0);
        const bin = window.atob(b64);
        const len = bin.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    function _libraryFile(url) {
        const isElearning = String(url).indexOf('elearning.univ-guelma.dz') !== -1;
        const m = _caps();
        if (isElearning && m && typeof m.ministry.relaxedBytes === 'function') {
            PN.log({ kind: 'http', url: _hostOnly(url), method: 'GET', via: 'ministry-bytes' });
            return m.ministry.relaxedBytes({ url: url, headers: { Accept: '*/*' } }).then(function (res) {
                if (!res || !res.status) throw new Error('file-null');
                return {
                    status: res.status,
                    contentType: String(res.contentType || (res.headers && res.headers['content-type']) || ''),
                    base64: String(res.base64 || ''),
                    bytes: null,
                };
            });
        }
        return fetch(url, { method: 'GET' }).then(function (r) {
            return r.arrayBuffer().then(function (buf) {
                let ct = '';
                try { ct = r.headers.get('content-type') || ''; } catch (e) {}
                return { status: r.status, contentType: ct, base64: '', bytes: new Uint8Array(buf) };
            });
        });
    }

    PN.libraryFile = _libraryFile;

    // Persist / open a Moodle library file on-device. base64 comes from
    // _libraryFile; the JS layer hands it to the native plugin which writes
    // it to Downloads (saveFile) or opens it with the system viewer (viewFile).
    function _saveLibraryFile(name, mime, base64) {
        const m = _caps();
        if (m && m.ministry && typeof m.ministry.saveFile === 'function') {
            return m.ministry.saveFile({ name: name, mime: mime || 'application/octet-stream', base64: base64 || '' });
        }
        return Promise.reject(new Error('save-unavailable'));
    }
    function _viewLibraryFile(name, mime, base64) {
        const m = _caps();
        if (m && m.ministry && typeof m.ministry.viewFile === 'function') {
            return m.ministry.viewFile({ name: name, mime: mime || 'application/octet-stream', base64: base64 || '' });
        }
        return Promise.reject(new Error('view-unavailable'));
    }
    PN.saveLibraryFile = _saveLibraryFile;
    PN.viewLibraryFile = _viewLibraryFile;

    // Pull a binary file from the open university repositories (DSpace).
    // Routes through the native relaxed client (expired-cert safe AND free of
    // WebView CORS), returning base64 so the JS layer can reuse saveFile /
    // viewFile unchanged.
    function _dspaceBytes(url) {
        const m = _caps();
        if (m && typeof m.ministry.relaxedBytes === 'function') {
            return m.ministry.relaxedBytes({ url: String(url), headers: { Accept: '*/*' } }).then(function (res) {
                if (!res || !res.status) throw new Error('ds-no-status');
                return {
                    status: res.status,
                    contentType: String(res.contentType || (res.headers && res.headers['content-type']) || ''),
                    base64: String(res.base64 || ''),
                    bytes: null,
                };
            }).catch(function (e) {
                PN.log({ kind: 'http-error', url: _hostOnly(url), method: 'GET', error: _errMsg(e) });
                return _dspaceBytesFetch(url);
            });
        }
        return _dspaceBytesFetch(url);
    }
    function _dspaceBytesFetch(url) {
        return _httpBinary('GET', String(url), { 'User-Agent': GENERIC_UA, Accept: '*/*' }, null).then(function (res) {
            if (!res || res.status !== 200) throw new Error('ds-http ' + ((res && res.status) || 'no-status'));
            return { status: 200, contentType: 'application/pdf', base64: _bytesToB64(res.raw || new Uint8Array(0)), bytes: null };
        });
    }
    function _dspaceJson(url) {
        return _http('GET', String(url), { 'User-Agent': GENERIC_UA, Accept: 'application/json' }, null).then(function (res) {
            if (!res || !res.status || res.status !== 200) throw new Error('ds-http ' + ((res && res.status) || 'no-status'));
            return _jsonParse(res.text || '');
        });
    }
    PN.dspaceBytes = _dspaceBytes;
    PN.dspaceJson = _dspaceJson;

    // Open any URL in the system browser. Used for courses that are not
    // enrolled yet but allow one-click self-enrolment ("Auto-inscription"):
    // the site's session does the enrolment and the same token works here
    // afterwards.
    function _openInBrowser(url) {
        const m = _caps();
        if (m && m.ministry && typeof m.ministry.openInBrowser === 'function') {
            return m.ministry.openInBrowser({ url: String(url || '') });
        }
        if (typeof window !== 'undefined' && window.open) window.open(String(url), '_blank');
        return Promise.resolve({ ok: true });
    }
    PN.openInBrowser = _openInBrowser;
    PN.MoodleService = MoodleService;
    if (typeof window !== 'undefined') window.MoodleService = MoodleService;
})();