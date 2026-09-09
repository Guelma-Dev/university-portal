/* ============================================================
   PORTAL-NOTIFY — notification foundation + meal auto-booking UX.
   - Preferences live in localStorage (survive restarts).
   - Native scheduling/notifications go through NotifyPlugin (Android);
     the web build degrades gracefully with an explanatory note.
   - Booking itself is replayed NATIVELY (BookingReceiver) against OUR
     backend (/api/onou/*), which resolves the ministry session
     server-side — the result notification always reflects the ACTUAL
     server-verified outcome, never mere task execution.
   ============================================================ */
window.PortalNotify = (function () {
    'use strict';

    var KEY = 'portal_notif_v1';
    var CTX_KEY = 'meals_autobook_ctx';
    var LIVE_ORIGIN = 'https://university-portal-gv78.onrender.com';
    var MEAL_NAMES = { 1: 'فطور الصباح', 2: 'الغداء', 3: 'العشاء' };

    function defaults() {
        return { enabled: false, mealAuto: false, classRemind: false, clsSig: '', hour: 18, minute: 0, meals: [2], depotId: 0, depotName: '' };
    }

    function load() {
        try {
            var p = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (p && typeof p === 'object') return Object.assign(defaults(), p);
        } catch (e) {}
        return defaults();
    }

    function save(p) {
        try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
    }

    function isNative() {
        try {
            return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        } catch (e) { return false; }
    }

    function plugin() {
        try {
            return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NotifyPlugin) || null;
        } catch (e) { return null; }
    }

    function apiBase() {
        try {
            var o = String(window.location.origin || '');
            if (isNative() && /(localhost|capacitor)/i.test(o)) return LIVE_ORIGIN;
            return o;
        } catch (e) { return LIVE_ORIGIN; }
    }

    function toast(msg, type) {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    }

    function getSession() {
        try {
            if (typeof window.getOnouSession === 'function') {
                var s = window.getOnouSession();
                if (s && s.uuid) return s;
            }
        } catch (e) {}
        try {
            if (typeof getProgresSession === 'function') {
                var g = getProgresSession();
                if (g && g.uuid) return { uuid: g.uuid, dia: g.selectedCard || g.idCardYear || '' };
            }
        } catch (e) {}
        return null;
    }

    function bookingCtx() {
        try {
            var c = JSON.parse(localStorage.getItem(CTX_KEY) || 'null');
            if (c && c.depotId) return c;
        } catch (e) {}
        return null;
    }

    // Called by sec-meals after a successful manual booking.
    function rememberCtx(depotId, depotName, meals) {
        try {
            if (!depotId || !meals || !meals.length) return;
            localStorage.setItem(CTX_KEY, JSON.stringify({ depotId: depotId, depotName: depotName || '', meals: meals.slice(0, 3) }));
        } catch (e) {}
    }

    async function areEnabled() {
        var pl = plugin();
        if (!pl) return false;
        try {
            var r = await pl.areEnabled();
            return !!(r && r.enabled);
        } catch (e) { return false; }
    }

    // Contextual permission: only when the user enables something that needs it.
    async function ensurePermission(rationale) {
        if (!isNative() || !plugin()) {
            toast('الإشعارات والحجز التلقائي يعملان في تطبيق الأندرويد', 'info');
            return false;
        }
        try {
            if (await areEnabled()) return true;
            toast(rationale || 'فعّل الإشعارات ليصلك تأكيد الحجز', 'info');
            var r = await plugin().requestPermission();
            var ok = !!(r && (r.granted === true || r.granted === 'granted'));
            if (!ok) toast('تم الرفض — يمكنك التفعيل لاحقًا من إعدادات النظام', 'error');
            return ok;
        } catch (e) { return false; }
    }

    async function notify(title, body, channel) {
        var pl = plugin();
        if (pl) {
            try { await pl.notifyNow({ title: title, body: body, channel: channel || 'general' }); return; }
            catch (e) {}
        }
        toast(title + ' — ' + body, 'info');
    }

    // (Re)build the native schedule from prefs + live session. Idempotent:
    // same alarm ID + FLAG_UPDATE_CURRENT => updating replaces, never duplicates.
    async function applySchedule() {
        var p = load();
        var pl = plugin();
        if (!isNative() || !pl) return { ok: false, reason: 'web' };
        if (!p.enabled || !p.mealAuto) {
            try { await pl.cancelBooking(); } catch (e) {}
            return { ok: true, cancelled: true };
        }
        var s = getSession();
        if (!s || !s.uuid) return { ok: false, reason: 'no-session' };
        var ctx = bookingCtx();
        var depotId = (ctx && ctx.depotId) || p.depotId || 0;
        var depotName = (ctx && ctx.depotName) || p.depotName || '';
        var meals = (p.meals && p.meals.length ? p.meals : (ctx && ctx.meals)) || [];
        if (!depotId || !meals.length) return { ok: false, reason: 'no-depot' };
        var names = meals.map(function (m) { return MEAL_NAMES[m] || ''; }).filter(Boolean).join(' و ');
        try {
            var r = await pl.scheduleBooking({
                hour: p.hour, minute: p.minute,
                apiBase: apiBase(), uuid: String(s.uuid), dia: String(s.dia || ''),
                depotId: Number(depotId), depotName: String(depotName || ''),
                meals: meals.join(','), mealNames: names,
            });
            save(Object.assign(p, { depotId: depotId, depotName: depotName, meals: meals }));
            return { ok: true, exact: !!(r && r.exact) };
        } catch (e) {
            return { ok: false, reason: 'schedule-failed' };
        }
    }

    // Called at boot (restored session) and after login: re-establish
    // scheduling from saved prefs without touching the prefs themselves.
    async function restore() {
        var p = load();
        if (!p.mealAuto && !p.classRemind) return;
        if (p.mealAuto) await applySchedule();
        if (p.classRemind) await rebuildClassReminders();
    }

    // Logout must not leave orphaned tasks behind (booking needs the
    // authenticated session; reminders belong to the previous student).
    // Prefs are kept so re-login restores scheduling automatically.
    async function onLogout() {
        var pl = plugin();
        if (pl) { try { await pl.cancelBooking(); } catch (e) {} }
        try { await cancelClassReminders(); } catch (e) {}
    }

    function pad2(n) { return String(n).padStart(2, '0'); }
    function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

    // FINAL timetable the user actually sees: personal overlay wins over the
    // university cell; empty/deleted slots yield nothing. No separate DB.
    function computeClassReminders() {
        var out = [];
        try {
            if (typeof DAYS === 'undefined' || typeof TIME_SLOTS === 'undefined') return out;
            if (typeof ptsOverlay !== 'function') return out;
            var sched = (typeof schedule !== 'undefined' && schedule) ? schedule : {};
            var empty = (typeof isScheduleEmpty === 'function') ? isScheduleEmpty() : false;
            var toMin = (typeof dhToMin === 'function') ? dhToMin : function () { return -1; };
            var now = Date.now();
            for (var dd = 0; dd < 7; dd++) {
                var dt = new Date();
                dt.setDate(dt.getDate() + dd);
                dt.setHours(0, 0, 0, 0);
                var js = dt.getDay();
                if (js < 0 || js > 4) continue; // Fri/Sat off, like the home view
                var day = DAYS[js];
                for (var i = 0; i < TIME_SLOTS.length; i++) {
                    var parts = String(TIME_SLOTS[i]).split('-');
                    var sm = toMin((parts[0] || '').trim());
                    if (sm < 0) continue;
                    var subject = '', room = '';
                    var ov = null;
                    try { ov = ptsOverlay(day, i); } catch (e) {}
                    if (ov && ov.subject) {
                        subject = String(ov.subject).trim();
                        room = String(ov.room || '').trim();
                    } else if (!empty) {
                        var cell = sched[day + '_' + i] || {};
                        var text = cell.text ? String(cell.text).trim() : '';
                        if (text) subject = text;
                    }
                    if (!subject) continue; // empty/deleted slot: no reminder
                    var at = dt.getTime() + sm * 60000 - 3600000; // 1h before
                    if (at <= now + 60000) continue; // past or imminent: skip
                    out.push({ id: 'cls-' + dayStr(dt) + '-' + i, at: at, subject: subject, room: room });
                }
            }
        } catch (e) {}
        return out;
    }

    var _rebuildChain = Promise.resolve();
    function rebuildClassReminders() {
        _rebuildChain = _rebuildChain.then(_rebuildClassRemindersInner).catch(function () {});
        return _rebuildChain;
    }

    async function _rebuildClassRemindersInner() {
        var p = load();
        var pl = plugin();
        if (!p.enabled || !p.classRemind || !isNative() || !pl) {
            if ((p.clsSig || '') !== '') {
                p.clsSig = '';
                save(p);
                if (pl) { try { await pl.cancelReminders({ tag: 'cls' }); } catch (e) {} }
            }
            return { ok: false };
        }
        var list = computeClassReminders();
        var sig = list.map(function (r) { return r.id + '@' + r.at + '#' + r.subject + '|' + r.room; }).join(';');
        if (sig === (p.clsSig || '')) return { ok: true, unchanged: true };
        p.clsSig = sig;
        save(p);
        try { await pl.cancelReminders({ tag: 'cls' }); } catch (e) {}
        if (!sig) return { ok: true, cancelled: true };
        for (var k = 0; k < list.length; k++) {
            var r = list[k];
            var body = 'لديك محاضرة ' + r.subject + ' بعد ساعة' + (r.room ? '\nالقاعة: ' + r.room : '');
            try {
                await pl.scheduleReminder({ id: r.id, tag: 'cls', triggerAt: r.at, title: 'تذكير بالمحاضرة', body: body, channel: 'general' });
            } catch (e) {}
        }
        return { ok: true, count: list.length };
    }

    async function cancelClassReminders() {
        var p = load();
        p.clsSig = '';
        save(p);
        var pl = plugin();
        if (pl) { try { await pl.cancelReminders({ tag: 'cls' }); } catch (e) {} }
    }

    return {
        load: load, save: save, isNative: isNative,
        rememberCtx: rememberCtx, bookingCtx: bookingCtx,
        ensurePermission: ensurePermission, areEnabled: areEnabled,
        notify: notify, applySchedule: applySchedule,
        restore: restore, onLogout: onLogout, MEAL_NAMES: MEAL_NAMES,
        computeClassReminders: computeClassReminders,
        rebuildClassReminders: rebuildClassReminders,
        cancelClassReminders: cancelClassReminders,
    };
})();
/* ---- settings-screen bindings (account section) ---- */
window.PortalNotifyUI = (function () {
    'use strict';

    function paint() {
        var N = window.PortalNotify;
        if (!N) return;
        var p = N.load();
        var set = function (id, on) {
            var b = document.getElementById(id);
            if (!b) return;
            b.classList.toggle('on', !!on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        };
        set('sw-notif', p.enabled);
        set('sw-auto', p.mealAuto);
        set('sw-class', p.classRemind);
        var sub = document.getElementById('auto-sub');
        if (sub) sub.classList.toggle('hidden', !p.mealAuto);
        var t = document.getElementById('auto-time');
        if (t) t.value = String(p.hour).padStart(2, '0') + ':' + String(p.minute).padStart(2, '0');
        var ctx = N.bookingCtx() || {};
        var dep = document.getElementById('auto-depot');
        if (dep) {
            var nm = ctx.depotName || p.depotName || '';
            dep.textContent = nm ? ('المطعم: ' + nm) : 'احجز وجبة يدويًا مرة واحدة لاختيار المطعم تلقائيًا';
        }
        document.querySelectorAll('#auto-meals [data-meal]').forEach(function (b) {
            var m = Number(b.getAttribute('data-meal'));
            b.classList.toggle('sel', (p.meals || []).indexOf(m) !== -1);
        });
        // Honest state: if features are on but the OS blocks notifications, say so.
        var denied = document.getElementById('notif-denied');
        if (denied) {
            denied.classList.add('hidden');
            if ((p.enabled || p.mealAuto || p.classRemind) && N.isNative()) {
                N.areEnabled().then(function (ok) {
                    if (!ok) denied.classList.remove('hidden');
                }).catch(function () {});
            }
        }
    }

    function toast(msg, type) {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    }

    async function toggleMaster() {
        var N = window.PortalNotify;
        if (!N) return;
        var p = N.load();
        if (!p.enabled) {
            if (!(await N.ensurePermission())) { paint(); return; }
            p.enabled = true;
            N.save(p);
            toast('تم تفعيل الإشعارات', 'success');
        } else {
            p.enabled = false;
            N.save(p);
            await N.applySchedule(); // cancels native schedule too
            toast('تم إيقاف الإشعارات', 'info');
        }
        paint();
    }

    async function toggleAuto() {
        var N = window.PortalNotify;
        if (!N) return;
        var p = N.load();
        if (!p.mealAuto) {
            var ctx = N.bookingCtx();
            if (!ctx || !ctx.depotId) {
                toast('احجز وجبة يدويًا مرة واحدة أولًا لاختيار المطعم', 'error');
                paint();
                return;
            }
            if (!(await N.ensurePermission())) { paint(); return; }
            p.mealAuto = true;
            if (!p.enabled) p.enabled = true;
            N.save(p);
            var r = await N.applySchedule();
            if (r && r.ok) toast('تم تفعيل الحجز التلقائي', 'success');
            else if (r && r.reason === 'no-session') toast('سجّل الدخول أولًا', 'error');
            else if (r && r.reason === 'web') toast('الحجز التلقائي يعمل في تطبيق الأندرويد', 'info');
            else toast('تعذر تفعيل الحجز التلقائي', 'error');
        } else {
            p.mealAuto = false;
            N.save(p);
            await N.applySchedule(); // cancels
            toast('تم إيقاف الحجز التلقائي', 'info');
        }
        paint();
    }

    async function setTime(v) {
        var N = window.PortalNotify;
        if (!N || !v) return;
        var parts = String(v).split(':');
        var p = N.load();
        p.hour = Math.max(0, Math.min(23, parseInt(parts[0], 10) || 0));
        p.minute = Math.max(0, Math.min(59, parseInt(parts[1], 10) || 0));
        N.save(p);
        if (p.mealAuto) {
            var r = await N.applySchedule(); // replaces previous schedule
            if (r && r.ok) toast('تم تحديث وقت الحجز', 'success');
        }
        paint();
    }

    async function toggleClass() {
        var N = window.PortalNotify;
        if (!N) return;
        var p = N.load();
        if (!p.classRemind) {
            if (!(await N.ensurePermission('لتلقي تذكيرات المحاضرات ونتائج الحجز التلقائي، يحتاج التطبيق إلى إذن الإشعارات.'))) { paint(); return; }
            p.classRemind = true;
            if (!p.enabled) p.enabled = true;
            N.save(p);
            var r = await N.rebuildClassReminders();
            if (r && r.count) toast('تم تفعيل تذكير المحاضرات', 'success');
            else toast('تم التفعيل — لا توجد حصص قادمة هذا الأسبوع', 'info');
        } else {
            p.classRemind = false;
            N.save(p);
            await N.rebuildClassReminders(); // cancels stale ones
            toast('تم إيقاف تذكير المحاضرات', 'info');
        }
        paint();
    }

    async function toggleMeal(m) {        var N = window.PortalNotify;
        if (!N) return;
        m = Number(m);
        var p = N.load();
        var arr = (p.meals || []).slice();
        var i = arr.indexOf(m);
        if (i === -1) arr.push(m); else arr.splice(i, 1);
        if (!arr.length) { toast('اختر وجبة واحدة على الأقل', 'error'); return; }
        arr.sort();
        p.meals = arr;
        N.save(p);
        if (p.mealAuto) await N.applySchedule();
        paint();
    }

    var _tapN = 0, _tapT = null;
    function devTap() {
        _tapN++;
        if (_tapT) clearTimeout(_tapT);
        _tapT = setTimeout(function () { _tapN = 0; }, 1500);
        if (_tapN >= 3) {
            _tapN = 0;
            clearTimeout(_tapT);
            runNotifTests();
        }
    }

    // Developer-only test trigger: uses the REAL scheduling + display paths
    // (native scheduleReminder + notifyNow). Never touches booking logic and
    // never claims a real booking happened (manual trigger + test content).
    async function runNotifTests() {
        var N = window.PortalNotify;
        if (!N || !N.isNative()) { toast('اختبار الإشعارات يعمل في تطبيق الأندرويد', 'info'); return; }
        try {
            if (!(await N.ensurePermission('لاختبار تذكيرات المحاضرات يحتاج التطبيق إلى إذن الإشعارات.'))) return;
            var C = null;
            try { C = window.Capacitor.Plugins.NotifyPlugin; } catch (e) {}
            if (!C) return;
            var at = Date.now() + 2 * 60 * 1000;
            await C.scheduleReminder({ id: 'test-cls-' + at, tag: 'test', triggerAt: at, title: 'تذكير بالمحاضرة', body: 'لديك محاضرة اختبار بعد ساعة\nالقاعة: B12', channel: 'general' });
            await N.notify('حجز الوجبات', 'تم حجز الوجبة بنجاح [اختبار]', 'meals');
            setTimeout(function () { N.notify('حجز الوجبات', 'تعذر حجز الوجبة [اختبار]', 'meals'); }, 4000);
            toast('اختبار الإشعارات: تذكير المحاضرة بعد دقيقتين', 'success');
        } catch (e) {
            toast('تعذر تشغيل الاختبار', 'error');
        }
    }

    return { paint: paint, toggleMaster: toggleMaster, toggleAuto: toggleAuto, toggleClass: toggleClass, setTime: setTime, toggleMeal: toggleMeal, devTap: devTap, runNotifTests: runNotifTests };
})();

// Rebuild class reminders when returning to the app (covers reboot +
// late-granted permission); the signature guard makes this a no-op usually.
try {
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && window.PortalNotify) {
            try { window.PortalNotify.rebuildClassReminders(); } catch (e) {}
        }
    });
} catch (e) {}
