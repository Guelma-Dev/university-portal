// ==== الأقسام الدراسية الجديدة (المجموعة/النسب/العطلة) ====
// PortalSections: groupe / coeffs / congesx — نفس نمط sec-inscription.
// البيانات: /api/academic/* (الباك-اند للويب، وnative.js يعترضها في الأندرويد).
(() => {
    'use strict';

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (msg, type) => { if (typeof window.showToast === 'function') window.showToast(msg, type); };

    function getSession() {
        try {
            if (typeof window.getProgresSession === 'function') {
                const s = window.getProgresSession();
                if (s && s.uuid && s.token) return s;
            }
        } catch (e) { /* noop */ }
        return null;
    }

    function authHeaders(s) {
        return { 'Authorization': s.token };
    }

    function diaOf(s) {
        let dia = s.selectedCard || s.idCardYear || '';
        if (!dia && s.token && s.token.indexOf('.') !== -1) {
            try {
                const part = s.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
                const pad = part + '='.repeat((4 - (part.length % 4)) % 4);
                const claims = JSON.parse(decodeURIComponent(escape(atob(pad))));
                dia = String(claims.dias || '').split(',')[0].trim();
            } catch (e) {}
        }
        return String(dia || '');
    }

    async function getJSON(url, s) {
        const res = await fetch(url, { headers: authHeaders(s) });
        if (res.status === 401) { const e = new Error('expired'); e.code = 401; throw e; }
        if (!res.ok) throw new Error('http-' + res.status);
        return res.json().catch(() => null);
    }

    async function getCards(s) {
        if (Array.isArray(s.cards) && s.cards.length) return s.cards;
        if (typeof window.progresFetch !== 'function') return [];
        try {
            const cards = await window.progresFetch('cards');
            if (Array.isArray(cards)) {
                const cur = window.getProgresSession();
                if (cur) { cur.cards = cards; if (typeof window.setProgresSession === 'function') window.setProgresSession(cur); }
                return cards;
            }
        } catch (e) { /* noop */ }
        return [];
    }

    const pick = (...vals) => {
        for (const v of vals) {
            if (typeof v === 'string' && v.trim()) return v.trim();
            if (v !== null && v !== undefined && v !== '') return v;
        }
        return '';
    };

    function headerHTML(icon, title) {
        return `<div class="calculator-header"><i class="fas ${icon}"></i><h3>${title}</h3></div>`;
    }

    function loginPromptHTML(icon, title, text) {
        return `
            <div class="grades-container">
                ${headerHTML(icon, title)}
                <div class="ins-body">
                    <div class="ins-login-prompt">
                        <i class="fas fa-id-card-clip"></i>
                        <p>${text}</p>
                        <button type="button" class="lx-m-btn-retry" data-action="goto-progres-login">
                            <i class="fas fa-right-to-bracket"></i> تسجيل دخول Progres
                        </button>
                    </div>
                </div>
            </div>`;
    }

    function errorHTML(icon, title, retryAction) {
        return `
            <div class="grades-container">
                ${headerHTML(icon, title)}
                <div class="ins-body">
                    <div class="ins-login-prompt">
                        <i class="fas fa-triangle-exclamation"></i>
                        <p>تعذر جلب البيانات حالياً، حاول من جديد.</p>
                        <button type="button" class="lx-m-btn-retry" data-action="${retryAction}">
                            <i class="fas fa-rotate-right"></i> إعادة المحاولة
                        </button>
                    </div>
                </div>
            </div>`;
    }

    function emptyHTML(icon, title, text, retryAction) {
        return `
            <div class="grades-container">
                ${headerHTML(icon, title)}
                <div class="ins-body">
                    <div class="ins-login-prompt">
                        <i class="fas ${icon}"></i>
                        <p>${text}</p>
                        <button type="button" class="lx-m-btn-retry" data-action="${retryAction}">
                            <i class="fas fa-rotate-right"></i> إعادة المحاولة
                        </button>
                    </div>
                </div>
            </div>`;
    }

    function dataRow(label, value) {
        const v = esc(value);
        if (!v) return '';
        return `<div class="data-row"><span class="label">${esc(label)}:</span><strong class="value">${v}</strong></div>`;
    }

    function bindActions(root, onAction) {
        root.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const a = btn.dataset.action;
            if (a === 'goto-progres-login') {
                if (typeof navigateToSection === 'function') navigateToSection('grades');
                setTimeout(() => {
                    const inp = document.querySelector('#section-grades [name="progres-username"]');
                    if (inp) inp.focus();
                    toast('أدخل بيانات Progres ثم عد إلى القسم', 'info');
                }, 350);
                return;
            }
            onAction(a);
        });
    }

    function makeSection(id, title, icon, load) {
        let activeRoot = null;
        let nonce = 0;
        async function refresh() {
            const root = activeRoot;
            if (!root) return;
            const my = ++nonce;
            const s = getSession();
            if (!s) { root.innerHTML = loginPromptHTML(icon, title, 'سجّل دخول <b>Progres</b> لرؤية هذه البيانات.'); return; }
            root.innerHTML = `<div class="grades-container">${headerHTML(icon, title)}<div class="ins-body"><div class="mobile-empty"><i class="fas fa-spinner fa-spin"></i><p>جاري الجلب من الوزارة...</p></div></div></div>`;
            try {
                const html = await load(s);
                if (my !== nonce || activeRoot !== root) return;
                root.innerHTML = `<div class="grades-container">${headerHTML(icon, title)}<div class="ins-body">${html}</div></div>`;
            } catch (e) {
                if (my !== nonce || activeRoot !== root) return;
                if (e && e.code === 401) {
                    root.innerHTML = loginPromptHTML(icon, title, 'انتهت جلسة Progres، سجّل الدخول من جديد.');
                } else {
                    root.innerHTML = errorHTML(icon, title, 'retry');
                }
            }
        }
        function mount(root) {
            activeRoot = root;
            if (!root.dataset.stMounted) {
                root.dataset.stMounted = '1';
                bindActions(root, (a) => { if (a === 'retry') refresh(); });
            }
            refresh();
        }
        window.PortalSections = window.PortalSections || [];
        window.PortalSections.push({ id, title, mount });
    }

    // ---------- المجموعة والفوج ----------
    makeSection('groupe', 'المجموعة والفوج', 'fa-users', async (s) => {
        const dia = diaOf(s);
        if (!dia) throw new Error('no-dia');
        const data = await getJSON(`/api/academic/groupe?uuid=${encodeURIComponent(s.uuid)}&dia=${encodeURIComponent(dia)}`, s);
        const list = Array.isArray(data) ? data : [];
        if (!list.length) return `<div class="ins-login-prompt"><i class="fas fa-folder-open"></i><p>لا توجد بيانات مجموعة وفوج منشورة حالياً.</p></div>`;
        return list.map((g) => `
            <div class="ins-card ins-current">
                <div class="ins-main">
                    ${dataRow('المجموعة (Section)', g.nomSection ?? g.section)}
                    ${dataRow('الفوج (Groupe)', g.nomGroupePedagogique ?? g.groupe)}
                    ${dataRow('السداسي', g.periodeLibelleLongAr || g.periodeLibelleLongLt || g.periodeLibelle)}
                </div>
            </div>`).join('');
    });

    // ---------- النسب المئوية للمقاييس ----------
    makeSection('coeffs', 'النسب المئوية للمقاييس', 'fa-percent', async (s) => {
        const cards = await getCards(s);
        const c0 = cards[0] || {};
        const oid = c0.ouvertureOffreFormationId;
        const nid = c0.niveauId;
        if (!oid || !nid) throw new Error('no-ids');
        const data = await getJSON(`/api/academic/coefficients?uuid=${encodeURIComponent(s.uuid)}&oid=${encodeURIComponent(oid)}&nid=${encodeURIComponent(nid)}`, s);
        const list = Array.isArray(data) ? data : [];
        if (!list.length) return `<div class="ins-login-prompt"><i class="fas fa-folder-open"></i><p>لا توجد نسب منشورة لهذا المسار حالياً.</p></div>`;
        const coefOf = (o, keys) => {
            for (const k of keys) {
                const v = o[k];
                if (v !== null && v !== undefined && v !== '') return v;
            }
            return '–';
        };
        return list.map((o) => {
            const name = pick(o.mcLibelleAr, o.mcLibelleFr, o.matiereLibelleAr, o.matiere, o.libelleAr, o.libelle);
            return `
            <div class="ins-card ins-current">
                <div class="ins-main">
                    ${dataRow('المقياس', name || 'مقياس')}
                    ${dataRow('معامل الامتحان', coefOf(o, ['coefficientExamen', 'coefExam']))}
                    ${dataRow('المراقبة المستمرة', coefOf(o, ['coefficientControleContinu', 'coefCC']))}
                    ${dataRow('المراقبة الوسطية', coefOf(o, ['coefficientControleIntermediaire', 'coefCI']))}
                </div>
            </div>`;
        }).join('');
    });

    // ---------- العطلة الأكاديمية (عرض فقط) ----------
    makeSection('congesx', 'العطلة الأكاديمية', 'fa-plane-departure', async (s) => {
        const data = await getJSON(`/api/academic/conges?uuid=${encodeURIComponent(s.uuid)}`, s);
        const items = (data && Array.isArray(data.items)) ? data.items : (Array.isArray(data) ? data : []);
        const sum = (data && data.summary) || null;
        if (!items.length) return `<div class="ins-login-prompt"><i class="fas fa-folder-open"></i><p>لا توجد طلبات عطلة أكاديمية مسجلة.</p></div>`;
        const badge = (st) => {
            const t = String(st || '').toLowerCase();
            const cls = /valid|approuv|accept/.test(t) ? 'ins-ok' : (/refus|rejet|non/.test(t) ? 'ins-warn' : 'ins-warn');
            const lbl = /valid|approuv|accept/.test(t) ? 'مقبولة' : (/refus|rejet|non/.test(t) ? 'مرفوضة' : String(st || 'قيد الدراسة'));
            return `<span class="ins-badge ${cls}">${esc(lbl)}</span>`;
        };
        const head = sum ? `<div class="ins-card ins-current"><div class="ins-main">${dataRow('المجموع', sum.validee + sum.nonValidee)}${dataRow('مقبولة', sum.validee)}${dataRow('غير مقبولة', sum.nonValidee)}</div></div>` : '';
        return head + items.map((c) => `
            <div class="ins-card">
                <div class="ins-current-head">
                    <span class="ins-current-tag"><i class="fas fa-plane-departure"></i>${esc(pick(c.anneeAcademique, c.annee, ''))}</span>
                    ${badge(c.statut)}
                </div>
                <div class="ins-main">
                    ${dataRow('من', c.dateDebut || c.date_demande)}${dataRow('إلى', c.dateFin)}
                    ${dataRow('السبب', c.motif || c.motifAr || c.motifFr)}
                </div>
            </div>`).join('');
    });
})();
