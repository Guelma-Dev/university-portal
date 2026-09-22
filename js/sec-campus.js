// ==== جامعتي — نسخة المسئول الفاخرة (PMS قالمة، قراءة فقط) ====
// بوابة: user_role=admin فقط. الجلسة مزروعة دائماً (student_id ثابت).
// البيانات: /api/pms/* (ويب) أو مباشرة من الهاتف (native.js).
(() => {
    'use strict';

    const API = window.location.origin + '/api/pms';
    const LS_KEY = 'lx_pms';
    const SID = 997;

    const SEED_PROFILE = {
        Id: 997, Inscription: 'UN24012026252536255705', Bac: '2025',
        Matricule: '252536255705', Nom: 'BRAHIMI Mohamed', NomAr: 'محمد براهيمي',
        spec_id: 215, niveau_id: 37, section: '1', Groupe: '2',
        gender: 'Masculin', date_naiss: '2006-10-29',
        email: 'bbm82186@gmail.com', Tel: '0558163003',
    };

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (m, t) => { if (typeof window.showToast === 'function') window.showToast(m, t); };
    const isAdmin = () => { try { return localStorage.getItem('user_role') === 'admin'; } catch (e) { return false; } };

    const S = { root: null, tab: 'home', sess: null, cache: {}, loading: false, tabHtml: '', unread: 0 };

    function loadSess() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) { const s = JSON.parse(raw); if (s && s.student_id) return s; }
        } catch (e) {}
        const s = { student_id: SID, profile: Object.assign({}, SEED_PROFILE), seeded: true };
        try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
        return s;
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
        ['schedule', 'fa-calendar-days', 'رزنامتي'],
        ['exams', 'fa-file-pen', 'امتحاناتي'],
        ['absences', 'fa-user-xmark', 'غياباتي'],
        ['modules', 'fa-book', 'موديولاتي'],
        ['rooms', 'fa-door-open', 'القاعات'],
        ['tutor', 'fa-user-tie', 'المشرف'],
        ['stage', 'fa-briefcase', 'التربص'],
        ['defense', 'fa-graduation-cap', 'المناقشة'],
        ['news', 'fa-newspaper', 'الأخبار'],
        ['notifs', 'fa-bell', 'تنبيهاتي'],
        ['profile', 'fa-id-card', 'ملفي'],
    ];

    function syncTile() {
        try {
            const t = document.getElementById('campus-tile');
            if (t) t.style.display = isAdmin() ? '' : 'none';
        } catch (e) {}
    }

    function lockHTML() {
        return `<div class="cx-card"><div class="cx-lock">
            <i class="fas fa-shield-halved"></i>
            <h3>منطقة المسئول</h3>
            <p>قسم «جامعتي» خاص بإدارة التطبيق فقط.</p>
        </div></div>`;
    }

    function heroHTML(d) {
        const p = S.sess.profile || {};
        return `<div class="cx-hero">
            <p class="cx-name">👋 ${esc(p.NomAr || p.Nom || '')}</p>
            <p class="cx-sub">${esc(d.specialtyNameAr || d.specialtyNameFr || '')} — ${esc(d.lvlYearStr || '')} — فوج ${esc(d.group || p.Groupe || '')} / قسم ${esc(d.section || p.section || '')}</p>
        </div>`;
    }

    function statsHTML(d) {
        return `<div class="cx-stats">
            <div class="cx-stat gold"><b>${esc(d.currentSemester ?? '—')}</b><span>السداسي</span></div>
            <div class="cx-stat ${Number(d.totalAbsences) > 0 ? 'blue' : 'green'}"><b>${esc(d.totalAbsences ?? 0)}</b><span>غيابات</span></div>
            <div class="cx-stat green"><b>${esc((d.risk_modules || []).length)}</b><span>موديولات خطر</span></div>
        </div>`;
    }

    function tabsHTML() {
        return `<div class="cx-tabs">` + TABS.map(([id, ic, t]) => {
            const badge = (id === 'notifs' && S.unread > 0) ? `<span class="cx-badge">${S.unread}</span>` : '';
            return `<button type="button" class="cx-tab ${S.tab === id ? 'on' : ''}" data-action="pms-tab" data-tab="${id}"><i class="fas ${ic}"></i> ${t}${badge}</button>`;
        }).join('') + `</div>`;
    }

    function render() {
        if (!S.root) return;
        if (!isAdmin()) { S.root.innerHTML = lockHTML(); return; }
        let body = S.loading ? `<div class="cx-card"><div class="cx-sk"></div><div class="cx-sk"></div></div>` : (S.tabHtml || '');
        S.root.innerHTML = tabsHTML() + `<div id="pms-body">${body}</div>`;
    }

    async function showTab(tab) {
        S.tab = tab; S.loading = true; S.tabHtml = ''; render();
        try {
            S.tabHtml =
                tab === 'home' ? await vHome() :
                tab === 'schedule' ? await vSchedule() :
                tab === 'exams' ? await vExams() :
                tab === 'absences' ? await vAbsences() :
                tab === 'modules' ? await vModules() :
                tab === 'rooms' ? await vRooms() :
                tab === 'tutor' ? await vTutor() :
                tab === 'stage' ? await vStage() :
                tab === 'defense' ? await vDefense() :
                tab === 'news' ? await vNews() :
                tab === 'notifs' ? await vNotifs() :
                await vProfile();
        } catch (e) {
            S.tabHtml = `<div class="cx-card"><p>تعذر الجلب: ${esc(e.message)}</p><button type="button" class="cx-btn gold" data-action="pms-tab" data-tab="${tab}">إعادة المحاولة</button></div>`;
        }
        S.loading = false; render();
    }

    // ---------- الشاشات ----------
    async function vHome() {
        const d = await pms('get_dashboard_data');
        try {
            const n = await pms('get_all_notifications');
            S.unread = Number(n.total || (n.notifications || []).filter(x => !x.is_unread && x.is_unread !== 0).length || 0);
        } catch (e) {}
        const risks = (d.risk_modules || []).map(r =>
            `<div class="cx-room"><span class="cx-dot busy"></span><span>${esc(r.module_name || r.name || r.mod_name || '')}</span></div>`).join('');
        const events = [].concat(d.tutor_events || [], d.cp_meetings || []).slice(0, 3).map(e =>
            `<p>📌 ${esc(e.title || e.cp_title || e.subject || JSON.stringify(e).slice(0, 80))}</p>`).join('');
        return heroHTML(d) + statsHTML(d) + `
        <div class="cx-card"><h4>⚠️ موديولات في خطر</h4>${risks || '<p class="cx-muted">✅ لا موديولات في خطر — واصل.</p>'}</div>
        <div class="cx-card"><h4>📅 مواعيد قادمة</h4>${events || '<p class="cx-muted">لا مواعيد معلنة.</p>'}</div>`;
    }

    async function vSchedule() {
        const d = await pms('get_group_schedule');
        let groups = [];
        if (Array.isArray(d.semA) && d.semA.length) groups.push(['السداسي الأول', d.semA]);
        if (Array.isArray(d.semB) && d.semB.length) groups.push(['السداسي الثاني', d.semB]);
        if (!groups.length && Array.isArray(d.schedule)) groups.push(['رزنامتي', d.schedule]);
        if (!groups.length) return `<div class="cx-card"><p class="cx-muted">لا حصص مبرمجة.</p></div>`;
        return groups.map(([title, rows]) => {
            const days = {};
            rows.forEach(r => { const k = r.jours || 'أخرى'; (days[k] = days[k] || []).push(r); });
            return `<div class="cx-card"><h4>📅 ${esc(title)}</h4>` + Object.keys(days).map(day =>
                `<p class="cx-day">${esc(day)}</p><table class="cx-table"><tr><th>التوقيت</th><th>المقياس</th><th>القاعة / الأستاذ</th></tr>` +
                days[day].map(r => `<tr><td class="cx-time">${esc(r.heure || '')}</td>
                    <td><b>${esc(r.mNameAr || r.mName || '')}</b><br><span class="cx-pill info">${esc(r.type || '')}</span></td>
                    <td>${esc(r.nom_salle || r.salle_id || '')}<br><span class="cx-muted">${esc(r.teacherAr || r.teacher || '')}</span></td></tr>`).join('') +
                `</table>`).join('') + `</div>`;
        }).join('');
    }

    async function vExams() {
        const d = await pms('get_student_exams');
        const sec = (t, arr, cls) => {
            arr = arr || [];
            if (!arr.length) return '';
            return `<div class="cx-card"><h4>${t} <span class="cx-pill ${cls}">${arr.length}</span></h4>` + arr.map(x =>
                `<div class="cx-room"><span>📝</span><span><b>${esc(x.module_name || x.mod_name || x.name || '')}</b><br>
                <span class="cx-muted">${esc(x.exam_date || x.date || x.scheduled_date || '')} ${esc(x.heure || x.time || '')} — قاعة ${esc(x.salle || x.nom_salle || '')}</span></span></div>`
            ).join('') + `</div>`;
        };
        const h = sec('📝 الدورة العادية', d.regular, 'ok') + sec('🔁 الاستدراك', d.replacements, 'warn') + sec('📦 الديون', d.debts, 'bad');
        return h || `<div class="cx-card"><p class="cx-muted">لا امتحانات مبرمجة حالياً.</p></div>`;
    }

    async function vAbsences() {
        const d = await pms('get_student_absences');
        const tot = Number(d.total_all || 0), unjust = Number(d.total_unjustified || 0);
        const pct = Math.min(100, unjust * 20);
        const mods = (d.modules || []).map(m => {
            const a = Number(m.total_abs ?? m.abs ?? 0);
            return `<div class="cx-room"><span>📚</span><span style="flex:1"><b>${esc(m.module_name || m.name || '')}</b>
                <div class="cx-meter"><i style="width:${Math.min(100, a * 20)}%"></i></div></span>
                <b>${a}</b></div>`;
        }).join('');
        return `<div class="cx-card"><h4>🚫 الغيابات</h4>
            <div class="cx-stats" style="margin:0 0 8px">
                <div class="cx-stat blue"><b>${tot}</b><span>المجموع</span></div>
                <div class="cx-stat green"><b>${esc(d.total_justified ?? 0)}</b><span>مبررة</span></div>
                <div class="cx-stat ${unjust >= 5 ? '' : 'green'}"><b>${unjust}</b><span>غير مبررة</span></div>
            </div>
            <p class="cx-muted">عتبة الإقصاء: 5 غير مبررة</p>
            <div class="cx-meter"><i style="width:${pct}%"></i></div></div>
        <div class="cx-card"><h4>📚 حسب المقياس</h4>${mods || '<p class="cx-muted">✅ سجل نظيف.</p>'}</div>`;
    }

    async function vModules() {
        const d = await pms('get_student_modules');
        const mods = d.modules || d.data || [];
        if (!mods.length) return `<div class="cx-card"><p class="cx-muted">لا موديولات.</p></div>`;
        return `<div class="cx-card"><h4>📚 موديولاتي <span class="cx-pill info">${mods.length}</span></h4>` + mods.map(m => `
            <details><summary>${esc(m.nameAr || m.name || '')}</summary>
                <p class="cx-muted">coeff ${esc(m.TotalCoefficient ?? m.coef ?? '')} — ${esc(m.credit ?? m.TotalCredit ?? '')} رصيد — سداسي ${esc(m.semestre ?? '')}</p>
                <button type="button" class="cx-btn green" data-action="pms-syllabus" data-mid="${esc(m.id ?? m.module_id)}">📜 المنهاج</button>
                <div id="pms-syl-${esc(m.id ?? m.module_id)}"></div>
            </details>`).join('') + `</div>`;
    }

    async function vRooms() {
        const d = await pms('get_occupancy_data');
        const rooms = d.rooms || [];
        const busy = new Set((d.horaires || []).map(h => String(h.salle_id)));
        const free = rooms.filter(r => !busy.has(String(r.id))).length;
        return `<div class="cx-card"><h4>🏫 القاعات <span class="cx-pill ok">🟢 ${free} حرة</span> <span class="cx-pill bad">🔴 ${rooms.length - free} مشغولة</span></h4>
            <p class="cx-muted">${esc((d.debug_info || {}).day_queried || '')} — ${esc((d.debug_info || {}).semester_type || '')}</p>` +
            rooms.map(r => {
                const parts = String(r.coordonnes || '').split(',');
                const map = parts.length === 2
                    ? ` <a class="cx-btn" style="min-height:36px;padding:0 12px" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${parts[0].trim()}&mlon=${parts[1].trim()}#map=18/${parts[0].trim()}/${parts[1].trim()}">🗺️</a>` : '';
                return `<div class="cx-room"><span class="cx-dot ${busy.has(String(r.id)) ? 'busy' : 'free'}"></span><span><b>${esc(r.nom_salle)}</b></span><span class="cx-map">${map}</span></div>`;
            }).join('') + `</div>`;
    }

    async function vTutor() {
        const t = await pms('get_tutoring');
        const tu = t.tutor || {};
        const hist = (t.history || []).map(h => `<p>• ${esc(h.title || h.subject || JSON.stringify(h).slice(0, 100))}</p>`).join('');
        return `<div class="cx-card"><h4>👨‍🏫 مشرفي</h4>` + (t.tutor
            ? `<p style="font-size:1.15rem;font-weight:800">${esc(tu.tutorNameAr || tu.tutorName || '')}</p><p class="cx-muted">${esc(tu.tutorName || '')}</p>`
            : `<p class="cx-muted">لا مشرف مسند حالياً.</p>`) + `</div>
        <div class="cx-card"><h4>📜 السجل</h4>${hist || '<p class="cx-muted">لا عناصر.</p>'}</div>`;
    }

    async function vStage() {
        const s = await pms('get_student_stage');
        let body = s.is_open
            ? `<span class="cx-pill ok">الترشح مفتوح</span>`
            : `<span class="cx-pill warn">الترشح مغلق حالياً</span>`;
        const data = s.data || [];
        if (Array.isArray(data) && data.length) body += data.map(x =>
            `<div class="cx-room"><span>💼</span><span><b>${esc(x.company_name || x.theme || '')}</b><br>
            <span class="cx-muted">${esc(x.status || '')} ${esc(x.start_date || '')}</span></span></div>`).join('');
        return `<div class="cx-card"><h4>💼 التربص</h4><p>${body}</p></div>`;
    }

    async function vDefense() {
        const d = await pms('get_student_defense');
        if (!d.has_defense) return `<div class="cx-card"><h4>🎓 المناقشة</h4><p class="cx-muted">لا مناقشة مبرمجة — ستظهر هنا اللجنة والقاعة فور برمجتها.</p></div>`;
        const jury = [d.president, d.supervisor, d.co_supervisor, d.examiners, d.ext_examiners]
            .filter(Boolean).map(j => `<div class="cx-room"><span>⚖️</span><span>${esc(typeof j === 'string' ? j : (j.name || JSON.stringify(j)))}</span></div>`).join('');
        return `<div class="cx-card"><h4>🎓 المناقشة</h4>
            <p>📅 ${esc(d.scheduled_date || d.meeting_date || '')} — 📍 ${esc(d.lieu || d.salle || '')}</p>
            <h4>اللجنة</h4>${jury || '<p class="cx-muted">—</p>'}</div>`;
    }

    async function vNews() {
        const [n, a] = await Promise.all([
            pms('get_news').catch(() => ({})),
            pms('get_announcements').catch(() => ({})),
        ]);
        const tick = (n.ticker || []).slice(0, 5).map(t =>
            `<div class="cx-card"><span class="cx-pill warn">عاجل</span><p>${esc(t.subject || '')}</p></div>`).join('');
        const item = (t) => {
            const img = t.image ? `<br><img src="https://ent.univ-guelma.dz/board/uploads/${esc(t.image)}" loading="lazy" style="max-width:100%;border-radius:14px;margin-top:8px" />` : '';
            return `<p>📢 <b>${esc(t.title || t.sDate || '')}</b><br>${esc(t.subject || t.content || '')}${img}</p><hr>`;
        };
        const notices = (n.notices || []).slice(0, 15).map(item).join('');
        const admin = [].concat(a.notices || [], a.dept_notices || []).slice(0, 10).map(item).join('');
        return tick + `<div class="cx-card cx-news"><h4>📰 أخبار الجامعة</h4>${notices || '<p class="cx-muted">لا أخبار.</p>'}</div>
        <div class="cx-card cx-news"><h4>📣 إعلانات الإدارة</h4>${admin || '<p class="cx-muted">لا إعلانات.</p>'}</div>`;
    }

    async function vNotifs() {
        const n = await pms('get_all_notifications');
        S.unread = Number(n.total || 0);
        const items = (n.notifications || []).map(x =>
            `<div class="cx-room"><span>${x.is_unread ? '🔵' : '⚪'}</span><span><b>${esc(x.titleAr || x.title || '')}</b><br>
            <span class="cx-muted">${esc(x.senderAr || x.sender || '')} — ${esc(x.created_at || '')}</span><br>${esc(x.contenu_json || x.content || '').slice(0, 200)}</span></div>`
        ).join('');
        return `<div class="cx-card"><h4>🔔 تنبيهاتي <span class="cx-pill info">${esc(n.total ?? 0)}</span></h4>${items || '<p class="cx-muted">لا تنبيهات.</p>'}</div>`;
    }

    async function vProfile() {
        let live = null;
        try { live = (await pms('api_student_profile')).data || null; } catch (e) {}
        if (live) { S.sess.profile = Object.assign({}, S.sess.profile, live); try { localStorage.setItem(LS_KEY, JSON.stringify(S.sess)); } catch (e) {} }
        const p = S.sess.profile || {};
        const row = (k, v) => v ? `<div class="cx-room"><span class="cx-muted" style="min-width:110px">${k}</span><b>${esc(v)}</b></div>` : '';
        return `<div class="cx-card"><h4>🪪 ملفي الجامعي</h4>
            ${row('الاسم', p.NomAr || p.Nom)}${row('Matricule', p.Matricule)}${row('التسجيل', p.Inscription)}
            ${row('البكالوريا', p.Bac)}${row('الميلاد', p.date_naiss)}${row('الهاتف', p.Tel || p.phone)}
            ${row('البريد', p.email)}${row('القسم/الفوج', (p.section || '') + ' / ' + (p.Groupe || ''))}
            <p style="margin-top:12px"><button type="button" class="cx-btn gold" data-action="pms-refresh">🔄 تحديث الملف</button></p>
            <p class="cx-muted">🔒 قانون 18-07: بياناتك لا تغادر جهازك وسيرفر الجامعة.</p></div>`;
    }

    async function onAction(btn) {
        const a = btn.dataset.action;
        if (a === 'pms-tab') { showTab(btn.dataset.tab); return; }
        if (a === 'pms-refresh') { S.cache = {}; showTab('profile'); return; }
        if (a === 'pms-syllabus') {
            const mid = btn.dataset.mid;
            const box = document.getElementById('pms-syl-' + mid);
            if (!box) return;
            if (box.dataset.done) { box.innerHTML = ''; delete box.dataset.done; return; }
            box.innerHTML = '<div class="cx-sk"></div>';
            try {
                const s = await pms('get_syllabus', { module_id: mid });
                const d = s.data || {};
                box.innerHTML = `<p class="cx-muted">ساعات: cours ${esc(d.vhc ?? '—')} / TD ${esc(d.vhtd ?? '—')} / TP ${esc(d.vhtp ?? '—')} — ${esc(d.eNameAr || d.eName || '')}</p>`;
                box.dataset.done = '1';
            } catch (e) { box.innerHTML = `<p>${esc(e.message)}</p>`; }
        }
    }

    function mount(root) {
        S.root = root;
        syncTile();
        if (!isAdmin()) { S.root.innerHTML = lockHTML(); return; }
        if (root.dataset.mountedInitDone) { render(); return; }
        root.dataset.mountedInitDone = '1';
        root.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (btn) onAction(btn);
        });
        S.sess = loadSess();
        render();
        showTab('home');
    }

    window.PortalSections = window.PortalSections || [];
    window.PortalSections.push({ id: 'campus', title: '🎓 جامعتي', icon: 'fa-building-columns', mount });

    // مزامنة البلاطة + حراسة القسم مع كل تنقل
    if (window.navigateToSection && !window.navigateToSection.__cxPatched) {
        const orig = window.navigateToSection;
        window.navigateToSection = function (sec) {
            syncTile();
            if (sec === 'campus' && !isAdmin()) {
                toast('خاص بالمسئول فقط', 'error');
                return orig.call(this, 'home');
            }
            return orig.apply(this, arguments);
        };
        window.navigateToSection.__cxPatched = true;
    }
    if (document.readyState !== 'loading') syncTile();
    else document.addEventListener('DOMContentLoaded', syncTile);
})();
