(function () {
    'use strict';

    function active() {
        try {
            return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        } catch (e) {
            return false;
        }
    }

    if (!active()) return;

    document.addEventListener('DOMContentLoaded', function () {
        document.body.classList.add('native-app');

        if (typeof window.PortalNative !== 'undefined' && window.PortalNative.authenticate) {
            window.PortalNative.auth = {
                when: window.PortalNative.authenticate,
            };
        }

        var C = window.Capacitor;

        function statusBar() {
            var sb = C && C.Plugins && C.Plugins.StatusBar;
            if (!sb || !sb.setOverlaysWebView || !sb.setBackgroundColor) return;
            sb.setOverlaysWebView({ overlay: true }).catch(function () {});
            var dark = themeIsDark();
            sb.setBackgroundColor({ color: dark ? '#0a0a0a' : '#F6F2E9' }).catch(function () {});
            if (sb.setStyle) sb.setStyle({ style: dark ? 'LIGHT' : 'DARK' }).catch(function () {});
        }

        function themeIsDark() {
            var th = '';
            try { th = String(document.documentElement.getAttribute('data-theme') || ''); } catch (e) {}
            if (!th) {
                try { th = String(window.localStorage.getItem('theme') || ''); } catch (e) {}
            }
            return th !== 'light';
        }

        window.PortalNative.setStatusBarTheme = statusBar;

        if (C && C.Plugins && C.Plugins.StatusBar) {
            statusBar();
        } else {
            window.addEventListener('capacitor:plugin-load', statusBar, { once: true });
        }

        var splash = C && C.Plugins && C.Plugins.SplashScreen;
        if (splash && splash.hide) {
            var tryHide = function () {
                splash.hide().catch(function () {});
            };
            // Hide as soon as the first content frame is painted (login UI visible).
            // Fail-safe at 4s so the screen never sticks black if the bridge is late.
            var painted = false;
            var onPaint = function () {
                if (painted) return;
                painted = true;
                setTimeout(tryHide, 80);
            };
            window.requestAnimationFrame(function () {
                window.requestAnimationFrame(onPaint);
            });
            setTimeout(tryHide, 4000);
        }

        var firstTouch = 0;
        document.addEventListener('touchstart', function () {
            firstTouch = Date.now();
        }, { passive: true });
        document.addEventListener('touchend', function (e) {
            if (Date.now() - firstTouch < 220 && window.portalVibrateFunc) {
                try { window.portalVibrateFunc(); } catch (err) {}
            }
        }, { passive: true });

        try {
            window.portalVibrateFunc = function () {
                (navigator.vibrate || function () {}).call(navigator, 12);
            };
        } catch (e) {}

        try {
            if (navigator.connection && navigator.connection.addEventListener) {
                navigator.connection.addEventListener('change', function () {
                    var off = !navigator.onLine;
                    var tag = document.getElementById('pn-net');
                    if (off && !tag) {
                        var el = document.createElement('div');
                        el.id = 'pn-net';
                        el.className = 'pn-netline';
                        el.textContent = 'لا يوجد اتصال بالإنترنت';
                        document.body.appendChild(el);
                    } else if (off && tag) {
                        tag.style.display = 'flex';
                    } else if (tag) {
                        tag.style.display = 'none';
                    }
                });
            }
        } catch (e) {}
    });
})();