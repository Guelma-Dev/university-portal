(() => {
    'use strict';

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (msg, type) => { if (typeof window.showToast === 'function') window.showToast(msg, type); };

    let activeRoot = null;
    let state = { loaded: false, error: false, reason: '', cards: [] };

    function getSession() {
        try {
            if (typeof window.getProgresSession === 'function') {
                const s = window.getProgresSession();
                if (s && s.uuid && s.token) return s;
            }
        } catch (e) { /* noop */ }
        return null;
    }

    const pick = (...vals) => {
        for (const v of vals) {
            if (typeof v === 'string' && v.trim()) return v.trim();
            if (v !== null && v !== undefined && v !== '') return v;
        }
        return '';
    };

    // يقرأ بطاقات DIA مباشرة من خوادم الوزارة (نفس مصدر أقسام النقاط) —
    // عبر progresFetch('cards') الذي يقبضه native.js في الأندرويد ويوجهه إلى
    // api-webetu دون أي وسيط، وفي الويب يُعالج عبر نقطة /api/progres.
    async function fetchInscriptions(force) {
        if (state.loaded && !force) return state;
        state.loaded = false; state.error = false; state.cards = [];
        const session = getSession();
        if (!session) { state.error = true; state.reason = 'no-session'; return state; }
        try {
            let cards = Array.isArray(session.cards) ? session.cards : null;
            if (!cards && typeof window.progresFetch === 'function') {
                cards = await window.progresFetch('cards');
                if (Array.isArray(cards)) {
                    const s = window.getProgresSession();
                    if (s) { s.cards = cards; if (typeof window.setProgresSession === 'function') window.setProgresSession(s); }
                }
            }
            if (!Array.isArray(cards) || cards.length === 0) { state.error = true; state.reason = 'no-cards'; return state; }
            state.cards = cards.map(simplifyDia);
            state.loaded = true;
        } catch (e) {
            state.error = true;
            state.reason = (e && e.message === 'Failed to fetch') ? 'network' : String((e && e.message) || e);
        }
        return state;
    }

    // يحوّل بطاقة DIA واحدة إلى حقول العرض المتوافقة مع واجهة "تسجيلاتي"
    function simplifyDia(c) {
        c = c || {};
        return {
            anneeAcademiqueCode: pick(c.anneeAcademiqueCode, c.anneeAcademique, c.codeAnneeAcademique),
            anneeAcademique: pick(c.anneeAcademique, c.anneeAcademiqueLibelle),
            etablissement: pick(c.etablissementLibelleAr, c.etablissementLibelle, c.etablissementLibelleLt, c.llEtablissementArabe, c.llEtablissementLatin),
            wilaya: pick(c.etablissementWilaya, c.wilayaLibelle, c.wilaya),
            domaine: pick(c.ofLlDomaineArabe, c.ofLlDomaine),
            filiere: pick(c.ofLlFiliereArabe, c.ofLlFiliere, c.filiere, c.filiereLibelleAr),
            specialite: pick(c.ofLlSpecialiteArabe, c.ofLlSpecialite, c.specialiteLibelleAr, c.specialty),
            niveau: pick(c.niveauLibelleLongAr, c.niveauLibelleLongLt, c.niveauLibelleAr, c.niveau),
            numeroInscription: pick(c.numeroInscription),
            situationId: c.situationId,
        };
    }

    // ---------- العرض ----------
    function statusBadge(s) {
        // situationId: 13/26 → مُصادق؛ غيره/غياب → عرض محايد أو غير مُصادق
        const val = Number(s);
        if (val === 13 || val === 26) return '<span class="ins-badge ins-ok"><i class="fas fa-circle-check"></i> تم التحقق</span>';
        return '<span class="ins-badge ins-warn"><i class="fas fa-circle-exclamation"></i> قيد المعالجة</span>';
    }

    function chip(label, value) {
        const v = esc(value);
        if (!v) return '';
        return `<span class="ins-chip"><em>${esc(label)}</em><b>${v}</b></span>`;
    }

    function dataRow(label, value) {
        const v = esc(value);
        if (!v) return '';
        return `<div class="data-row"><span class="label">${esc(label)}:</span><strong class="value">${v}</strong></div>`;
    }

    // بطاقة التسجيل الحالي — مضغوطة: عمود مرن بفجوة 8px، وصفوف أفقية
    // label/value بدون أي صناديق متداخلة (لا border ولا background داخلية)
    function currentCardHTML(c) {
        const year = c.anneeAcademiqueCode || c.anneeAcademique || 'سنة دراسية';
        return `
            <div class="ins-card ins-current">
                <div class="ins-current-head">
                    <span class="ins-current-tag"><i class="fas fa-star"></i>التسجيل الحالي</span>
                    ${statusBadge(c.situationId)}
                </div>
                <div class="ins-main">
                    ${dataRow('المؤسسة', c.etablissement || c.wilaya)}
                    ${dataRow('السنة الدراسية', year)}
                    ${dataRow('المستوى', c.niveau)}
                    ${dataRow('الميدان', c.domaine)}
                    ${dataRow('الشعبة', c.filiere)}
                    ${dataRow('التخصص', c.specialite || c.filiere)}
                    ${dataRow('الولاية', c.wilaya)}
                    ${dataRow('رقم التسجيل', c.numeroInscription)}
                </div>
            </div>`;
    }

    // التسجيلات السابقة — قائمة أكورديون مدمجة
    function prevListHTML(cards) {
        const rows = cards.map(c => {
            const year = c.anneeAcademiqueCode || c.anneeAcademique || 'سنة دراسية';
            const etab = c.etablissement || '';
            const spec = c.specialite || c.filiere || '';
            return `
                <details class="ins-prev">
                    <summary>
                        <span class="ins-prev-year"><i class="fas fa-calendar-days"></i>${esc(year)}</span>
                        <span class="ins-prev-spec">${esc(spec)}</span>
                        ${statusBadge(c.situationId)}
                    </summary>
                    <div class="ins-prev-body">
                        ${chip('المؤسسة', etab)}
                        ${chip('الشعبة', c.filiere)}
                        ${chip('الولاية', c.wilaya)}
                        ${chip('المستوى', c.niveau)}
                        ${chip('رقم التسجيل', c.numeroInscription)}
                    </div>
                </details>`;
        }).join('');
        return `<div class="ins-prev-wrap"><h4 class="ins-prev-title"><i class="fas fa-clock-rotate-left"></i>التسجيلات السابقة</h4>${rows}</div>`;
    }

    function render() {
        const root = activeRoot;
        if (!root) return;

        // لا جلسة → تشجيع الدخول ببروقرس
        if (!getSession()) {
            root.innerHTML = `
                <div class="grades-container">
                    <div class="calculator-header"><i class="fas fa-clipboard-list"></i><h3>تسجيلاتي</h3></div>
                    <div class="ins-body">
                        <div class="ins-login-prompt">
                            <i class="fas fa-id-card-clip"></i>
                            <p>سجّل دخول <b>Progres</b> لرؤية تسجيلاتك الجامعية للسنة الحالية والسنوات السابقة.</p>
                            <button type="button" class="lx-m-btn-retry" data-action="goto-progres-login">
                                <i class="fas fa-right-to-bracket"></i> تسجيل دخول Progres
                            </button>
                        </div>
                    </div>
                </div>`;
            return;
        }

        // تحميل
        if (!state.loaded && !state.error) {
            root.innerHTML = `<div class="grades-container"><div class="calculator-header"><i class="fas fa-clipboard-list"></i><h3>تسجيلاتي</h3></div><div class="ins-body">${skel()}</div></div>`;
            return;
        }

        // خطأ
        if (state.error) {
            const prompt = (() => {
                if (state.reason === 'no-session' || state.reason === 'expired') {
                    return `
                        <p>انتهت جلستك أو لم تُسجّل بعد في <b>Progres</b>.</p>
                        <button type="button" class="lx-m-btn-retry" data-action="goto-progres-login">
                            <i class="fas fa-right-to-bracket"></i> تسجيل دخول Progres
                        </button>`;
                }
                if (state.reason === 'network') {
                    return '<p>تعذّر الاتصال بالخادم، تحقق من الإنترنت ثم أعد المحاولة.</p>';
                }
                return `<p>${esc(state.reason)}</p>`;
            })();
            root.innerHTML = `
                <div class="grades-container">
                    <div class="calculator-header"><i class="fas fa-clipboard-list"></i><h3>تسجيلاتي</h3></div>
                    <div class="ins-body">
                        <div class="ins-login-prompt">
                            <i class="fas fa-triangle-exclamation"></i>
                            ${prompt}
                            <button type="button" class="lx-m-btn-retry" data-action="retry-ins">
                                <i class="fas fa-rotate-right"></i> إعادة المحاولة
                            </button>
                        </div>
                    </div>
                </div>`;
            return;
        }

        // لا بيانات
        if (!state.cards.length) {
            root.innerHTML = `
                <div class="grades-container">
                    <div class="calculator-header"><i class="fas fa-clipboard-list"></i><h3>تسجيلاتي</h3></div>
                    <div class="ins-body">
                        <div class="ins-login-prompt">
                            <i class="fas fa-folder-open"></i>
                            <p>لا توجد تسجيلات إدارية معروضة في حسابك حالياً.</p>
                            <button type="button" class="lx-m-btn-retry" data-action="retry-ins">
                                <i class="fas fa-rotate-right"></i> إعادة المحاولة
                            </button>
                        </div>
                    </div>
                </div>`;
            return;
        }

        // البيانات — بطاقة التسجيل الحالي + قائمة التسجيلات السابقة
        const first = state.cards[0];
        const prev = state.cards.slice(1);
        const currentHtml = currentCardHTML(first);
        const prevHtml = prev.length ? prevListHTML(prev) : '';
        root.innerHTML = `
            <div class="grades-container">
                <div class="calculator-header"><i class="fas fa-clipboard-list"></i><h3>تسجيلاتي</h3></div>
                <div class="ins-body">
                    <p class="ins-note"><i class="fas fa-circle-info"></i> تعكس هذه المعلومات مسارك الأكاديمي الرسمي من المنصة الوطنية.</p>
                    <div class="ins-current-wrap">${currentHtml}</div>
                    ${prevHtml}
                </div>
            </div>`;
    }

    function skel() {
        let s = '';
        for (let i = 0; i < 2; i++) {
            s += `<div class="ins-skel"><span class="skel skel-block" style="height:18px;width:40%"></span><span class="skel skel-block" style="height:14px;width:90%"></span><span class="skel skel-block" style="height:14px;width:70%"></span></div>`;
        }
        return s;
    }

    function onAction(el) {
        const a = el.dataset.action;
        if (a === 'goto-progres-login') {
            if (typeof navigateToSection === 'function') navigateToSection('grades');
            setTimeout(() => {
                const inp = document.querySelector('#section-grades [name="progres-username"]');
                if (inp) inp.focus();
                toast('أدخل بيانات Progres ثم عد إلى قسم تسجيلاتي', 'info');
            }, 350);
        } else if (a === 'retry-ins') {
            state.loaded = false; state.error = false;
            fetchInscriptions(true).then(render);
        }
    }

    function mount(root) {
        activeRoot = root;
        if (root.dataset.mountedInitDone) { render(); return; }
        root.dataset.mountedInitDone = '1';

        root.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (btn) onAction(btn);
        });

        state.loaded = false; state.error = false;
        render();
        fetchInscriptions(false).then(render);
    }

    window.PortalSections = window.PortalSections || [];
    window.PortalSections.push({
        id: 'inscription',
        title: 'تسجيلاتي',
        icon: 'fa-clipboard-list',
        mount,
    });

    // refresh عند فتح القسم مجدداً عبر switchSection
    if (window.navigateToSection && !window.navigateToSection.__insPatched) {
        const orig = window.navigateToSection;
        window.navigateToSection = function (sec) {
            const r = orig.apply(this, arguments);
            if (sec === 'inscription' && activeRoot) {
                state.loaded = false; state.error = false;
                fetchInscriptions(true).then(render);
            }
            return r;
        };
        window.navigateToSection.__insPatched = true;
    }
})();
