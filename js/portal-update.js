/* ============================================================
   PORTAL-UPDATE — in-app update system (sideload provider).
   Layers: manifest fetch + validate (here) → native provider
   (UpdatePlugin: download / verify / install) → state → About UI.
   The UI never downloads or installs anything directly. A future
   Google Play provider can replace the native calls without
   touching the UI or the state machine below.
   States: idle|checking|up_to_date|update_available|downloading|
           downloaded|installing|error
   ============================================================ */
window.PortalUpdate = (function () {
    'use strict';

    var LIVE_ORIGIN = 'https://university-portal-gv78.onrender.com';
    var LS_DL = 'portal_update_dl';
    var LS_CHECK = 'portal_update_check';
    var CHECK_TTL = 6 * 3600 * 1000;
    var FETCH_TIMEOUT = 30000;

    var state = { name: 'idle', remote: null, progress: null, error: '' };
    var listeners = [];
    var pollTimer = null;
    var bootChecked = false;

    function emit() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](state); } catch (e) {}
        }
        try {
            if (window.PortalUpdateUI) window.PortalUpdateUI.render(state);
        } catch (e) {}
    }

    function onChange(fn) {
        if (typeof fn === 'function') listeners.push(fn);
    }

    function setState(patch) {
        for (var k in patch) state[k] = patch[k];
        emit();
    }

    function isNative() {
        try {
            return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        } catch (e) { return false; }
    }

    function plugin() {
        try {
            return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.UpdatePlugin) || null;
        } catch (e) { return null; }
    }

    function manifestUrl() {
        try {
            var ov = localStorage.getItem('update_manifest_url');
            if (ov && /^https:\/\//.test(ov)) return ov; // dev override only
        } catch (e) {}
        return LIVE_ORIGIN + '/app/update.json';
    }

    function toast(msg, type) {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    }

    function validManifest(d) {
        if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
        var vc = Number(d.versionCode);
        if (!Number.isInteger(vc) || vc <= 0) return null;
        var url = String(d.apkUrl || '');
        if (!/^https:\/\/[^\/\s]+/.test(url)) return null;
        var sha = (d.sha256 == null || d.sha256 === '') ? '' : String(d.sha256);
        if (sha && !/^[0-9a-fA-F]{64}$/.test(sha)) return null;
        return {
            versionName: String(d.versionName || ('v' + vc)),
            versionCode: vc, apkUrl: url,
            sha256: sha.toLowerCase(), mandatory: d.mandatory === true,
        };
    }

    async function installedVersion() {
        var cached = null;
        try { cached = JSON.parse(localStorage.getItem('portal_update_ver') || 'null'); } catch (e) {}
        var pl = plugin();
        if (pl) {
            try {
                var v = await pl.getInstalledVersion();
                var out = { versionName: String((v && v.versionName) || ''), versionCode: Number((v && v.versionCode) || 0) };
                if (out.versionCode > 0) {
                    try { localStorage.setItem('portal_update_ver', JSON.stringify(out)); } catch (e) {}
                    return out;
                }
            } catch (e) {}
        }
        return cached;
    }

    function readDl() {
        try { return JSON.parse(localStorage.getItem(LS_DL) || 'null'); } catch (e) { return null; }
    }

    function saveDl(o) {
        try {
            if (o) localStorage.setItem(LS_DL, JSON.stringify(o));
            else localStorage.removeItem(LS_DL);
        } catch (e) {}
    }

    async function checkUpdate(opts) {
        opts = opts || {};
        if (state.name === 'checking' || state.name === 'downloading' || state.name === 'installing') return state;
        if (!opts.manual) {
            try {
                var last = JSON.parse(localStorage.getItem(LS_CHECK) || 'null');
                if (last && (Date.now() - last.at) < CHECK_TTL && last.available === false) {
                    setState({ name: 'up_to_date', remote: null, error: '' });
                    return state;
                }
            } catch (e) {}
        }
        setState({ name: 'checking', error: '' });
        var ctrl = null, timer = null;
        try {
            if (typeof AbortController !== 'undefined') {
                ctrl = new AbortController();
                timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, FETCH_TIMEOUT);
            }
            var res = await fetch(manifestUrl(), { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' });
            if (!res.ok) throw new Error('http-' + res.status);
            var data = await res.json();
            var m = validManifest(data);
            if (!m) throw new Error('bad-manifest');
            var inst = await installedVersion();
            if (!inst || !(inst.versionCode > 0)) throw new Error('no-installed-version');
            try {
                localStorage.setItem(LS_CHECK, JSON.stringify({ at: Date.now(), available: m.versionCode > inst.versionCode }));
            } catch (e) {}
            if (m.versionCode > inst.versionCode) {
                // Reuse an already-downloaded identical update instead of re-downloading.
                var dl = readDl();
                if (dl && dl.versionCode === m.versionCode) {
                    var present = await nativePresent(m.versionCode);
                    if (present) {
                        setState({ name: 'downloaded', remote: m, error: '' });
                        return state;
                    }
                    saveDl(null);
                }
                setState({ name: 'update_available', remote: m, error: '' });
            } else {
                saveDl(null);
                setState({ name: 'up_to_date', remote: null, error: '' });
            }
        } catch (e) {
            setState({ name: 'error', error: 'تعذر التحقق من وجود تحديث', remote: null });
        } finally {
            if (timer) clearTimeout(timer);
        }
        return state;
    }

    async function nativePresent(versionCode) {
        var pl = plugin();
        if (!pl) return false;
        try {
            var r = await pl.getDownloadedUpdate({ versionCode: versionCode });
            return !!(r && r.present);
        } catch (e) { return false; }
    }

    var fallbackCtrl = null;

    // HEAD preflight: warms a sleeping server and proves the file URL is
    // reachable before involving the system downloader.
    async function preflight(url) {
        try {
            var ctrl = new AbortController();
            var t = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 20000);
            var res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, cache: 'no-store' });
            clearTimeout(t);
            return res.ok;
        } catch (e) {
            return false;
        }
    }

    async function startDownload() {
        if (state.name === 'downloading' || state.name === 'installing') return state;
        var m = state.remote;
        if (!m) return state;
        var pl = plugin();
        if (!isNative() || !pl) {
            toast('التنزيل متاح في تطبيق الأندرويد', 'info');
            return state;
        }
        setState({ name: 'downloading', progress: { pct: null, soFar: 0, total: 0 }, error: '' });
        if (!(await preflight(m.apkUrl))) {
            return fallbackFetch(m);
        }
        try {
            var r = await pl.downloadUpdate({ url: m.apkUrl, versionCode: m.versionCode });
            var id = r && (r.downloadId != null ? Number(r.downloadId) : 0);
            if (!id) throw new Error('no-id');
            saveDl({ downloadId: id, versionCode: m.versionCode, sha256: m.sha256, apkUrl: m.apkUrl });
            pollLoop(id, m.versionCode);
        } catch (e) {
            return fallbackFetch(m);
        }
        return state;
    }

    // Fallback when the system downloader fails on a device: stream the APK
    // over WebView HTTPS (proven by the manifest check) with REAL byte
    // progress, then hand the bytes to the same verified native installer.
    async function fallbackFetch(m) {
        var pl = plugin();
        if (!pl) {
            saveDl(null);
            setState({ name: 'error', error: 'تعذر تنزيل التحديث', progress: null });
            return state;
        }
        setState({ name: 'downloading', progress: { pct: null, soFar: 0, total: 0 }, error: '' });
        try { if (fallbackCtrl) fallbackCtrl.abort(); } catch (e) {}
        fallbackCtrl = new AbortController();
        try {
            var res = await fetch(m.apkUrl, { signal: fallbackCtrl.signal, cache: 'no-store' });
            if (!res.ok || !res.body || typeof res.body.getReader !== 'function') throw new Error('http-' + (res && res.status));
            var total = Number(res.headers.get('content-length') || 0);
            var reader = res.body.getReader();
            var chunks = [];
            var received = 0;
            for (;;) {
                var part = await reader.read();
                if (part.done) break;
                chunks.push(part.value);
                received += part.value.length;
                setState({ name: 'downloading', progress: { pct: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : null, soFar: received, total: total } });
            }
            var blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });
            var b64 = await new Promise(function (resolve, reject) {
                var fr = new FileReader();
                fr.onload = function () {
                    var s = String(fr.result || '');
                    var i = s.indexOf(',');
                    resolve(i === -1 ? '' : s.slice(i + 1));
                };
                fr.onerror = function () { reject(new Error('encode')); };
                fr.readAsDataURL(blob);
            });
            chunks = null;
            if (!b64) throw new Error('encode');
            saveDl({ downloadId: 0, versionCode: m.versionCode, sha256: m.sha256, apkUrl: m.apkUrl });
            var r = await pl.installFromBase64({ base64: b64, versionCode: m.versionCode, sha256: m.sha256 || '' });
            if (r && r.status === 'pending_user_action') {
                setState({ name: 'installing', progress: { pct: 100, soFar: 0, total: 0 }, error: '' });
            } else {
                throw new Error('install-rejected');
            }
        } catch (e) {
            if (e && e.name === 'AbortError') {
                saveDl(null);
                setState({ name: 'update_available', progress: null, error: '' });
            } else {
                saveDl(null);
                setState({ name: 'error', error: 'تعذر تنزيل التحديث', progress: null });
            }
        } finally {
            fallbackCtrl = null;
        }
        return state;
    }

    function stopPoll() {
        if (pollTimer) { try { clearInterval(pollTimer); } catch (e) {} pollTimer = null; }
    }

    function pollLoop(id, versionCode) {
        stopPoll();
        var pl = plugin();
        var tick = async function () {
            if (!plugin()) { stopPoll(); return; }
            try {
                var r = await plugin().pollDownload({ downloadId: id });
                var st = r && r.status;
                if (st === 'downloading') {
                    var soFar = Number((r && r.bytesSoFar) || 0);
                    var total = Number((r && r.bytesTotal) || 0);
                    setState({ name: 'downloading', progress: { pct: total > 0 ? Math.min(99, Math.round((soFar / total) * 100)) : null, soFar: soFar, total: total } });
                } else if (st === 'complete') {
                    stopPoll();
                    setState({ name: 'downloaded', progress: { pct: 100, soFar: 0, total: 0 }, error: '' });
                } else if (st === 'failed' || st === 'unknown') {
                    stopPoll();
                    saveDl(null);
                    var rm = state.remote;
                    if (rm && rm.versionCode === versionCode) { fallbackFetch(rm); return; }
                    setState({ name: 'error', error: 'تعذر تنزيل التحديث', progress: null });
                }
            } catch (e) {
                stopPoll();
                saveDl(null);
                var rm2 = state.remote;
                if (rm2 && rm2.versionCode === versionCode) { fallbackFetch(rm2); return; }
                setState({ name: 'error', error: 'تعذر تنزيل التحديث', progress: null });
            }
        };
        tick();
        pollTimer = setInterval(tick, 800);
    }

    async function cancelDownload() {
        stopPoll();
        try { if (fallbackCtrl) fallbackCtrl.abort(); } catch (e) {}
        fallbackCtrl = null;
        var dl = readDl();
        var pl = plugin();
        if (pl && dl && dl.downloadId) {
            try { await pl.cancelDownload({ downloadId: dl.downloadId }); } catch (e) {}
        }
        saveDl(null);
        setState({ name: 'update_available', progress: null, error: '' });
    }

    async function installUpdate() {
        var m = state.remote;
        var dl = readDl();
        if (!m || !dl || dl.versionCode !== m.versionCode) {
            setState({ name: 'error', error: 'ملف التحديث غير موجود — أعد التنزيل' });
            return state;
        }
        var pl = plugin();
        if (!isNative() || !pl) {
            toast('التثبيت متاح في تطبيق الأندرويد', 'info');
            return state;
        }
        setState({ name: 'installing', error: '' });
        try {
            var r = await pl.verifyAndInstall({ versionCode: m.versionCode, sha256: m.sha256 || '' });
            if (r && r.status === 'pending_user_action') {
                // Android now shows its own confirmation; outcome arrives via installStatus.
                return state;
            }
            setState({ name: 'error', error: 'تعذر بدء التثبيت' });
        } catch (e) {
            var msg = String((e && e.message) || '');
            var friendly = 'تعذر تثبيت التحديث';
            if (/checksum/i.test(msg)) friendly = 'ملف التحديث تالف — أعد التنزيل';
            else if (/blocked/i.test(msg)) friendly = 'التثبيت محظور من النظام — اسمح بتثبيت التطبيقات';
            else if (/incompatible|invalid/i.test(msg)) friendly = 'ملف التحديث غير متوافق';
            else if (/missing|incomplete/i.test(msg)) friendly = 'ملف التحديث ناقص — أعد التنزيل';
            if (/checksum|missing|incomplete/i.test(msg)) saveDl(null);
            setState({ name: 'error', error: friendly });
        }
        return state;
    }

    function bindNativeEvents() {
        var pl = plugin();
        if (!pl || pl.__portalUpdateBound) return;
        pl.__portalUpdateBound = true;
        try {
            pl.addListener('downloadComplete', function () {
                var dl = readDl();
                if (dl) pollLoopOnce(dl.downloadId);
            });
        } catch (e) {}
        try {
            pl.addListener('installStatus', function (ev) {
                var phase = ev && ev.phase;
                if (phase === 'success') {
                    toast('تم التثبيت بنجاح', 'success');
                    saveDl(null);
                } else if (phase === 'cancelled') {
                    setState({ name: 'downloaded', error: '' });
                    toast('تم إلغاء التثبيت', 'info');
                } else if (phase === 'failed') {
                    setState({ name: 'error', error: 'تعذر تثبيت التحديث' });
                }
            });
        } catch (e) {}
    }

    async function pollLoopOnce(id) {
        try {
            var r = await plugin().pollDownload({ downloadId: id });
            if (r && r.status === 'complete') {
                stopPoll();
                setState({ name: 'downloaded', progress: { pct: 100, soFar: 0, total: 0 }, error: '' });
            } else if (r && (r.status === 'failed' || r.status === 'unknown')) {
                stopPoll();
                saveDl(null);
                setState({ name: 'error', error: 'تعذر تنزيل التحديث', progress: null });
            }
        } catch (e) {}
    }

    // Resume an in-flight download after activity recreation / relaunch.
    async function resume() {
        var dl = readDl();
        if (!dl || !dl.downloadId || state.name === 'downloading') return;
        var pl = plugin();
        if (!isNative() || !pl) return;
        try {
            var r = await pl.pollDownload({ downloadId: dl.downloadId });
            var st = r && r.status;
            if (st === 'downloading') {
                var m = state.remote;
                if (!m || m.versionCode !== dl.versionCode) {
                    try {
                        var chk = await checkUpdate({ manual: true });
                        m = chk.remote;
                    } catch (e) {}
                }
                if (m && m.versionCode === dl.versionCode) {
                    setState({ name: 'downloading', remote: m, progress: { pct: null, soFar: 0, total: 0 }, error: '' });
                    pollLoop(dl.downloadId, dl.versionCode);
                }
            } else if (st === 'complete') {
                setState({ name: 'downloaded', progress: { pct: 100, soFar: 0, total: 0 }, error: '' });
            } else {
                saveDl(null);
            }
        } catch (e) {}
    }

    function bootCheck() {
        if (bootChecked) return;
        bootChecked = true;
        bindNativeEvents();
        resume();
        // One silent cached check per boot; never blocks the app.
        setTimeout(function () {
            try { checkUpdate({}); } catch (e) {}
        }, 10000);
    }

    return {
        onChange: onChange,
        getState: function () { return state; },
        checkUpdate: checkUpdate,
        startDownload: startDownload,
        cancelDownload: cancelDownload,
        installUpdate: installUpdate,
        resume: resume,
        bootCheck: bootCheck,
        bindNativeEvents: bindNativeEvents,
        installedVersion: installedVersion,
        manifestUrl: manifestUrl,
    };
})();

