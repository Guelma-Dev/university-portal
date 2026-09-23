// ==== جامعتي — نفس مكونات بوابة الطالب (مسئول فقط، جلسة دائمة) ====
// القائمة: وصول سريع + خدمات (مطابق للرئيسية). الرزنامة: منتقي أيام + حصص
// (مطابق لرزنامة التطبيق) مع تعديل محلي يعيد استعمال محرر الحصص الأصلي.
(() => {
    'use strict';

    const API = window.location.origin + '/api/pms';
    const SCHED_KEY = 'lx_pms_sched_v1';
    const SID = 997;

    const SEED_PROFILE = {
        Id: 997, Inscription: 'UN24012026252536255705', Bac: '2025',
        Matricule: '252536255705', Nom: 'BRAHIMI Mohamed', NomAr: 'محمد براهيمي',
        spec_id: 215, niveau_id: 37, section: '1', Groupe: '2',
        gender: 'Masculin', date_naiss: '2006-10-29',
        email: 'bbm82186@gmail.com', Tel: '0558163003',
    };

    const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
    const DAY_AR = { sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس' };
    const DAY_ICON = ['fa-sun', 'fa-cloud-sun', 'fa-cloud', 'fa-cloud-rain', 'fa-moon'];
    const FR_DAY = { dimanche: 'sunday', lundi: 'monday', mardi: 'tuesday', mercredi: 'wednesday', jeudi: 'thursday', vendredi: 'friday', samedi: 'saturday' };
    const SLOTS = ['08:00 - 09:30', '09:30 - 11:00', '11:00 - 12:30', '12:30 - 14:00', '14:00 - 15:30', '15:30 - 17:00'];
    const PMS_TYPE = { cours: 'lecture', lecture: 'lecture', td: 'td', tp: 'tp' };
    const CELL_CLASS = { lecture: 'schedule-cell-lecture', td: 'schedule-cell-tdtp', tp: 'schedule-cell-tp' };
    const TYPE_AR = { lecture: 'محاضرة', td: 'أعمال موجهة', tp: 'أعمال تطبيقية' };

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (m, t) => { if (typeof window.showToast === 'function') window.showToast(m, t); };
    const isAdmin = () => { try { return localStorage.getItem('user_role') === 'admin'; } catch (e) { return false; } };
    const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

    // ---------- تفويض جامعتي ----------
    const OWNER_MAT = '202536255705';
    const DEL_KEY = 'lx_admin_delegates';
    const LINK_KEY = 'lx_progres_user';

    function getDelegates() {
        try {
            const a = JSON.parse(localStorage.getItem(DEL_KEY) || '[]');
            if (Array.isArray(a)) return a.map(x => String(x)).filter(x => /^\d{8,20}$/.test(x));
        } catch (e) {}
        return [];
    }
    function saveDelegates(a) { try { localStorage.setItem(DEL_KEY, JSON.stringify(a)); } catch (e) {} }

    window.CampusAccess = {
        owner: OWNER_MAT,
        delegates: getDelegates,
        level() {
            let u = '';
            try { u = String(localStorage.getItem(LINK_KEY) || ''); } catch (e) {}
            if (u === OWNER_MAT) return 'full';
            if (u && getDelegates().indexOf(u) !== -1) return 'campus';
            return null;
        },
        link(u) { try { if (u) localStorage.setItem(LINK_KEY, String(u)); } catch (e) {} },
        unlink() { try { localStorage.removeItem(LINK_KEY); } catch (e) {} },
        elevate(username) {
            this.link(username);
            const lv = this.level();
            if (lv === 'full') {
                try {
                    APP_STATE.role = 'admin';
                    localStorage.setItem('user_role', 'admin');
                    if (typeof showEl === 'function') { showEl('admin-menu-item'); showEl('admin-tile'); }
                    if (typeof setNameEverywhere === 'function') setNameEverywhere('مسؤول');
                } catch (e) {}
                toast('تم تفعيل وضع المسئول', 'success');
            } else if (lv === 'campus') {
                toast('تم تفعيل قسم جامعتي', 'success');
            }
            syncTile();
            renderDelegates();
            try { if (window.CampusAccess.level()) prefetchCampus(); } catch (e) {}
        },
        restoreBoot() {
            if (this.level() !== 'full') return;
            try {
                APP_STATE.role = 'admin';
                localStorage.setItem('user_role', 'admin');
                if (typeof showEl === 'function') { showEl('admin-menu-item'); showEl('admin-tile'); }
                if (typeof setNameEverywhere === 'function') setNameEverywhere('مسؤول');
            } catch (e) {}
            try { prefetchCampus(); } catch (e) {}
            try {
                if (typeof silentOwnerProgres === 'function' && typeof getValidProgresSession === 'function' && !getValidProgresSession()) silentOwnerProgres(false);
            } catch (e) {}
        },
    };

    const campusAllowed = () => isAdmin() || (window.CampusAccess && !!window.CampusAccess.level());

    function renderDelegates() {
        const box = document.getElementById('campus-delegates');
        if (!box) return;
        if (!isAdmin()) { box.innerHTML = ''; return; }
        const list = getDelegates();
        box.innerHTML = `<p class="set-head">حسابات جامعتي المفوضة</p>
            <div class="set-row">
                <input id="cx-del-input" inputmode="numeric" placeholder="رقم التسجيل" style="flex:1;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:10px;color:var(--text-primary);font-family:inherit" />
                <button type="button" class="btn btn-ghost btn-sm" data-delaction="add">إضافة</button>
            </div>
            ${list.map(m => `<div class="set-row">
                <span class="set-lbl"><i class="fas fa-user-check"></i><bdi>${esc(m)}</bdi></span>
                <button type="button" class="btn btn-ghost btn-sm" data-delaction="del" data-m="${esc(m)}"><i class="fas fa-trash"></i></button>
            </div>`).join('')}
            <p class="set-note">المطابق يُفعَّل له قسم «جامعتي» فقط عند دخوله Progres — بلا لوحة تحكم.</p>`;
    }

    if (!window.__cxDelListener) {
        document.addEventListener('click', (e) => {
            const b = e.target.closest('[data-delaction]');
            if (!b) return;
            if (!isAdmin()) return;
            if (b.dataset.delaction === 'add') {
                const inp = document.getElementById('cx-del-input');
                const m = String((inp && inp.value) || '').trim();
                if (!/^\d{8,20}$/.test(m)) { toast('أدخل رقم تسجيل صحيح', 'error'); return; }
                const list = getDelegates();
                if (list.indexOf(m) === -1) { list.push(m); saveDelegates(list); }
                renderDelegates();
                toast('تمت الإضافة', 'success');
            } else if (b.dataset.delaction === 'del') {
                saveDelegates(getDelegates().filter(x => x !== String(b.dataset.m)));
                renderDelegates();
            }
        });
        window.__cxDelListener = true;
    }

    const S = { root: null, view: 'menu', sess: null, cache: {}, loading: false, html: '', dash: null, unread: 0, cxEdit: false, cxDay: -1 };

    // ---------- جلسات PMS لكل مستخدم (المالك مزروع، المفوض يتحقق مرة) ----------
    const PMS_USERS_KEY = 'lx_pms_users';

    function pmsLinkedUser() {
        try { return String(localStorage.getItem(LINK_KEY) || ''); } catch (e) { return ''; }
    }
    function pmsUserSessions() {
        try {
            const o = JSON.parse(localStorage.getItem(PMS_USERS_KEY) || '{}');
            if (o && typeof o === 'object' && !Array.isArray(o)) return o;
        } catch (e) {}
        return {};
    }
    function pmsSaveUserSessions(o) { try { localStorage.setItem(PMS_USERS_KEY, JSON.stringify(o)); } catch (e) {} }

    function loadSess() {
        const u = pmsLinkedUser() || 'guest';
        const all = pmsUserSessions();
        if (all[u] && all[u].student_id) return all[u];
        // المالك (Progres أو admin) → حسابه مزروع دائماً بلا دخول
        if (u === OWNER_MAT || isAdmin()) {
            const s = { student_id: SID, profile: Object.assign({}, SEED_PROFILE) };
            all[u] = s;
            pmsSaveUserSessions(all);
            return s;
        }
        return null;
    }

    function saveSess(s) {
        const u = pmsLinkedUser() || 'guest';
        const all = pmsUserSessions();
        all[u] = s;
        pmsSaveUserSessions(all);
    }

    function loginHTML() {
        return `<div class="pm-card" style="margin-top:14px">
            <h3><i class="fas fa-building-columns" style="color:#1d4ed8"></i> جامعتي</h3>
            <p class="pm-muted">سجل دخولك الجامعي (PMS) مرة واحدة — تبقى جلستك على هذا الجهاز.</p>
            ${S.loginErr ? `<p style="color:#dc2626">${esc(S.loginErr)}</p>` : ''}
            <div class="pm-search"><input id="pms-user" inputmode="numeric" placeholder="رقم التسجيل الجامعي" autocomplete="username" /></div>
            <div class="pm-search"><input id="pms-pass" type="password" placeholder="كلمة المرور" autocomplete="current-password" /></div>
            <button type="button" class="pm-goldbtn" data-action="pms-login"><i class="fas fa-right-to-bracket"></i> دخول</button>
        </div>`;
    }

    function cxDb() {
        try { const d = JSON.parse(localStorage.getItem(SCHED_KEY) || '{}'); if (d && typeof d === 'object') return d; } catch (e) {}
        return {};
    }
    function cxSave(db) { try { localStorage.setItem(SCHED_KEY, JSON.stringify(db)); } catch (e) {} }

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

    function syncTile() {
        try {
            const t = document.getElementById('campus-tile');
            if (t) t.style.display = campusAllowed() ? '' : 'none';
        } catch (e) {}
    }

    function lockHTML() {
        return `<div class="cx-card"><div class="cx-lock">
            <i class="fas fa-shield-halved"></i>
            <h3>منطقة المسئول</h3>
            <p>قسم «جامعتي» خاص بإدارة التطبيق فقط.</p>
        </div></div>`;
    }

    // ---------- القائمة (لوحة قيادة PMS + وصول سريع) ----------
    function dashHeadHTML() {
        const p = (S.sess && S.sess.profile) || {};
        const d = S.dash || {};
        const tutor = d.tutorNameAr || d.tutorName || 'غير معين';
        const lvl = String(d.lvlYearStr || '').replace(/[^0-9]/g, '') || '—';
        return `
        <div class="pm-card" style="margin-top:14px"><h3>مرحباً بعودتك، ${esc(p.Nom || '')}</h3></div>
        <div class="pm-blue">
            <div style="display:flex;align-items:center;gap:12px">
                <span style="font-size:2rem;opacity:.9"><i class="fas fa-graduation-cap"></i></span>
                <span><span class="pm-muted" style="color:#cdd6ff">تخصصك</span><h2 style="margin:2px 0 0">${esc(d.specialtyNameAr || d.specialtyNameFr || 'جامعة قالمة')}</h2></span>
            </div>
        </div>
        <div class="pm-stat4">
            <div class="pm-stat"><i class="fas fa-users" style="color:#16a34a"></i><b>دفعة ${esc(d.section || p.section || '—')} / فوج ${esc(d.group || p.Groupe || '—')}</b><span>الدفعة / الفوج</span></div>
            <div class="pm-stat"><i class="fas fa-user-xmark" style="color:#dc2626"></i><b>${esc(d.totalAbsences ?? 0)}</b><span>إجمالي الغيابات</span></div>
            <div class="pm-stat"><i class="fas fa-layer-group" style="color:#2563eb"></i><b>${esc(lvl)}</b><span>المستوى</span></div>
            <div class="pm-stat"><i class="fas fa-user-tie" style="color:#d97706"></i><b>${esc(tutor)}</b><span>أستاذي الوصي</span></div>
        </div>`;
    }

    function todayMiniHTML() {
        let items = null;
        try { items = (typeof window.__campusTodaySync === 'function') ? window.__campusTodaySync() : null; } catch (e) {}
        if (!items) return '';
        const rows = items.slice(0, 4).map(x =>
            `<div class="pm-tlrow"><span class="pm-t">${esc(x.start)}</span> <strong>${esc(x.subject)}</strong><br>
            <span class="pm-muted">${esc(x.meta || '')}</span></div>`).join('');
        return `<div class="pm-card"><h4><i class="fas fa-chart-line" style="color:#16a34a"></i> جدول اليوم</h4>
            <div class="pm-tl">${rows || '<p class="pm-muted">لا حصص اليوم.</p>'}</div></div>`;
    }
    function featBtn(tab, icon, tone, name, sub) {
        return `<button class="dh-qa-feat pressable" data-action="pms-open" data-tab="${tab}">
            <span class="dh-sv-ico ${tone}"><i class="fas ${icon}"></i></span>
            <span class="dh-qa-m"><span class="dh-qa-fname">${name}</span><small>${sub}</small></span>
            <i class="fas fa-chevron-left dh-qa-go"></i></button>`;
    }
    function cellBtn(tab, icon, tone, name) {
        return `<button class="dh-qa-cell pressable" data-action="pms-open" data-tab="${tab}">
            <span class="dh-sv-ico ${tone}"><i class="fas ${icon}"></i></span>
            <span class="dh-qa-m"><span>${name}</span></span></button>`;
    }
    function wideBtn(tab, icon, tone, name, sub) {
        return `<button class="dh-qa-wide pressable" data-action="pms-open" data-tab="${tab}">
            <span class="dh-sv-ico ${tone}"><i class="fas ${icon}"></i></span>
            <span class="dh-qa-m"><span class="dh-qa-fname">${name}</span><small>${sub}</small></span>
            <i class="fas fa-chevron-left dh-qa-go"></i></button>`;
    }
    function svRow(tab, icon, tone, name, badge) {
        return `<button class="dh-sv-row pressable" data-action="pms-open" data-tab="${tab}">
            <span class="dh-sv-ico ${tone}"><i class="fas ${icon}"></i></span>
            <span class="dh-sv-name">${name}${badge ? ` <span class="cx-pill bad">${badge}</span>` : ''}</span>
            <i class="fas fa-chevron-left dh-go"></i></button>`;
    }

    function menuHTML() {
        return dashHeadHTML() + todayMiniHTML() + `
        <h2 class="dh-minihead" style="margin-inline:14px">وصول سريع</h2>
        <div class="dh-qa" style="padding:0 14px">
            ${featBtn('schedule', 'fa-calendar-week', 'sx-blue', 'رزنامتي', 'الشبكة الأسبوعية')}
            <div class="dh-qa-grid">
                ${cellBtn('modules', 'fa-book', 'sx-gold', 'موديولاتي')}
                ${cellBtn('exams', 'fa-file-pen', 'sx-blue', 'امتحاناتي')}
            </div>
            ${wideBtn('news', 'fa-newspaper', 'sx-green', 'الأخبار', 'أخبار الجامعة والإدارة')}
        </div>
        <section class="dh-sv-sec" style="padding:0 14px">
            <h2 class="dh-minihead">الخدمات</h2>
            <p class="dh-sv-head">النتائج الدراسية</p>
            <div class="dh-sv">${svRow('absences', 'fa-user-xmark', 'sx-amber', 'غياباتي')}</div>
            <p class="dh-sv-head">الحياة الجامعية</p>
            <div class="dh-sv">${svRow('rooms', 'fa-door-open', 'sx-green', 'القاعات')}</div>
            <p class="dh-sv-head">الملف الجامعي</p>
            <div class="dh-sv">
                ${svRow('tutor', 'fa-user-tie', 'sx-blue', 'المشرف')}
                ${svRow('stage', 'fa-briefcase', 'sx-gold', 'التربص')}
                ${svRow('defense', 'fa-graduation-cap', 'sx-amber', 'المناقشة')}
                ${svRow('notifs', 'fa-bell', 'sx-amber', 'تنبيهاتي', S.unread > 0 ? S.unread : '')}
                ${svRow('profile', 'fa-id-card', 'sx-neutral', 'ملفي')}
            </div>
        </section>`;
    }

    function render() {
        if (!S.root) return;
        if (!campusAllowed()) { S.root.innerHTML = lockHTML(); return; }
        if (!S.sess) { S.root.innerHTML = loginHTML(); return; }
        if (S.view === 'menu') { S.root.innerHTML = menuHTML(); return; }
        const back = `<button type="button" class="cx-back pressable" data-action="pms-menu"><i class="fas fa-chevron-right"></i> الأقسام</button>`;
        const body = S.loading
            ? `<div class="cx-card"><div class="cx-sk"></div><div class="cx-sk"></div></div>`
            : (S.html || '');
        S.root.innerHTML = back + `<div id="pms-body">${body}</div>`;
    }

    async function openSection(tab) {
        S.view = tab; S.loading = true; S.html = ''; render();
        try {
            S.html =
                tab === 'schedule' ? await vSchedule() :
                tab === 'exams' ? await vExams() :
                tab === 'absences' ? await vAbsences() :
                tab === 'modules' ? await vModules() :
                tab === 'moddetail' ? await vModDetail() :
                tab === 'rooms' ? await vRooms() :
                tab === 'tutor' ? await vTutor() :
                tab === 'stage' ? await vStage() :
                tab === 'defense' ? await vDefense() :
                tab === 'news' ? await vNews() :
                tab === 'notifs' ? await vNotifs() :
                await vProfile();
        } catch (e) {
            S.html = `<div class="cx-card"><p>تعذر الجلب: ${esc(e.message)}</p><button type="button" class="cx-btn gold" data-action="pms-open" data-tab="${tab}">إعادة المحاولة</button></div>`;
        }
        S.loading = false; render();
    }

    // ---------- الرزنامة (منتقي أيام + حصص) ----------
    function normTime(t) { return String(t || '').replace(/\s+/g, ''); }

    function pmsBaseGrid() {
        const d = S.cache['sched_raw'];
        const grid = {};
        const extra = [];
        if (!d) return { grid, extra };
        const rows = Array.isArray(d.schedule) ? d.schedule
            : [].concat(Array.isArray(d.semA) ? d.semA : [], Array.isArray(d.semB) ? d.semB : []);
        const slotNorm = SLOTS.map(normTime);
        rows.forEach(r => {
            const day = FR_DAY[String(r.jours || '').trim().toLowerCase()];
            const si = slotNorm.indexOf(normTime(r.heure));
            const cell = {
                subject: r.mNameAr || r.mName || '',
                type: PMS_TYPE[String(r.type || '').toLowerCase()] || 'lecture',
                room: r.nom_salle || (r.salle_id != null ? String(r.salle_id) : ''),
                teacher: r.eNameAr || r.vNameAr || r.teacherAr || r.teacher || r.eName || r.vName || '',
            };
            if (day && DAYS.includes(day) && si >= 0) grid[day + '_' + si] = cell;
            else extra.push(Object.assign({ _day: r.jours, _heure: r.heure }, cell));
        });
        return { grid, extra };
    }

    function finalCell(base, key) {
        const ov = cxDb()[key];
        if (ov && ov.deleted) return null;
        if (ov && ov.subject) return ov;
        return base[key] || null;
    }

        // حصص اليوم للرئيسية (تستهلكها dhTodayItems عند التفعيل)
    window.__campusTodaySync = function () {
        try {
            if (!S.cache['sched_raw']) return null;
            const jsDay = new Date().getDay();
            if (jsDay < 0 || jsDay > 4) return [];
            const day = DAYS[jsDay];
            const { grid } = pmsBaseGrid();
            const items = [];
            SLOTS.forEach((rng, i) => {
                const parts = String(rng).split('-');
                const c = finalCell(grid, day + '_' + i);
                if (c && c.subject) items.push({
                    start: (parts[0] || '').trim(), end: (parts[1] || '').trim(),
                    subject: c.subject, typeAr: TYPE_AR[c.type] || '',
                    meta: [c.room, c.teacher].filter(Boolean).join(' • '),
                });
            });
            return items;
        } catch (e) { return null; }
    };

    function prefetchCampus() {
        try { if (!S.sess) S.sess = loadSess(); } catch (e) { return; }
        if (!S.sess || S.cache['sched_raw']) return;
        pms('get_group_schedule').catch(() => {});
        pms('get_dashboard_data').then(d => { S.dash = d; }).catch(() => {});
    }

    // مزامنة أحادية: جامعتي ← طبقة الرزنامة الرئيسية (تملأ الفارغ فقط)
    function syncCampusToPts(manual) {
        try {
            if (typeof getValidProgresSession !== 'function' || !getValidProgresSession()) {
                if (manual) toast('سجل دخول Progres أولاً للمزامنة', 'error');
                return 0;
            }
            if (!S.cache['sched_raw']) return 0;
            if (typeof ptsDb !== 'function' || typeof ptsOwner !== 'function' || typeof ptsPersist !== 'function') return 0;
            const { grid } = pmsBaseGrid();
            const db = ptsDb();
            const o = ptsOwner();
            if (!db.owners[o] || typeof db.owners[o] !== 'object' || Array.isArray(db.owners[o])) db.owners[o] = {};
            let n = 0;
            Object.keys(grid).forEach(key => {
                if (db.owners[o][key]) return;
                try { if (typeof schedule !== 'undefined' && schedule[key] && schedule[key].text) return; } catch (e) {}
                const c = grid[key];
                if (!c || !c.subject) return;
                const li = key.lastIndexOf('_');
                db.owners[o][key] = {
                    day: key.slice(0, li), idx: parseInt(key.slice(li + 1), 10),
                    subject: c.subject, type: c.type, room: c.room || '', teacher: c.teacher || '', notes: '',
                };
                n++;
            });
            if (n) {
                ptsPersist(db);
                try { if (typeof renderSchedule === 'function') renderSchedule(); } catch (e) {}
                if (manual) toast(`تمت مزامنة ${n} حصة`, 'success');
            } else if (manual) toast('رزنامتك محدثة — لا جديد للمزامنة', 'info');
            return n;
        } catch (e) { return 0; }
    }

    function dayHasClasses(grid, day) {        const db = cxDb();
        return SLOTS.some((_, i) => {
            const key = day + '_' + i;
            const ov = db[key];
            if (ov && ov.deleted) return false;
            if (ov && ov.subject) return true;
            return !!grid[key];
        });
    }

    function defaultDay() {
        const js = new Date().getDay();
        return (js >= 0 && js <= 4) ? js : 0;
    }

    function slotInner(c) {
        if (!c) return '';
        const meta = [];
        if (c.room) meta.push('<i class="fas fa-door-open"></i> ' + esc(c.room));
        if (c.teacher) meta.push('<i class="fas fa-user"></i> ' + esc(c.teacher));
        return '<strong>' + esc(c.subject) + '</strong>'
            + ' <span>' + esc(TYPE_AR[c.type] || '') + '</span>'
            + (meta.length ? '<br>' + meta.join(' · ') : '');
    }

    async function vSchedule() {
        if (!S.cache['sched_raw']) S.cache['sched_raw'] = await pms('get_group_schedule');
        try { syncCampusToPts(false); } catch (e) {}
        if (S.cxDay < 0) S.cxDay = defaultDay();
        const { grid, extra } = pmsBaseGrid();
        const day = DAYS[S.cxDay];
        const picker = `<div class="schedule-day-picker"><div class="day-picker-title">
                <span><i class="fas fa-calendar-day"></i> اختر اليوم</span>
                <button type="button" class="sched-edit-btn ${S.cxEdit ? 'active' : ''}" data-action="pms-editmode">
                    <i class="fas ${S.cxEdit ? 'fa-check' : 'fa-pen'}"></i> ${S.cxEdit ? 'تم' : 'تعديل الجدول'}</button>
                <button type="button" class="sched-edit-btn" data-action="pms-syncpts" title="نسخ حصص جامعتي لرزنامتي الرئيسية">
                    <i class="fas fa-arrows-rotate"></i> مزامنة</button>
            </div><div class="day-picker-grid">` +
            DAYS.map((dd, i) =>
                `<button class="day-btn ${i === S.cxDay ? 'active' : ''} ${dayHasClasses(grid, dd) ? 'has-classes' : ''}" data-action="pms-day" data-day="${i}"><i class="fas ${DAY_ICON[i]}"></i> ${DAY_AR[dd]}</button>`
            ).join('') + `</div></div>`;
        let slots = `<div class="mobile-day-title"><i class="fas fa-calendar-check"></i> جدول ${DAY_AR[day]}</div>`;
        const uniEmpty = !Object.keys(grid).length;
        if (uniEmpty && !S.cxEdit) {
            slots += `<div class="schedule-not-available"><i class="fas fa-pen-to-square"></i><p>رزنامة الجامعة غير منشورة</p><small>فعّل «تعديل الجدول» والمس أي خانة للإضافة</small></div>`;
        }
        slots += SLOTS.map((time, i) => {
            const key = day + '_' + i;
            const c = finalCell(grid, key);
            const cls = c ? (CELL_CLASS[c.type] || '') : '';
            let inner, clickable = '';
            if (S.cxEdit) {
                inner = (c ? slotInner(c) : '<span class="empty">فارغ</span>') + ' <i class="fas fa-pen pts-pen"></i>';
                clickable = ` slot-tap" data-action="pms-slot" data-key="${key}`;
            } else if (!c) {
                inner = '<span class="empty">فارغ</span>';
            } else {
                inner = slotInner(c);
            }
            return `<div class="mobile-slot"><div class="mobile-slot-time"><i class="fas fa-clock"></i> ${esc(time)}</div><div class="mobile-slot-content ${cls}${clickable}">${inner}</div></div>`;
        }).join('');
        const extraHtml = extra.length
            ? `<div class="cx-card"><h4><i class="fas fa-clock" style="color:var(--accent)"></i> خارج الدوام</h4>` + extra.map(c =>
                `<p><strong>${esc(c.subject)}</strong> — ${esc(c._day || '')} ${esc(c._heure || '')}${c.room ? ' — قاعة ' + esc(c.room) : ''}</p>`).join('') + `</div>`
            : '';
        return picker + `<div class="schedule-mobile-view">${slots}</div>` + extraHtml;
    }

    function openCampusSlot(key) {
        const parts = String(key).split('_');
        const idx = parseInt(parts.pop(), 10);
        const day = parts.join('_');
        if (!DAYS.includes(day) || isNaN(idx) || !SLOTS[idx]) return;
        const { grid } = pmsBaseGrid();
        const c = finalCell(grid, key) || {};
        const hasOv = !!(cxDb()[key] && cxDb()[key].subject);
        if (typeof window.openSlotEditor !== 'function') { toast('محرر الحصص غير متاح', 'error'); return; }
        window.__cxSlot = { day, idx, key };
        window.openSlotEditor(day, idx);
        try {
            document.getElementById('pt-subject').value = c.subject || '';
            document.getElementById('pt-room').value = c.room || '';
            document.getElementById('pt-teacher').value = c.teacher || '';
            document.getElementById('pt-notes').value = c.notes || '';
            const t = (c.type && TYPE_AR[c.type]) ? c.type : 'lecture';
            document.getElementById('pt-type').value = t;
            if (typeof window.paintPtsType === 'function') window.paintPtsType(t);
            document.getElementById('pt-del').style.display = (hasOv || (!hasOv && !!grid[key])) ? '' : 'none';
        } catch (e) {}
    }

    function wrapSlotPersistence() {
        if (window.__cxWrapped || typeof window.saveSlotOverride !== 'function') return;
        const origSave = window.saveSlotOverride.bind(window);
        const origDel = (typeof window.deleteSlotOverride === 'function') ? window.deleteSlotOverride.bind(window) : null;
        window.saveSlotOverride = function (e) {
            if (e && e.preventDefault) e.preventDefault();
            const cx = window.__cxSlot;
            if (!cx) return origSave(e);
            const subject = (document.getElementById('pt-subject').value || '').trim();
            if (!subject) { toast('أدخل اسم المادة', 'error'); return; }
            let type = document.getElementById('pt-type').value;
            if (!TYPE_AR[type]) type = 'lecture';
            const db = cxDb();
            db[cx.key] = {
                day: cx.day, idx: cx.idx, subject, type,
                room: (document.getElementById('pt-room').value || '').trim(),
                teacher: (document.getElementById('pt-teacher').value || '').trim(),
                notes: (document.getElementById('pt-notes').value || '').trim(),
            };
            cxSave(db);
            window.__cxSlot = null;
            if (typeof window.closeSessionEditor === 'function') window.closeSessionEditor();
            toast('تم حفظ الحصة', 'success');
            openSection('schedule');
        };
        if (origDel) {
            window.deleteSlotOverride = function () {
                const cx = window.__cxSlot;
                if (!cx) return origDel();
                const { grid } = pmsBaseGrid();
                const db = cxDb();
                if (grid[cx.key]) db[cx.key] = { deleted: true };
                else delete db[cx.key];
                cxSave(db);
                window.__cxSlot = null;
                if (typeof window.closeSessionEditor === 'function') window.closeSessionEditor();
                toast('تم حذف الحصة', 'success');
                openSection('schedule');
            };
        }
        if (typeof window.closeSessionEditor === 'function' && !window.__cxCloseWrapped) {
            const origClose = window.closeSessionEditor.bind(window);
            window.closeSessionEditor = function () {
                window.__cxSlot = null;
                return origClose();
            };
            window.__cxCloseWrapped = true;
        }
        window.__cxWrapped = true;
    }

    // ---------- المقاييس (تبويبات + بطاقات PMS) ----------
    function modHours(m) {
        const c = num(m.vhc), t = num(m.vhtd), p = num(m.vhtp);
        return { c, t, p, tot: c + t + p };
    }
    function modHoursLine(m) {
        const h = modHours(m);
        return `محاضرة: ${h.c}h • أ.م: ${h.t}h • أ.ت: ${h.p}h`;
    }

    async function vModules() {
        const d = await pms('get_student_modules');
        const mods = d.modules || d.data || [];
        if (!mods.length) return `<div class="pm-card"><p class="pm-muted">لا مقاييس.</p></div>`;
        const sems = [...new Set(mods.map(m => parseInt(m.semestre ?? m.semester ?? 0, 10) || 0))].sort((a, b) => a - b);
        if (!S.modTab || !sems.includes(S.modTab)) S.modTab = sems[0];
        const tabs = `<div class="pm-tabs">` + sems.map(s =>
            `<button type="button" class="pm-tab ${s === S.modTab ? 'on' : ''}" data-action="pms-modtab" data-sem="${s}">السداسي ${s}</button>`
        ).join('') + `</div>`;
        const arr = mods.filter(m => (parseInt(m.semestre ?? m.semester ?? 0, 10) || 0) === S.modTab);
        const cards = arr.map(m => {
            const mid = m.id ?? m.module_id;
            const h = modHours(m);
            return `<div class="pm-card">
                <div style="display:flex;align-items:center;gap:10px">
                    <h3 style="flex:1;margin:0">${esc(m.nameAr || m.name || '')}</h3>
                    <span style="width:14px;height:14px;border-radius:50%;background:#e2e8f0;flex:0 0 auto"></span>
                </div>
                <div class="pm-mstat">
                    <span><i class="fas fa-star pm-c-blue"></i><b>${esc(m.credit ?? m.TotalCredit ?? '—')}</b><span>الرصيد</span></span>
                    <span><i class="fas fa-scale-balanced pm-c-orange"></i><b>${esc(m.coef ?? m.TotalCoefficient ?? '—')}</b><span>المعامل</span></span>
                    <span><i class="fas fa-stopwatch pm-c-purple"></i><b>${h.tot}</b><span>الحجم الساعي</span></span>
                </div>
                <hr class="pm-hr" />
                <p class="pm-muted" style="text-align:center">${modHoursLine(m)}</p>
                <button type="button" class="pm-more" data-action="pms-modopen" data-mid="${esc(mid)}">عرض المنهاج</button>
            </div>`;
        }).join('');
        return tabs + cards;
    }

    async function vModDetail() {
        const d = await pms('get_student_modules');
        const mods = d.modules || d.data || [];
        const m = mods.find(x => String(x.id ?? x.module_id) === String(S.modMid));
        if (!m) return `<div class="pm-card"><p class="pm-muted">المقياس غير موجود.</p></div>`;
        let syl = {};
        try { syl = (await pms('get_syllabus', { module_id: S.modMid })).data || {}; } catch (e) {}
        const h = modHours(m);
        const teacher = syl.eNameAr || syl.eName || '';
        const goals = syl.contenu_json || syl.plan_json || '';
        return `
        <div style="margin:12px 14px"><button type="button" class="pm-goldbtn" data-action="pms-open" data-tab="modules"><i class="fas fa-arrow-right"></i> العودة للمواد</button></div>
        <div class="pm-blue">
            <span class="pm-ar">AR</span>
            <h2 style="margin:10px 0 4px;font-size:1.5rem">${esc(m.nameAr || m.name || '')}</h2>
            ${teacher ? `<p><i class="fas fa-user"></i> ${esc(teacher)}</p>` : ''}
            <div class="pm-prog">
                <div style="display:flex;justify-content:space-between;font-size:.85rem"><span>التدرج الأسبوعي</span><span>0%</span></div>
                <div class="pm-bar"><i style="width:0%"></i></div>
            </div>
        </div>
        <div class="pm-stat4" style="grid-template-columns:repeat(3,1fr)">
            <div class="pm-stat"><span>الأرصدة</span><b class="pm-c-blue">${esc(m.credit ?? m.TotalCredit ?? '—')}</b></div>
            <div class="pm-stat"><span>المعامل</span><b class="pm-c-orange">${esc(m.coef ?? m.TotalCoefficient ?? '—')}</b></div>
            <div class="pm-stat"><span>الحجم الساعي</span><b class="pm-c-teal">${h.tot}h</b></div>
        </div>
        <div class="pm-card" style="border-inline-end:5px solid #2b3a9e">
            <h4><i class="fas fa-bullseye" style="color:#2563eb"></i> الأهداف</h4>
            <p class="pm-muted">${goals ? esc(String(goals).slice(0, 600)) : '---'}</p>
            <p class="pm-muted">محاضرة: ${h.c}h • أعمال موجهة: ${h.t}h • أعمال تطبيقية: ${h.p}h</p>
        </div>`;
    }

    // ---------- باقي الشاشات ----------
    async function vExams() {
        const d = await pms('get_student_exams');
        const sec = (t, icon, arr, cls) => {
            arr = arr || [];
            if (!arr.length) return '';
            return `<div class="cx-card"><h4><i class="fas ${icon}" style="color:var(--accent)"></i> ${t} <span class="cx-pill ${cls}">${arr.length}</span></h4>` + arr.map(x =>
                `<div class="cx-room"><span><i class="fas fa-file-pen"></i></span><span><strong>${esc(x.module_name || x.mod_name || x.name || '')}</strong><br>
                <span class="cx-muted">${esc(x.exam_date || x.date || x.scheduled_date || '')} ${esc(x.heure || x.time || '')} — قاعة ${esc(x.salle || x.nom_salle || '')}</span></span></div>`
            ).join('') + `</div>`;
        };
        const h = sec('الدورة العادية', 'fa-file-lines', d.regular, 'ok') + sec('الاستدراك', 'fa-rotate-right', d.replacements, 'warn') + sec('الديون', 'fa-box-archive', d.debts, 'bad');
        return h || `<div class="cx-card"><p class="cx-muted">لا امتحانات مبرمجة حالياً.</p></div>`;
    }

    async function vAbsences() {
        const d = await pms('get_student_absences');
        const tot = Number(d.total_all || 0), unjust = Number(d.total_unjustified || 0);
        const mods = (d.modules || []).map(m => {
            const a = Number(m.total_abs ?? m.abs ?? 0);
            return `<div class="cx-room"><span><i class="fas fa-book"></i></span><span style="flex:1"><strong>${esc(m.module_name || m.name || '')}</strong>
                <div class="cx-meter"><i style="width:${Math.min(100, a * 20)}%"></i></div></span><strong>${a}</strong></div>`;
        }).join('');
        return `<div class="cx-card"><h4><i class="fas fa-user-xmark" style="color:var(--accent)"></i> الغيابات</h4>
            <p class="cx-muted">المجموع <strong>${tot}</strong> — مبررة <strong>${esc(d.total_justified ?? 0)}</strong> — غير مبررة <strong>${unjust}</strong> (عتبة الإقصاء: 5)</p>
            <div class="cx-meter"><i style="width:${Math.min(100, unjust * 20)}%"></i></div></div>
        <div class="cx-card"><h4>حسب المقياس</h4>${mods || '<p class="cx-muted">سجل نظيف.</p>'}</div>`;
    }

    // ---------- شغور القاعات (جدول PMS) ----------
    const FR_DAYS_L = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi'];
    const FR_DAY_AR = { dimanche: 'الأحد', lundi: 'الاثنين', mardi: 'الثلاثاء', mercredi: 'الأربعاء', jeudi: 'الخميس' };
    function occBusySet(d) {
        const set = new Set();
        (d.matrix || []).forEach(x => set.add(x.salle_id + '|' + x.horaire_id));
        return set;
    }

    async function vRooms() {
        if (!S.roomDay) {
            const js = new Date().getDay();
            S.roomDay = FR_DAYS_L[(js >= 0 && js <= 4) ? js : 0];
        }
        const d = await pms('get_occupancy_data', { day: S.roomDay });
        const slots = (d.horaires || []).slice().sort((a, b) => (a.id || 0) - (b.id || 0));
        const busy = occBusySet(d);
        const q = (S.roomQ || '').trim().toLowerCase();
        let rooms = d.rooms || [];
        if (q) rooms = rooms.filter(r => String(r.nom_salle || '').toLowerCase().includes(q));
        const per = 10;
        const pages = Math.max(1, Math.ceil(rooms.length / per));
        if (!S.roomPage || S.roomPage > pages) S.roomPage = 1;
        const page = rooms.slice((S.roomPage - 1) * per, S.roomPage * per);
        const occName = (rid, hid) => {
            const x = (d.matrix || []).find(y => String(y.salle_id) === String(rid) && String(y.horaire_id) === String(hid));
            return x ? ((x.mod_name_ar || x.mod_name || '') + ' — ' + (x.teach_name_ar || x.teach_name || '')) : '';
        };
        const rows = page.map(r => `<tr><td>${esc(r.nom_salle)}${r.coordonnes ? ` <a href="https://www.openstreetmap.org/?mlat=${esc(String(r.coordonnes).split(',')[0].trim())}&mlon=${esc(String(r.coordonnes).split(',')[1].trim())}#map=18/${esc(String(r.coordonnes).split(',')[0].trim())}/${esc(String(r.coordonnes).split(',')[1].trim())}" target="_blank" rel="noopener" style="color:#1d4ed8"><i class="fas fa-map-location-dot"></i></a>` : ''}</td>` +
            slots.map(h => {
                const isBusy = busy.has(r.id + '|' + h.id);
                const title = isBusy ? occName(r.id, h.id) : 'حرة';
                return `<td><span class="${isBusy ? 'pm-cellbusy' : 'pm-cellok'}" title="${esc(title)}"><i class="fas ${isBusy ? 'fa-user-group' : 'fa-check'}"></i></span></td>`;
            }).join('') + `</tr>`).join('');
        return `
        <div class="pm-roomhead">
            <h3>شغور القاعات</h3>
            <select class="pm-day" id="pms-roomday" aria-label="اليوم">
                ${FR_DAYS_L.map(fd => `<option value="${fd}" ${fd === S.roomDay ? 'selected' : ''}>${FR_DAY_AR[fd]}</option>`).join('')}
            </select>
        </div>
        <div class="pm-search"><input id="pms-roomq" placeholder="ابحث عن اسم القاعة..." value="${esc(S.roomQ || '')}" /><i class="fas fa-magnifying-glass"></i></div>
        <div class="pm-twrap"><table class="pm-rooms">
            <thead><tr><th>القاعة</th>${slots.map(h => `<th>${esc(h.heure || '')}</th>`).join('')}</tr></thead>
            <tbody>${rows || '<tr><td>لا نتائج.</td></tr>'}</tbody>
        </table></div>
        <div class="pm-pager">
            <button type="button" data-action="pms-roompage" data-d="-1" ${S.roomPage <= 1 ? 'disabled' : ''} aria-label="السابق"><i class="fas fa-chevron-right"></i></button>
            <span>Page ${S.roomPage} / ${pages}</span>
            <button type="button" data-action="pms-roompage" data-d="1" ${S.roomPage >= pages ? 'disabled' : ''} aria-label="التالي"><i class="fas fa-chevron-left"></i></button>
        </div>`;
    }

    async function vTutor() {
        const t = await pms('get_tutoring');
        const tu = t.tutor || {};
        const hist = (t.history || []).map(h => `<p>• ${esc(h.title || h.subject || '')}</p>`).join('');
        return `<div class="cx-card"><h4><i class="fas fa-user-tie" style="color:var(--accent)"></i> مشرفي</h4>` + (t.tutor
            ? `<p style="font-size:1.15rem;font-weight:800">${esc(tu.tutorNameAr || tu.tutorName || '')}</p><p class="cx-muted">${esc(tu.tutorName || '')}</p>`
            : `<p class="cx-muted">لا مشرف مسند حالياً.</p>`) + `</div>
        <div class="cx-card"><h4>السجل</h4>${hist || '<p class="cx-muted">لا عناصر.</p>'}</div>`;
    }

    async function vStage() {
        const s = await pms('get_student_stage');
        const pill = s.is_open ? `<span class="cx-pill ok">الترشح مفتوح</span>` : `<span class="cx-pill warn">الترشح مغلق حالياً</span>`;
        let items = '';
        const data = s.data;
        const arr = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
        if (arr.length && !(arr.length === 1 && !Object.keys(arr[0]).length)) {
            items = arr.map(x => `<div class="cx-room"><span><i class="fas fa-briefcase"></i></span><span><strong>${esc(x.company_name || x.theme || x.subject || '')}</strong><br>
                <span class="cx-muted">${esc(x.status || '')} ${esc(x.start_date || '')}</span></span></div>`).join('');
        }
        return `<div class="cx-card"><h4><i class="fas fa-briefcase" style="color:var(--accent)"></i> التربص</h4><p>${pill}</p>${items}</div>`;
    }

    async function vDefense() {
        const d = await pms('get_student_defense');
        if (!d.has_defense) return `<div class="cx-card"><h4><i class="fas fa-graduation-cap" style="color:var(--accent)"></i> المناقشة</h4><p class="cx-muted">لا مناقشة مبرمجة — ستظهر هنا اللجنة والقاعة فور برمجتها.</p></div>`;
        const roles = [['president', 'الرئيس'], ['supervisor', 'المشرف'], ['co_supervisor', 'المشرف المساعد'], ['examiners', 'الممتحنون'], ['ext_examiners', 'أعضاء خارجيون']];
        const fmt = (v) => Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : (x.name || '')).filter(Boolean).join('، ') : (typeof v === 'string' ? v : (v && v.name) || '');
        const jury = roles.map(([k, label]) => d[k] && fmt(d[k]) ? `<div class="cx-room"><span><i class="fas fa-scale-balanced"></i></span><span><strong>${label}:</strong> ${esc(fmt(d[k]))}</span></div>` : '').join('');
        return `<div class="cx-card"><h4><i class="fas fa-graduation-cap" style="color:var(--accent)"></i> المناقشة</h4>
            <p>${esc(d.scheduled_date || d.meeting_date || '')} — ${esc(d.lieu || d.salle || '')}</p>
            <h4>اللجنة</h4>${jury || '<p class="cx-muted">—</p>'}</div>`;
    }

    // ---------- أخبار الجامعة (شريط + بحث + بطاقات PMS) ----------
    function newsPill(t) {
        const s = String(t.sender || t.type || t.category || t.src || '');
        if (/رئاس/.test(s)) return `<span class="pm-tag pink">رئاسة الجامعة</span>`;
        if (/قسم|مصلحة|كلية|معهد/.test(s)) return `<span class="pm-tag teal">القسم</span>`;
        return s ? `<span class="pm-tag gray">${esc(s)}</span>` : '';
    }
    function newsText(t) { return String(t.subject || t.content || t.description || t.body || ''); }
    function newsTitle(t) { return String(t.title || t.sujet || newsText(t).slice(0, 80) || 'خبر'); }

    function renderNewsCard(box, full) {
        const t = (S.newsItems || [])[Number(box.dataset.idx)] || {};
        const img = t.image ? `<br><img src="https://ent.univ-guelma.dz/board/uploads/${esc(t.image)}" loading="lazy" />` : '';
        const txt = newsText(t);
        box.innerHTML = `
            <div class="pm-top"><span class="pm-date">${esc(t.sDate || t.date || t.created_at || '')}</span>${newsPill(t)}</div>
            <h3>${esc(newsTitle(t))}</h3>
            <p class="pm-x">${esc(full ? txt : txt.slice(0, 140))}</p>
            ${full ? img : ''}
            <button type="button" class="pm-more" data-action="pms-newsopen" data-nid="${esc(box.id.replace('pms-news-', ''))}">${full ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}</button>`;
    }

    async function vNews() {
        const fac = await fetch(window.location.origin + '/api/pms/faculty').then(r => r.json()).catch(() => ({}));
        const facItems = (fac.items || []).slice(0, 5).map(t =>
            `<div class="cx-room"><span><i class="fas fa-landmark" style="color:var(--accent);font-size:.7rem"></i></span>
            <span><a href="${esc(t.link)}" target="_blank" rel="noopener" style="color:inherit"><strong>${esc(t.title)}</strong></a><br>
            <span class="cx-muted">${esc((t.date || '').slice(0, 16))}</span></span></div>`
        ).join('');
        const facCard = `<div class="cx-card"><h4><i class="fas fa-landmark" style="color:var(--accent)"></i> إعلانات الكلية <span class="cx-pill info">مباشر</span></h4>
            ${facItems || '<p class="cx-muted">تعذر الجلب حالياً.</p>'}</div>`;
        const [n, a] = await Promise.all([
            pms('get_news').catch(() => ({})),
            pms('get_announcements').catch(() => ({})),
        ]);
        const tick = (n.ticker || []).slice(0, 5).map(t => esc(String(t.subject || '').slice(0, 120))).join(' • ');
        S.newsItems = (n.notices || []).concat(a.notices || [], a.dept_notices || []);
        const q = (S.newsQ || '').trim();
        let items = S.newsItems;
        if (q) items = items.filter(t => (newsTitle(t) + ' ' + newsText(t)).includes(q));
        const per = 5;
        const pages = Math.max(1, Math.ceil(items.length / per));
        if (!S.newsPage || S.newsPage > pages) S.newsPage = 1;
        const slice = items.slice((S.newsPage - 1) * per, S.newsPage * per);
        const cards = slice.map(t => {
            const gi = S.newsItems.indexOf(t);
            return `<div class="pm-card pm-news" id="pms-news-n${gi}" data-idx="${gi}"></div>`;
        }).join('');
        setTimeout(() => {
            (slice).forEach(t => {
                const gi = S.newsItems.indexOf(t);
                const box = document.getElementById('pms-news-n' + gi);
                if (box && !box.dataset.done) renderNewsCard(box, false);
            });
        }, 30);
        return `
        ${facCard}
        ${tick ? `<div class="pm-ticker"><span class="pm-bolt"><i class="fas fa-bolt"></i></span><div class="pm-track"><span>${tick}</span></div></div>` : ''}
        <div class="pm-search"><input id="pms-newsq" placeholder="البحث في الأخبار..." value="${esc(S.newsQ || '')}" /><i class="fas fa-magnifying-glass"></i></div>
        ${cards || '<div class="pm-card"><p class="pm-muted">لا أخبار.</p></div>'}
        <div class="pm-pager">
            <button type="button" data-action="pms-newspage" data-d="-1" ${S.newsPage <= 1 ? 'disabled' : ''} aria-label="السابق"><i class="fas fa-chevron-right"></i></button>
            <span>Page ${S.newsPage} / ${pages}</span>
            <button type="button" data-action="pms-newspage" data-d="1" ${S.newsPage >= pages ? 'disabled' : ''} aria-label="التالي"><i class="fas fa-chevron-left"></i></button>
        </div>`;
    }

    async function vNotifs() {
        const n = await pms('get_all_notifications');
        const list = n.notifications || [];
        S.unread = Number(n.total ?? list.filter(x => x.is_unread).length ?? 0);
        const items = list.map(x =>
            `<div class="cx-room"><span><i class="fas ${x.is_unread ? 'fa-circle' : 'fa-circle-notch'}" style="color:${x.is_unread ? 'var(--info)' : 'var(--text-tertiary)'};font-size:.6rem"></i></span>
            <span><strong>${esc(x.titleAr || x.title || '')}</strong><br>
            <span class="cx-muted">${esc(x.senderAr || x.sender || '')} — ${esc(x.created_at || '')}</span><br>${esc(String(x.contenu_json || x.content || '')).slice(0, 200)}</span></div>`
        ).join('');
        return `<div class="cx-card"><h4><i class="fas fa-bell" style="color:var(--accent)"></i> تنبيهاتي <span class="cx-pill info">${esc(n.total ?? list.length)}</span></h4>${items || '<p class="cx-muted">لا تنبيهات.</p>'}</div>`;
    }

    async function vProfile() {
        let live = null;
        try { live = (await pms('api_student_profile')).data || null; } catch (e) {}
        if (live) { S.sess.profile = Object.assign({}, S.sess.profile, live); try { saveSess(S.sess); } catch (e) {} }
        const p = S.sess.profile || {};
        const row = (k, v) => v ? `<div class="cx-room"><span class="cx-muted" style="min-width:110px">${k}</span><strong>${esc(v)}</strong></div>` : '';
        return `<div class="cx-card"><h4><i class="fas fa-id-card" style="color:var(--accent)"></i> ملفي الجامعي</h4>
            ${row('الاسم', p.NomAr || p.Nom)}${row('Matricule', p.Matricule)}${row('التسجيل', p.Inscription)}
            ${row('البكالوريا', p.Bac)}${row('الميلاد', p.date_naiss)}${row('الهاتف', p.Tel || p.phone)}
            ${row('البريد', p.email)}${row('القسم/الفوج', (p.section || '') + ' / ' + (p.Groupe || ''))}
            <p style="margin-top:12px"><button type="button" class="cx-btn gold" data-action="pms-refresh"><i class="fas fa-rotate-right"></i> تحديث الملف</button></p>
            <p class="cx-muted">قانون 18-07: بياناتك لا تغادر جهازك وسيرفر الجامعة.</p></div>`;
    }

    async function onAction(el) {
        const a = el.dataset.action;
        if (a === 'pms-menu') { S.view = 'menu'; render(); return; }
        if (a === 'pms-open') { openSection(el.dataset.tab); return; }
        if (a === 'pms-refresh') { S.cache = {}; openSection('profile'); return; }
        if (a === 'pms-login') {
            const u = ((document.getElementById('pms-user') || {}).value || '').trim();
            const p = (document.getElementById('pms-pass') || {}).value || '';
            if (!u || !p) { S.loginErr = 'أدخل رقم التسجيل وكلمة المرور'; render(); return; }
            S.loginErr = '';
            el.disabled = true;
            try {
                const d = await api('/login', { username: u, password: p });
                if (d.status !== 'success' || !d.data || !(d.data.Id || d.data.student_id)) throw new Error(d.message || 'فشل الدخول');
                S.sess = { student_id: d.data.Id || d.data.student_id, profile: d.data };
                saveSess(S.sess);
                S.cache = {}; S.view = 'menu'; S.loginErr = '';
                toast('مرحباً ' + (d.data.NomAr || d.data.Nom || ''), 'success');
                render();
                prefetchCampus();
            } catch (e) { S.loginErr = e.message; render(); }
            return;
        }
        if (a === 'pms-editmode') { S.cxEdit = !S.cxEdit; openSection('schedule'); return; }
        if (a === 'pms-syncpts') { syncCampusToPts(true); return; }
        if (a === 'pms-day') { S.cxDay = parseInt(el.dataset.day, 10) || 0; openSection('schedule'); return; }
        if (a === 'pms-slot') { openCampusSlot(el.dataset.key); return; }
        if (a === 'pms-modtab') { S.modTab = parseInt(el.dataset.sem, 10) || 0; openSection('modules'); return; }
        if (a === 'pms-modopen') { S.modMid = el.dataset.mid; openSection('moddetail'); return; }
        if (a === 'pms-roompage') { S.roomPage = Math.max(1, (S.roomPage || 1) + (parseInt(el.dataset.d, 10) || 0)); openSection('rooms'); return; }
        if (a === 'pms-newspage') { S.newsPage = Math.max(1, (S.newsPage || 1) + (parseInt(el.dataset.d, 10) || 0)); openSection('news'); return; }
        if (a === 'pms-newsopen') {
            const box = document.getElementById('pms-news-' + el.dataset.nid);
            if (!box) return;
            if (box.dataset.done) { renderNewsCard(box, false); delete box.dataset.done; }
            else { renderNewsCard(box, true); box.dataset.done = '1'; }
            return;
        }
    }

    function mount(root) {
        S.root = root;
        syncTile();
        wrapSlotPersistence();
        if (!campusAllowed()) { S.root.innerHTML = lockHTML(); return; }
        S.sess = loadSess();
        S.cache = {};
        if (root.dataset.mountedInitDone) { render(); if (S.sess) prefetchCampus(); return; }
        root.dataset.mountedInitDone = '1';
        root.addEventListener('click', (e) => {
            const el = e.target.closest('[data-action]');
            if (!el || !S.root.contains(el)) return;
            onAction(el);
        });
        let debT = null;
        const refocus = (id) => {
            try {
                const i = document.getElementById(id);
                if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
            } catch (e) {}
        };
        root.addEventListener('input', (e) => {
            if (e.target && e.target.id === 'pms-roomq') {
                clearTimeout(debT);
                const v = e.target.value;
                debT = setTimeout(() => { S.roomQ = v; S.roomPage = 1; openSection('rooms').then(() => refocus('pms-roomq')); }, 500);
            }
            if (e.target && e.target.id === 'pms-newsq') {
                clearTimeout(debT);
                const v = e.target.value;
                debT = setTimeout(() => { S.newsQ = v; S.newsPage = 1; openSection('news').then(() => refocus('pms-newsq')); }, 500);
            }
        });
        root.addEventListener('change', (e) => {
            if (e.target && e.target.id === 'pms-roomday') {
                S.roomDay = e.target.value; S.roomPage = 1; openSection('rooms');
            }
        });
        S.sess = loadSess();
        S.view = 'menu';
        render();
        prefetchCampus();
        pms('get_dashboard_data').then(d => { S.dash = d; if (S.view === 'menu') render(); }).catch(() => {});
        pms('get_all_notifications').then(n => {
            S.unread = Number(n.total || 0);
            if (S.view === 'menu') render();
        }).catch(() => {});
    }

    window.PortalSections = window.PortalSections || [];
    window.PortalSections.push({ id: 'campus', title: 'جامعتي', icon: 'fa-building-columns', mount });

    if (window.navigateToSection && !window.navigateToSection.__cxPatched) {
        const orig = window.navigateToSection;
        window.navigateToSection = function (sec) {
            syncTile();
            if (sec === 'campus' && !campusAllowed()) {
                toast('خاص بالمسئول فقط', 'error');
                return orig.call(this, 'home');
            }
            if (sec === 'account') setTimeout(renderDelegates, 60);
            return orig.apply(this, arguments);
        };
        window.navigateToSection.__cxPatched = true;
    }
    if (document.readyState !== 'loading') { syncTile(); renderDelegates(); try { if (window.CampusAccess.level()) prefetchCampus(); } catch (e) {} }
    else document.addEventListener('DOMContentLoaded', () => { syncTile(); renderDelegates(); try { if (window.CampusAccess.level()) prefetchCampus(); } catch (e) {} });
})();
