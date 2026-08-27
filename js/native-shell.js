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
            sb.setBackgroundColor({ color: '#0a0a0a' }).catch(function () {});
            if (sb.setStyle) sb.setStyle({ style: 'LIGHT' }).catch(function () {});
        }

        if (C && C.Plugins && C.Plugins.StatusBar) {
            statusBar();
        } else {
            window.addEventListener('capacitor:plugin-load', statusBar, { once: true });
        }

        var splash = C && C.Plugins && C.Plugins.SplashScreen;
        if (splash && splash.hide) {
            setTimeout(function () {
                splash.hide().catch(function () {});
            }, 600);
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