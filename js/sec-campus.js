// ==== قسم جامعتي (PMS جامعة قالمة — قراءة فقط) ====
// البيانات: /api/pms/* (البروكسي للويب، وnative.js يعترضها في الأندرويد).
// الدخول برقم التسجيل + كلمة سر PMS (جلسة الجامعة، تُحفظ محلياً فقط).
(() => {
    'use strict';

    const API = window.location.origin + '/api/pms';
    const LS_KEY = 'lx_pms';
    const SS_KEY = 'lx_pms_sess';

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (m, t) => { if (typeof window.showToast === 'function') window.showToast(m, t); };

    const S = { root: null, tab: 'home', sess: null, cache: {}, loading: false, loginErr: '' };

    function loadSess() {
        try {
            const raw = sessionStorage.getItem(SS_KEY) || localStorage.getItem(LS_KEY);
            if (raw) { const s = JSON.parse(raw); if (s && s.student_id) return s; }
        } catch (e) {}
        return null;
    }

    function saveSess(s, remember) {
        try {
            sessionStorage.removeItem(SS_KEY); localStorage.removeItem(LS_KEY);
            (remember ? localStorage : sessionStorage).setItem(remember ? LS_KEY : SS_KEY, JSON.stringify(s));
        } catch (e) {}
    }

    function clearSess() {
        try { sessionStorage.removeItem(SS_KEY); localStorage.removeItem(LS_KEY); } catch (e) {}
    }

    async function api(path, body) {
        const res = await fetch(API + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
        if (!res.ok) {
            let msg = 'خطأ ' + res.status;
            try { msg = (await res.json()).error || msg; } catch (e) {}
            throw new Error(msg);
        }
        return res.json();
    }

    async function pms(endpoint, extra) {
        const key = endpoint + '|' + JSON.stringify(extra || {});
        if (S.cache[key]) return S.cache[key];
        const d = await api('/fetch', Object.assign({ endpoint, student_id: S.sess.student_id }, extra));
        S.cache[key] = d;
        return d;
    }

    const TABS = [
        ['home', 'fa-house', 'الرئيسية'],
        ['modules', 'fa-book', 'الموديولات'],
        ['schedule', 'fa-calendar-days', 'الرزنامة'],
        ['rooms', 'fa-door-open', 'القاعات'],
        ['absences', 'fa-user-xmark', 'الغيابات'],
        ['exams', 'fa-file-pen', 'الامتحانات'],
        ['stage', 'fa-briefcase', 'التربص'],
        ['news', 'fa-newspaper', 'الأخبار'],
    ];

    function headerHTML() {
        const p = (S.sess && S.sess.profile) || {};
        const name = p.NomAr || p.Nom || '';
        return `<div class="calculator-header"><i class="fas fa-building-columns"></i><h3>🎓 جامعتي (قالمة)</h3></div>
            <div class="ins-body" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                <span>👤 ${esc(name)} — فوج ${esc(p.Groupe || '')}</span>
                <button type="button" class="lx-m-btn-retry" data-action="pms-logout">خروج</button>
            </div>`;
    }

    function tabsHTML() {
        return `<div class="ins-body" style="display:flex;flex-wrap:wrap;gap:6px">` + TABS.map(([id, ic, t]) =>
            `<button type="button" class="lx-m-btn-retry" data-action="pms-tab" data-tab="${id}" ${S.tab === id ? 'disabled' : ''}><i class="fas ${ic}"></i> ${t}</button>`
        ).join('') + `</div>`;
    }

    function loginHTML() {
        return `<div class="grades-container">
            <div class="calculator-header"><i class="fas fa-building-columns"></i><h3>🎓 جامعتي (قالمة)</h3></div>
            <div class="ins-body"><div class="ins-login-prompt">
                <i class="fas fa-id-card-clip"></i>
                <p>ادخل برقم تسجيل PMS للوصول لرزنامة جامعتك، القاعات، الموديولات والأخبار. (قراءة فقط)</p>
                ${S.loginErr ? `<p style="color:#e11d48">${esc(S.loginErr)}</p>` : ''}
                <input id="pms-user" inputmode="numeric" placeholder="رقم التسجيل" autocomplete="username"
                    style="width:100%;padding:10px;border-radius:10px;border:1px solid #cbd5e1;margin-bottom:8px" />
                <input id="pms-pass" type="password" placeholder="كلمة المرور" autocomplete="current-password"
                    style="width:100%;padding:10px;border-radius:10px;border:1px solid #cbd5e1;margin-bottom:8px" />
                <label style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
                    <input type="checkbox" id="pms-remember" checked /> تذكرني على هذا الجهاز
                </label>
                <button type="button" class="lx-m-btn-retry" data-action="pms-login">
                    <i class="fas fa-right-to-bracket"></i> دخول
                </button>
            </div></div>
        </div>`;
    }

    function render() {
        if (!S.root) return;
        if (!S.sess) { S.root.innerHTML = loginHTML(); return; }
        let body = '';
        if (S.loading) body = `<div class="ins-body"><p>⏳ جاري الجلب...</p></div>`;
        else if (S.tabHtml) body = S.tabHtml;
        S.root.innerHTML = `<div class="grades-container">${headerHTML()}${tabsHTML()}<div class="ins-body" id="pms-body">${body}</div></div>`;
    }

    async function showTab(tab) {
        S.tab = tab; S.loading = true; S.tabHtml = ''; render();
        try {
            if (tab === 'home') S.tabHtml = await homeHTML();
            else if (tab === 'modules') S.tabHtml = await modulesHTML();
            else if (tab === 'schedule') S.tabHtml = await scheduleHTML();
            else if (tab === 'rooms') S.tabHtml = await roomsHTML();
            else if (tab === 'absences') S.tabHtml = await absencesHTML();
            else if (tab === 'exams') S.tabHtml = await examsHTML();
            else if (tab === 'stage') S.tabHtml = await stageHTML();
            else if (tab === 'news') S.tabHtml = await newsHTML();
        } catch (e) {
            S.tabHtml = `<p>تعذر الجلب: ${esc(e.message)} <button type="button" class="lx-m-btn-retry" data-action="pms-tab" data-tab="${tab}">إعادة</button></p>`;
        }
        S.loading = false; render();
    }

    async function homeHTML() {
        const d = await pms('get_dashboard_data');
        const tickers = await pms('get_news').then(n => n.ticker || []).catch(() => []);
        const risks = (d.risk_modules || []).map(r => `<li>⚠️ ${esc(r.module_name || r.name || JSON.stringify(r))}</li>`).join('');
        return `<p><b>${esc(d.specialtyNameAr || '')}</b> — ${esc(d.lvlYearStr || '')} — فوج ${esc(d.group || '')}</p>
            <p>🚫 الغيابات: <b>${esc(d.totalAbsences ?? 0)}</b>${d.tutorName ? ` — 👨‍🏫 المشرف: <b>${esc(d.tutorNameAr || d.tutorName)}</b>` : ''}</p>
            ${risks ? `<ul>${risks}</ul>` : '<p>✅ لا موديولات في خطر</p>'}
            ${tickers.slice(0, 3).map(t => `<p>📢 ${esc((t.subject || '').slice(0, 140))}...</p>`).join('')}`;
    }

    async function modulesHTML() {
        const d = await pms('get_student_modules');
        const mods = d.modules || d.data || [];
        if (!mods.length) return '<p>لا موديولات.</p>';
        return mods.map(m => `
            <details style="border:1px solid #e2e8f0;border-radius:10px;padding:8px;margin-bottom:8px">
                <summary><b>${esc(m.nameAr || m.name)}</b> — coeff ${esc(m.TotalCoefficient || m.coef || '')} — ${esc(m.credit || m.TotalCredit || '')} cr</summary>
                <p>الأستاذ: ${esc(m.eNameAr || m.eName || '')} ${m.vNameAr ? '| محاضر: ' + esc(m.vNameAr) : ''}</p>
                <button type="button" class="lx-m-btn-retry" data-action="pms-syllabus" data-mid="${esc(m.id || m.module_id)}">📜 المنهاج</button>
                <div id="pms-syl-${esc(m.id || m.module_id)}"></div>
            </details>`).join('');
    }

    async function scheduleHTML() {
        const d = await pms('get_group_schedule');
        const rows = d.schedule || [];
        if (!rows.length) return '<p>لا حصص.</p>';
        const days = {};
        rows.forEach(r => { (days[r.jours || '?'] = days[r.jours || '?'] || []).push(r); });
        return Object.keys(days).map(day => `<p><b>📅 ${esc(day)}</b></p>` + days[day].map(r =>
            `<p>${esc(r.heure || '')} — <b>${esc(r.mNameAr || r.mName || '')}</b> (${esc(r.type || '')}) — قاعة ${esc(r.nom_salle || r.salle_id || '')} — ${esc(r.teacherAr || r.teacher || '')}</p>`
        ).join('')).join('');
    }

    async function roomsHTML() {
        const d = await pms('get_occupancy_data');
        const rooms = d.rooms || [];
        const horaires = d.horaires || [];
        const busy = new Set(horaires.map(h => String(h.salle_id)));
        return `<p>🏫 ${rooms.length} قاعة (${esc((d.debug_info || {}).day_queried || '')}) — 🟢 حرة / 🔴 مشغولة الآن</p>` +
            rooms.map(r => {
                const [lat, lng] = String(r.coordonnes || ',').split(',');
                const map = (lat && lng) ? ` <a href="https://www.openstreetmap.org/?mlat=${lat.trim()}&mlon=${lng.trim()}#map=18/${lat.trim()}/${lng.trim()}" target="_blank" rel="noopener">🗺️</a>` : '';
                return `<p>${busy.has(String(r.id)) ? '🔴' : '🟢'} ${esc(r.nom_salle)}${map}</p>`;
            }).join('');
    }

    async function absencesHTML() {
        const d = await pms('get_student_absences');
        const mods = d.modules || [];
        return `<p>المجموع: <b>${esc(d.total_all ?? 0)}</b> (مبررة ${esc(d.total_justified ?? 0)} / غير مبررة ${esc(d.total_unjustified ?? 0)})</p>` +
            (mods.length ? mods.map(m => `<p>• ${esc(m.module_name || m.name || '')}: ${esc(m.total_abs ?? m.abs ?? '')}</p>`).join('') : '<p>✅ سجل نظيف</p>');
    }

    async function examsHTML() {
        const d = await pms('get_student_exams');
        const all = [].concat(d.regular || [], d.debts || [], d.replacements || []);
        if (!all.length) return '<p>لا امتحانات مبرمجة حالياً.</p>';
        return all.map(x => `<p>📝 <b>${esc(x.module_name || x.name || '')}</b> — ${esc(x.exam_date || x.date || '')} — قاعة ${esc(x.salle || x.nom_salle || '')} (${esc(x.session_type || '')})</p>`).join('');
    }

    async function stageHTML() {
        const [tut, stg, def] = await Promise.all([
            pms('get_tutoring').catch(() => null),
            pms('get_student_stage').catch(() => null),
            pms('get_student_defense').catch(() => null),
        ]);
        let h = '';
        if (tut && tut.tutor) h += `<p>👨‍🏫 مشرفك: <b>${esc(tut.tutor.tutorNameAr || tut.tutor.tutorName || '')}</b></p>`;
        else h += '<p>لا مشرف مسند حالياً.</p>';
        if (stg) h += stg.is_open ? `<p>💼 التربص مفتوح: ${esc(JSON.stringify(stg.data).slice(0, 200))}</p>` : '<p>💼 الترشح للتربص مغلق حالياً.</p>';
        if (def) h += def.has_defense ? `<p>🎓 المناقشة: ${esc(def.scheduled_date || '')} — ${esc(def.jury_title || '')}</p>` : '<p>🎓 لا مناقشة مبرمجة.</p>';
        return h;
    }

    async function newsHTML() {
        const n = await pms('get_news');
        const items = (n.notices || []).concat(n.ticker || []);
        if (!items.length) return '<p>لا أخبار.</p>';
        return items.slice(0, 20).map(t => {
            const img = t.image ? `<br><img src="https://ent.univ-guelma.dz/board/uploads/${esc(t.image)}" loading="lazy" style="max-width:100%;border-radius:10px" />` : '';
            return `<p>📢 <b>${esc(t.title || t.sDate || '')}</b><br>${esc(t.subject || t.content || '')}${img}</p><hr>`;
        }).join('');
    }

    async function onAction(btn) {
        const a = btn.dataset.action;
        if (a === 'pms-login') {
            const u = (document.getElementById('pms-user') || {}).value || '';
            const p = (document.getElementById('pms-pass') || {}).value || '';
            const rem = !!(document.getElementById('pms-remember') || {}).checked;
            if (!u.trim() || !p) { S.loginErr = 'أدخل رقم التسجيل وكلمة المرور'; render(); return; }
            S.loginErr = ''; render();
            btn.disabled = true;
            try {
                const d = await api('/login', { username: u.trim(), password: p });
                if (d.status !== 'success' || !d.data) throw new Error(d.message || 'فشل الدخول');
                S.sess = { student_id: d.data.Id || d.data.student_id, profile: d.data };
                saveSess(S.sess, rem);
                S.cache = {}; S.tab = 'home';
                toast('مرحباً ' + (d.data.NomAr || d.data.Nom || ''), 'success');
                showTab('home');
            } catch (e) { S.loginErr = e.message; render(); }
            return;
        }
        if (a === 'pms-logout') { clearSess(); S.sess = null; S.cache = {}; render(); return; }
        if (a === 'pms-tab') { showTab(btn.dataset.tab); return; }
        if (a === 'pms-syllabus') {
            const mid = btn.dataset.mid;
            const box = document.getElementById('pms-syl-' + mid);
            if (!box) return;
            if (box.dataset.done) { box.innerHTML = ''; delete box.dataset.done; return; }
            box.innerHTML = '⏳...';
            try {
                const s = await pms('get_syllabus', { module_id: mid });
                const d = s.data || {};
                box.innerHTML = `<p>ساعات: cours ${esc(d.vhc ?? '')} / TD ${esc(d.vhtd ?? '')} / TP ${esc(d.vhtp ?? '')} — الأستاذ ${esc(d.eNameAr || d.eName || '')}</p>`;
                box.dataset.done = '1';
            } catch (e) { box.innerHTML = `<p>${esc(e.message)}</p>`; }
        }
    }

    function mount(root) {
        S.root = root;
        if (root.dataset.mountedInitDone) { render(); if (S.sess) showTab(S.tab); return; }
        root.dataset.mountedInitDone = '1';
        root.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (btn) onAction(btn);
        });
        S.sess = loadSess();
        render();
        if (S.sess) showTab('home');
    }

    window.PortalSections = window.PortalSections || [];
    window.PortalSections.push({ id: 'campus', title: '🎓 جامعتي', icon: 'fa-building-columns', mount });
})();
