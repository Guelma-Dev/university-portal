'use strict';

// Copies the web app (index.html + css/ + js/ + assets/) into www/ consumed by Capacitor.
// Run: npm run app:prep   (auto-runs before `npx cap sync`)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

// Single source of truth: the release versionName from android/app/build.gradle.
// (A date stamp here would desync www busters from the release and break OTA freshness checks.)
function releaseVersion() {
    const g = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
    const m = g.match(/versionName\s+"([^"]+)"/);
    if (!m) throw new Error('versionName not found in android/app/build.gradle');
    return m[1];
}
const VERSION = releaseVersion();

// JS assets are cache-busted by appending ?v=<versionName> to every script tag.
const BUST = 'v=' + VERSION;

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
    if (fs.existsSync(path.join(ROOT, 'assets'))) {
        cp(path.join(ROOT, 'assets'), path.join(WWW, 'assets'));
    }

    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    // Cache-bust local script tags (replace any existing ?v= query, don't append).
    html = html.replace(/(<script[^>]+src=")([^"?]+)(\?[^"]*)?"/g, (m, pre, src, _old) => {
        if (/^https?:|^\/\//.test(src)) return m;
        return `${pre}${src}?${BUST}"`;
    });
    // Same for css links.
    html = html.replace(/(<link[^>]+href=")([^"?]+)(\?[^"]*)?"/g, (m, pre, href, _old) => {
        if (/^https?:|^\/\//.test(href)) return m;
        return `${pre}${href}?${BUST}"`;
    });

    fs.writeFileSync(path.join(WWW, 'index.html'), html);
    console.log('www ready (android): ' + BUST);
}

main();