/* ---- About UI (account section) ---- */
window.PortalUpdateUI = (function () {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    async function paintVersion() {
        var el = document.getElementById('app-version');
        if (!el) return;
        var v = null;
        try { v = await window.PortalUpdate.installedVersion(); } catch (e) {}
        if (v && v.versionCode > 0) {
            el.textContent = v.versionName || ('v' + v.versionCode);
            el.setAttribute('title', 'versionCode ' + v.versionCode);
        } else {
            el.textContent = '—';
        }
    }

    function bar(pct) {
        if (pct == null) return '<div class="upd-bar indeterminate"><span></span></div>';
        return '<div class="upd-bar"><span style="width:' + Math.max(0, Math.min(100, pct)) + '%"></span></div>'
            + '<p class="upd-pct">' + Math.max(0, Math.min(100, pct)) + '%</p>';
    }

    function render(st) {
        var box = document.getElementById('update-box');
        if (!box || !window.PortalUpdate) return;
        var h = '';
        if (st.name === 'checking') {
            h = '<div class="upd-state"><p class="upd-msg"><i class="fas fa-spinner fa-spin"></i> جاري التحقق من وجود تحديث...</p></div>';
        } else if (st.name === 'up_to_date') {
            h = '<div class="upd-state"><p class="upd-ok"><i class="fas fa-circle-check"></i> أنت تستخدم أحدث إصدار</p>'
                + '<button type="button" class="btn btn-ghost btn-sm" onclick="PortalUpdate.checkUpdate({manual:true})">التحقق من وجود تحديث</button></div>';
        } else if (st.name === 'update_available' && st.remote) {
            h = '<div class="upd-state"><p class="upd-avail"><i class="fas fa-arrow-up"></i> تحديث متوفر</p>'
                + '<p class="upd-ver">الإصدار ' + esc(st.remote.versionName) + '</p>'
                + '<button type="button" class="btn btn-primary btn-full" onclick="PortalUpdate.startDownload()"><i class="fas fa-download"></i> تحديث</button></div>';
        } else if (st.name === 'downloading') {
            var p = st.progress || {};
            h = '<div class="upd-state"><p class="upd-msg"><i class="fas fa-spinner fa-spin"></i> جاري تنزيل التحديث...</p>'
                + bar(p.pct)
                + '<button type="button" class="btn btn-ghost btn-sm" onclick="PortalUpdate.cancelDownload()">إلغاء</button></div>';
        } else if (st.name === 'downloaded') {
            h = '<div class="upd-state"><p class="upd-ok"><i class="fas fa-circle-check"></i> اكتمل تنزيل التحديث</p>'
                + '<button type="button" class="btn btn-primary btn-full" onclick="PortalUpdate.installUpdate()"><i class="fas fa-right-to-bracket"></i> تثبيت التحديث</button></div>';
        } else if (st.name === 'installing') {
            h = '<div class="upd-state"><p class="upd-msg"><i class="fas fa-spinner fa-spin"></i> التحديث جاهز — أكّد التثبيت في نافذة النظام</p>'
                + '<button type="button" class="btn btn-primary btn-full" onclick="PortalUpdate.installUpdate()"><i class="fas fa-rotate"></i> إعادة تشغيل التطبيق</button></div>';
        } else if (st.name === 'error') {
            h = '<div class="upd-state"><p class="upd-err"><i class="fas fa-triangle-exclamation"></i> ' + esc(st.error || 'تعذر تحديث التطبيق') + '</p>'
                + '<button type="button" class="btn btn-ghost btn-sm" onclick="PortalUpdate.checkUpdate({manual:true})">إعادة المحاولة</button></div>';
        }
        box.innerHTML = h;
    }

    // Called when the account section opens: paint version + cached state,
    // then refresh (cached) — never on every navigation.
    async function refresh() {
        await paintVersion();
        try { window.PortalUpdate.bindNativeEvents(); } catch (e) {}
        render(window.PortalUpdate.getState());
        try { await window.PortalUpdate.checkUpdate({}); } catch (e) {}
        try { await window.PortalUpdate.resume(); } catch (e) {}
    }

    return { render: render, refresh: refresh, paintVersion: paintVersion };
})();

try {
    setTimeout(function () {
        try { window.PortalUpdate.bootCheck(); } catch (e) {}
    }, 12000);
} catch (e) {}
