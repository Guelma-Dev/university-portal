// ==== البحوث الأكاديمية (Semantic Scholar، مجاني وقانوني) ====
// PortalSection: research — بحث عربي + نتائج + فتح PDF داخل التطبيق.
// مباشر أولاً، وبروكسي سيرفرنا (/api/lib/s2) احتياطياً ضد الخنق.
(() => {
    'use strict';

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (msg, type) => { if (typeof window.showToast === 'function') window.showToast(msg, type); };

    const RENDER_ORIGIN = 'https://university-portal-gv78.onrender.com';

    let activeRoot = null;
    let state = { q: '', loading: false, items: [], searched: false, error: '' };

    const S2 = 'https://api.semanticscholar.org/graph/v1/paper/search';
    const FIELDS = 'title,authors,year,abstract,citationCount,openAccessPdf,url,venue';

    function apiBase() {
        try {
            const o = String(window.location.origin || '');
            const nat = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
            if (nat && /(localhost|capacitor)/i.test(o)) return RENDER_ORIGIN;
            return o;
        } catch (e) { return RENDER_ORIGIN; }
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function fetchS2(url) {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (res.status === 429) {
            const e = new Error('busy');
            e.busy = true;
            throw e;
        }
        if (!res.ok) throw new Error('http-' + res.status);
        const data = await res.json().catch(() => null);
        return (data && Array.isArray(data.data)) ? data.data : [];
    }

    async function runSearch(q) {
        state.q = q; state.loading = true; state.searched = true; state.error = ''; state.items = [];
        render();
        const direct = S2 + '?query=' + encodeURIComponent(q) + '&limit=20&fields=' + FIELDS;
        const proxy = apiBase() + '/api/lib/s2?q=' + encodeURIComponent(q);
        try {
            try {
                state.items = await fetchS2(direct);
            } catch (e1) {
                if (e1 && e1.busy) {
                    await sleep(2500); // محاولة مباشرة أخيرة قبل البروكسي
                    try { state.items = await fetchS2(direct); }
                    catch (e2) { state.items = await fetchS2(proxy); }
                } else {
                    state.items = await fetchS2(proxy);
                }
            }
            state.loading = false;
            render();
        } catch (e) {
            state.loading = false;
            state.error = 'تعذر الاتصال بمصدر البحوث — تحقق من الإنترنت وحاول مجدداً';
            render();
        }
    }

    function authorsLine(p) {
        const a = Array.isArray(p.authors) ? p.authors.map(x => x && x.name).filter(Boolean).slice(0, 3) : [];
        return a.join('، ') + (Array.isArray(p.authors) && p.authors.length > 3 ? ' وآخرون' : '');
    }

    function cardHTML(p, i) {
        const pdf = p.openAccessPdf && p.openAccessPdf.url ? p.openAccessPdf.url : '';
        const abs = String(p.abstract || '').trim();
        const meta = [p.year ? esc(p.year) : '',
            p.citationCount ? `<i class="fas fa-quote-right"></i> ${esc(p.citationCount)} استشهاد` : '',
            p.venue ? esc(String(p.venue).slice(0, 40)) : ''].filter(Boolean).join(' <span style="opacity:.4">•</span> ');
        return `
        <div class="rs-card">
            <p class="rs-title">${esc(p.title || 'بدون عنوان')}</p>
            ${meta ? `<div class="rs-meta">${meta}</div>` : ''}
            ${authorsLine(p) ? `<p class="rs-authors">${esc(authorsLine(p))}</p>` : ''}
            ${abs ? `<details class="rs-abs"><summary>الملخص</summary><p>${esc(abs.length > 400 ? abs.slice(0, 400) + '…' : abs)}</p></details>` : ''}
            <div class="rs-actions">
                ${pdf ? `<button type="button" class="lx-m-btn-xs yes" data-action="pdf" data-i="${i}"><i class="fas fa-file-pdf"></i> فتح PDF</button>` : `<span class="ins-badge ins-warn">PDF غير متاح مجاناً</span>`}
                ${p.url ? `<button type="button" class="lx-m-btn-xs no" data-action="page" data-i="${i}"><i class="fas fa-globe"></i> صفحة البحث</button>` : ''}
            </div>
        </div>`;
    }

    function render() {
        const root = activeRoot;
        if (!root) return;
        let body = '';
        if (state.loading) {
            body = `<div class="mobile-empty"><i class="fas fa-spinner fa-spin"></i><p>جاري البحث...</p></div>`;
        } else if (state.error) {
            body = `<div class="ins-login-prompt"><i class="fas fa-triangle-exclamation"></i><p>${esc(state.error)}</p>
                <button type="button" class="lx-m-btn-retry" data-action="retry"><i class="fas fa-rotate-right"></i> إعادة المحاولة</button></div>`;
        } else if (!state.searched) {
            body = `<div class="ins-login-prompt"><i class="fas fa-flask"></i><p>ابحث في ملايين البحوث والمذكرات الأكاديمية المجانية.</p></div>`;
        } else if (!state.items.length) {
            body = `<div class="ins-login-prompt"><i class="fas fa-folder-open"></i><p>لا نتائج — جرّب كلمات إنجليزية (مثال: microeconomics).</p></div>`;
        } else {
            body = state.items.map(cardHTML).join('');
        }
        root.innerHTML = `
            <div class="grades-container">
                <div class="calculator-header"><i class="fas fa-flask"></i><h3>البحوث الأكاديمية</h3></div>
                <div class="ins-body">
                    <div class="rs-search">
                        <input id="rs-q" type="search" inputmode="search" placeholder="ابحث عن بحث أو مذكرة..." value="${esc(state.q)}">
                        <button type="button" class="lx-m-btn-xs yes" data-action="go"><i class="fas fa-magnifying-glass"></i> بحث</button>
                    </div>
                    ${body}
                </div>
            </div>`;
        const inp = root.querySelector('#rs-q');
        if (inp) inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const q = inp.value.trim();
                if (q) runSearch(q);
            }
        });
    }

    function cleanName(s) {
        return String(s || 'paper').replace(/[^\w\u0600-\u06FF\-. ]+/g, '').trim().slice(0, 60) || 'paper';
    }

    function b64encode(bytes) {
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        return btoa(s);
    }

    function openExternal(url) {
        try {
            if (window.PortalNative && typeof window.PortalNative.openInBrowser === 'function') window.PortalNative.openInBrowser(url);
            else window.open(url, '_blank');
        } catch (e) {}
    }

    // عارض PDF داخل التطبيق، وعند تعذر التنزيل يُفتح في المتصفح بدل الخطأ.
    async function openPdf(i) {
        const p = state.items[Number(i)];
        const url = p && p.openAccessPdf && p.openAccessPdf.url;
        if (!url) return;
        toast('جاري فتح الملف...', 'info');
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('http-' + res.status);
            const buf = await res.arrayBuffer();
            if (!buf || !buf.byteLength) throw new Error('empty');
            const bytes = new Uint8Array(buf);
            const name = cleanName(p.title) + '.pdf';
            const pn = window.PortalNative;
            if (pn && pn.viewLibraryFile) {
                try { await pn.viewLibraryFile(name, 'application/pdf', b64encode(bytes)); return; }
                catch (e) { /* fallback below */ }
            }
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const obj = URL.createObjectURL(blob);
            const modal = document.createElement('div');
            modal.className = 'lx-m-modal';
            modal.innerHTML = `
                <div class="lx-m-modal-bg" data-x></div>
                <div class="lx-m-ticket" role="dialog" aria-modal="true" style="max-width:900px;width:94%;height:86vh;display:flex;flex-direction:column">
                    <div class="lx-m-tkhead">
                        <button type="button" class="lx-m-tkclose" data-x title="إغلاق"><i class="fas fa-xmark"></i></button>
                        <div class="lx-m-tktitle" style="font-size:.9rem">${esc(p.title || name)}</div>
                    </div>
                    <iframe src="${obj}" style="flex:1;border:0;border-radius:0 0 12px 12px" title="PDF"></iframe>
                </div>`;
            const close = () => { try { URL.revokeObjectURL(obj); } catch (e) {} modal.remove(); };
            modal.querySelectorAll('[data-x]').forEach(el => el.addEventListener('click', close));
            document.addEventListener('keydown', function esc2(e) {
                if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
            });
            document.body.appendChild(modal);
        } catch (e) {
            toast('تعذر التنزيل المباشر — فتح في المتصفح', 'info');
            openExternal(url);
        }
    }

    function openPage(i) {
        const p = state.items[Number(i)];
        if (p && p.url) openExternal(p.url);
    }

    function mount(root) {
        activeRoot = root;
        if (!root.dataset.rsMounted) {
            root.dataset.rsMounted = '1';
            root.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                const a = btn.dataset.action;
                if (a === 'go') {
                    const inp = root.querySelector('#rs-q');
                    const q = inp ? inp.value.trim() : '';
                    if (!q) { toast('اكتب كلمة البحث أولاً', 'info'); return; }
                    runSearch(q);
                } else if (a === 'retry') {
                    if (state.q) runSearch(state.q);
                } else if (a === 'pdf') openPdf(btn.dataset.i);
                else if (a === 'page') openPage(btn.dataset.i);
            });
        }
        render();
    }

    window.PortalSections = window.PortalSections || [];
    window.PortalSections.push({ id: 'research', title: 'البحوث الأكاديمية', icon: 'fa-flask', mount });
})();
