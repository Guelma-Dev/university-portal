(() => {
    'use strict';

    const GOLD = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#D4AF37';
    const MEALS = {
        1: { name: 'فطور الصباح', icon: 'fa-mug-saucer', slot: '06:30 - 09:30' },
        2: { name: 'الغداء', icon: 'fa-bowl-food', slot: '11:30 - 14:30' },
        3: { name: 'العشاء', icon: 'fa-mug-hot', slot: '18:30 - 20:45' },
    };
    const MEAL_ORDER = [1, 2, 3];
    const WD_FMT = new Intl.DateTimeFormat('ar', { weekday: 'long' });
    const DATE_FMT = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long' });

    const state = {
        ctx: null,
        ctxError: false,
        ctxReason: '',
        res: [],
        resLoaded: false,
        resError: false,
        resReason: '',
        prefs: null,
        prefsLoaded: false,
        depotId: null,
        activeDay: null,
        sel: {},
        tab: 'new',
        showingResults: false,
    };

    let activeRoot = null;

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const toast = (msg, type) => { if (typeof window.showToast === 'function') window.showToast(msg, type); };

    function getSession() {
        try {
            if (typeof window.getOnouSession === 'function') {
                const s = window.getOnouSession();
                if (s && s.uuid && s.dia != null) return s;
            }
        } catch (e) { /* noop */ }
        for (const store of [window.sessionStorage, window.localStorage]) {
            try {
                const raw = store.getItem('onou_session') || store.getItem('meals_session');
                if (!raw) continue;
                const s = JSON.parse(raw);
                if (s && s.uuid && s.dia != null) return s;
            } catch (e) { /* noop */ }
        }
        return null;
    }

    function authQS() {
        const s = getSession();
        if (!s) return '';
        return `uuid=${encodeURIComponent(s.uuid)}&dia=${encodeURIComponent(s.dia)}`;
    }

    async function jfetch(url, opts = {}) {
        const res = await fetch(url, opts);
        let data = null;
        try { data = await res.json(); } catch (e) { /* non-json */ }
        if (!res.ok) {
            const msg = data && (data.error || data.message);
            throw new Error(msg || `status-${res.status}`);
        }
        return data;
    }

    function fmtDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function futureDays() {
        const out = [];
        const now = new Date();
        const labels = ['غد', 'بعد غد', '+3'];
        for (let i = 1; i <= 3; i++) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
            out.push({ key: fmtDate(d), label: labels[i - 1], wd: WD_FMT.format(d), pretty: DATE_FMT.format(d) });
        }
        return out;
    }

    function mealIdFromFr(fr) {
        const f = String(fr || '').toLowerCase();
        if (/petit|break|matin|فطور/.test(f)) return 1;
        if (/déj|dej|lunch|midi|غداء/.test(f)) return 2;
        if (/d[iî]n|supper|dinner|soir|عشاء/.test(f)) return 3;
        return null;
    }

    function mealLabel(fr) {
        const id = mealIdFromFr(fr);
        return id ? MEALS[id].name : String(fr || 'وجبة');
    }

    function servedMeals(depot) {
        if (!depot) return [];
        return MEAL_ORDER.filter((id) => {
            const k = ['breakfast', 'lunch', 'dinner'][id - 1];
            return !!depot[k];
        });
    }

    function selectedCount() {
        let n = 0;
        Object.values(state.sel).forEach((set) => { n += set.size; });
        return n;
    }

    /* ================= SKELETON ================= */

    function skeletonHTML() {
        return `
        <div class="lx-m-wrap">
            <div class="lx-m-sk lx-m-sk-tab"></div>
            <div class="lx-m-sk lx-m-sk-card"></div>
            <div class="lx-m-sk lx-m-sk-row"></div>
            <div class="lx-m-sk lx-m-sk-row"></div>
            <div class="lx-m-sk lx-m-sk-row"></div>
        </div>`;
    }

    /* ================= SHELL ================= */

    function shellHTML() {
        return `
        <div class="lx-m-wrap">
            <div class="lx-m-tabs" role="tablist">
                <button type="button" class="lx-m-tab active" role="tab" data-action="tab" data-tab="new"><i class="fas fa-plus"></i><span>حجز جديد</span></button>
                <button type="button" class="lx-m-tab" role="tab" data-action="tab" data-tab="mine"><i class="fas fa-calendar-check"></i><span>حجوزاتي</span></button>
                <button type="button" class="lx-m-tab" role="tab" data-action="tab" data-tab="auto"><i class="fas fa-robot"></i><span>الحاجز الآلي</span></button>
                <span class="lx-m-slider"></span>
            </div>
            <div class="lx-m-pane active" data-pane="new">${skCards()}</div>
            <div class="lx-m-pane" data-pane="mine"></div>
            <div class="lx-m-pane" data-pane="auto"></div>
        </div>`;
    }

    function skCards() {
        return `<div style="margin-top:16px">
            <div class="lx-m-sk lx-m-sk-card"></div>
            <div class="lx-m-sk lx-m-sk-row"></div>
            <div class="lx-m-sk lx-m-sk-row"></div>
        </div>`;
    }

    function paneEl(name) {
        return activeRoot.querySelector(`[data-pane="${name}"]`);
    }

    function moveSlider() {
        if (!activeRoot) return;
        const tabs = activeRoot.querySelector('.lx-m-tabs');
        const act = tabs && tabs.querySelector('.lx-m-tab.active');
        const sl = tabs && tabs.querySelector('.lx-m-slider');
        if (!act || !sl) return;
        sl.style.left = `${act.offsetLeft}px`;
        sl.style.width = `${act.offsetWidth}px`;
    }

    function switchTab(tab) {
        state.tab = tab;
        activeRoot.querySelectorAll('.lx-m-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        activeRoot.querySelectorAll('.lx-m-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === tab));
        moveSlider();
        if (tab === 'new') renderNewPane();
        if (tab === 'mine') renderMinePane();
        if (tab === 'auto') renderAutoPane();
    }

    /* ================= TAB 1 — NEW RESERVATION ================= */

    async function loadContext(force = false) {
        if (state.ctx && !force) { renderNewPane(); return; }
        state.ctxError = false;
        state.ctxReason = '';
        const p = paneEl('new');
        if (p && !state.showingResults) p.innerHTML = skCards();
        try {
            const data = await jfetch(`/api/onou/context?${authQS()}`);
            state.ctx = Array.isArray(data.depots) ? data : { ...data, depots: [] };
            if (state.ctx.wilaya && typeof setUserWilaya === 'function') setUserWilaya(String(state.ctx.wilaya).trim());
            const pref = state.prefs && Number(state.prefs.depot);
            const preferred = state.ctx.depots.find((d) => Number(d.id) === pref) || state.ctx.depots.find((d) => Number(d.id) === state.depotId) || state.ctx.depots[0];
            state.depotId = preferred ? preferred.id : null;
            renderNewPane();
        } catch (e) {
            const msg = String(e && e.message || '');
            if (/انتهيت الجلسة|401/.test(msg)) state.ctxReason = 'login';
            else if (/uuid مطلوب/.test(msg)) state.ctxReason = 'login';
            state.ctxError = true;
            renderNewPane();
        }
    }

    function currentDepot() {
        if (!state.ctx || state.depotId == null) return null;
        return state.ctx.depots.find((d) => String(d.id) === String(state.depotId)) || null;
    }

    function locLine() {
        const c = state.ctx;
        if (!c) return '';
        const bits = [];
        if (c.wilaya) bits.push(`ولاية ${esc(c.wilaya)}`);
        if (c.residence) bits.push(`الإقامة: ${esc(c.residence)}`);
        return bits.length ? `<div class="lx-m-locline"><i class="fas fa-location-dot"></i><span>${bits.join(' — ')}</span></div>` : '';
    }

    function renderNewPane() {
        const p = paneEl('new');
        if (!p) return;
        if (state.showingResults) return;
        if (state.ctxError) {
            const loginNeeded = state.ctxReason === 'login';
            p.innerHTML = `
                <div class="lx-m-wrap-pad" style="margin-top:16px">
                    <div class="lx-m-errcard">
                        <i class="fas ${loginNeeded ? 'fa-right-to-bracket' : 'fa-triangle-exclamation'}"></i>
                        <p>${loginNeeded
                            ? 'تتطلب خدمة الوجبات جلسة Progres نشطة — سجّل دخولك أولاً'
                            : 'تعذر الوصول لخدمة الوجبات، أعد المحاولة بعد قليل'}</p>
                        ${loginNeeded
                            ? `<button type="button" class="lx-m-btn-retry" data-action="goto-progres-login"><i class="fas fa-right-to-bracket"></i> تسجيل دخول Progres</button>`
                            : `<button type="button" class="lx-m-btn-retry" data-action="retry-ctx"><i class="fas fa-rotate-right"></i> إعادة المحاولة</button>`}
                    </div>
                </div>`;
            return;
        }
        if (!state.ctx) { p.innerHTML = skCards(); return; }
        const depot = currentDepot();
        const served = servedMeals(depot);
        const days = futureDays();
        if (!state.activeDay || !days.some((d) => d.key === state.activeDay)) state.activeDay = days.length ? days[0].key : null;

        const depotCards = state.ctx.depots.map((d) => {
            const sv = servedMeals(d);
            return `
            <button type="button" class="lx-m-depot ${String(d.id) === String(state.depotId) ? 'sel' : ''}" data-action="depot" data-id="${esc(d.id)}">
                <span class="lx-m-depot-check"><i class="fas fa-check"></i></span>
                <div class="lx-m-depot-name">${esc(d.nameAR)}</div>
                <div class="lx-m-depot-latin">${esc(d.nameFR || d.nameEN || '')}</div>
                ${Number(d.isRu) ? '<span class="lx-m-badge-ru"><i class="fas fa-bed"></i> مطعم الإقامة</span>' : ''}
                <div class="lx-m-chips">
                    ${MEAL_ORDER.map((m) => `<span class="lx-m-chip ${sv.includes(m) ? 'on' : ''}"><i class="fas ${MEALS[m].icon}"></i>${MEALS[m].name}</span>`).join('')}
                </div>
            </button>`;
        }).join('');

        const dayChips = days.map((d) => `
            <button type="button" class="lx-m-day ${d.key === state.activeDay ? 'on' : ''}" data-action="day" data-date="${d.key}">
                <span class="lx-m-daylbl">${d.label}</span>
                <small>${d.wd} · ${d.pretty}</small>
            </button>`).join('');

        const daySel = state.sel[state.activeDay] || new Set();
        const mealRows = served.map((m) => {
            const on = daySel.has(m);
            return `
            <button type="button" class="lx-m-meal ${on ? 'on' : ''}" data-action="meal" data-meal="${m}">
                <span class="lx-m-mic"><i class="fas ${MEALS[m].icon}"></i></span>
                <span>
                    <span class="lx-m-meal-name">${MEALS[m].name}</span>
                    <span class="lx-m-meal-slot" style="display:block">${MEALS[m].slot}</span>
                </span>
                <span class="lx-m-knob"></span>
            </button>`;
        }).join('');

        const n = selectedCount();
        p.innerHTML = `
            ${locLine()}
            <div class="lx-m-h"><i class="fas fa-store"></i> اختر المطعم</div>
            ${depotCards ? `<div class="lx-m-depots">${depotCards}</div>` : '<div class="lx-m-empty"><i class="fas fa-store-slash"></i><p>لا توجد مطاعم متوفرة حالياً</p></div>'}
            <div class="lx-m-h"><i class="fas fa-calendar-days"></i> اختر اليوم</div>
            <div class="lx-m-days">${dayChips}</div>
            <div class="lx-m-h"><i class="fas fa-utensils"></i> الوجبات المتاحة</div>
            ${served.length
                ? `<div class="lx-m-meals">${mealRows}</div>`
                : '<div class="lx-m-empty" style="padding:26px"><i class="fas fa-circle-question"></i><p>اختر مطعماً لعرض وجباته</p></div>'}
            <div class="lx-m-sumbar">
                <span class="lx-m-count"><i class="fas fa-basket-shopping"></i> <b>${n}</b> ${n === 1 ? 'وجبة مختارة' : 'وجبات مختارة'}</span>
                <button type="button" class="lx-m-cta" data-action="confirm" ${n === 0 || !depot ? 'disabled' : ''}>
                    <i class="fas fa-check-double"></i> تأكيد الحجز
                </button>
            </div>`;
    }

    function toggleMeal(mealId) {
        if (!state.activeDay) return;
        const set = state.sel[state.activeDay] || new Set();
        if (set.has(mealId)) set.delete(mealId); else set.add(mealId);
        if (set.size) state.sel[state.activeDay] = set; else delete state.sel[state.activeDay];
        renderNewPane();
    }

    function selectDepot(id) {
        if (String(state.depotId) === String(id)) return;
        state.depotId = id;
        const served = servedMeals(currentDepot());
        Object.keys(state.sel).forEach((k) => {
            const set = state.sel[k];
            [...set].forEach((m) => { if (!served.includes(m)) set.delete(m); });
            if (!set.size) delete state.sel[k];
        });
        renderNewPane();
    }

    async function confirmReserve(btn) {
        const depot = currentDepot();
        const groups = [];
        Object.entries(state.sel).forEach(([date, set]) => {
            set.forEach((m) => {
                let g = groups.find((x) => x.menu_type === m);
                if (!g) { g = { menu_type: m, dates: [] }; groups.push(g); }
                g.dates.push(date);
            });
        });
        if (!groups.length || !depot) return;
        const session = getSession();
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحجز...';
        try {
            const responses = await Promise.all(groups.map((g) => jfetch('/api/onou/reserve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuid: session.uuid, dia: session.dia, menu_type: g.menu_type, idDepot: depot.id, dates: g.dates }),
            })));
            const items = responses.flatMap((r) => normalizeItems(r));
            state.sel = {};
            state.showingResults = true;
            renderResults(items);
            loadReservations(true).catch(() => {});
            const ok = items.filter((it) => it._ok).length;
            if (ok === items.length && items.length) toast(`تم تأكيد ${items.length} ${items.length === 1 ? 'وجبة' : 'وجبات'} بنجاح`, 'success');
            else if (ok > 0) toast('تم حجز بعض الوجبات، راجع النتائج', 'info');
            else toast('لم يتم تأكيد أي حجز', 'error');
        } catch (e) {
            toast(e.message === 'Failed to fetch' ? 'تعذر الاتصال بالخادم' : (e.message || 'فشل الحجز، حاول مجدداً'), 'error');
            renderNewPane();
        }
    }

    function normalizeItems(data) {
        let arr = data;
        if (arr && !Array.isArray(arr)) {
            if (Array.isArray(arr.results)) arr = arr.results;
            else if (Array.isArray(arr.items)) arr = arr.items;
            else arr = [arr];
        }
        if (!Array.isArray(arr)) arr = [];
        return arr.map((it) => ({
            date: it.date || it.date_reserve || '',
            meal: it.meal ?? it.meal_type ?? '',
            status: it.status,
            message: it.message || '',
            _ok: it.status === true || it.status === 'true' || /^(ok|success|confirmed|reserved|done)/i.test(String(it.status ?? '')),
        }));
    }

    function renderResults(items) {
        const p = paneEl('new');
        if (!p) return;
        const rows = items.map((it, i) => {
            const mid = Number(it.meal);
            const mname = MEALS[mid] ? MEALS[mid].name : mealLabel(it.meal);
            const dpretty = it.date ? `${DATE_FMT.format(new Date(`${it.date}T12:00:00`))}` : '';
            return `
            <div class="lx-m-resrow ${it._ok ? 'ok' : 'fail'}" style="animation-delay:${Math.min(i * 60, 300)}ms">
                <span class="lx-m-resic"><i class="fas ${it._ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i></span>
                <span class="lx-m-restxt">
                    ${esc(dpretty || it.date)} · ${esc(mname)}
                    ${it.message ? `<span class="lx-m-resmsg">${esc(it.message)}</span>` : ''}
                </span>
            </div>`;
        }).join('');
        p.innerHTML = `
            <div class="lx-m-h"><i class="fas fa-receipt"></i> نتيجة الحجز</div>
            <div class="lx-m-results">${rows}</div>
            <div class="lx-m-sumbar">
                <span class="lx-m-count"><i class="fas fa-circle-info"></i> يمكنك مراجعة حجوزاتك في تبويب «حجوزاتي»</span>
                <button type="button" class="lx-m-cta" data-action="results-done"><i class="fas fa-thumbs-up"></i> حسناً</button>
            </div>`;
    }

    function closeResults() {
        state.showingResults = false;
        renderNewPane();
    }

    /* ================= TAB 2 — MY RESERVATIONS ================= */

    async function loadReservations(force = false) {
        if (state.resLoaded && !force) { renderMinePane(); return; }
        state.resError = false;
        if (force) state.resLoaded = false;
        try {
            const data = await jfetch(`/api/onou/reservations?${authQS()}`);
            state.res = Array.isArray(data) ? data
                : (data && Array.isArray(data.data)) ? data.data : [];
            state.resLoaded = true;
            renderMinePane();
        } catch (e) {
            const msg = String(e && e.message || '');
            if (/انتهيت الجلسة|401|uuid مطلوب/.test(msg)) state.resReason = 'login';
            state.resError = true;
            renderMinePane();
        }
    }

    function renderMinePane() {
        const p = paneEl('mine');
        if (!p) return;
        if (state.resError) {
            const loginNeeded = state.resReason === 'login';
            p.innerHTML = `
                <div style="margin-top:16px">
                    <div class="lx-m-errcard">
                        <i class="fas ${loginNeeded ? 'fa-right-to-bracket' : 'fa-triangle-exclamation'}"></i>
                        <p>${loginNeeded
                            ? 'تتطلب خدمة الوجبات جلسة Progres نشطة — سجّل دخولك أولاً'
                            : 'تعذر جلب الحجوزات حالياً'}</p>
                        ${loginNeeded
                            ? `<button type="button" class="lx-m-btn-retry" data-action="goto-progres-login"><i class="fas fa-right-to-bracket"></i> تسجيل دخول Progres</button>`
                            : `<button type="button" class="lx-m-btn-retry" data-action="retry-res"><i class="fas fa-rotate-right"></i> إعادة المحاولة</button>`}
                    </div>
                </div>`;
            return;
        }
        if (!state.resLoaded) { p.innerHTML = skCards(); return; }
        if (!state.res.length) {
            p.innerHTML = `
                <div class="lx-m-glass lx-m-empty" style="margin-top:16px">
                    <i class="fas fa-utensils"></i>
                    <p>لا توجد حجوزات بعد</p>
                    <span>ابدأ حجزك الأول من تبويب «حجز جديد»</span>
                </div>`;
            return;
        }
        const groups = {};
        [...state.res].sort((a, b) => String(a.date_reserve).localeCompare(String(b.date_reserve))).forEach((r) => {
            const k = r.date_reserve;
            (groups[k] = groups[k] || []).push(r);
        });
        const cards = Object.entries(groups).map(([date, rows]) => {
            const dt = new Date(`${date}T12:00:00`);
            const head = `${WD_FMT.format(dt)} ${DATE_FMT.format(dt)}`;
            const body = rows.map((r) => {
                const mid = mealIdFromFr(r.mealtype_fr);
                const icon = mid ? MEALS[mid].icon : 'fa-utensil-spoon';
                const canDel = r.candelete !== false && r.candelete !== 'false' && r.candelete !== 0;
                return `
                <div class="lx-m-rrow" data-open="${esc(r.id)}">
                    <span class="lx-m-ricon"><i class="fas ${icon}"></i></span>
                    <span class="lx-m-rmain">
                        <span class="lx-m-rname">${esc(mid ? MEALS[mid].name : mealLabel(r.mealtype_fr))}</span>
                        <span class="lx-m-rdepot">${esc(r.depot_fr || '')}</span>
                    </span>
                    <span class="lx-m-ractions" data-row="${esc(r.id)}">
                        <span class="lx-m-chip-ok">مؤكد</span>
                        ${canDel ? `<button type="button" class="lx-m-del" data-action="del-start" data-id="${esc(r.id)}" title="إلغاء الحجز"><i class="fas fa-trash-can"></i></button>` : ''}
                    </span>
                </div>`;
            }).join('');
            return `
            <div class="lx-m-glass lx-m-datecard">
                <div class="lx-m-dchead"><span><i class="fas fa-calendar-day"></i> ${head}</span><small>${rows.length} ${rows.length === 1 ? 'حجز' : 'حجوزات'}</small></div>
                ${body}
            </div>`;
        }).join('');
        p.innerHTML = `<div style="margin-top:16px">${cards}</div>`;
    }

    function askDelete(id, btn) {
        const box = btn.closest('.lx-m-ractions');
        if (!box) return;
        box.dataset.prev = box.innerHTML;
        box.innerHTML = `
            <span class="lx-m-confirm">
                <button type="button" class="lx-m-btn-xs yes" data-action="del-confirm" data-id="${esc(id)}">تأكيد الإلغاء</button>
                <button type="button" class="lx-m-btn-xs no" data-action="del-cancel" data-id="${esc(id)}">تراجع</button>
            </span>`;
    }

    function cancelDelete(id, btn) {
        const box = btn.closest('.lx-m-ractions');
        if (box && box.dataset.prev) { box.innerHTML = box.dataset.prev; delete box.dataset.prev; }
    }

    async function doDelete(id, btn) {
        const row = btn.closest('.lx-m-rrow');
        if (row) row.classList.add('gone');
        try {
            await jfetch(`/api/onou/reservations/${encodeURIComponent(id)}?${authQS()}`, { method: 'DELETE' });
            state.res = state.res.filter((r) => String(r.id) !== String(id));
            setTimeout(() => renderMinePane(), 220);
            toast('تم إلغاء الحجز', 'success');
        } catch (e) {
            if (row) row.classList.remove('gone');
            toast(e.message === 'Failed to fetch' ? 'تعذر الاتصال بالخادم' : 'تعذر إلغاء الحجز، حاول مجدداً', 'error');
        }
    }

    /* ================= TICKET MODAL ================= */

    let qrPromise = null;

    function loadQrLib() {
        if (!qrPromise) {
            qrPromise = new Promise((resolve, reject) => {
                if (window.QRCode) return resolve();
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('qr-load-failed'));
                document.head.appendChild(s);
            });
        }
        return qrPromise;
    }

    function openTicket(res) {
        closeModal();
        const session = getSession();
        const mid = mealIdFromFr(res.mealtype_fr);
        const menuType = mid != null ? mid : String(res.mealtype_fr || '');
        const payload = `${session ? session.uuid : ''}|${res.date_reserve}|${menuType}|${res.idDepot}`;
        const modal = document.createElement('div');
        modal.className = 'lx-m-modal';
        modal.innerHTML = `
            <div class="lx-m-modal-bg" data-action="modal-close"></div>
            <div class="lx-m-ticket" role="dialog" aria-modal="true">
                <div class="lx-m-tkhead">
                    <button type="button" class="lx-m-tkclose" data-action="modal-close" title="إغلاق"><i class="fas fa-xmark"></i></button>
                    <div class="lx-m-tklogo"><i class="fas fa-building-columns"></i></div>
                    <div class="lx-m-tktitle">الديوان الوطني للخدمات الجامعية</div>
                    <span class="lx-m-tksub">تذكرة وجبة إلكترونية</span>
                </div>
                <div class="lx-m-tkbody">
                    <div class="lx-m-tkqr" data-qr><span class="lx-m-sk" style="width:150px;height:150px;border-radius:12px"></span></div>
                    <div class="lx-m-dash"></div>
                    <div class="lx-m-tkrow"><span>التاريخ</span><span>${esc(res.date_reserve || '--')}</span></div>
                    <div class="lx-m-tkrow"><span>وقت الخدمة</span><span>${mid ? MEALS[mid].slot : '--'}</span></div>
                    <div class="lx-m-tkrow"><span>المطعم</span><span>${esc(res.depot_fr || '--')}</span></div>
                    <div class="lx-m-tkrow"><span>الوجبة</span><span>${esc(mid ? MEALS[mid].name : mealLabel(res.mealtype_fr))}</span></div>
                    <div class="lx-m-barcode"></div>
                    <div class="lx-m-tkserial">${esc(String(res.id ?? '').padStart(8, '0'))}</div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            const t = e.target.closest('[data-action]');
            if (t && t.dataset.action === 'modal-close') closeModal();
        });
        document.addEventListener('keydown', escListener);
        loadQrLib().then(() => {
            const box = modal.querySelector('[data-qr]');
            if (!box || !modal.isConnected) return;
            box.innerHTML = '';
            try {
                new window.QRCode(box, {
                    text: payload,
                    width: 168,
                    height: 168,
                    colorDark: '#1e293b',
                    colorLight: '#ffffff',
                    correctLevel: window.QRCode.CorrectLevel.M,
                });
            } catch (e) {
                box.innerHTML = `<div class="lx-m-tkqrfail">${esc(payload)}</div>`;
            }
        }).catch(() => {
            const box = modal.querySelector('[data-qr]');
            if (box) box.innerHTML = `<div class="lx-m-tkqrfail">${esc(payload)}</div>`;
        });
    }

    function escListener(e) {
        if (e.key === 'Escape') closeModal();
    }

    function closeModal() {
        document.querySelectorAll('.lx-m-modal').forEach((m) => m.remove());
        document.removeEventListener('keydown', escListener);
    }

    /* ================= TAB 3 — AUTO GUARD ================= */

    async function loadPrefs() {
        try {
            const data = await jfetch(`/api/onou/prefs?${authQS()}`);
            state.prefs = data && typeof data === 'object' ? data : {};
        } catch (e) {
            state.prefs = {};
        }
        state.prefsLoaded = true;
        if (state.tab === 'auto') renderAutoPane();
    }

    function renderAutoPane() {
        const p = paneEl('auto');
        if (!p) return;
        if (!state.prefsLoaded) { p.innerHTML = skCards(); return; }
        const pr = state.prefs || {};
        const enabled = !!pr.enabled;
        const curHour = Number(pr.hour) || 6;
        const depotOptions = (state.ctx ? state.ctx.depots : [])
            .map((d) => `<option value="${esc(d.id)}" ${String(pr.depot ?? '') === String(d.id) ? 'selected' : ''}>${esc(d.nameAR)}</option>`)
            .join('');
        const hourOptions = [4, 5, 6, 7, 8, 9]
            .map((h) => `<option value="${h}" ${curHour === h ? 'selected' : ''}>${h} صباحاً</option>`)
            .join('');
        const chk = (key, label, icon) => `
            <label class="lx-m-check">
                <input type="checkbox" data-pref="${key}" ${(pr[key] === undefined || pr[key]) ? 'checked' : ''}>
                <i class="fas ${icon}" style="color:${GOLD}"></i> ${label}
            </label>`;
        p.innerHTML = `
            <div class="lx-m-glass lx-m-setcard" style="margin-top:16px">
                <div class="lx-m-setrow">
                    <span class="lx-m-setlabel">الحجز الآلي<small>تشغيل/إيقاف الخدمة</small></span>
                    <button type="button" class="lx-m-switch ${enabled ? 'on' : ''}" data-action="pref-master" role="switch" aria-checked="${enabled}"></button>
                </div>
                <div class="lx-m-autosub ${enabled ? '' : 'off'}">
                    <div class="lx-m-field">
                        <label>الوجبات المؤجّل بها آلياً</label>
                        <div class="lx-m-checks">
                            ${chk('breakfast', MEALS[1].name, MEALS[1].icon)}
                            ${chk('lunch', MEALS[2].name, MEALS[2].icon)}
                            ${chk('dinner', MEALS[3].name, MEALS[3].icon)}
                        </div>
                    </div>
                    <div class="lx-m-field">
                        <label>المطعم</label>
                        <select class="lx-m-select" data-prefsel="depot">
                            <option value="" ${!pr.depot ? 'selected' : ''}>— اختر المطعم —</option>
                            ${depotOptions}
                        </select>
                    </div>
                    <div class="lx-m-field">
                        <label>ساعة التنفيذ يومياً</label>
                        <select class="lx-m-select" data-prefsel="hour">${hourOptions}</select>
                    </div>
                </div>
            </div>
            <div class="lx-m-info">
                <i class="fas fa-circle-info"></i>
                <p>يعمل تلقائياً كل يوم لحجز أقصى نافذة مسموحة (3 أيام) ما دامت جلسة موقعك نشطة</p>
            </div>
            <div style="margin-top:14px">
                <button type="button" class="lx-m-cta full" data-action="pref-save"><i class="fas fa-floppy-disk"></i> حفظ الإعدادات</button>
            </div>`;
    }

    async function savePrefs(btn) {
        const p = paneEl('auto');
        if (!p) return;
        const session = getSession();
        const master = p.querySelector('[data-action="pref-master"]');
        const enabled = master && master.classList.contains('on');
        const meals = {};
        p.querySelectorAll('input[data-pref]').forEach((inp) => { meals[inp.dataset.pref] = inp.checked; });
        const depotSel = p.querySelector('[data-prefsel="depot"]');
        const hourSel = p.querySelector('[data-prefsel="hour"]');
        const body = {
            uuid: session.uuid,
            enabled: !!enabled,
            breakfast: !!meals.breakfast,
            lunch: !!meals.lunch,
            dinner: !!meals.dinner,
            depot: depotSel ? depotSel.value : '',
            hour: hourSel ? Number(hourSel.value) : 6,
        };
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الحفظ...';
        try {
            await jfetch('/api/onou/prefs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            state.prefs = body;
            toast('تم حفظ إعدادات الحاجز الآلي', 'success');
        } catch (e) {
            toast(e.message === 'Failed to fetch' ? 'تعذر الاتصال بالخادم' : 'تعذر الحفظ، حاول مجدداً', 'error');
        }
        renderAutoPane();
    }

    /* ================= MOUNT & EVENTS ================= */

    function onClick(e) {
        const el = e.target.closest('[data-action]');
        if (!el) {
            const openRow = e.target.closest('.lx-m-rrow[data-open]');
            if (openRow) {
                const r = state.res.find((x) => String(x.id) === String(openRow.dataset.open));
                if (r) openTicket(r);
            }
            return;
        }
        const a = el.dataset.action;
        if (a === 'tab') switchTab(el.dataset.tab);
        else if (a === 'depot') selectDepot(el.dataset.id);
        else if (a === 'day') { state.activeDay = el.dataset.date; renderNewPane(); }
        else if (a === 'meal') toggleMeal(Number(el.dataset.meal));
        else if (a === 'confirm') confirmReserve(el);
        else if (a === 'results-done') closeResults();
        else if (a === 'retry-ctx') loadContext(true);
        else if (a === 'goto-progres-login') {
            if (typeof navigateToSection === 'function') {
                navigateToSection('grades');
                setTimeout(() => {
                    const inp = document.getElementById('progres-username');
                    if (inp) inp.focus();
                    toast('أدخل بيانات Progres ثم عد إلى قسم الوجبات', 'info');
                }, 350);
            }
        }
        else if (a === 'retry-res') loadReservations(true);
        else if (a === 'del-start') askDelete(el.dataset.id, el);
        else if (a === 'del-confirm') doDelete(el.dataset.id, el);
        else if (a === 'del-cancel') cancelDelete(el.dataset.id, el);
        else if (a === 'pref-master') {
            const on = el.classList.toggle('on');
            el.setAttribute('aria-checked', String(on));
            const sub = paneEl('auto').querySelector('.lx-m-autosub');
            if (sub) sub.classList.toggle('off', !on);
        } else if (a === 'pref-save') savePrefs(el);
    }

    async function mount(container) {
        if (!container) return;
        activeRoot = container;
        container.classList.add('lx-m-root');
        container.innerHTML = skeletonHTML();
        container.removeEventListener('click', onClick);
        container.addEventListener('click', onClick);

        const session = getSession();
        if (!session) {
            container.innerHTML = `
                <div class="lx-m-wrap">
                    <div class="lx-m-tabs" aria-hidden="true">
                        <span class="lx-m-tab active" style="background:linear-gradient(135deg,var(--brand-light),var(--brand),var(--brand-dark));box-shadow:0 4px 14px var(--accent-glow)"><i class="fas fa-utensils"></i><span>الوجبات</span></span>
                    </div>
                    <div class="lx-m-glass lx-m-lock" style="margin-top:16px">
                        <i class="fas fa-lock"></i>
                        <p>خدمة الوجبات متاحة للطلبة المسجلين</p>
                        <span>سجّل الدخول بمعرف الجامعة لتصل إلى حجز الوجبات والحاجز الآلي</span>
                        <button type="button" class="lx-m-btn-retry" style="margin-top:12px" data-action="goto-progres-login"><i class="fas fa-right-to-bracket"></i> تسجيل الدخول</button>
                    </div>
                </div>`;
            return;
        }

        container.innerHTML = shellHTML();
        requestAnimationFrame(() => requestAnimationFrame(moveSlider));

        loadContext(!state.ctx);
        loadReservations(!state.resLoaded);
        loadPrefs();
    }

    window.addEventListener('resize', () => moveSlider());

    window.PortalSections = window.PortalSections || [];
    window.PortalSections.push({
        id: 'meals',
        title: 'الوجبات',
        icon: 'fa-utensils',
        mount,
    });

    window.LxMeals = { mount, openTicket, state };

    document.addEventListener('DOMContentLoaded', () => {
        const host = document.getElementById('section-meals');
        if (host && !host.dataset.lxMounted) {
            host.dataset.lxMounted = '1';
            mount(host);
        }
    });
})();
