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
        }, 5200);
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

    // ---- Splash: swallow ends ~2.5s; fade, min 2500ms, max 3300ms ----
    var T0 = Date.now();
    function dismissSplash() {
        try {
            var el = document.getElementById('nova-splash');
            if (!el || el.classList.contains('done')) return;
            el.classList.add('done');
            setTimeout(function () {
                try { el.remove(); } catch (e) {}
            }, 650);
        } catch (e) {}
    }
    function splashSchedule() {
        var wait = Math.max(0, 2500 - (Date.now() - T0));
        setTimeout(dismissSplash, wait);
        setTimeout(dismissSplash, 3300); // fail-safe
        try {
            if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                var el = document.getElementById('nova-splash');
                if (el) el.remove();
            }
        } catch (e) {}
    }

    function boot() {
        ownLegacyBuzz();
        hookErrors();
        hookNav();
        hookTaps();
        hookRipple();
        hookInstall();
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
