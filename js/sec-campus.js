// ==== جامعتي — بلغة بوابة الطالب (مسئول فقط، جلسة دائمة) ====
// قائمة عمودية ← تفاصيل (نفس ملاحة التطبيق). الرزنامة شبكية بشبكة التطبيق
// مع طبقة تعديل محلية lx_pms_sched_v1 تعيد استعمال محرر الحصص الأصلي.
(() => {
    'use strict';

    const API = window.location.origin + '/api/pms';
    const LS_KEY = 'lx_pms';
    const SCHED_KEY = 'lx_pms_sched_v1';
    const SID = 997;

    const SEED_PROFILE = {
        Id: 997, Inscription: 'UN24012026252536255705', Bac: '2025',
        Matricule: '252536255705', Nom: 'BRAHIMI Mohamed', NomAr: 'محمد براهيمي',
        spec_id: 215, niveau_id: 37, section: '1', Groupe: '2',
        gender: 'Masculin', date_naiss: '2006-10-29',
        email: 'bbm82186@gmail.com', Tel: '0558163003',
    };

    const DAYS = (typeof window.DAYS !== 'undefined' && window.DAYS) || ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
    const DAY_AR = { sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس', friday: 'الجمعة', saturday: 'السبت' };
    const FR_DAY = { dimanche: 'sunday', lundi: 'monday', mardi: 'tuesday', mercredi: 'wednesday', jeudi: 'thursday', vendredi: 'friday', samedi: 'saturday' };
    const SLOTS = (typeof window.TIME_SLOTS !== 'undefined' && window.TIME_SLOTS) || ['08:00 - 09:30', '09:30 - 11:00', '11:00 - 12:30', '14:00 - 15:30', '15:30 - 17:00'];
    const PMS_TYPE = { cours: 'lecture', lecture: 'lecture', td: 'td', tp: 'tp' };
    const CELL_CLASS = { lecture: 'schedule-cell-lecture', td: 'schedule-cell-tdtp', tp: 'schedule-cell-tp' };
    const TYPE_AR = { lecture: 'محاضرة', td: 'أعمال موجهة', tp: 'أعمال تطبيقية' };

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (m, t) => { if (typeof window.showToast === 'function') window.showToast(m, t); };
    const isAdmin = () => { try { return localStorage.getItem('user_role') === 'admin'; } catch (e) { return false; } };
    const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

    const S = { root: null, view: 'menu', sess: null, cache: {}, loading: false, html: '', dash: null, unread: 0, cxEdit: false };

    const SECTIONS = [
        ['schedule', 'fa-calendar-days', 'رزنامتي', 'الشبكة الأسبوعية + تعديلي', ''],
        ['exams', 'fa-file-pen', 'امتحاناتي', 'عادية / استدراك / ديون', 'blue'],
        ['absences', 'fa-user-xmark', 'غياباتي', 'مبررة وغير مبررة + عتبة الإقصاء', 'red'],
        ['modules', 'fa-book', 'موديولاتي', 'حسب السداسي + الأرصدة والمعاملات', ''],
        ['rooms', 'fa-door-open', 'القاعات', 'إشغال حي + خرائط GPS', 'green'],
        ['tutor', 'fa-user-tie', 'المشرف', 'مشرفي وسجله', ''],
        ['stage', 'fa-briefcase', 'التربص', 'الترشح والحالة', 'blue'],
        ['defense', 'fa-graduation-cap', 'المناقشة', 'اللجنة والقاعة', ''],
        ['news', 'fa-newspaper', 'الأخبار', 'أخبار الجامعة + إعلانات الإدارة', 'green'],
        ['notifs', 'fa-bell', 'تنبيهاتي', 'إشعارات الجامعة', 'red'],
        ['profile', 'fa-id-card', 'ملفي', 'بطاقتي الجامعية الكاملة', ''],
    ];

    // ---------- الجلسة الدائمة ----------
    function loadSess() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) { const s = JSON.parse(raw); if (s && s.student_id) return s; }
        } catch (e) {}
        const s = { student_id: SID, profile: Object.assign({}, SEED_PROFILE) };
        try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
        return s;
    }

    // ---------- طبقة الرزنامة المحلية ----------
    function cxDb() {
        try { const d = JSON.parse(localStorage.getItem(SCHED_KEY) || '{}'); if (d && typeof d === 'object') return d; } catch (e) {}
        return {};
    }
    function cxSave(db) { try { localStorage.setItem(SCHED_KEY, JSON.stringify(db)); } catch (e) {} }

    // ---------- الشبكة ----------
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

    // ---------- العرض ----------
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

    function heroHTML() {
        const p = (S.sess && S.sess.profile) || {};
        const d = S.dash || {};
        return `<div class="cx-hero">
            <p class="cx-name">👋 ${esc(p.NomAr || p.Nom || '')}</p>
            <p class="cx-sub">${esc(d.specialtyNameAr || d.specialtyNameFr || 'جامعة قالمة')} — ${esc(d.lvlYearStr || '')} — فوج ${esc(d.group || p.Groupe || '')}</p>
        </div>`;
    }

    function menuHTML() {
        return heroHTML() + `<div class="cx-menu">` + SECTIONS.map(([id, ic, t, sub, tone]) => {
            const badge = (id === 'notifs' && S.unread > 0) ? `<span class="cx-badge">${S.unread}</span>` : '';
            return `<button type="button" class="cx-row pressable" data-action="pms-open" data-tab="${id}">
                <span class="cx-ico ${tone}"><i class="fas ${ic}"></i></span>
                <span class="cx-name">${t}<span class="cx-sub">${sub}</span></span>
                ${badge}<i class="fas fa-chevron-left cx-go"></i>
            </button>`;
        }).join('') + `</div>`;
    }

    function render() {
        if (!S.root) return;
        if (!isAdmin()) { S.root.innerHTML = lockHTML(); return; }
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

    // ---------- الرزنامة الشبكية ----------
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
                teacher: r.teacherAr || r.teacher || '',
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

    async function vSchedule() {
        if (!S.cache['sched_raw']) S.cache['sched_raw'] = await pms('get_group_schedule');
        const { grid, extra } = pmsBaseGrid();
        const head = `<tr><th>الحصة</th>` + DAYS.map(d => `<th>${DAY_AR[d] || d}</th>`).join('') + `</tr>`;
        const body = SLOTS.map((time, i) => {
            const tds = DAYS.map(day => {
                const key = day + '_' + i;
                const c = finalCell(grid, key);
                const cls = c ? (CELL_CLASS[c.type] || '') : '';
                const tap = S.cxEdit ? ` slot-tap" data-action="pms-slot" data-key="${key}` : '';
                const inner = c
                    ? `<span class="cx-cell-sub">${esc(c.subject)}</span><span class="cx-cell-meta">${esc(TYPE_AR[c.type] || '')}${c.room ? ' • ' + esc(c.room) : ''}${c.teacher ? ' • ' + esc(c.teacher) : ''}</span>`
                    : (S.cxEdit ? '<span class="cx-muted">+ إضافة</span>' : '');
                return `<td class="${cls}${tap}">${inner}</td>`;
            }).join('');
            return `<tr><td class="time-col">${esc(time)}</td>${tds}</tr>`;
        }).join('');
        const extraHtml = extra.length
            ? `<div class="cx-card cx-unmatched"><h4>🕐 خارج الشبكة</h4>` + extra.map(c =>
                `<p><b>${esc(c.subject)}</b> — ${esc(c._day || '')} ${esc(c._heure || '')}${c.room ? ' — قاعة ' + esc(c.room) : ''}</p>`).join('') + `</div>`
            : '';
        return `<div class="cx-card">
            <h4>📅 رزنامتي الأسبوعية</h4>
            <p><button type="button" class="cx-btn ${S.cxEdit ? 'active' : ''}" data-action="pms-editmode">
                <i class="fas ${S.cxEdit ? 'fa-check' : 'fa-pen'}"></i> ${S.cxEdit ? 'تم' : 'تعديل الجدول'}</button></p>
            ${S.cxEdit ? '<p class="cx-muted">المس أي خانة للتعديل — إضافاتك محفوظة على جهازك.</p>' : ''}
            <div class="cx-grid-wrap"><table class="cx-grid">${head}${body}</table></div>
        </div>${extraHtml}`;
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

    // ---------- الموديولات حسب السداسي ----------
    async function vModules() {
        const d = await pms('get_student_modules');
        const mods = d.modules || d.data || [];
        if (!mods.length) return `<div class="cx-card"><p class="cx-muted">لا موديولات.</p></div>`;
        const groups = {};
        mods.forEach(m => {
            const s = parseInt(m.semestre ?? m.semester ?? 0, 10) || 0;
            (groups[s] = groups[s] || []).push(m);
        });
        return Object.keys(groups).map(Number).sort((a, b) => a - b).map(s => {
            const arr = groups[s];
            const totC = arr.reduce((a, m) => a + num(m.credit ?? m.TotalCredit), 0);
            const totK = arr.reduce((a, m) => a + num(m.coef ?? m.TotalCoefficient), 0);
            const label = s > 0 ? `السداسي ${s}` : 'سداسي غير محدد';
            return `<div class="cx-card"><h4>📚 ${label} <span class="cx-pill info">${arr.length} مواد</span></h4>
                <div class="cx-stats" style="margin:0 0 8px">
                    <div class="cx-stat gold"><b>${totC}</b><span>مجموع الأرصدة</span></div>
                    <div class="cx-stat blue"><b>${totK}</b><span>مجموع المعاملات</span></div>
                    <div class="cx-stat green"><b>${arr.length}</b><span>مادة</span></div>
                </div>
                <table class="cx-table"><tr><th>المادة</th><th>المعامل</th><th>الرصيد</th><th></th></tr>` +
                arr.map(m => {
                    const mid = m.id ?? m.module_id;
                    return `<tr><td><b>${esc(m.nameAr || m.name || '')}</b><br><span class="cx-muted">${esc(m.name || '')}</span>
                            <div id="pms-syl-${esc(mid)}"></div></td>
                        <td class="cx-time">${esc(m.coef ?? m.TotalCoefficient ?? '—')}</td>
                        <td class="cx-time">${esc(m.credit ?? m.TotalCredit ?? '—')}</td>
                        <td><button type="button" class="cx-btn green" data-action="pms-syllabus" data-mid="${esc(mid)}">📜</button></td></tr>`;
                }).join('') + `</table></div>`;
        }).join('');
    }

    // ---------- باقي الشاشات ----------
    async function vHome() {
        const d = await pms('get_dashboard_data');
        S.dash = d;
        return `<div class="cx-card"><h4>📌 لوحتي</h4>
            <p><b>${esc(d.specialtyNameAr || '')}</b> — ${esc(d.lvlYearStr || '')}</p>
            <p>🚫 الغيابات: <b>${esc(d.totalAbsences ?? 0)}</b>${d.tutorName ? ` — 👨‍🏫 المشرف: <b>${esc(d.tutorNameAr || d.tutorName)}</b>` : ''}</p>
            <p class="cx-muted">السداسي الحالي: ${esc(d.currentSemester ?? '—')}</p></div>`;
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
        const mods = (d.modules || []).map(m => {
            const a = Number(m.total_abs ?? m.abs ?? 0);
            return `<div class="cx-room"><span>📚</span><span style="flex:1"><b>${esc(m.module_name || m.name || '')}</b>
                <div class="cx-meter"><i style="width:${Math.min(100, a * 20)}%"></i></div></span><b>${a}</b></div>`;
        }).join('');
        return `<div class="cx-card"><h4>🚫 الغيابات</h4>
            <div class="cx-stats" style="margin:0 0 8px">
                <div class="cx-stat blue"><b>${tot}</b><span>المجموع</span></div>
                <div class="cx-stat green"><b>${esc(d.total_justified ?? 0)}</b><span>مبررة</span></div>
                <div class="cx-stat"><b>${unjust}</b><span>غير مبررة</span></div>
            </div>
            <p class="cx-muted">عتبة الإقصاء: 5 غير مبررة</p>
            <div class="cx-meter"><i style="width:${Math.min(100, unjust * 20)}%"></i></div></div>
        <div class="cx-card"><h4>📚 حسب المقياس</h4>${mods || '<p class="cx-muted">✅ سجل نظيف.</p>'}</div>`;
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
                const lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
                const map = (isFinite(lat) && isFinite(lng))
                    ? ` <a class="cx-btn" style="min-height:36px;padding:0 12px" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}">🗺️</a>` : '';
                return `<div class="cx-room"><span class="cx-dot ${busy.has(String(r.id)) ? 'busy' : 'free'}"></span><span><b>${esc(r.nom_salle)}</b></span><span class="cx-map">${map}</span></div>`;
            }).join('') + `</div>`;
    }

    async function vTutor() {
        const t = await pms('get_tutoring');
        const tu = t.tutor || {};
        const hist = (t.history || []).map(h => `<p>• ${esc(h.title || h.subject || '')}</p>`).join('');
        return `<div class="cx-card"><h4>👨‍🏫 مشرفي</h4>` + (t.tutor
            ? `<p style="font-size:1.15rem;font-weight:800">${esc(tu.tutorNameAr || tu.tutorName || '')}</p><p class="cx-muted">${esc(tu.tutorName || '')}</p>`
            : `<p class="cx-muted">لا مشرف مسند حالياً.</p>`) + `</div>
        <div class="cx-card"><h4>📜 السجل</h4>${hist || '<p class="cx-muted">لا عناصر.</p>'}</div>`;
    }

    async function vStage() {
        const s = await pms('get_student_stage');
        const pill = s.is_open ? `<span class="cx-pill ok">الترشح مفتوح</span>` : `<span class="cx-pill warn">الترشح مغلق حالياً</span>`;
        let items = '';
        const data = s.data;
        const arr = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
        if (arr.length && !(arr.length === 1 && !Object.keys(arr[0]).length)) {
            items = arr.map(x => `<div class="cx-room"><span>💼</span><span><b>${esc(x.company_name || x.theme || x.subject || '')}</b><br>
                <span class="cx-muted">${esc(x.status || '')} ${esc(x.start_date || '')}</span></span></div>`).join('');
        }
        return `<div class="cx-card"><h4>💼 التربص</h4><p>${pill}</p>${items}</div>`;
    }

    async function vDefense() {
        const d = await pms('get_student_defense');
        if (!d.has_defense) return `<div class="cx-card"><h4>🎓 المناقشة</h4><p class="cx-muted">لا مناقشة مبرمجة — ستظهر هنا اللجنة والقاعة فور برمجتها.</p></div>`;
        const roles = [['president', 'الرئيس'], ['supervisor', 'المشرف'], ['co_supervisor', 'المشرف المساعد'], ['examiners', 'الممتحنون'], ['ext_examiners', 'أعضاء خارجيون']];
        const fmt = (v) => Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : (x.name || '')).filter(Boolean).join('، ') : (typeof v === 'string' ? v : (v && v.name) || '');
        const jury = roles.map(([k, label]) => d[k] && fmt(d[k]) ? `<div class="cx-room"><span>⚖️</span><span><b>${label}:</b> ${esc(fmt(d[k]))}</span></div>` : '').join('');
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
            `<div class="cx-card"><span class="cx-pill warn">عاجل</span><p>${esc(String(t.subject || '').slice(0, 300))}</p></div>`).join('');
        const item = (t) => {
            const img = t.image ? `<br><img src="https://ent.univ-guelma.dz/board/uploads/${esc(t.image)}" loading="lazy" style="max-width:100%;border-radius:12px;margin-top:8px" />` : '';
            return `<p>📢 <b>${esc(t.title || t.sDate || '')}</b><br>${esc(t.subject || t.content || '')}${img}</p><hr>`;
        };
        const notices = (n.notices || []).slice(0, 15).map(item).join('');
        const admin = [].concat(a.notices || [], a.dept_notices || []).slice(0, 10).map(item).join('');
        return tick + `<div class="cx-card cx-news"><h4>📰 أخبار الجامعة</h4>${notices || '<p class="cx-muted">لا أخبار.</p>'}</div>
        <div class="cx-card cx-news"><h4>📣 إعلانات الإدارة</h4>${admin || '<p class="cx-muted">لا إعلانات.</p>'}</div>`;
    }

    async function vNotifs() {
        const n = await pms('get_all_notifications');
        const list = n.notifications || [];
        S.unread = Number(n.total ?? list.filter(x => x.is_unread).length ?? 0);
        const items = list.map(x =>
            `<div class="cx-room"><span>${x.is_unread ? '🔵' : '⚪'}</span><span><b>${esc(x.titleAr || x.title || '')}</b><br>
            <span class="cx-muted">${esc(x.senderAr || x.sender || '')} — ${esc(x.created_at || '')}</span><br>${esc(String(x.contenu_json || x.content || '')).slice(0, 200)}</span></div>`
        ).join('');
        return `<div class="cx-card"><h4>🔔 تنبيهاتي <span class="cx-pill info">${esc(n.total ?? list.length)}</span></h4>${items || '<p class="cx-muted">لا تنبيهات.</p>'}</div>`;
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
        if (a === 'pms-menu') { S.view = 'menu'; render(); return; }
        if (a === 'pms-open') { openSection(btn.dataset.tab); return; }
        if (a === 'pms-refresh') { S.cache = {}; openSection('profile'); return; }
        if (a === 'pms-editmode') { S.cxEdit = !S.cxEdit; openSection('schedule'); return; }
        if (a === 'pms-slot') { openCampusSlot(btn.dataset.key); return; }
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
        wrapSlotPersistence();
        if (!isAdmin()) { S.root.innerHTML = lockHTML(); return; }
        if (root.dataset.mountedInitDone) { render(); return; }
        root.dataset.mountedInitDone = '1';
        root.addEventListener('click', (e) => {
            const el = e.target.closest('[data-action]');
            if (!el || !S.root.contains(el)) return;
            // تجاهل أزرار التبويبات الداخلية للتطبيق إن وجدت
            onAction(el);
        });
        S.sess = loadSess();
        S.view = 'menu';
        render();
        // prefetch لوحة + غير المقروء لتغذية القائمة
        pms('get_dashboard_data').then(d => { S.dash = d; if (S.view === 'menu') render(); }).catch(() => {});
        pms('get_all_notifications').then(n => {
            S.unread = Number(n.total || 0);
            if (S.view === 'menu') render();
        }).catch(() => {});
    }

    window.PortalSections = window.PortalSections || [];
    window.PortalSections.push({ id: 'campus', title: '🎓 جامعتي', icon: 'fa-building-columns', mount });

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
