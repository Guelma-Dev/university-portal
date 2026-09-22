// ==== جامعتي — نفس مكونات بوابة الطالب (مسئول فقط، جلسة دائمة) ====
// القائمة: وصول سريع + خدمات (مطابق للرئيسية). الرزنامة: منتقي أيام + حصص
// (مطابق لرزنامة التطبيق) مع تعديل محلي يعيد استعمال محرر الحصص الأصلي.
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

    const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
    const DAY_AR = { sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس' };
    const DAY_ICON = ['fa-sun', 'fa-cloud-sun', 'fa-cloud', 'fa-cloud-rain', 'fa-moon'];
    const FR_DAY = { dimanche: 'sunday', lundi: 'monday', mardi: 'tuesday', mercredi: 'wednesday', jeudi: 'thursday', vendredi: 'friday', samedi: 'saturday' };
    const SLOTS = ['08:00 - 09:30', '09:30 - 11:00', '11:00 - 12:30', '14:00 - 15:30', '15:30 - 17:00'];
    const PMS_TYPE = { cours: 'lecture', lecture: 'lecture', td: 'td', tp: 'tp' };
    const CELL_CLASS = { lecture: 'schedule-cell-lecture', td: 'schedule-cell-tdtp', tp: 'schedule-cell-tp' };
    const TYPE_AR = { lecture: 'محاضرة', td: 'أعمال موجهة', tp: 'أعمال تطبيقية' };

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (m, t) => { if (typeof window.showToast === 'function') window.showToast(m, t); };
    const isAdmin = () => { try { return localStorage.getItem('user_role') === 'admin'; } catch (e) { return false; } };
    const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

    const S = { root: null, view: 'menu', sess: null, cache: {}, loading: false, html: '', dash: null, unread: 0, cxEdit: false, cxDay: -1 };

    function loadSess() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) { const s = JSON.parse(raw); if (s && s.student_id) return s; }
        } catch (e) {}
        const s = { student_id: SID, profile: Object.assign({}, SEED_PROFILE) };
        try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
        return s;
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

    // ---------- القائمة (وصول سريع + خدمات) ----------
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
        const p = (S.sess && S.sess.profile) || {};
        const d = S.dash || {};
        return `
        <div class="cx-card" style="margin-top:14px">
            <h3><i class="fas fa-building-columns" style="color:var(--accent)"></i> جامعتي <span class="cx-muted">— ${esc(d.specialtyNameAr || d.specialtyNameFr || 'جامعة قالمة')}</span></h3>
            <p><strong>${esc(p.NomAr || p.Nom || '')}</strong> <span class="cx-muted">— فوج ${esc(d.group || p.Groupe || '')} / قسم ${esc(d.section || p.section || '')}</span></p>
        </div>
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

    function dayHasClasses(grid, day) {
        const db = cxDb();
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
        if (S.cxDay < 0) S.cxDay = defaultDay();
        const { grid, extra } = pmsBaseGrid();
        const day = DAYS[S.cxDay];
        const picker = `<div class="schedule-day-picker"><div class="day-picker-title">
                <span><i class="fas fa-calendar-day"></i> اختر اليوم</span>
                <button type="button" class="sched-edit-btn ${S.cxEdit ? 'active' : ''}" data-action="pms-editmode">
                    <i class="fas ${S.cxEdit ? 'fa-check' : 'fa-pen'}"></i> ${S.cxEdit ? 'تم' : 'تعديل الجدول'}</button>
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
            return `<div class="cx-card"><h4><i class="fas fa-book" style="color:var(--accent)"></i> ${label} <span class="cx-pill info">${arr.length} مواد</span></h4>
                <p class="cx-muted">مجموع الأرصدة <strong>${totC}</strong> — مجموع المعاملات <strong>${totK}</strong></p>
                <table class="cx-table"><tr><th>المادة</th><th>المعامل</th><th>الرصيد</th><th></th></tr>` +
                arr.map(m => {
                    const mid = m.id ?? m.module_id;
                    return `<tr><td><strong>${esc(m.nameAr || m.name || '')}</strong><br><span class="cx-muted">${esc(m.name && m.nameAr ? m.name : '')}</span>
                            <div id="pms-syl-${esc(mid)}"></div></td>
                        <td class="cx-time">${esc(m.coef ?? m.TotalCoefficient ?? '—')}</td>
                        <td class="cx-time">${esc(m.credit ?? m.TotalCredit ?? '—')}</td>
                        <td><button type="button" class="cx-btn" data-action="pms-syllabus" data-mid="${esc(mid)}" aria-label="المنهاج"><i class="fas fa-scroll"></i></button></td></tr>`;
                }).join('') + `</table></div>`;
        }).join('');
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

    async function vRooms() {
        const d = await pms('get_occupancy_data');
        const rooms = d.rooms || [];
        const busy = new Set((d.horaires || []).map(h => String(h.salle_id)));
        const free = rooms.filter(r => !busy.has(String(r.id))).length;
        return `<div class="cx-card"><h4><i class="fas fa-door-open" style="color:var(--accent)"></i> القاعات <span class="cx-pill ok">${free} حرة</span> <span class="cx-pill bad">${rooms.length - free} مشغولة</span></h4>
            <p class="cx-muted">${esc((d.debug_info || {}).day_queried || '')} — ${esc((d.debug_info || {}).semester_type || '')}</p>` +
            rooms.map(r => {
                const parts = String(r.coordonnes || '').split(',');
                const lat = parseFloat(parts[0]), lng = parseFloat(parts[1]);
                const map = (isFinite(lat) && isFinite(lng))
                    ? ` <a class="cx-btn" style="min-height:36px;padding:0 12px" target="_blank" rel="noopener" aria-label="خريطة" href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}"><i class="fas fa-map-location-dot"></i></a>` : '';
                return `<div class="cx-room"><span class="cx-dot ${busy.has(String(r.id)) ? 'busy' : 'free'}"></span><span><strong>${esc(r.nom_salle)}</strong></span><span class="cx-map">${map}</span></div>`;
            }).join('') + `</div>`;
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

    async function vNews() {
        const [n, a] = await Promise.all([
            pms('get_news').catch(() => ({})),
            pms('get_announcements').catch(() => ({})),
        ]);
        const tick = (n.ticker || []).slice(0, 5).map(t =>
            `<div class="cx-card"><span class="cx-pill warn">عاجل</span><p>${esc(String(t.subject || '').slice(0, 300))}</p></div>`).join('');
        const item = (t) => {
            const img = t.image ? `<br><img src="https://ent.univ-guelma.dz/board/uploads/${esc(t.image)}" loading="lazy" style="max-width:100%;border-radius:12px;margin-top:8px" />` : '';
            return `<p><strong>${esc(t.title || t.sDate || '')}</strong><br>${esc(t.subject || t.content || '')}${img}</p><hr>`;
        };
        const notices = (n.notices || []).slice(0, 15).map(item).join('');
        const admin = [].concat(a.notices || [], a.dept_notices || []).slice(0, 10).map(item).join('');
        return tick + `<div class="cx-card cx-news"><h4><i class="fas fa-newspaper" style="color:var(--accent)"></i> أخبار الجامعة</h4>${notices || '<p class="cx-muted">لا أخبار.</p>'}</div>
        <div class="cx-card cx-news"><h4><i class="fas fa-bullhorn" style="color:var(--accent)"></i> إعلانات الإدارة</h4>${admin || '<p class="cx-muted">لا إعلانات.</p>'}</div>`;
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
        if (live) { S.sess.profile = Object.assign({}, S.sess.profile, live); try { localStorage.setItem(LS_KEY, JSON.stringify(S.sess)); } catch (e) {} }
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
        if (a === 'pms-editmode') { S.cxEdit = !S.cxEdit; openSection('schedule'); return; }
        if (a === 'pms-day') { S.cxDay = parseInt(el.dataset.day, 10) || 0; openSection('schedule'); return; }
        if (a === 'pms-slot') { openCampusSlot(el.dataset.key); return; }
        if (a === 'pms-syllabus') {
            const mid = el.dataset.mid;
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
            onAction(el);
        });
        S.sess = loadSess();
        S.view = 'menu';
        render();
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
