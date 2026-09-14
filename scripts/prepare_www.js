'use strict';

// Copies the web app (index.html + css/ + js/) into www/ consumed by Capacitor.
// Run: npm run app:prep   (auto-runs before `npx cap sync`)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const VERSION = new Date().toISOString().slice(0, 10).replace(/-/g, '');

// JS assets are cache-busted by appending ?v=YYYYMMDD to every script tag.
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

    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    // Cache-bust local script tags.
    html = html.replace(/(<script[^>]+src=")([^"]+)(\?v=[0-9a-z]+)?"/g, (m, pre, src, _old) => {
        if (/^https?:|^\/\//.test(src)) return m;
        return `${pre}${src}?${BUST}"`;
    });
    // Same for css links.
    html = html.replace(/(<link[^>]+href=")([^"]+)(\?v=[0-9a-z]+)?"/g, (m, pre, href, _old) => {
        if (/^https?:|^\/\//.test(href)) return m;
        return `${pre}${href}?${BUST}"`;
    });

    fs.writeFileSync(path.join(WWW, 'index.html'), html);
    console.log('www ready (android): ' + BUST);
}

main();