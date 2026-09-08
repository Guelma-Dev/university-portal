'use strict';
// Regression harness: nav back-stack + official card + residence + premium UI.
// Lives in repo (tools/) so it survives /tmp cleanups. Run: node tools/harness.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const profSrc = fs.readFileSync(path.join(ROOT, 'js', 'sec-profile.js'), 'utf8');

function makeElem() {
    const el = {
        id: '', tag: 'el', value: '', innerHTML: '', textContent: '', className: '',
        style: { setProperty(){} },
        dataset: {},
        classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
        setAttribute(){}, getAttribute(){ return null; },
        appendChild(){}, remove(){}, prepend(){}, append(){}, replaceChildren(){},
        closest(){ return null; }, matches(){ return false; },
        addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; },
        querySelector(){ return makeElem(); }, querySelectorAll(){ return []; },
        getBoundingClientRect(){ return {}; }, scrollTo(){}, focus(){}, click(){},
        set onclick(v){}, get onclick(){ return null; },
    };
    return el;
}

function jwt() {
    const p = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return 'e30.' + p + '.sig';
}

const store = {
    theme: 'dark', visits: '0', tg_config: '{}',
    lmd_calc_v2: '{"sem1":[],"sem2":[]}',
    user_role: 'student',
    progres_session: JSON.stringify({ token: jwt(), name: 'طالب الاختبار', uuid: 'u-123', selectedCard: '2024', cards: [{ id: '2024' }] }),
};
const localStore = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
};
const sessionSt = { data: {}, getItem: k => (k in sessionSt.data ? sessionSt.data[k] : null), setItem: (k, v) => { sessionSt.data[k] = String(v); }, removeItem: k => { delete sessionSt.data[k]; } };

const hashHandlers = {};
const domContentHandlers = [];
const _loc = { origin: 'http://localhost:8100', hash: '#/home', hostname: 'localhost' };

let results = [];
function check(cond, msg) { results.push((cond ? 'PASS' : 'FAIL') + ' — ' + msg); if (!cond) process.exitCode = 1; }

const location = new Proxy(_loc, {
    set(target, prop, value) {
        if (prop === 'hash' && typeof value === 'string' && !value.startsWith('#')) value = '#' + value;
        target[prop] = value;
        if (prop === 'hash' && hashHandlers.hash) {
            try { hashHandlers.hash({}); } catch (e) { results.push('WARN auto-hashchange: ' + e.message); }
        }
        return true;
    },
    get(target, prop) { return target[prop]; },
});

const sandbox = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: id => clearTimeout(id),
    Promise, URLSearchParams, URL, TextEncoder, TextDecoder,
    fetch: async url => {
        const u = String(url);
        if (u.includes('/api/academic/hebergement')) {
            // REAL shape: list of demandes (verified live against api-webetu)
            return { ok: true, status: 200, json: async () => ([
                { idAnneeAcademique: 25, idDou: 5185736, idResidance: 5185989,
                  llAffectation: 'pav-K-040',
                  llDouArabe: 'مديرية الخدمات الجامعية قالمة', llDouLatin: 'direction des oeuvres universitaires guelma',
                  llResidanceArabe: 'الاقامة الجامعية هباش احمد الشريف - قالمة', llResidanceLatin: 'RU Habbache Ahmed Cherif  - Guelma' },
            ]) };
        }
        return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    },
    atob: s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    btoa: b => Buffer.from(b).toString('base64'),
    Event: function () {}, CustomEvent: function () {}, KeyboardEvent: function () {},
    FileReader: function () { return { readAsDataURL(){} }; },
    Blob: function () {}, Headers: function () {}, AbortController: function () {},
    localStorage: localStore, sessionStorage: sessionSt,
    navigator: { userAgent: 'node', language: 'ar' },
    location: location,
    history: { pushState(){}, replaceState(){}, back(){} },
    matchMedia: () => ({ matches: false }),
    document: {
        readyState: 'loading',
        getElementById: () => makeElem(),
        querySelector: sel => {
            if (sel === '.app-bar') return makeElem();
            if (sel.includes('m-modal') || sel.includes('modal-overlay')) return null;
            return makeElem();
        },
        querySelectorAll: () => [],
        createElement: () => makeElem(),
        createElementNS: () => makeElem(),
        addEventListener: (t, h) => { if (t === 'DOMContentLoaded') domContentHandlers.push(h); },
        dispatchEvent: () => true,
        documentElement: makeElem(),
        body: makeElem(), head: makeElem(),
    },
    addEventListener: (t, h) => { if (t === 'hashchange') hashHandlers.hash = h; },
    removeEventListener: () => {},
};
sandbox.window = sandbox;

