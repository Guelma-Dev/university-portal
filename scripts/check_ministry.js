'use strict';

// Probe direct access to ministry hosts, mimicking the Capacitor native client.
// This machine can reach the ministry directly, so it revalidates TLS + paths.
// Run: npm run net:test

const https = require('https');

const HOSTS = [
    ['https://progres.mesrs.dz/api/authentication/v1/', 'POST', 'progress login?'],
    ['https://api-webetu.mesrs.dz/api/infos/bannerInformations', 'GET', 'webetu infos'],
    ['https://api-webetu.mesrs.dz/api/infos/bac/aaa/dias', 'GET', 'webetu dias'],
    ['https://api-webetu.mesrs.dz/api/infos/planningSession/dia/1/noteExamens', 'GET', 'exams'],
    ['https://api-webetu.mesrs.dz/api/infos/image/aaa', 'GET', 'photo'],
    ['https://mybus.mesrs.dz/api/nearby-lines?lat=36.4627&lng=7.4350', 'GET', 'bus nearby'],
    ['https://mybus.mesrs.dz/api/searchlines/test', 'GET', 'bus search'],
    ['https://gs-api.onou.dz/api/getdepotres', 'GET', 'onou gs (TLS!)'],
];

function probe(url, method) {
    return new Promise((resolve) => {
        const u = new URL(url);
        const req = https.request(
            {
                hostname: u.hostname,
                port: 443,
                path: u.pathname + u.search,
                method,
                headers: { 'user-agent': 'Mozilla/5.0', 'content-length': 0 },
                timeout: 9000,
            },
            (res) => resolve({ status: res.statusCode, ct: res.headers['content-type'] || '' })
        );
        req.on('error', (e) => resolve({ error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
        req.end();
    });
}

(async () => {
    const tls = require('tls');
    for (const [url, method, label] of HOSTS) {
        const u = new URL(url);
        const s = tls.connect(443, u.hostname, { servername: u.hostname });
        const hostTls = await new Promise((res) => {
            const done = (v) => { clearTimeout(tt); s.destroy(); res(v); };
            const tt = setTimeout(() => done({ error: 'tls timeout' }), 7000);
            s.on('secureConnect', () => done({ ok: true, proto: s.getProtocol() }));
            s.on('error', (e) => done({ error: 'TLS: ' + e.message }));
        });
        const probeRes = hostTls.ok ? await probe(url, method) : hostTls;
        const mark = (probeRes.error ? 'FAIL ' : ((probeRes.status || '') + ' ').padEnd(5)) + (hostTls.error ? probeRes.error : '');
        console.log('[' + mark + '] ' + label + '  ' + url);
    }
})();