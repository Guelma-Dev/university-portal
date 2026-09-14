'use strict';

// Copies the web app (index.html + css/ + js/) into www/ consumed by Capacitor.
// Run: npm run app:prep   (auto-runs before `npx cap sync`)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

// The Android shell ships its own home dashboard (index.android.html —
// platform dashboards differ by design, see tools/harness.js). Shared
// css/ + js/ are identical on both platforms.
const ANDROID_HTML = path.join(ROOT, 'index.android.html');
const WEB_HTML = path.join(ROOT, 'index.html');

// Cache busters must equal the release versionName (harness enforces this
// so OTA updates never serve stale assets).
function releaseVersion() {
    try {
        const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
        const m = gradle.match(/versionName\s+"([^"]+)"/);
        if (m) return m[1];
    } catch (e) { /* fall through */ }
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

// JS assets are cache-busted by appending ?v=<versionName> to every tag.
const BUST = 'v=' + releaseVersion();

function rmDir(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function cp(srcBase, dstBase) {
    fs.mkdirSync(dstBase, { recursive: true });
    const entries = fs.readdirSync(srcBase, { withFileTypes: true });
    for (const e of entries) {
        const s = path.join(srcBase, e.name);
        const d = path.join(dstBase, e.name);
        if (e.isDirectory()) {
            cp(s, d);
        } else {
            fs.copyFileSync(s, d);
        }
    }
}

function main() {
    rmDir(WWW);
    fs.mkdirSync(WWW, { recursive: true });

    cp(path.join(ROOT, 'css'), path.join(WWW, 'css'));
    cp(path.join(ROOT, 'js'), path.join(WWW, 'js'));

    let html = fs.readFileSync(fs.existsSync(ANDROID_HTML) ? ANDROID_HTML : WEB_HTML, 'utf8');

    // Cache-bust local script tags (normalize any existing ?v= first).
    html = html.replace(/(<script[^>]+src=")([^"?]+)(\?v=[^"]*)?"/g, (m, pre, src) => {
        if (/^https?:|^\/\//.test(src)) return m;
        return `${pre}${src}?${BUST}"`;
    });
    // Same for css links.
    html = html.replace(/(<link[^>]+href=")([^"?]+)(\?v=[^"]*)?"/g, (m, pre, href) => {
        if (/^https?:|^\/\//.test(href)) return m;
        return `${pre}${href}?${BUST}"`;
    });

    fs.writeFileSync(path.join(WWW, 'index.html'), html);
    console.log('www ready (android): ' + BUST);
}

main();