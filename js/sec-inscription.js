(() => {
    'use strict';

    const API_BASE = window.location.origin;

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

    async function fetchInscriptions(force) {
        if (state.loaded && !force) return state;
        state.loaded = false; state.error = false; state.cards = [];
        const session = getSession();
        if (!session) { state.error = true; state.reason = 'no-session'; return state; }
        try {
            const res = await fetch(
                `${API_BASE}/api/inscription?uuid=${encodeURIComponent(session.uuid)}`,
                { headers: { Authorization: session.token } },
            );
            let data = null;
            try { data = await res.json(); } catch (e) { /* non-json */ }
            if (!res.ok) {
                const msg = data && (data.error || data.message);
                state.error = true;
                state.reason = (res.status === 401) ? 'expired'
                    : (msg || `status-${res.status}`);
                return state;
            }
            state.cards = Array.isArray(data && data.cards) ? data.cards : [];
            state.loaded = true;
        } catch (e) {
            state.error = true;
            state.reason = e.message === 'Failed to fetch' ? 'network' : String(e.message || e);
        }
        return state;
    }

    // ---------- العرض ----------
    function statusBadge(s) {
        // situationId: 13/26 → مُصادق؛ غيره/غياب → عرض محايد أو غير مُصادق
        const val = Number(s);
        if (val === 13 || val === 26) return '<span class="ins-badge ins-ok"><i class="fas fa-circle-check"></i> تم التحقق</span>';
        return '<span class="ins-badge ins-warn"><i class="fas fa-circle-exclamation"></i> قيد المعالجة</span>';
    }

    function kv(label, value, icon) {
        const v = esc(value);
        if (!v) return '';
        return `
            <div class="ins-kv">
                <span class="ins-kv-label">${icon ? `<i class="fas fa-${icon}"></i> ` : ''}${esc(label)}</span>
                <span class="ins-kv-value">${v}</span>
            </div>`;
    }

    function cardHTML(c, isFirst) {
        const year = c.anneeAcademiqueCode || c.anneeAcademique || 'سنة دراسية';
        const rows = [
            kv('رقم التسجيل', c.numeroInscription, 'hashtag'),
            kv('المؤسسة', c.etablissement, 'building-columns'),
            kv('الولاية', c.wilaya, 'location-dot'),
            kv('الميدان', c.domaine, 'layer-group'),
            kv('الشعبة', c.filiere, 'graduation-cap'),
            kv('التخصص', c.specialite, 'flask'),
            kv('السلك', c.cycle, 'arrow-up-wide-short'),
            kv('المستوى', c.niveau, 'chart-column'),
        ].join('');

        const body = rows || '<p class="ins-empty">لا توجد تفاصيل إضافية لهذه السنة.</p>';
        return `
            <div class="ins-card ${isFirst ? 'ins-current' : ''}">
                <div class="ins-card-head">
                    <div class="ins-year">
                        <i class="fas fa-calendar-days"></i>
                        <span>${esc(year)}</span>
                    </div>
                    ${isFirst ? '<span class="ins-current-tag"><i class="fas fa-star"></i> التسجيل الحالي</span>' : ''}
                    ${statusBadge(c.situationId)}
                </div>
                <div class="ins-kv-grid">${body}</div>
            </div>`;
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

        // البيانات
        const cardsHtml = state.cards
            .map((c, i) => cardHTML(c, i === 0))
            .join('');
        root.innerHTML = `
            <div class="grades-container">
                <div class="calculator-header"><i class="fas fa-clipboard-list"></i><h3>تسجيلاتي</h3></div>
                <div class="ins-body">
                    <p class="ins-note"><i class="fas fa-circle-info"></i> تعكس هذه المعلومات مسارك الأكاديمي الرسمي من المنصة الوطنية.</p>
                    ${cardsHtml}
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
