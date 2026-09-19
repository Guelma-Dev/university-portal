// ==== البحوث الأكاديمية (Semantic Scholar، مجاني وقانوني) ====
// PortalSection: research — بحث عربي + نتائج + فتح PDF داخل التطبيق.
// بلا مفاتيح (تُضاف لاحقاً عند الحاجة). العروض/سكريبد في مرحلتين قادمتين.
(() => {
    'use strict';

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (msg, type) => { if (typeof window.showToast === 'function') window.showToast(msg, type); };

    let activeRoot = null;
    let state = { q: '', loading: false, items: [], searched: false, error: '' };

    const S2 = 'https://api.semanticscholar.org/graph/v1/paper/search';
    const FIELDS = 'title,authors,year,abstract,citationCount,openAccessPdf,url,venue';

    async function runSearch(q) {
        state.q = q; state.loading = true; state.searched = true; state.error = ''; state.items = [];
        render();
        // مباشر أولاً، وبروكسي سيرفرنا احتياطياً (كاش 24 ساعة ضد الخنق).
        const attempts = [
            S2 + '?query=' + encodeURIComponent(q) + '&limit=20&fields=' + FIELDS,
            (typeof API_BASE !== 'undefined' ? API_BASE : window.location.origin) + '/api/lib/s2?q=' + encodeURIComponent(q),
        ];
        let lastErr = '';
        for (const url of attempts) {
            try {
                const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
                if (res.status === 429) { lastErr = 'busy'; continue; }
                if (!res.ok) { lastErr = 'http-' + res.status; continue; }
                const data = await res.json().catch(() => null);
                const arr = (data && Array.isArray(data.data)) ? data.data : [];
                state.items = arr;
                state.loading = false;
                render();
                return;
            } catch (e) { lastErr = 'net'; }
        }
        state.loading = false;
        state.error = lastErr === 'busy' ? 'مصدر البحوث مشغول حالياً — حاول بعد دقيقة' : 'تعذر الاتصال بمصدر البحوث';
        render();
    }

    function authorsLine(p) {
        const a = Array.isArray(p.authors) ? p.authors.map(x => x && x.name).filter(Boolean).slice(0, 3) : [];
        return a.join('، ') + (Array.isArray(p.authors) && p.authors.length > 3 ? ' وآخرون' : '');
    }

    function cardHTML(p, i) {
        const pdf = p.openAccessPdf && p.openAccessPdf.url ? p.openAccessPdf.url : '';
        const abs = String(p.abstract || '').trim();
        return `
        <div class="ins-card">
            <div class="ins-current-head">
                <span class="ins-current-tag"><i class="fas fa-flask"></i>بحث</span>
                ${p.year ? `<span class="ins-badge ins-ok">${esc(p.year)}</span>` : ''}
                ${p.citationCount ? `<span class="ins-badge ins-warn"><i class="fas fa-quote-right"></i>${esc(p.citationCount)}</span>` : ''}
            </div>
            <div class="ins-main">
                <div class="data-row"><strong class="value" style="font-size:1rem">${esc(p.title || 'بدون عنوان')}</strong></div>
                ${authorsLine(p) ? `<div class="data-row"><span class="label">المؤلفون:</span><strong class="value">${esc(authorsLine(p))}</strong></div>` : ''}
                ${abs ? `<details class="ins-prev"><summary>الملخص</summary><div class="ins-prev-body"><p style="font-size:.88rem;line-height:1.8">${esc(abs.length > 500 ? abs.slice(0, 500) + '…' : abs)}</p></div></details>` : ''}
                <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
                    ${pdf ? `<button type="button" class="lx-m-btn-xs yes" data-action="pdf" data-i="${i}"><i class="fas fa-file-pdf"></i> فتح PDF</button>` : ''}
                    ${p.url ? `<button type="button" class="lx-m-btn-xs no" data-action="page" data-i="${i}"><i class="fas fa-globe"></i> صفحة البحث</button>` : ''}
                    ${!pdf ? `<span class="ins-badge ins-warn">PDF غير متاح مجاناً</span>` : ''}
                </div>
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
                    <div style="display:flex;gap:8px;margin-bottom:12px">
                        <input id="rs-q" type="search" inputmode="search" placeholder="ابحث عن بحث أو مذكرة..." value="${esc(state.q)}"
                            style="flex:1;min-height:44px;border-radius:12px;border:1px solid var(--glass-line,#ccc);background:var(--surface-2,#fff);color:inherit;padding:0 14px;font-family:inherit;font-size:.95rem">
                        <button type="button" class="lx-m-btn-xs yes" data-action="go" style="min-height:44px;padding:0 18px"><i class="fas fa-magnifying-glass"></i> بحث</button>
                    </div>
                    ${body}
                </div>
            </div>`;
        const inp = root.querySelector('#rs-q');
        if (inp) inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runSearch(inp.value.trim());
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

    // عارض PDF داخل التطبيق: نيتف إن وُجد، وإلا نافذة iframe.
    async function openPdf(i) {
        const p = state.items[Number(i)];
        const url = p && p.openAccessPdf && p.openAccessPdf.url;
        if (!url) return;
        toast('جاري فتح الملف...', 'info');
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('http-' + res.status);
            const buf = await res.arrayBuffer();
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
            toast('تعذر فتح الملف', 'error');
        }
    }

    function openPage(i) {
        const p = state.items[Number(i)];
        const url = p && p.url;
        if (!url) return;
        try {
            if (window.PortalNative && typeof window.PortalNative.openInBrowser === 'function') window.PortalNative.openInBrowser(url);
            else window.open(url, '_blank');
        } catch (e) {}
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
