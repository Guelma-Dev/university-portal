/* ============================================================
   PORTAL-FEEL — Nova motion + haptics + splash controller.
   - Forces dark theme (Nova is dark-only; toggles hidden in CSS).
   - Capacitor Haptics with navigator.vibrate fallback (single owner:
     legacy portalVibrateFunc is rerouted here to avoid double buzz).
   - SVG splash overlay: path-draw -> glow flash -> fade, then remove.
   Layers: feel only. No data, no network, never throws.
   ============================================================ */
(function () {
    'use strict';

    // Force dark before first paint (script runs at parse time).
    try {
        document.documentElement.setAttribute('data-theme', 'dark');
        window.localStorage.setItem('theme', 'dark');
        document.body.classList.add('boot');
        setTimeout(function () {
            try { document.body.classList.remove('boot'); } catch (e) {}
        }, 5600);
    } catch (e) {}

    function isNative() {
        try {
            return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        } catch (e) { return false; }
    }

    function haptics() {
        try {
            return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) || null;
        } catch (e) { return null; }
    }

    function vibrate(ms) {
        try {
            if (navigator.vibrate) navigator.vibrate(ms);
        } catch (e) {}
    }

    var Feel = {
        tap: function () {
            var h = haptics();
            if (h && h.impact) { h.impact({ style: 'LIGHT' }).catch(function () { vibrate(10); }); return; }
            vibrate(10);
        },
        nav: function () {
            var h = haptics();
            if (h && h.selectionChanged) { h.selectionChanged().catch(function () { vibrate(8); }); return; }
            vibrate(8);
        },
        error: function () {
            var h = haptics();
            if (h && h.notification) { h.notification({ type: 'ERROR' }).catch(function () { vibrate([30, 40, 30]); }); return; }
            vibrate([30, 40, 30]);
        },
        success: function () {
            var h = haptics();
            if (h && h.notification) { h.notification({ type: 'SUCCESS' }).catch(function () { vibrate(15); }); return; }
            vibrate(15);
        },
    };
    window.Feel = Feel;

    // Single haptic owner: reroute the legacy 12ms tap buzz through Feel.
    function ownLegacyBuzz() {
        try { window.portalVibrateFunc = function () { Feel.tap(); }; } catch (e) {}
    }

    // Universal error buzz: every showToast(..., 'error') buzzes once.
    function hookErrors() {
        try {
            if (typeof window.showToast !== 'function' || window.showToast.__feel) return;
            var orig = window.showToast;
            var wrapped = function (msg, type) {
                if (type === 'error') { try { Feel.error(); } catch (e2) {} }
                return orig(msg, type);
            };
            wrapped.__feel = true;
            window.showToast = wrapped;
        } catch (e) {}
    }

    // Nav tick on section change.
    function hookNav() {
        try {
            window.addEventListener('hashchange', function () {
                try { Feel.nav(); } catch (e) {}
            });
        } catch (e) {}
    }

    // Tap tick on buttons/nav (delegated, native only — web gets silence).
    function hookTaps() {
        try {
            document.addEventListener('click', function (ev) {
                if (!isNative()) return;
                var t = ev.target;
                try {
                    if (t && t.closest && t.closest('.btn,.bn-item,.qa-item,button')) Feel.tap();
                } catch (e) {}
            }, { passive: true });
        } catch (e) {}
    }

    // Ripple: expanding glow circle from the touch point (GPU only).
    function hookRipple() {
        try {
            document.addEventListener('pointerdown', function (ev) {
                var t = null;
                try { t = ev.target && ev.target.closest ? ev.target.closest('.btn') : null; } catch (e) {}
                if (!t) return;
                try {
                    var r = t.getBoundingClientRect();
                    var d = Math.max(r.width, r.height) * 2.2;
                    var s = document.createElement('span');
                    s.className = 'ripple';
                    s.style.width = s.style.height = d + 'px';
                    s.style.left = (ev.clientX - r.left - d / 2) + 'px';
                    s.style.top = (ev.clientY - r.top - d / 2) + 'px';
                    t.appendChild(s);
                    setTimeout(function () { try { s.remove(); } catch (e2) {} }, 600);
                } catch (e) {}
            }, { passive: true });
        } catch (e) {}
    }

    // Success buzz when an install completes (if updater present).
    function hookInstall() {
        try {
            if (window.PortalUpdate && window.PortalUpdate.onChange) {
                window.PortalUpdate.onChange(function (st) {
                    if (st && st.name === 'downloaded') { try { Feel.success(); } catch (e) {} }
                });
            }
        } catch (e) {}
    }

    // White status icons on the navy chrome (theme is forced dark).
    function fixStatusBar() {
        try {
            if (window.PortalNative && typeof window.PortalNative.setStatusBarTheme === 'function') {
                window.PortalNative.setStatusBarTheme();
            }
        } catch (e) {}
    }

    // ---- Splash v7-slow: clip-reveal draw (2.4s, user: let it take its
    // time) + pen + fill + swallow (~4.45s); min 3850ms, fail-safe 4550ms ----
    var T0 = Date.now();    function dismissSplash() {
        try {
            var el = document.getElementById('nova-splash');
            if (!el || el.classList.contains('done')) return;
            el.classList.add('done');
            setTimeout(function () {
                try { el.remove(); } catch (e) {}
            }, 600);
        } catch (e) {}
    }
    function splashSchedule() {
        var wait = Math.max(0, 3850 - (Date.now() - T0));
        setTimeout(dismissSplash, wait);
        setTimeout(dismissSplash, 4550); // fail-safe
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                var el = document.getElementById('nova-splash');
                if (el) el.remove();
            }
        } catch (e) {}
    }

    // ================= DFL MOTION =================

    function landingVisible() {
        try {
            var l = document.getElementById('landing-page');
            return !!(l && !l.classList.contains('hidden'));
        } catch (e) { return false; }
    }

    /* ---- Electric bolts canvas (midpoint displacement, GPU strokes) ---- */
    var boltsRAF = 0, bolts = [], boltNext = 0;
    function boltsStart() {
        try {
            var cv = document.getElementById('df-bolts');
            if (!cv || !cv.getContext) return;
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            var ctx = cv.getContext('2d');
            var W = 0, H = 0, DPR = 1;
            function size() {
                try {
                    // cap 1.5: DPR 2 doubles the stroke raster cost on weak phones
                    DPR = Math.min(1.5, window.devicePixelRatio || 1);
                    W = cv.clientWidth; H = cv.clientHeight;
                    cv.width = W * DPR; cv.height = H * DPR;
                    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
                } catch (e) {}
            }
            size();
            window.addEventListener('resize', size);
            function midBolt(x0, y0, x1, y1, disp) {
                var pts = [[x0, y0], [x1, y1]];
                var d = disp;
                while (d > 4) {
                    var out = [pts[0]];
                    for (var i = 0; i < pts.length - 1; i++) {
                        var mx = (pts[i][0] + pts[i + 1][0]) / 2 + (Math.random() - .5) * d;
                        var my = (pts[i][1] + pts[i + 1][1]) / 2 + (Math.random() - .5) * d;
                        out.push([mx, my], pts[i + 1]);
                    }
                    pts = out; d /= 2;
                }
                // 1-2 thin branches
                var nb = 1 + ((Math.random() * 2) | 0);
                for (var b = 0; b < nb; b++) {
                    var at = pts[(Math.random() * (pts.length - 2) + 1) | 0];
                    var bl = 20 + Math.random() * 40;
                    out = [at];
                    var bx = at[0], by = at[1];
                    for (var s = 0; s < 3; s++) {
                        bx += (Math.random() - .5) * bl; by += bl / 3;
                        out.push([bx, by]);
                    }
                    pts.branches = pts.branches || [];
                    pts.branches.push(out);
                }
                return pts;
            }
            function spawn() {
                var x = Math.random() * W;
                bolts.push({ pts: midBolt(x, -10, x + (Math.random() - .5) * 120, H * (0.5 + Math.random() * 0.4), 46), born: performance.now(), life: 600 });
            }
            function frame(now) {
                try {
                    // Park the loop while the login screen is hidden: no RAF
                    // churn, a cheap 600ms timer wakes it back up.
                    if (document.hidden || !landingVisible()) {
                        ctx.clearRect(0, 0, W, H);
                        bolts = []; boltNext = now + 800;
                        boltsRAF = 0;
                        setTimeout(function () {
                            if (!boltsRAF) boltsRAF = requestAnimationFrame(frame);
                        }, 600);
                        return;
                    }
                    boltsRAF = requestAnimationFrame(frame);
                    ctx.clearRect(0, 0, W, H);
                    if (now >= boltNext) { spawn(); boltNext = now + 1800 + Math.random() * 1200; }
                    bolts = bolts.filter(function (b) { return now - b.born < b.life; });
                    for (var i = 0; i < bolts.length; i++) {
                        var b = bolts[i], k = 1 - (now - b.born) / b.life;
                        ctx.save();
                        ctx.globalAlpha = Math.max(0, k) * 0.9;
                        // Fake glow = two strokes (shadowBlur is a per-frame
                        // raster cost weak phones can't afford).
                        ctx.strokeStyle = 'rgba(47, 124, 246, .30)';
                        ctx.lineWidth = 3.5;
                        strokeBolt(b.pts);
                        ctx.strokeStyle = '#BFD9FF';
                        ctx.lineWidth = 1.2;
                        strokeBolt(b.pts);
                        ctx.restore();
                    }
                } catch (e) {}
            }
            function strokeBolt(pts) {
                ctx.beginPath();
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
                ctx.stroke();
                var brs = pts.branches || [];
                for (var q = 0; q < brs.length; q++) {
                    ctx.beginPath();
                    ctx.moveTo(brs[q][0][0], brs[q][0][1]);
                    for (var w = 1; w < brs[q].length; w++) ctx.lineTo(brs[q][w][0], brs[q][w][1]);
                    ctx.stroke();
                }
            }
            boltNext = performance.now() + 500;
            boltsRAF = requestAnimationFrame(frame);
        } catch (e) {}
    }

    /* ---- Auth: segmented student/guest + keep-me + spinner + validation ---- */
    var authMode = 'student', keepChecked = true, submitSpinT = 0;
    function hookAuth() {
        try {
            var form = document.getElementById('login-form');
            var landing = document.getElementById('landing-page');
            if (!form || !landing) return;
            // Segmented
            var btns = form.querySelectorAll('.df-seg-btn');
            for (var i = 0; i < btns.length; i++) {
                (function (b) {
                    b.addEventListener('click', function () {
                        try {
                            authMode = b.getAttribute('data-mode') || 'student';
                            for (var j = 0; j < btns.length; j++) btns[j].classList.toggle('on', btns[j] === b);
                            var seg = form.querySelector('.df-seg');
                            if (seg) seg.classList.toggle('guest', authMode === 'guest');
                            landing.classList.toggle('guest', authMode === 'guest');
                            var lbl = form.querySelector('#login-submit .df-label');
                            if (lbl) lbl.innerHTML = authMode === 'guest'
                                ? 'الدخول كضيف' : '<i class="fas fa-right-to-bracket"></i> تسجيل الدخول';
                            if (typeof Feel !== 'undefined') Feel.nav();
                        } catch (e) {}
                    });
                })(btns[i]);
            }
            // Submit routing rides on a DOCUMENT-CAPTURE listener: it must run
            // BEFORE the form's inline onsubmit (handleProgresLogin), and the
            // form is novalidate — hidden required fields in guest mode used
            // to block the submit event entirely (guest login dead).
            try {
                document.addEventListener('submit', function (ev) {
                    try {
                        var f = ev.target;
                        if (!f || f.id !== 'login-form') return;
                        var k = document.getElementById('login-keep');
                        keepChecked = !k || !!k.checked;
                        var btn = document.getElementById('login-submit');
                        if (btn) {
                            btn.classList.add('loading');
                            if (submitSpinT) clearTimeout(submitSpinT);
                            submitSpinT = setTimeout(function () { try { btn.classList.remove('loading'); } catch (e) {} }, 25000);
                        }
                        if (authMode === 'guest') {
                            ev.preventDefault();
                            ev.stopPropagation();
                            if (btn) btn.classList.remove('loading');
                            if (typeof enterAsStudent === 'function') enterAsStudent();
                            return;
                        }
                        // Student with empty fields: show validation visuals and
                        // stop the call before the inline handler runs.
                        var u = document.getElementById('login-reg');
                        var p = document.getElementById('login-pass');
                        if (u && p && (!String(u.value || '').trim() || !String(p.value || ''))) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            if (btn) btn.classList.remove('loading');
                            dfBadSubmit();
                            try { Feel.error(); } catch (e2) {}
                        }
                    } catch (e) {}
                }, true);
            } catch (e) {}
            // Landing hides = login success: settle spinner + honor keep-me
            try {
                var mo = new MutationObserver(function () {
                    try {
                        if (landing.classList.contains('hidden')) {
                            var btn = document.getElementById('login-submit');
                            if (btn) btn.classList.remove('loading');
                            if (!keepChecked) {
                                var uuid = null;
                                try {
                                    var s = JSON.parse(window.localStorage.getItem('progres_session') || 'null');
                                    uuid = s && s.uuid;
                                } catch (e2) {}
                                if (uuid && typeof removeProgresAccount === 'function') removeProgresAccount(uuid);
                            }
                        }
                    } catch (e) {}
                });
                mo.observe(landing, { attributes: true, attributeFilter: ['class'] });
            } catch (e) {}
            // Clear validation on input
            form.addEventListener('input', function (ev) {
                try {
                    var g = ev.target && ev.target.closest ? ev.target.closest('.input-group') : null;
                    if (g && g.classList.contains('field-error')) {
                        g.classList.remove('field-error');
                        var h = g.querySelector('.field-msg');
                        if (h) h.hidden = true;
                    }
                } catch (e) {}
            });
            // Forgot link (honest toast) — staff login is an inline button now.
            var fg = document.getElementById('forgot-link');
            if (fg) fg.addEventListener('click', function () {
                try { window.showToast('لتغيير كلمة المرور راجع مصلحة الدراسة', 'info'); } catch (e) {}
            });
        } catch (e) {}
    }

    // Validation visuals ride on the existing error-toast path.
    var _origToastHooked = false;
    function hookValidation() {
        if (_origToastHooked) return;
        _origToastHooked = true;
        try {
            var iv = setInterval(function () {
                try {
                    if (typeof window.showToast === 'function' && !window.showToast.__dfv) {
                        var orig = window.showToast;
                        var wrapped = function (msg, type) {
                            if (type === 'error' && landingVisible()) dfBadSubmit();
                            return orig(msg, type);
                        };
                        wrapped.__feel = orig.__feel;
                        wrapped.__dfv = true;
                        window.showToast = wrapped;
                        clearInterval(iv);
                    }
                } catch (e) {}
            }, 500);
        } catch (e) {}
    }

    function dfBadSubmit() {
        try {
            var sheet = document.querySelector('#login-form.df-sheet');
            if (sheet) {
                sheet.classList.remove('shake');
                void sheet.offsetWidth;
                sheet.classList.add('shake');
                setTimeout(function () { try { sheet.classList.remove('shake'); } catch (e) {} }, 450);
            }
            var groups = document.querySelectorAll('#login-form .input-group');
            for (var i = 0; i < groups.length; i++) {
                var inp = groups[i].querySelector('input');
                if (inp && !String(inp.value || '').trim()) {
                    groups[i].classList.add('field-error');
                    var h = groups[i].querySelector('.field-msg');
                    if (h) h.hidden = false;
                }
            }
        } catch (e) {}
    }

    /* ---- Onboarding: first entry to main-app ---- */
    function hookOnboard() {
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
            var done = false;
            try { done = window.localStorage.getItem('nova_onboard') === '1'; } catch (e) { done = true; }
            if (done) return;
            var main = document.getElementById('main-app');
            var ob = document.getElementById('df-onboard');
            if (!main || !ob) return;
            function maybe() {
                try {
                    if (main.classList.contains('hidden')) return;
                    if (window.localStorage.getItem('nova_onboard') === '1') return;
                    ob.classList.remove('hidden');
                    ob.setAttribute('aria-hidden', 'false');
                } catch (e) {}
            }
            var cta = document.getElementById('df-ob-cta');
            if (cta) cta.addEventListener('click', function () {
                try {
                    window.localStorage.setItem('nova_onboard', '1');
                    ob.classList.add('hidden');
                    ob.setAttribute('aria-hidden', 'true');
                    if (typeof Feel !== 'undefined') Feel.success();
                } catch (e) {}
            });
            try {
                var mo = new MutationObserver(maybe);
                mo.observe(main, { attributes: true, attributeFilter: ['class'] });
            } catch (e) {}
            setTimeout(maybe, 3600);
        } catch (e) {}
    }

    function boot() {
        ownLegacyBuzz();
        hookErrors();
        hookNav();
        hookTaps();
        hookRipple();
        hookInstall();
        hookAuth();
        hookValidation();
        hookOnboard();
        boltsStart();
        fixStatusBar();
        fixStatusBar();
        splashSchedule();
        // native-shell (defer) assigns portalVibrateFunc later — re-own it.
        setTimeout(ownLegacyBuzz, 1500);
        setTimeout(fixStatusBar, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
