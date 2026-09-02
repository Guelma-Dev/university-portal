(function () {
    'use strict';

    const API_BASE = window.location.origin;
    const CAMPUS = { lat: 36.4627, lng: 7.4350 };
    const FAVS_KEY = 'lx_tr_favs';
    const GEO_KEY = 'lx_tr_geo';

    const S = {
        root: null,
        listEl: null,
        boardEl: null,
        mode: 'nearby',
        q: '',
        lines: [],
        loading: false,
        lastError: false,
        ctrl: null,
        favs: null,
        geo: null,
        geoLabel: '',
        board: null,
        cdTimer: null,
        debTimer: null,
        flashT: null,
        mounted: false,
    };

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    function loadFavs() {
        try { return new Set(JSON.parse(localStorage.getItem(FAVS_KEY) || '[]')); }
        catch (e) { return new Set(); }
    }

    function saveFavs() {
        try { localStorage.setItem(FAVS_KEY, JSON.stringify(Array.from(S.favs))); } catch (e) { }
    }

    function getGeo() {
        try {
            const g = JSON.parse(localStorage.getItem(GEO_KEY) || 'null');
            if (g && isFinite(g.lat) && isFinite(g.lng)) return g;
        } catch (e) { }
        return CAMPUS;
    }

    function getSession() {
        try {
            if (typeof getProgresSession === 'function') return getProgresSession() || null;
        } catch (e) { }
        return null;
    }

    function authQS(params) {
        const p = new URLSearchParams(params || {});
        const s = getSession();
        if (s && s.uuid) p.set('uuid', s.uuid);
        if (s && s.token) p.set('token', s.token);
        return p.toString();
    }

    async function api(path, params, signal) {
        const p = Object.assign({}, params || {});
        const w = (typeof getUserWilaya === 'function') ? getUserWilaya() : '';
        if (w && !p.wilaya) p.wilaya = w;
        const res = await fetch(`${API_BASE}${path}?${authQS(p)}`, { signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    function fmtDist(m) {
        const n = Number(m);
        if (!isFinite(n) || n < 0) return '—';
        if (n < 1000) return Math.round(n) + ' م';
        return (n / 1000).toFixed(1) + ' كم';
    }

    function badgeTxt(id) {
        const s = String(id == null ? '' : id).trim();
        if (!s) return '•';
        return s.length > 4 ? s.slice(0, 4) : s;
    }

    function countdown(t) {
        const m = /^(\d{1,2})[:hH](\d{2})/.exec(String(t == null ? '' : t).trim());
        if (!m) return { txt: '—', soon: false, gone: true };
        const now = new Date();
        const dep = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2], 0, 0);
        const diff = Math.round((dep - now) / 60000);
        if (diff < 0) return { txt: 'غداً', soon: false, gone: true };
        if (diff <= 1) return { txt: 'الآن', soon: true, gone: false };
        if (diff < 60) return { txt: 'بعد ' + diff + ' د', soon: diff <= 15, gone: false };
        const h = Math.floor(diff / 60);
        const r = diff % 60;
        return { txt: r ? 'بعد ' + h + ' س ' + r + ' د' : 'بعد ' + h + ' س', soon: false, gone: false };
    }

    const ST_MAP = {
        pending: ['pending', 'في الانتظار'],
        started: ['go', 'انطلقت'],
        em_route: ['go', 'في الطريق'],
        arrived: ['arrived', 'وصلت'],
    };

    function statusOf(d) {
        const raw = String((d && d.status) || '').trim().toLowerCase().replace(/[\s\-]+/g, '_');
        const hit = ST_MAP[raw];
        const label = (d && d.status_ar) || (hit && hit[1]) || (raw || '—');
        return { cls: hit ? hit[0] : 'pending', label: esc(label) };
    }

    function tplShell() {
        const userWilaya = (typeof getUserWilaya === 'function') ? getUserWilaya() : '';
        const geoSub = userWilaya ? `${esc(userWilaya)} · ${esc(S.geoLabel)}` : esc(S.geoLabel);
        return `<div class="lx-tr-root">
            <header class="lx-tr-hero">
                <div class="lx-tr-hinfo">
                    <h2>النقل <em>الحي</em></h2>
                    <p><i class="fas fa-location-dot"></i><span data-geolbl>${geoSub}</span></p>
                </div>
                <button type="button" class="lx-tr-locate" data-locate aria-label="تحديد موقعي" title="تحديد موقعي"><i class="fas fa-location-crosshairs"></i></button>
            </header>
            <div class="lx-tr-flash" data-flash hidden></div>
            <div class="lx-tr-search">
                <i class="fas fa-magnifying-glass lx-tr-sicon"></i>
                <input id="lx-q" class="lx-tr-input" type="search" inputmode="search" placeholder="ابحث عن خط أو وجهة..." autocomplete="off">
                <button type="button" class="lx-tr-clear" data-clear hidden aria-label="مسح البحث"><i class="fas fa-xmark"></i></button>
            </div>
            <div class="lx-tr-stage">
                <div id="lx-list" class="lx-tr-list"></div>
                <div id="lx-board" class="lx-tr-board" hidden></div>
            </div>
        </div>`;
    }

    function skelCards(n) {
        let h = '';
        for (let i = 0; i < n; i++) {
            h += `<div class="lx-tr-skel lx-tr-skrow"><span class="lx-tr-skav"></span><span class="lx-tr-skcol"><span class="lx-tr-skl1"></span><span class="lx-tr-skl2"></span></span><span class="lx-tr-skp"></span></div>`;
        }
        return h;
    }

    function skelRows(n) {
        let h = '<div class="lx-tr-deps">';
        for (let i = 0; i < n; i++) {
            h += `<div class="lx-tr-skel lx-tr-skrow"><span class="lx-tr-skt"></span><span class="lx-tr-skcol"><span class="lx-tr-skl1" style="width:44%"></span></span><span class="lx-tr-skp"></span></div>`;
        }
        return h + '</div>';
    }

    function errCard(msg) {
        return `<div class="lx-tr-state lx-tr-err">
            <i class="fas fa-tower-broadcast"></i>
            <strong>${esc(msg)}</strong>
            <p>خدمة النقل الجامعي غير متاحة حالياً، أعد المحاولة بعد قليل</p>
            <button type="button" class="lx-tr-retry" data-retry><i class="fas fa-rotate-right"></i> إعادة المحاولة</button>
        </div>`;
    }

    function emptyCard() {
        const search = S.mode === 'search';
        return `<div class="lx-tr-state">
            <i class="fas ${search ? 'fa-file-circle-question' : 'fa-map-location-dot'} lx-tr-goldi"></i>
            <strong>${search ? 'لا توجد نتائج مطابقة' : 'لا توجد خطوط قريبة حالياً'}</strong>
            <p>${search ? 'جرّب كلمة بحث أخرى أو رقم الخط' : 'فعّل موقعك عبر الزر أعلاه أو ابحث بالاسم'}</p>
        </div>`;
    }

    function sortLines(arr) {
        return arr.slice().sort((a, b) => {
            const fa = S.favs.has(String(a && a.id)) ? 0 : 1;
            const fb = S.favs.has(String(b && b.id)) ? 0 : 1;
            if (fa !== fb) return fa - fb;
            const da = a && a.distance != null ? Number(a.distance) : Infinity;
            const db = b && b.distance != null ? Number(b.distance) : Infinity;
            if (da !== db) return da - db;
            return String((a && (a.name_ar || a.name_fr)) || '').localeCompare(String((b && (b.name_ar || b.name_fr)) || ''), 'ar');
        });
    }

    function cardHTML(l) {
        const id = l && l.id;
        const ar = (l && (l.name_ar || l.name_fr)) || '';
        const fr = (l && l.name_fr) || '';
        const ag = (l && l.agency_name) || '';
        const fav = S.favs.has(String(id));
        const dist = l && l.distance != null
            ? `<span class="lx-tr-chip"><i class="fas fa-route"></i>${esc(fmtDist(l.distance))}</span>`
            : '';
        return `<article class="lx-tr-line" data-line="${esc(id)}" role="button" tabindex="0" aria-label="${esc(ar)}">
            <span class="lx-tr-badge">${esc(badgeTxt(id))}</span>
            <span class="lx-tr-names">
                <strong class="lx-tr-ar">${esc(ar)}</strong>
                <span class="lx-tr-fr">${esc(fr)}</span>
                ${ag ? `<span class="lx-tr-agency"><i class="fas fa-building-columns"></i>${esc(ag)}</span>` : ''}
            </span>
            <span class="lx-tr-side">
                <button type="button" class="lx-tr-fav${fav ? ' lx-tr-on' : ''}" data-fav="${esc(id)}" aria-label="أضف إلى المفضلة" title="المفضلة"><i class="${fav ? 'fas' : 'far'} fa-star"></i></button>
                ${dist}
            </span>
        </article>`;
    }

    function listHead(n) {
        if (S.mode === 'search') {
            return `<div class="lx-tr-lhead"><i class="fas fa-magnifying-glass"></i>نتائج البحث<span class="lx-tr-cnt">${n} خط</span></div>`;
        }
        return `<div class="lx-tr-lhead"><i class="fas fa-tower-observation"></i>أقرب الخطوط إلى ${esc(S.geoLabel)}<span class="lx-tr-cnt">${n} خط</span></div>`;
    }

    function renderList() {
        if (!S.listEl) return;
        if (S.loading && !S.lines.length) {
            S.listEl.innerHTML = skelCards(5);
            return;
        }
        if (S.lastError && !S.lines.length) {
            S.listEl.innerHTML = errCard('تعذر جلب الخطوط');
            return;
        }
        const lines = sortLines(S.lines);
        if (!lines.length) {
            S.listEl.innerHTML = emptyCard();
            return;
        }
        S.listEl.innerHTML = listHead(lines.length) + lines.map(cardHTML).join('');
    }

    async function loadList() {
        if (!S.root) return;
        if (S.ctrl) { try { S.ctrl.abort(); } catch (e) { } }
        const ctrl = new AbortController();
        S.ctrl = ctrl;
        S.loading = true;
        S.lastError = false;
        renderList();
        try {
            const data = S.mode === 'search'
                ? await api('/api/bus/search', { q: S.q }, ctrl.signal)
                : await api('/api/bus/nearby', { lat: S.geo.lat, lng: S.geo.lng }, ctrl.signal);
            if (ctrl.signal.aborted) return;
            S.lines = Array.isArray(data) ? data
                : (data && Array.isArray(data.data)) ? data.data : [];
            S.loading = false;
            renderList();
        } catch (err) {
            if (ctrl.signal.aborted || (err && err.name === 'AbortError')) return;
            S.loading = false;
            S.lastError = true;
            renderList();
        }
    }

    function stopHTML(s) {
        const stn = s && (s.is_station === true || s.is_station === 1 || s.is_station === '1');
        return `<li class="${stn ? 'lx-tr-stn' : ''}">
            <span class="lx-tr-tldot"></span>
            <span class="lx-tr-stnames"><strong>${esc(s && s.name_ar)}</strong><small>${esc(s && s.name_fr)}</small></span>
        </li>`;
    }

    function depHTML(d, i) {
        const cd = countdown(d && d.time);
        const st = statusOf(d);
        const opn = i === S.board.openIdx;
        const stops = Array.isArray(d && d.stops) ? d.stops : [];
        const tl = stops.length ? `<ol class="lx-tr-tl">${stops.map(stopHTML).join('')}</ol>` : '<div class="lx-tr-nostops">لا يوجد مسار مسجل لهذه الرحلة</div>';
        return `<div class="lx-tr-dep${opn ? ' lx-tr-open' : ''}">
            <button type="button" class="lx-tr-dephead" data-dep="${i}" aria-expanded="${opn}">
                <span class="lx-tr-time">${esc(d && d.time)}</span>
                <span class="lx-tr-cd${cd.soon ? ' lx-tr-hot' : ''}" data-cd data-time="${esc(d && d.time)}">${esc(cd.txt)}</span>
                <span class="lx-tr-st lx-tr-${st.cls}"><i class="lx-tr-dot"></i>${st.label}</span>
                <i class="fas fa-chevron-down lx-tr-chev"></i>
            </button>
            <div class="lx-tr-depbody">${tl}</div>
        </div>`;
    }

    function renderBoard() {
        if (!S.board || !S.boardEl) return;
        const B = S.board;
        const L = B.line || {};
        const ar = L.name_ar || L.name_fr || '';
        const fr = L.name_fr || '';
        const ag = L.agency_name || '';
        const fav = S.favs.has(String(L.id));
        let rows = '';
        if (!B.deps.length && B.loading) {
            rows = skelRows(4);
        } else if (B.error && !B.deps.length) {
            rows = errCard('تعذر جلب مواعيد الانطلاق');
        } else if (!B.deps.length) {
            rows = `<div class="lx-tr-state"><i class="fas fa-circle-info lx-tr-goldi"></i><strong>لا توجد رحلات مسجلة لهذا الخط</strong><p>جرّب لاحقاً أو اختر خطاً آخر</p></div>`;
        } else {
            rows = `<div class="lx-tr-deps">${B.deps.map(depHTML).join('')}</div>`;
            if (B.page < B.last) {
                rows += `<button type="button" class="lx-tr-more" data-more>${B.loading ? '<i class="fas fa-spinner fa-spin"></i> جاري التحميل...' : 'المزيد <i class="fas fa-angles-down"></i>'}</button>`;
            }
        }
        S.boardEl.innerHTML = `<header class="lx-tr-bhead">
                <button type="button" class="lx-tr-back" data-back aria-label="عودة"><i class="fas fa-arrow-right"></i></button>
                <span class="lx-tr-badge lx-tr-lg">${esc(badgeTxt(L.id))}</span>
                <span class="lx-tr-bnames">
                    <strong>${esc(ar)}</strong>
                    <small>${esc(fr)}</small>
                    <em>${ag ? esc(ag) + ' · ' : ''}مواعيد الانطلاق</em>
                </span>
                <button type="button" class="lx-tr-fav${fav ? ' lx-tr-on' : ''}" data-fav="${esc(L.id)}" aria-label="أضف إلى المفضلة" title="المفضلة"><i class="${fav ? 'fas' : 'far'} fa-star"></i></button>
            </header>
            ${rows}`;
    }

    async function loadDeps(page) {
        const B = S.board;
        if (!B || B.loading) return;
        B.loading = true;
        B.error = false;
        renderBoard();
        try {
            const res = await api('/api/bus/starts/' + encodeURIComponent(B.line.id), { page: page });
            if (!S.board || S.board.line !== B.line) return;
            const deps = Array.isArray(res && res.departures) ? res.departures : [];
            const meta = (res && res.meta) || {};
            B.page = Number(meta.current_page) || page;
            B.last = Number(meta.last_page) || B.page;
            B.deps = B.deps.concat(deps);
            if (B.openIdx < 0 && B.deps.length) {
                const i = B.deps.findIndex((d) => !countdown(d && d.time).gone);
                B.openIdx = i >= 0 ? i : 0;
            }
            B.loading = false;
            renderBoard();
        } catch (err) {
            if (!S.board || S.board.line !== B.line) return;
            B.loading = false;
            B.error = true;
            renderBoard();
        }
    }

    function openBoard(id) {
        const line = S.lines.find((l) => String(l && l.id) === String(id));
        if (!line || !S.boardEl || !S.listEl) return;
        S.board = { line: line, deps: [], page: 1, last: 1, loading: false, openIdx: -1, error: false };
        S.listEl.classList.add('lx-tr-hide');
        S.boardEl.classList.remove('lx-tr-closing');
        S.boardEl.classList.add('lx-tr-open');
        S.boardEl.hidden = false;
        renderBoard();
        loadDeps(1);
    }

    function closeBoard() {
        if (!S.board) return;
        S.board = null;
        const el = S.boardEl;
        if (!el) return;
        el.classList.add('lx-tr-closing');
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(() => {
            el.classList.remove('lx-tr-open', 'lx-tr-closing');
            el.hidden = true;
            el.innerHTML = '';
            if (S.listEl) S.listEl.classList.remove('lx-tr-hide');
        }, reduce ? 0 : 300);
    }

    function toggleDep(i) {
        const B = S.board;
        if (!B) return;
        const idx = Number(i);
        B.openIdx = B.openIdx === idx ? -1 : idx;
        renderBoard();
    }

    function syncFavButtons(id) {
        if (!S.root) return;
        const k = String(id);
        const on = S.favs.has(k);
        S.root.querySelectorAll('.lx-tr-fav').forEach((b) => {
            if (b.getAttribute('data-fav') !== k) return;
            b.classList.toggle('lx-tr-on', on);
            const ic = b.querySelector('i');
            if (ic) ic.className = on ? 'fas fa-star' : 'far fa-star';
        });
    }

    function toggleFav(id) {
        const k = String(id);
        if (S.favs.has(k)) S.favs.delete(k);
        else S.favs.add(k);
        saveFavs();
        syncFavButtons(k);
        renderList();
    }

    function flash(msg) {
        if (!S.root) return;
        const el = S.root.querySelector('[data-flash]');
        if (!el) return;
        el.textContent = msg;
        el.hidden = false;
        if (S.flashT) clearTimeout(S.flashT);
        S.flashT = setTimeout(() => { el.hidden = true; }, 2800);
    }

    function updGeoLabel() {
        if (!S.root) return;
        S.root.querySelectorAll('[data-geolbl]').forEach((el) => { el.textContent = S.geoLabel; });
    }

    function locate() {
        if (!navigator.geolocation) { flash('خدمة تحديد الموقع غير مدعومة على هذا الجهاز'); return; }
        const btn = S.root && S.root.querySelector('[data-locate]');
        if (btn) btn.classList.add('lx-tr-busy');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                if (btn) btn.classList.remove('lx-tr-busy');
                S.geo = { lat: +Number(pos.coords.latitude).toFixed(6), lng: +Number(pos.coords.longitude).toFixed(6) };
                S.geoLabel = 'موقعي الحالي';
                try { localStorage.setItem(GEO_KEY, JSON.stringify(S.geo)); } catch (e) { }
                updGeoLabel();
                S.mode = 'nearby';
                S.q = '';
                const inp = S.root.querySelector('#lx-q');
                if (inp) inp.value = '';
                const clr = S.root.querySelector('[data-clear]');
                if (clr) clr.hidden = true;
                loadList();
                flash('تم تحديث الموقع بنجاح');
            },
            () => {
                if (btn) btn.classList.remove('lx-tr-busy');
                flash('تعذر تحديد موقعك — يتم استخدام موقع الحرم الجامعي');
            },
            { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
        );
    }

    function resetToNearby() {
        if (!S.root) return;
        const inp = S.root.querySelector('#lx-q');
        if (inp) inp.value = '';
        const clr = S.root.querySelector('[data-clear]');
        if (clr) clr.hidden = true;
        S.q = '';
        if (S.mode !== 'nearby') {
            S.mode = 'nearby';
            loadList();
        }
    }

    function startTicker() {
        if (S.cdTimer) clearInterval(S.cdTimer);
        S.cdTimer = setInterval(() => {
            if (!S.root) return;
            S.root.querySelectorAll('[data-cd]').forEach((el) => {
                const cd = countdown(el.getAttribute('data-time'));
                el.textContent = cd.txt;
                el.classList.toggle('lx-tr-hot', !!cd.soon);
            });
        }, 30000);
    }

    function wireShell(host) {
        const inp = host.querySelector('#lx-q');
        if (inp) {
            inp.addEventListener('input', () => {
                const clr = host.querySelector('[data-clear]');
                if (clr) clr.hidden = !inp.value.trim();
                if (S.debTimer) clearTimeout(S.debTimer);
                const q = inp.value.trim();
                if (q.length < 2) {
                    if (S.mode === 'search') {
                        S.mode = 'nearby';
                        S.q = '';
                        S.debTimer = setTimeout(loadList, 260);
                    }
                    return;
                }
                S.mode = 'search';
                S.q = q;
                S.debTimer = setTimeout(loadList, 340);
            });
        }
        host.addEventListener('click', (e) => {
            const fav = e.target.closest('[data-fav]');
            if (fav) { e.stopPropagation(); toggleFav(fav.getAttribute('data-fav')); return; }
            if (e.target.closest('[data-clear]')) { resetToNearby(); return; }
            if (e.target.closest('[data-locate]')) { locate(); return; }
            if (e.target.closest('[data-retry]')) {
                if (S.board) loadDeps(S.board.deps.length ? S.board.page + 1 : 1);
                else loadList();
                return;
            }
            if (e.target.closest('[data-more]')) { if (S.board) loadDeps(S.board.page + 1); return; }
            if (e.target.closest('[data-back]')) { closeBoard(); return; }
            const dep = e.target.closest('[data-dep]');
            if (dep) { toggleDep(dep.getAttribute('data-dep')); return; }
            const line = e.target.closest('[data-line]');
            if (line) { openBoard(line.getAttribute('data-line')); }
        });
        host.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[data-line]')) {
                e.preventDefault();
                openBoard(e.target.getAttribute('data-line'));
            }
        });
    }

    function mount(container) {
        const host = container && container.classList ? container : null;
        if (!host) return;
        if (S.cdTimer) { clearInterval(S.cdTimer); S.cdTimer = null; }
        if (S.debTimer) { clearTimeout(S.debTimer); S.debTimer = null; }
        S.favs = loadFavs();
        S.geo = getGeo();
        const saved = localStorage.getItem(GEO_KEY);
        S.geoLabel = saved ? 'موقعي الحالي' : 'الحرم الجامعي';
        S.mode = 'nearby';
        S.q = '';
        S.lines = [];
        S.board = null;
        S.root = host;
        host.innerHTML = tplShell();
        S.listEl = host.querySelector('#lx-list');
        S.boardEl = host.querySelector('#lx-board');
        wireShell(host);
        startTicker();
        S.mounted = true;
        loadList();
    }

    function refresh() {
        loadList();
        if (S.board) {
            S.board.deps = [];
            S.board.page = 1;
            S.board.last = 1;
            S.board.openIdx = -1;
            loadDeps(1);
        }
    }

    function ensureSection() {
        let sec = document.getElementById('section-transport');
        if (!sec) {
            const main = document.getElementById('app-main');
            if (!main) return null;
            sec = document.createElement('section');
            sec.id = 'section-transport';
            sec.className = 'section';
            main.appendChild(sec);
        }
        try {
            if (typeof VALID_SECTIONS !== 'undefined' && Array.isArray(VALID_SECTIONS) && !VALID_SECTIONS.includes('transport')) {
                VALID_SECTIONS.push('transport');
            }
        } catch (e) { }
        return sec;
    }

    window.PortalSections = window.PortalSections || [];
    window.PortalSections.push({
        id: 'transport',
        title: 'النقل الحي',
        icon: 'fa-bus',
        mount: mount,
    });
    window.LXTransport = { refresh: refresh };

    function boot() {
        const sec = ensureSection();
        if (sec && !S.mounted) mount(sec);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
    } else {
        setTimeout(boot, 0);
    }
})();