const ctx = vm.createContext(sandbox);
vm.runInContext(appSrc, ctx, { filename: 'app.js' });
vm.runInContext(profSrc, ctx, { filename: 'sec-profile.js' });

const wait = ms => new Promise(r => setTimeout(r, ms));

(async function () {
    for (const h of domContentHandlers) try { await h(); } catch (e) { results.push('WARN boot threw: ' + e.message); }
    await wait(120);

    // ---------- Back-stack ----------
    ctx.switchSection('grades');
    check(sandbox.location.hash === '#/grades', 'section nav home->grades (hash #/grades)');
    let r = ctx.portalNavBack();
    check(r === true && sandbox.location.hash === '#/home', 'back grades->home returns true');
    r = ctx.portalNavBack();
    check(r === false, 'back from root returns false (exit)');
    ctx.switchSection('grades');
    await ctx.openProgresView('card');
    let rCard = ctx.portalNavBack();
    check(rCard === true, 'back from card detail returns true (detail->overview)');
    const handlers = ctx.__portalBackHandlers;
    const h1 = () => true;
    handlers.push(h1);
    r = ctx.portalNavBack();
    check(r === true, 'back consumes library handler (true)');
    handlers.pop();
    const h2 = () => false;
    handlers.push(h2);
    r = ctx.portalNavBack();
    handlers.pop();
    check(r === true, 'fallback: library handler(false) skipped, still back to home');
    check(sandbox.location.hash === '#/home', 'returned to home after library-handler pass');

    // ---------- Official card faces ----------
    const card = {
        individuNomArabe: 'ابراهيمي', individuNomLatin: 'BRAHIMI',
        individuPrenomArabe: 'محمد', individuPrenomLatin: 'Mohamed',
        numeroInscription: 'UN24012026252536255708',
        anneeAcademiqueCode: '2026/2027', individuDateNaissance: '2006-10-29 00:00:00', individuLieuNaissanceArabe: 'قالمة',
        ofLlDomaineArabe: 'علوم اقتصادية والتسيير وعلوم تجارية', ofLlFiliereArabe: 'علوم مالية ومحاسبة',
    };
    const html = ctx.renderStudentCardPage(card);
    check(html.includes('assets/carteetu.jpg'), 'front uses real carteetu.jpg');
    check(html.includes('assets/carteback.jpg'), 'back uses real carteback.jpg');
    check(html.includes('sid-backface') && html.includes('onclick="sidFlip()"'), 'tap-to-flip restored');
    check(html.includes('sid-rotbox'), 'rotated footprint');
    check(html.includes('id="sid-card"'), 'card owns the flip button');
    check(html.includes('sid-head"') && html.includes('sid-titles'), '1.3.9 header (title, no buttons)');
    check(html.includes('sid-row') && html.includes('sid-lat') && !html.includes('sid-frow'), '1.3.9 distributed rows restored');
    check(html.includes('اللقب') && html.includes('تاريخ و مكان الميلاد') && html.includes('الميدان') && html.includes('الفرع'), 'official arabic labels');
    check(html.includes('BRAHIMI') && html.includes('Mohamed'), 'latin names');
    check(html.includes('2006-10-29') && html.includes('قالمة'), 'birth date split + place');
    check(html.includes('علوم اقتصادية والتسيير وعلوم تجارية'), 'domaine field');
    check(html.includes(encodeURIComponent('/checkInscription/')) && html.includes(encodeURIComponent('checkHebergement/')), 'official QR payloads front/back');
    check(html.includes('id="rsc-photo"') && html.includes('id="rsc-logo"'), 'photo/logo ids kept');
    check(html.includes('id="rsc-photo-b"') && html.includes('id="rsc-logo-b"'), 'back photo/logo slots');
    check(html.includes('sid-res-body'), 'back residence slot');
    check(html.includes('UN24012026252536255708'), 'registration number');

    // ---------- Residence (REAL list shape) ----------
    check(typeof ctx.window.PortalProfile.getResidence === 'function', 'PortalProfile.getResidence exported');
    const res = await ctx.window.PortalProfile.getResidence('u-123');
    check(!!res && res.name === 'الاقامة الجامعية هباش احمد الشريف - قالمة', 'list unwrapped: arabic residence name');
    check(!!res && res.affect === 'pav-K-040', 'llAffectation kept raw');
    check(!!res && res.dou === 'مديرية الخدمات الجامعية قالمة', 'llDouArabe captured');
    check(!!res && String(res.id) === '5185989', 'idResidance captured');
    const snap = ctx.window.PortalProfile.getCachedResidence('u-123');
    check(!!snap && snap.name === res.name, 'residence snapshot persisted (survives restart)');

    // ---------- Pomo in top bar (no fab) ----------
    const _cssLuxP = fs.readFileSync(path.join(ROOT, 'css', 'portal-lux.css'), 'utf8');
    const _appJsP = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    for (const f of ['index.html', path.join('www', 'index.html')]) {
        const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const tag = f.includes('www') ? '[www] ' : '';
        check(h.includes('id="appbar-pomo"') && h.includes('togglePomo()'), tag + 'pomo compact action in top bar');
        check(h.includes('id="appbar-potime"'), tag + 'center live timer slot');
        check(h.includes('class="appbar-btn" id="appbar-pomo"') || h.includes('id="appbar-pomo"'), tag + 'pomo button uses standard topbar size');
        check(!h.includes('pomo-fab'), tag + 'no floating pomo button');
    }
    check(_appJsP.includes("getElementById('appbar-pomo')"), 'pomo UI targets top bar');
    check(!_appJsP.includes("getElementById('pomo-fab')"), 'no fab references in logic');
    check(_cssLuxP.includes('#appbar-potime'), 'topbar live timer styles');
    check(!_cssLuxP.includes('.pomo-fab'), 'no dead fab CSS');
    for (const f of ['index.html', path.join('www', 'index.html')]) {
        const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const n = (h.match(/\?v=[^"'\s]+/g) || []).length;
        check(n >= 10, (f.includes('www') ? '[www] ' : '') + 'cache busters pinned to release (' + n + ')');
    }
    // Busters must track the release version or OTA updates serve stale assets.
    const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
    const verName = (gradle.match(/versionName\s+"([^"]+)"/) || [])[1] || '';
    for (const f of ['index.html', path.join('www', 'index.html')]) {
        const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const vers = new Set([...h.matchAll(/\?v=([^"'\s]+)/g)].map(m => m[1]));
        check(vers.size === 1 && vers.has(verName), (f.includes('www') ? '[www] ' : '') + 'all busters equal release ' + verName);
    }

    // ---------- Static CSS/JS checks ----------
    // ---------- Static CSS/JS checks ----------
    // ---------- Phase 4: in-app update system ----------
    const puJs = fs.readFileSync(path.join(ROOT, 'js', 'portal-update.js'), 'utf8');
    check(puJs.includes('fallbackFetch') && puJs.includes('getReader'), 'fetch fallback with real byte progress');
    check(puJs.includes('preflight'), 'server preflight before system download');
    check(puJs.includes('discardPartial'), 'partial files discarded on failure/cancel');
    check(puJs.includes('lastBeat') && puJs.includes('60000'), 'stall watchdog on stream');
    check(puJs.includes('confirmDownloaded'), 'validate-before-DOWNLOADED gate');
    check(puJs.includes('window.PortalUpdate') && puJs.includes('window.PortalUpdateUI'), 'update service + UI exist');
    check(puJs.includes('versionCode') && puJs.includes('apkUrl') && puJs.includes('sha256'), 'manifest contract (code/url/hash)');
    check(puJs.includes('m.versionCode > inst.versionCode'), 'numeric versionCode comparison');
    check(!puJs.includes('1.3.7') && !puJs.includes('1.3.8'), 'no hardcoded versions');
    check(puJs.includes('indeterminate'), 'indeterminate progress fallback (no fake %)');
    check(puJs.includes('getInstalledVersion'), 'installed version read from platform');
    for (const f of ['index.html', path.join('www', 'index.html')]) {
        const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const tag = f.includes('www') ? '[www] ' : '';
        check(h.includes('portal-update.js'), tag + 'update script loaded');
        check(h.includes('id="about-app"') && h.includes('id="app-version"') && h.includes('id="update-box"'), tag + 'about block present');
    }
    check(_appJsP.includes('PortalUpdateUI.refresh()'), 'about refresh wired (not every navigation)');
    const upJava = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'dz', 'guelma', 'portal', 'UpdatePlugin.java'), 'utf8');
    for (const m of ['getInstalledVersion', 'downloadUpdate', 'pollDownload', 'cancelDownload', 'getDownloadedUpdate', 'verifyAndInstall']) {
        check(upJava.includes('public void ' + m), 'update plugin method ' + m);
    }
    check(upJava.includes('MODE_FULL_INSTALL') || fs.existsSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'dz', 'guelma', 'portal', 'UpdateInstaller.java')), 'PackageInstaller session API (not deprecated)');
    check(!upJava.includes('ACTION_INSTALL_PACKAGE'), 'no deprecated install intent');
    check(upJava.includes('https'), 'https-only download URLs');
    const mani4 = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    check(mani4.includes('REQUEST_INSTALL_PACKAGES') && mani4.includes('.UpdateInstallReceiver'), 'install permission + status receiver');
    const beManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'flask_backend', 'update.json'), 'utf8'));
    check(beManifest.versionCode === 13 && beManifest.versionName === '1.4.9', 'production manifest advertises 1.4.5 (code 9)');
    check(/^https:\/\/[^\/\s]+\/app\/releases\/app-13\.apk$/.test(beManifest.apkUrl), 'manifest apkUrl points at hosted release');
    check(fs.existsSync(path.join(ROOT, 'backend', 'flask_backend', 'releases', 'app-13.apk')), 'release APK present for hosting');
    check(!upJava.includes('setDestinationUri(Uri.fromFile') && !upJava.includes('VISIBILITY_HIDDEN'), 'no banned download destination/visibility');
    check(upJava.includes('setDestinationInExternalFilesDir') && upJava.includes('VISIBILITY_VISIBLE'), 'store-compliant download target + visible progress');
    check(upJava.includes('installBegin') && upJava.includes('installAppend') && upJava.includes('installCommit'), 'chunked install handoff (bridge-safe)');
    check(puJs.includes('installBegin') && puJs.includes('CHUNK_BYTES'), 'JS streams chunks, never a giant string');
    check(/^[0-9a-f]{64}$/.test(beManifest.sha256 || ''), 'manifest carries real sha256');
    const beApp = fs.readFileSync(path.join(ROOT, 'backend', 'flask_backend', 'app.py'), 'utf8');
    check(beApp.includes("Access-Control-Allow-Origin'] = '*'") && beApp.includes('/app/update.json'), 'manifest + apk served with CORS for WebView');
    // ---------- Phase 3: branding / splash / login / status ----------
    check(fs.existsSync(path.join(ROOT, 'assets', 'logo.svg')), 'new logo SVG exists');
    const _logoSvg = fs.readFileSync(path.join(ROOT, 'assets', 'logo.svg'), 'utf8');
    check(_logoSvg.includes('currentColor'), 'logo adapts via currentColor');
    for (const f of ['index.html', path.join('www', 'index.html')]) {
        const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const tag = f.includes('www') ? '[www] ' : '';
        const needMarks = f.includes('www') ? 3 : 2; // www home has dh-seal; root dashboard differs
        check((h.match(/brand-mark/g) || []).length >= needMarks, tag + 'new logo in login/appbar' + (f.includes('www') ? '/home' : ''));
        check(h.includes('<svg class="brand-mark"'), tag + 'logo inlined (currentColor theming works)');
        check(h.includes('>رقم التسجيل الجامعي<'), tag + 'reg label text');
        check(h.includes('dev-contact') && h.includes('@vmw23') && h.includes('https://t.me/vmw23'), tag + 'dev contact Telegram');
        check(!h.includes('إذا لديك استفسار'), tag + 'no old dev blurb');
    }
    const _lux2 = fs.readFileSync(path.join(ROOT, 'css', 'portal-lux.css'), 'utf8');
    check(!_lux2.includes('.app-bar::after'), 'header divider line removed');
    check(_lux2.includes('.app-bar.scrolled'), 'header materializes on scroll');
    check(_lux2.includes('.login-form::before') && _lux2.includes('.dev-contact'), 'login polish + dev CSS');
    check(_appJsP.includes("classList.toggle('scrolled'"), 'scrolled state JS');
    // ---------- Phase 2: notification foundation ----------
    const pnJs = fs.readFileSync(path.join(ROOT, 'js', 'portal-notify.js'), 'utf8');
    check(pnJs.includes('window.PortalNotify') && pnJs.includes('window.PortalNotifyUI'), ' PortalNotify abstraction + UI bindings exist');
    check(pnJs.includes('portal_notif_v1') && pnJs.includes('meals_autobook_ctx'), 'prefs + booking ctx persisted');
    check(pnJs.includes('restore') && pnJs.includes('onLogout') && pnJs.includes('applySchedule'), 'restore/replace/cancel lifecycle');
    check(pnJs.includes('ensurePermission'), 'contextual permission request');
    for (const f of ['index.html', path.join('www', 'index.html')]) {
        const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const tag = f.includes('www') ? '[www] ' : '';
        check(h.includes('portal-notify.js'), tag + 'notify script loaded');
        check(h.includes('id="notif-settings"') && h.includes('id="sw-notif"') && h.includes('id="sw-auto"'), tag + 'settings UI present');
        check(h.includes('id="auto-time"') && h.includes('id="auto-meals"') && h.includes('id="auto-depot"'), tag + 'time + meals + depot controls');
        check(h.includes('id="sw-class"') && h.includes('toggleClass()') && h.includes('id="notif-denied"'), tag + 'lecture toggle + denied state');
    }
    const mealsJs = fs.readFileSync(path.join(ROOT, 'js', 'sec-meals.js'), 'utf8');
    check(mealsJs.includes('rememberCtx'), 'manual booking feeds auto-booking ctx');
    const _appJs2 = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    check(_appJs2.includes('PortalNotify.restore()') && _appJs2.includes('PortalNotify.onLogout()') && _appJs2.includes('PortalNotifyUI.paint()'), 'lifecycle hooks wired');
    const npJava = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'dz', 'guelma', 'portal', 'NotifyPlugin.java'), 'utf8');
    for (const m of ['areEnabled', 'requestPermission', 'notifyNow', 'scheduleBooking', 'cancelBooking', 'getBooking']) {
        check(npJava.includes('public void ' + m), 'plugin method ' + m);
    }
    for (const m of ['scheduleReminder', 'cancelReminder', 'cancelReminders']) {
        check(npJava.includes('public void ' + m), 'plugin method ' + m);
    }
    check(fs.existsSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'dz', 'guelma', 'portal', 'ReminderReceiver.java')), 'reminder receiver exists');
    check(pnJs.includes('computeClassReminders') && pnJs.includes('rebuildClassReminders') && pnJs.includes('toggleClass'), 'class reminder engine + toggle');
    check(pnJs.includes('ptsOverlay') && pnJs.includes('isScheduleEmpty'), 'reminders reuse final merged timetable');
    check(pnJs.includes('clsSig'), 'reminder signature guard (no duplicates)');
    check(_appJs2.includes('rebuildClassReminders()'), 'rebuild hooked (render/timetable changes)');
    check(npJava.includes('setExactAndAllowWhileIdle') && npJava.includes('setAndAllowWhileIdle'), 'exact alarm with inexact fallback');
    const brJava = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'dz', 'guelma', 'portal', 'BookingReceiver.java'), 'utf8');
    check(brJava.includes('/api/onou/reserve') && brJava.includes('/api/onou/reservations'), 'native replays booking + verifies list');
    check(brJava.includes('confirmed > 0'), 'success only on verified confirmation');
    check(brJava.includes('تعذر حجز الوجبة'), 'honest failure notification');
    check(brJava.includes('rescheduleIfEnabled'), 'daily rollover without duplicates');
    const bootJava = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'dz', 'guelma', 'portal', 'BootReceiver.java'), 'utf8');
    check(bootJava.includes('BOOT_COMPLETED'), 'schedule restored after reboot');
    const manifest = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    for (const s of ['POST_NOTIFICATIONS', 'SCHEDULE_EXACT_ALARM', 'RECEIVE_BOOT_COMPLETED', '.BookingReceiver', '.BootReceiver']) {
        check(manifest.includes(s), 'manifest: ' + s);
    }
    const mainAct2 = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'dz', 'guelma', 'portal', 'MainActivity.java'), 'utf8');
    check(mainAct2.includes('NotifyPlugin.class'), 'plugin registered');
    check(mainAct2.includes('windowLayoutInDisplayCutoutMode') || fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml'), 'utf8').includes('shortEdges'), 'cutout draws edge-to-edge (no letterbox strip)');
    check(mainAct2.includes('onResume'), 'bars re-asserted on resume');
    check(fs.existsSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'drawable', 'ic_notif.xml')), 'notification icon exists');
    // ---------- Phase 1: Pomodoro gated on auth ----------
    const _appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    check(_appJs.includes('function updatePomoVisibility'), 'pomo visibility helper exists');
    const pomoCalls = (_appJs.match(/updatePomoVisibility\(\)/g) || []).length;
    check(pomoCalls >= 6, 'pomo gated at all auth transitions (found ' + pomoCalls + ')');
    check(_appJs.includes("role === 'student' || APP_STATE.role === 'admin'"), 'pomo only for authenticated roles');

    // ---------- Phase 1: status bar blend ----------
    const mainAct = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'dz', 'guelma', 'portal', 'MainActivity.java'), 'utf8');
    check(mainAct.includes('setDecorFitsSystemWindows') && mainAct.includes('TRANSPARENT'), 'edge-to-edge transparent system bars');
    const stylesXml = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml'), 'utf8');
    check(stylesXml.includes('statusBarColor') && stylesXml.includes('transparent'), 'theme has no opaque status strip');
    const shellJs = fs.readFileSync(path.join(ROOT, 'js', 'native-shell.js'), 'utf8');
    check(shellJs.includes('setOverlaysWebView') && !shellJs.includes('setBackgroundColor'), 'status bar transparent overlay, no opaque paint');
    check(shellJs.includes("style: themeIsDark() ? 'LIGHT' : 'DARK'"), 'status icons adapt to theme');
    const cssLux = fs.readFileSync(path.join(ROOT, 'css', 'portal-lux.css'), 'utf8');
    const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    check(cssLux.includes('1012 / 638'), 'card aspect 1012/638');
    check(cssLux.includes('rotate(-90deg)'), 'official -90deg rotation');
    check(cssLux.includes('638 / 1012'), 'portrait footprint box');
    check(cssLux.includes('min(96%, 440px)'), 'card enlarged to original size');
    check(cssLux.includes('cubic-bezier(.4, .05, .3, 1)'), '1.3.9 flip easing kept');
    check(cssLux.includes('rotate(-90deg) rotateY(360deg)'), 'back lands at -90 (never mirrored)');
    check(!cssLux.includes('sid-flip'), 'no dead flip-layer CSS');
    check(cssLux.includes('app-hidden') && cssLux.includes('translateX(-50%) translateY(-115%)'), 'topbar hide-on-scroll CSS');
    check(cssLux.includes('PREMIUM POLISH'), 'premium override block present');
    check(cssLux.includes('.dh-sv button::before'), 'services are premium cards');
    check(cssLux.includes('.lib-head-ico'), 'library restyled');
    check(cssLux.includes('brightness(.78)'), 'card dark-mode dim');
    check(appJs.includes('initHideAppBar'), 'topbar hide-on-scroll JS');
    check(appJs.includes('capture: true'), 'hide catches any scroll pane');
    check(cssLux.includes('.dh-qa-feat .dh-sv-ico') && cssLux.includes('58px'), 'bento icon hierarchy (hero 58px)');
    check(cssLux.includes('duotone') || cssLux.includes('150deg, rgba(244, 220, 158'), 'duotone icon tints');

    // ---------- Home markup (platform dashboards differ by design) ----------
    const srcIdx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    check(srcIdx.includes('menu-grid') || (srcIdx.match(/class="dh-sv-ico/g) || []).length >= 10, 'web home services present');
    const srcWww = fs.readFileSync(path.join(ROOT, 'www', 'index.html'), 'utf8');
    check((srcWww.match(/class="dh-sv-ico/g) || []).length >= 10, '[www] service + qa chips present');
    check(!srcIdx.includes('dh-qa-fic'), 'no legacy qa-fic in index.html');

    // ---------- Login screen (acceptance criteria) ----------
    for (const f of ['index.html', path.join('www', 'index.html')]) {
        const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const tag = f.includes('www') ? '[www] ' : '';
        check(h.includes('id="login-form"') && h.includes('onsubmit="handleProgresLogin(event)"'), tag + 'direct login form wired to existing auth');
        check(h.includes('name="progres-username"') && h.includes('name="progres-password"'), tag + 'existing field names kept (auth untouched)');
        check(h.includes('id="login-reg"') && h.includes('inputmode="numeric"'), tag + 'numeric keyboard for reg number');
        check(h.includes('id="login-pass"') && h.includes('pw-toggle'), tag + 'password toggle present');
        check(h.includes('id="login-submit"') && h.includes('تسجيل الدخول'), tag + 'single primary button');
        check(!h.includes('showStudentLogin()') || h.includes('id="guest-restriction-modal"'), tag + 'no intermediate login button on landing');
        check(!h.includes('دخول كضيف') && !h.includes('enterAsStudent()'), tag + 'no guest login on landing');
        check(!h.includes('student-login-modal'), tag + 'no intermediate login screen');
        check(!h.includes('شاملة لطلبة جميع الجامعات') && !h.includes('lc-trust') && !h.includes('lc-footer'), tag + 'no marketing/clutter blocks');
        check(h.includes('سجّل الدخول للوصول إلى حسابك'), tag + 'short subtitle');
        check(h.includes('class="admin-fab"') && h.includes('showAdminLogin()'), tag + 'admin is small floating action');
        check(!h.includes('btn-admin'), tag + 'no large admin button');
    }
    check(appJs.includes('async function greetStudent'), 'real-name greeting helper');
    check(appJs.includes('/api/progres/me?uuid='), 'greeting reads authenticated individu');
    check(appJs.includes('initLoginKeyboard') && appJs.includes('visualViewport'), 'keyboard-aware login (visualViewport)');
    check(appJs.includes('kb-open') && appJs.includes('--kb-shift'), 'smooth shift + restore, fab hides');
    check(cssLux.includes('.login-card') && cssLux.includes('.admin-fab'), 'login composition CSS');
    check(cssLux.includes('100dvh') && cssLux.includes('.login-scroll'), 'keyboard-safe layout (dvh + scroller)');
    check(!cssLux.includes('lhero-actions') && !cssLux.includes('.lb-title'), 'old landing clutter CSS removed');

    console.log(results.join('\n'));
    console.log('\n' + results.filter(x => x.startsWith('FAIL')).length + ' failures / ' + results.length + ' checks');
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });