// ============================================================
// PROFILE 360 — ملفي الشامل
// Registers: window.PortalSections.push({id:'profile360',...})
// Expects globals from app.js: API_BASE, showToast, getProgresSession
// All styles live in css/luxury.css under the .lx-p- namespace
// ============================================================
(function () {
    'use strict';

    var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; }); }
    function rm() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    function ico(name, cls) { return '<i class="fas ' + esc(name) + (cls ? ' ' + cls : '') + '" aria-hidden="true"></i>'; }
    var SPIN = ico('fa-circle-notch', 'fa-spin');

    var BASE = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : window.location.origin;

    function getSession() {
        var s = null;
        try { s = (typeof getProgresSession === 'function') ? getProgresSession() : null; } catch (e) { s = null; }
        if (!s || !s.uuid) return null;
        var dia = s.dia || '';
        if (!dia && Array.isArray(s.cards)) {
            var want = String(s.selectedCard || s.idCardYear || '');
            var sel = s.cards.filter(function (c) { return String(c.id) === want; })[0];
            if (sel) dia = sel.anneeAcademiqueCode || sel.anneeCode || '';
        }
        return { uuid: s.uuid, dia: dia };
    }

    function apiGet(path, params) {
        var qs = new URLSearchParams(params || {}).toString();
        return fetch(BASE + '/api/academic/' + path + (qs ? '?' + qs : '')).then(function (res) {
            if (!res.ok) throw new Error('http-' + res.status);
            return res.json().catch(function () { return null; });
        });
    }

    function apiPost(path, body) {
        return fetch(BASE + '/api/academic/' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then(function (res) {
            return res.json().catch(function () { return null; }).then(function (data) {
                if (!res.ok) {
                    var err = new Error('http-' + res.status);
                    err.data = data;
                    throw err;
                }
                return data;
            });
        });
    }

    function toArray(data, keys) {
        if (Array.isArray(data)) return data;
        if (data && typeof data === 'object') {
            var cand = (keys || []).concat(['items', 'list', 'data', 'results', 'rows']).concat(Object.keys(data));
            for (var i = 0; i < cand.length; i++) if (Array.isArray(data[cand[i]])) return data[cand[i]];
        }
        return [];
    }

    function pickAny(o, keys) {
        if (!o || typeof o !== 'object') return '';
        for (var i = 0; i < keys.length; i++) {
            var v = o[keys[i]];
            if (v !== undefined && v !== null && v !== '') return v;
        }
        return '';
    }

    var DATE_KEYS = ['date', 'dateSeance', 'dateAbsence', 'dateDebut', 'date_demande', 'datePublication', 'createdAt', 'created_at', 'jour'];

    function fmtVal(v) {
        var s = String(v == null ? '' : v).trim();
        if (!s) return '';
        return esc(s.length > 24 ? s.slice(0, 24) + '…' : s);
    }

    var STATUS_META = {
        ok: { l: 'مقبولة', i: 'fa-circle-check' },
        bad: { l: 'مرفوضة', i: 'fa-circle-xmark' },
        wait: { l: 'قيد الانتظار', i: 'fa-hourglass-half' },
        none: { l: 'غير محددة', i: 'fa-circle-question' },
    };

    function normStatus(v) {
        var s = String(v == null ? '' : v).trim().toLowerCase();
        try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { }
        if (!s) return 'none';
        if (/^non|refus|rejet|reject|denie/.test(s)) return 'bad';
        if (/valid|accept|approuv/.test(s)) return 'ok';
        if (/attente|wait|pending|encours/.test(s)) return 'wait';
        return 'none';
    }

    function statusChip(v) {
        var k = normStatus(v);
        var m = STATUS_META[k];
        if (k === 'none' && String(v == null ? '' : v).trim()) {
            return '<span class="lx-p-chip st-none">' + ico(m.i) + esc(String(v).trim()) + '</span>';
        }
        return '<span class="lx-p-chip st-' + k + '">' + ico(m.i) + m.l + '</span>';
    }

    function sectTitle(icon, txt, count) {
        return '<div class="lx-p-sect lx-p-in"><span class="st-ico">' + ico(icon) + '</span><h4>' + txt +
            '</h4>' + (count != null ? '<span class="st-count">' + esc(count) + '</span>' : '') + '</div>';
    }

    function emptyLine(icon, txt) {
        return '<div class="lx-p-empty lx-p-in">' + ico(icon) + txt + '</div>';
    }

    function errorInlineSmall() {
        return emptyLine('fa-plug-circle-xmark', 'تعذر تحميل هذا الجزء');
    }

    var TABS = [
        { id: 'quitus', label: 'التبرئة', icon: 'fa-stamp' },
        { id: 'debts', label: 'الديون والغيابات', icon: 'fa-file-invoice-dollar' },
        { id: 'conges', label: 'العطل الأكاديمية', icon: 'fa-plane-departure' },
        { id: 'emploi', label: 'جدولي الرسمي', icon: 'fa-calendar-week' },
        { id: 'cards', label: 'البطاقات والطلبات', icon: 'fa-id-card-clip' },
        { id: 'banner', label: 'أخبار رسمية', icon: 'fa-bullhorn' },
    ];

    var QUITUS_ITEMS = [
        ['sit_dep', 'القسم', 'fa-door-open'],
        ['sit_bf', 'مكتبة الكلية', 'fa-book'],
        ['sit_bc', 'المكتبة المركزية', 'fa-building-columns'],
        ['sit_ru', 'الإقامة', 'fa-bed'],
        ['sit_brs', 'خدمة المنحة', 'fa-hand-holding-dollar'],
    ];

    var state = { tab: 'quitus', cache: {}, busy: false };

    // ---------------- shell ----------------

    function shellHTML() {
        var tabs = TABS.map(function (t, i) {
            return '<button class="lx-p-tab' + (i === 0 ? ' active' : '') + '" role="tab" aria-selected="' +
                (i === 0) + '" data-lx-tab="' + t.id + '">' + ico(t.icon) + '<span>' + t.label + '</span></button>';
        }).join('');
        var uniName = (typeof getProfileSubtitle === 'function') ? getProfileSubtitle() : ((typeof getUniversityName === 'function') ? getUniversityName() : 'طالب جامعي');
        return '<div class="lx-p-head lx-p-in">' +
            '<div class="lx-p-head-ic">' + ico('fa-id-badge') + '</div>' +
            '<div class="lx-p-head-tx"><h3>ملفي الشامل</h3>' +
            '<small>' + esc(uniName) + '</small></div>' +
            '<button class="lx-p-refresh" data-lx-refresh title="تحديث البيانات" aria-label="تحديث البيانات">' + ico('fa-rotate') + '</button>' +
            '</div>' +
            '<div class="lx-p-tabs" role="tablist">' + tabs + '</div>' +
            '<div class="lx-p-panel" id="lxp-panel" role="tabpanel"></div>';
    }

    function skeletonFor(tab) {
        var row = '<div class="lx-p-skel sk-row"></div>';
        var card = '<div class="lx-p-skel sk-card"></div>';
        if (tab === 'quitus') {
            return '<div class="lx-p-card"><div class="lx-p-skel sk-ring"></div>' +
                '<div class="lx-p-skels-col" style="margin-top:16px">' + row + row + '</div></div>' +
                '<div class="lx-p-qgrid">' + card + card + card + card + card + '</div>';
        }
        if (tab === 'cards') {
            return '<div class="lx-p-grid2">' + card + card + '</div>' + row + row;
        }
        return '<div class="lx-p-skels-col">' + row + row + row + row + '</div>';
    }

    function gateHTML() {
        return '<div class="lx-p-gate">' + ico('fa-lock') +
            '<strong>سجّل الدخول بحسابك في بروقرس عن طريق رقم التسجيل وكلمة المرور</strong>' +
            '<p>بمجرد تسجيل الدخول، سيتم ربط ملفك الشامل تلقائياً.</p>' +
            '<button class="lx-p-btn gold block" data-lx-goto-grades>' + ico('fa-right-to-bracket') + 'تسجيل الدخول</button></div>';
    }

    function errorHTML() {
        return '<div class="lx-p-error">' + ico('fa-triangle-exclamation') +
            '<p>تعذر جلب البيانات حالياً، تحقق من اتصالك ثم أعد المحاولة.</p>' +
            '<button class="lx-p-btn gold" data-lx-refresh>' + ico('fa-rotate') + 'إعادة المحاولة</button></div>';
    }

    // ---------------- animations ----------------

    function countUp(el, to) {
        var target = Math.max(0, Math.min(100, Number(to) || 0));
        var fmt = function (v) { return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + '%'; };
        if (rm()) { el.textContent = fmt(target); return; }
        var dur = 950, t0 = performance.now();
        var step = function (t) {
            var p = Math.min(1, (t - t0) / dur);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = fmt(target * eased);
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    function postRender(tab, panel) {
        if (tab !== 'quitus') return;
        var ring = panel.querySelector('.ring-fill');
        var num = panel.querySelector('[data-lx-count]');
        if (num && num.getAttribute('data-lx-count') !== '') countUp(num, num.getAttribute('data-lx-count'));
        if (!ring) return;
        var C = 2 * Math.PI * 56;
        var pct = parseFloat(ring.getAttribute('data-pct') || '0');
        ring.style.strokeDasharray = C.toFixed(2);
        ring.style.strokeDashoffset = C.toFixed(2);
        var target = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { ring.style.strokeDashoffset = target.toFixed(2); });
        });
    }

    // ---------------- tab ① quitus ----------------

    function loadQuitus(s) {
        return apiGet('quitus', { uuid: s.uuid }).then(function (raw) {
            var d = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
            var pct = null;
            if (d.percent != null) {
                var n = Number(d.percent);
                if (!isNaN(n)) pct = Math.max(0, Math.min(100, n));
            }
            var cards = QUITUS_ITEMS.map(function (it, i) {
                var st = normStatus(d[it[0]]);
                var m = STATUS_META[st];
                var label = (st === 'none' && String(d[it[0]] == null ? '' : d[it[0]]).trim())
                    ? esc(String(d[it[0]]).trim()) : m.l;
                return '<div class="lx-p-qcard ' + st + ' lx-p-in" style="--d:' + Math.min(i * 70, 420) + 'ms">' +
                    '<div class="qc-ico">' + ico(it[2]) + '</div>' +
                    '<span class="qc-name">' + it[1] + '</span>' +
                    '<span class="lx-p-chip st-' + st + '">' + ico(m.i) + label + '</span></div>';
            }).join('');
            return '<div class="lx-p-hero lx-p-card lx-p-in">' +
                '<div class="lx-p-ring">' +
                '<svg viewBox="0 0 132 132" aria-hidden="true">' +
                '<circle class="ring-bg" cx="66" cy="66" r="56"></circle>' +
                '<circle class="ring-fill" cx="66" cy="66" r="56" data-pct="' + (pct == null ? '' : pct) + '"></circle>' +
                '</svg>' +
                '<div class="ring-center"><span class="ring-num"' +
                (pct == null ? '>--%' : ' data-lx-count="' + pct + '">0%') +
                '</span><span class="ring-cap">نسبة التبرئة</span></div></div>' +
                '<div class="hero-side"><h3>بطاقة التبرئة الجامعية</h3>' +
                '<p>تُلخّص نسبة تصفير حساباتك لدى مختلف خدمات الجامعة.</p>' +
                '<div class="lx-p-legend">' +
                '<span><i class="dot ok"></i>مقبولة</span>' +
                '<span><i class="dot bad"></i>مرفوضة</span>' +
                '<span><i class="dot wait"></i>قيد الانتظار</span></div></div></div>' +
                '<div class="lx-p-qgrid">' + cards + '</div>' +
                '<div class="lx-p-note lx-p-in" style="--d:300ms">' + ico('fa-circle-info') +
                '<span><b>التبرئة شرط أساسي لاستلام الشهادات.</b> تأكد من تصفير جميع الخدمات قبل التخرج.</span></div>';
        });
    }

    // ---------------- tab ② debts / absences / exclusions ----------------

    function debtRow(it, i) {
        var title = pickAny(it, ['libelle', 'type', 'motif', 'designation', 'description']) || 'دين';
        var amount = pickAny(it, ['montant', 'amount', 'somme', 'valeur']);
        var cur = pickAny(it, ['devise', 'currency']) || 'دج';
        var date = fmtVal(pickAny(it, DATE_KEYS));
        var chip = (it.statut != null || it.status != null) ? statusChip(it.statut != null ? it.statut : it.status) : '';
        return '<div class="lx-p-row lx-p-in" style="--d:' + Math.min(i * 60, 420) + 'ms">' +
            '<div class="rw-main"><strong>' + esc(title) + '</strong>' +
            (date ? '<small>' + ico('fa-calendar') + '<span dir="ltr">' + date + '</span></small>' : '') + '</div>' +
            '<div class="rw-side">' + chip +
            (amount !== '' ? '<span class="lx-p-money" dir="ltr">' + esc(amount) + ' <b>' + esc(cur) + '</b></span>' : '') +
            '</div></div>';
    }

    function absRow(it) {
        var date = fmtVal(pickAny(it, DATE_KEYS));
        var time = fmtVal(pickAny(it, ['heure', 'horaire', 'creneau', 'seance']));
        var hrs = pickAny(it, ['nbHeures', 'nb_heures', 'duree', 'hours']);
        var jRaw = pickAny(it, ['justifie', 'justifiee', 'justified', 'excuse', 'excusee']);
        var just = jRaw === true || jRaw === 1 || jRaw === '1' ||
            /^(true|oui|yes)/i.test(String(jRaw).trim()) || /مبرر/.test(String(jRaw));
        var jChip = String(jRaw).trim() !== ''
            ? '<span class="lx-p-chip st-' + (just ? 'ok' : 'bad') + '">' + ico(just ? 'fa-check' : 'fa-xmark') + (just ? 'مبررة' : 'غير مبررة') + '</span>'
            : '';
        return '<div class="gr-item">' +
            '<div class="gi-date">' + (date ? ico('fa-calendar-day') + '<span dir="ltr">' + date + '</span>' : '') +
            (time ? ' <b class="gi-sep">·</b> ' + time : '') + '</div>' +
            '<div class="gi-side">' + (String(hrs).trim() !== '' ? '<span class="lx-p-chip st-none" dir="ltr">' + esc(hrs) + 'س</span>' : '') + jChip + '</div></div>';
    }

    function groupAbsences(list) {
        var map = {}, order = [];
        list.forEach(function (it) {
            var mod = pickAny(it, ['module', 'matiere', 'mcLibelleAr', 'mcLibelleFr', 'matiereLibelle', 'libelle', 'ueLibelle']);
            var key = mod ? 'm:' + String(mod).trim() : 'd:' + String(pickAny(it, DATE_KEYS)).slice(0, 7);
            if (!map[key]) { map[key] = { title: mod ? String(mod).trim() : 'حصص متنوعة', items: [] }; order.push(key); }
            map[key].items.push(it);
        });
        return order.map(function (k) { return map[k]; });
    }

    function summaryFromCounts(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
        var defs = [
            [/non[_ ]?(justif|excus)|unjust/i, 'غير مبررة', 'bad'],
            [/(justif|excus)/i, 'مبررة', 'ok'],
            [/total|all\b|nombre|count|sum/i, 'المجموع', 'total'],
        ];
        var chips = '';
        defs.forEach(function (d) {
            var ks = Object.keys(obj);
            for (var i = 0; i < ks.length; i++) {
                if (d[0].test(ks[i]) && typeof obj[ks[i]] === 'number') {
                    chips += '<div class="lx-p-sum ' + d[2] + '"><b>' + esc(obj[ks[i]]) + '</b><span>' + d[1] + '</span></div>';
                    return;
                }
            }
        });
        return chips ? '<div class="lx-p-sumrow lx-p-in" style="--d:40ms">' + chips + '</div>' : '';
    }

    function exclCard(it, i) {
        var title = pickAny(it, ['motif', 'raison', 'libelle', 'type', 'decision', 'description']) || 'استبعاد';
        var date = fmtVal(pickAny(it, DATE_KEYS));
        var duree = pickAny(it, ['duree', 'dureeJours', 'nbJours', 'periode']);
        var dec = pickAny(it, ['decision', 'statut', 'status', 'etat']);
        return '<div class="lx-p-xcard lx-p-in" style="--d:' + Math.min(i * 70, 420) + 'ms">' +
            '<div class="xc-head">' + ico('fa-triangle-exclamation') + '<strong>' + esc(title) + '</strong>' +
            (String(dec).trim() !== '' ? statusChip(dec) : '') + '</div>' +
            '<div class="xc-meta">' +
            (date ? '<span>' + ico('fa-calendar') + '<span dir="ltr">' + date + '</span></span>' : '') +
            (String(duree).trim() !== '' ? '<span>' + ico('fa-clock') + esc(duree) + '</span>' : '') +
            '</div></div>';
    }

    function loadDebts(s) {
        return Promise.allSettled([
            apiGet('dettes', { uuid: s.uuid }),
            apiGet('absences', { uuid: s.uuid }),
            apiGet('exclusions', { uuid: s.uuid }),
        ]).then(function (r) {
            function val(i) { return r[i].status === 'fulfilled' ? r[i].value : null; }
            var html = '';

            html += sectTitle('fa-file-invoice-dollar', 'الديون المالية');
            var dettes = val(0);
            if (dettes == null) html += errorInlineSmall();
            else {
                var arr = toArray(dettes);
                if (!arr.length) {
                    html += '<div class="lx-p-celebrate lx-p-in">' + ico('fa-circle-check') +
                        '<strong>لا توجد ديون</strong><small>وضعك المالي سليم تماماً</small></div>';
                } else {
                    html += '<div class="lx-p-list">' + arr.map(debtRow).join('') + '</div>';
                }
            }

            html += sectTitle('fa-user-clock', 'الغيابات');
            var abs = val(1);
            if (abs == null) html += errorInlineSmall();
            else {
                html += summaryFromCounts(abs);
                var list = toArray(abs);
                if (!list.length) html += emptyLine('fa-circle-check', 'لا توجد غيابات مسجلة');
                else {
                    html += groupAbsences(list).map(function (g, gi) {
                        return '<div class="lx-p-group lx-p-in" style="--d:' + Math.min(gi * 80, 480) + 'ms">' +
                            '<div class="gr-head"><span>' + esc(g.title) + '</span><b>' + g.items.length + '</b></div>' +
                            g.items.map(absRow).join('') + '</div>';
                    }).join('');
                }
            }

            html += sectTitle('fa-ban', 'الاستبعادات');
            var ex = val(2);
            if (ex == null) html += errorInlineSmall();
            else {
                var xl = toArray(ex);
                html += xl.length ? xl.map(exclCard).join('') : emptyLine('fa-shield-halved', 'لا توجد قرارات استبعاد');
            }
            return html;
        });
    }

    // ---------------- tab ③ congés ----------------

    function tlCard(it, i) {
        var statRaw = pickAny(it, ['statut', 'status', 'etat']);
        var st = normStatus(statRaw);
        var type = pickAny(it, ['type', 'nature', 'libelle', 'motifType']) || 'عطلة';
        var du = fmtVal(pickAny(it, ['dateDebut', 'date_debut', 'du', 'startDate', DATE_KEYS[0]]));
        var au = fmtVal(pickAny(it, ['dateFin', 'date_fin', 'au', 'endDate']));
        var motif = fmtVal(pickAny(it, ['motif', 'raison', 'commentaire', 'note']));
        return '<div class="tl-item ' + st + ' lx-p-in" style="--d:' + Math.min(i * 80, 480) + 'ms">' +
            '<div class="tl-dot"></div>' +
            '<div class="tl-card"><div class="tl-head"><strong>' + esc(type) + '</strong>' + statusChip(statRaw) + '</div>' +
            ((du || au) ? '<div class="tl-dates" dir="ltr">' + ico('fa-calendar-days') + (du || '…') + ' ← ' + (au || '…') + '</div>' : '') +
            (motif ? '<p class="tl-motif">' + motif + '</p>' : '') +
            '</div></div>';
    }

    function loadConges(s) {
        return apiGet('conges', { uuid: s.uuid }).then(function (raw) {
            var list = toArray(raw, ['conges', 'congeList', 'leaveList', 'items']);
            if (!list.length) {
                return sectTitle('fa-plane-departure', 'العطل الأكاديمية') +
                    emptyLine('fa-mug-hot', 'لا توجد عطل أكاديمية مسجلة بعد');
            }
            var okN = 0, badN = 0;
            list.forEach(function (it) {
                var st = normStatus(pickAny(it, ['statut', 'status', 'etat']));
                if (st === 'ok') okN++;
                if (st === 'bad') badN++;
            });
            return sectTitle('fa-plane-departure', 'العطل الأكاديمية', list.length) +
                '<div class="lx-p-sumrow lx-p-in" style="--d:40ms">' +
                '<div class="lx-p-sum total"><b>' + list.length + '</b><span>المجموع</span></div>' +
                '<div class="lx-p-sum ok"><b>' + okN + '</b><span>مقبولة</span></div>' +
                '<div class="lx-p-sum bad"><b>' + badN + '</b><span>غير مقبولة</span></div>' +
                '</div>' +
                '<div class="lx-p-timeline">' + list.map(tlCard).join('') + '</div>';
        });
    }

    // ---------------- tab ④ emploi ----------------

    var DAY_ALIASES = [
        [/^(0|sun|dim|dimanche|ahad|احد|أحد|الأحد)$/, 'الأحد'],
        [/^(1|mon|lun|lundi|ithnayn|اثنين|الاثنين|الإثنين)$/, 'الاثنين'],
        [/^(2|tue|mar|mardi|thulatha|ثلاثاء|الثلاثاء)$/, 'الثلاثاء'],
        [/^(3|wed|mer|mercredi|arbiaa|أربعاء|الأربعاء)$/, 'الأربعاء'],
        [/^(4|thu|jeu|jeudi|khamees|خميس|الخميس)$/, 'الخميس'],
        [/^(5|fri|ven|vendredi|joumaa|جمعة|الجمعة)$/, 'الجمعة'],
        [/^(6|sat|sam|samedi|sabt|سبت|السبت)$/, 'السبت'],
    ];

    function dayInfo(v) {
        var s = String(v == null ? '' : v).trim().toLowerCase();
        for (var i = 0; i < DAY_ALIASES.length; i++) {
            if (DAY_ALIASES[i][0].test(s)) return { idx: i, label: DAY_ALIASES[i][1] };
        }
        return { idx: 99, label: String(v == null ? '' : v).trim() || 'أيام' };
    }

    function unwrapToRows(raw) {
        var node = raw, guard = 0;
        while (node && typeof node === 'object' && !Array.isArray(node) && guard++ < 4) {
            var ks = Object.keys(node), hit = null;
            for (var i = 0; i < ks.length; i++) {
                if (/^(data|emploi|timetable|planning|schedule|items|result|rows|list)$/i.test(ks[i]) && node[ks[i]] != null) { hit = ks[i]; break; }
            }
            if (!hit) {
                for (var j = 0; j < ks.length; j++) {
                    if (Array.isArray(node[ks[j]]) && node[ks[j]].length && node[ks[j]].every(function (x) { return x && typeof x === 'object'; })) { hit = ks[j]; break; }
                }
            }
            if (!hit) break;
            node = node[hit];
        }
        if (Array.isArray(node)) return node.filter(function (x) { return x && typeof x === 'object'; });
        return null;
    }

    function kvBlock(raw) {
        if (raw == null) return emptyLine('fa-inbox', 'لا توجد بيانات');
        if (typeof raw !== 'object') return '<pre class="kv-pre">' + esc(JSON.stringify(raw, null, 2)) + '</pre>';
        return Object.keys(raw).map(function (k) {
            var v = raw[k];
            if (v != null && typeof v === 'object') {
                return '<div class="kv-row"><b>' + esc(k) + '</b></div><pre class="kv-pre">' + esc(JSON.stringify(v, null, 2)) + '</pre>';
            }
            return '<div class="kv-row"><b>' + esc(k) + '</b><span>' + esc(v) + '</span></div>';
        }).join('');
    }

    function slotCard(e, i) {
        var range = e.time ? (e.end ? esc(e.time) + ' – ' + esc(e.end) : esc(e.time)) : '';
        return '<div class="lx-p-slot lx-p-in" style="--d:' + Math.min(i * 70, 480) + 'ms">' +
            (range ? '<span class="sl-time">' + ico('fa-clock') + range + '</span>' : '') +
            '<div class="sl-body"><strong>' + esc(e.module || 'حصة دراسية') + '</strong>' +
            '<div class="sl-meta">' +
            (e.salle ? '<span class="lx-p-chip st-none">' + ico('fa-location-dot') + esc(e.salle) + '</span>' : '') +
            (e.seance ? '<span class="lx-p-chip goldc">' + esc(e.seance) + '</span>' : '') +
            (e.prof ? '<span class="prof">' + ico('fa-user-tie') + ' ' + esc(e.prof) + '</span>' : '') +
            '</div></div></div>';
    }

    function loadEmploi(s) {
        var params = { uuid: s.uuid };
        if (s.dia) params.dia = s.dia;
        return apiGet('emploi', params).then(function (raw) {
            var rows = unwrapToRows(raw);
            if (rows === null) {
                return sectTitle('fa-calendar-week', 'جدولي الرسمي') +
                    '<div class="lx-p-card lx-p-kv lx-p-in" style="--d:60ms"><p class="kv-hint">تعذر التعرف على شكل بيانات الجدول — عرض خام:</p>' +
                    kvBlock(raw) + '</div>';
            }
            var entries = rows.map(function (o) {
                return {
                    day: dayInfo(pickAny(o, ['jour', 'day', 'jourSemaine', 'dayName', 'leJour'])),
                    time: String(pickAny(o, ['heure', 'horaire', 'heureDebut', 'hDebut', 'time', 'startHeure', 'debut'])).trim(),
                    end: String(pickAny(o, ['heureFin', 'hFin', 'endTime', 'fin'])).trim(),
                    module: String(pickAny(o, ['module', 'matiere', 'libelle', 'intitule', 'subject', 'designation', 'nom'])).trim(),
                    salle: String(pickAny(o, ['salle', 'room', 'local', 'site', 'emplacement'])).trim(),
                    seance: String(pickAny(o, ['seance', 'typeSeance', 'nature'])).trim(),
                    prof: String(pickAny(o, ['enseignant', 'prof', 'professeur'])).trim(),
                };
            }).filter(function (e) { return e.module || e.time || e.salle; });

            if (!entries.length) {
                return sectTitle('fa-calendar-week', 'جدولي الرسمي') + emptyLine('fa-calendar-xmark', 'لا توجد حصص مسجلة في الجدول الرسمي');
            }
            var groups = {}, order = [];
            entries.forEach(function (e) {
                var k = e.day.label;
                if (!groups[k]) { groups[k] = { idx: e.day.idx, list: [] }; order.push(k); }
                groups[k].list.push(e);
            });
            order.sort(function (a, b) { return groups[a].idx - groups[b].idx || a.localeCompare(b, 'ar'); });
            return sectTitle('fa-calendar-week', 'جدولي الرسمي', entries.length) + order.map(function (k) {
                var g = groups[k];
                g.list.sort(function (a, b) { return String(a.time).localeCompare(String(b.time), 'en', { numeric: true }); });
                return '<div class="lx-p-dayhead lx-p-in"><span class="dh-badge">' + ico('fa-calendar-day') + '</span>' +
                    esc(k) + '<b>' + g.list.length + ' حصة</b></div>' +
                    '<div class="lx-p-slots">' + g.list.map(slotCard).join('') + '</div>';
            }).join('');
        });
    }

    // ---------------- tab ⑤ cards & requests ----------------

    function miniTitle(icon, txt) {
        return '<div class="mn-title">' + ico(icon) + txt + '</div>';
    }

    function mnRow(label, valueHtml) {
        return '<div class="mn-row"><span>' + label + '</span><b>' + valueHtml + '</b></div>';
    }

    function loadCards(s) {
        var sp = { uuid: s.uuid };
        if (s.dia) sp.dia = s.dia;
        return Promise.allSettled([
            apiGet('setram', sp),
            apiGet('transport', sp),
            apiGet('hebergement', { uuid: s.uuid }),
        ]).then(function (r) {

            var setramHtml = sectTitle('fa-bus', 'بطاقة النقل (SETRAM)');
            if (r[0].status === 'fulfilled' && r[0].value) {
                var sd = r[0].value;
                var exp = fmtVal(pickAny(sd, ['dateExpiration', 'date_expiration', 'expiration', 'expireLe', 'validite', 'dateValidite']));
                var qr = String(pickAny(sd, ['qr', 'qrCode', 'codeQr', 'codeQR', 'qrValue', 'valeurQR', 'numeroCarte', 'code'])).trim();
                setramHtml += '<div class="lx-p-setram lx-p-in" style="--d:40ms">' +
                    '<div class="sr-head"><span>' + ico('fa-bus-simple') + ' SETRAM · بطاقة النقل</span>' + ico('fa-signal') + '</div>' +
                    (exp ? '<div class="sr-exp">' + ico('fa-calendar-check') + 'صالحة إلى: <b>' + exp + '</b></div>' : '') +
                    (qr ? '<div class="sr-qr"><img alt="QR" loading="lazy" src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=0&data=' +
                        encodeURIComponent(qr) + '" onerror="this.style.display=\'none\'"><code>' + esc(qr) + '</code></div>' : '') +
                    (!exp && !qr ? '<div class="sr-exp">لا توجد معطيات بطاقة بعد</div>' : '') +
                    '</div>';
            } else {
                setramHtml += emptyLine('fa-circle-info', 'معطيات بطاقة SETRAM غير متوفرة');
            }

            var transHtml = sectTitle('fa-ticket-simple', 'طلب النقل الجامعي');
            if (r[1].status === 'fulfilled' && r[1].value != null && r[1].value !== '') {
                var td = r[1].value;
                transHtml += '<div class="lx-p-mini lx-p-in" style="--d:80ms">';
                if (td && typeof td === 'object' && !Array.isArray(td)) {
                    var tDate = fmtVal(pickAny(td, DATE_KEYS.concat(['dateDemande'])));
                    var tType = fmtVal(pickAny(td, ['typeDemande', 'type', 'libelle']));
                    transHtml += miniTitle('fa-route', 'حالة الطلب') +
                        mnRow('النوع', tType || '—') +
                        (tDate ? mnRow('تاريخ الطلب', '<span dir="ltr">' + tDate + '</span>') : '') +
                        mnRow('الحالة', statusChip(pickAny(td, ['statut', 'status', 'etat'])));
                } else {
                    transHtml += mnRow('الحالة', statusChip(td));
                }
                transHtml += '</div>';
            } else {
                transHtml += emptyLine('fa-circle-info', 'لا يوجد طلب نقل مسجل');
            }

            var hebHtml = sectTitle('fa-building-columns', 'الإقامة الجامعية');
            if (r[2].status === 'fulfilled' && r[2].value != null && r[2].value !== '') {
                var hd = r[2].value;
                var isObj = hd && typeof hd === 'object';
                var hid = isObj ? pickAny(hd, ['residenceId', 'residence_id', 'idResidence', 'id']) : hd;
                var hname = isObj ? String(pickAny(hd, ['residenceName', 'residenceNomAr', 'nomResidence', 'residenceAr', 'residence', 'libelle'])).trim() : '';
                var pav = isObj ? String(pickAny(hd, ['pavillon', 'pav', 'pavNum'])).replace(/^pav[-_]?/i, '').trim() : '';
                var room = isObj ? String(pickAny(hd, ['chambre', 'room', 'numChambre'])).trim() : '';
                var affect = (pav || room) ? ('pav-' + (pav || '—') + (room ? ' · ' + room : '')) : '';
                hebHtml += '<div class="lx-p-mini lx-p-in" style="--d:120ms">' + miniTitle('fa-bed', 'سكنك الحالي') +
                    mnRow('الإقامة', hname ? esc(hname) : '—') +
                    (affect ? mnRow('التخصيص', '<span dir="ltr" class="aff">' + esc(affect) + '</span>') : '') +
                    '<button type="button" class="lx-p-cta" data-lx-renew="' + esc(hid) + '"' +
                    (String(hid).trim() === '' ? ' disabled title="لا يوجد رقم إقامة مرتبط"' : '') + '>' +
                    ico('fa-rotate') + 'تجديد الإقامة</button></div>';
            } else {
                hebHtml += emptyLine('fa-house-circle-check', 'لا يوجد سكن جامعي مرتبط بحسابك');
            }

            return setramHtml + '<div class="lx-p-grid2">' +
                '<div class="lx-p-colwrap">' + transHtml + '</div>' +
                '<div class="lx-p-colwrap">' + hebHtml + '</div></div>' + recoursFormHTML();
        });
    }

    function recoursFormHTML() {
        return '<div class="lx-p-sect lx-p-in"><span class="st-ico">' + ico('fa-scale-balanced') + '</span><h4>طلب اعتراض (Recours)</h4></div>' +
            '<form id="lxp-recours" class="lx-p-card lx-p-form lx-p-in">' +
            '<div class="fld"><label>نوع النقطة المعنية</label><div class="seg">' +
            '<label class="seg-opt"><input type="radio" name="kind" value="exam" checked><span>' + ico('fa-file-pen') + 'امتحان</span></label>' +
            '<label class="seg-opt"><input type="radio" name="kind" value="cc"><span>' + ico('fa-pen-ruler') + 'تقييم مستمر</span></label>' +
            '</div></div>' +
            '<div class="fld"><label for="lxp-mcid">رقم المادة (MC ID)</label>' +
            '<input id="lxp-mcid" class="lx-p-input" type="number" name="mcId" inputmode="numeric" min="1" step="1" placeholder="مثال: 12345" required></div>' +
            '<div class="fld"><label>سبب الاعتراض</label><div class="motifs">' +
            '<label class="mot"><input type="radio" name="motif" value="1" required><span><b>1</b> — عدم ظهور النقطة</span></label>' +
            '<label class="mot"><input type="radio" name="motif" value="2"><span><b>2</b> — خطأ في الرصد</span></label>' +
            '</div></div>' +
            '<button type="submit" class="lx-p-btn gold block">' + ico('fa-paper-plane') + 'إرسال الطلب</button>' +
            '</form>';
    }

    function upstreamMsg(resp, fallback) {
        var m = resp && typeof resp === 'object' ? (resp.message || resp.msg || resp.detail || resp.intitule) : null;
        return esc(m || fallback);
    }

    function errMsg(err, fallback) {
        var m = err && err.data && typeof err.data === 'object' ? (err.data.error || err.data.message || err.data.detail) : null;
        if (!m && err && err.message && err.message.indexOf('http-') !== 0) m = err.message;
        return esc(m || fallback);
    }

    function submitRecours(form) {
        var sess = getSession();
        if (!sess) { showToast('انتهت الجلسة، أعد تسجيل الدخول إلى نقاطي', 'error'); return; }
        var fd = new FormData(form);
        var mcId = parseInt(fd.get('mcId'), 10);
        var motif = parseInt(fd.get('motif'), 10);
        var kindEl = form.querySelector('input[name="kind"]:checked');
        if (!mcId || mcId < 1) { showToast('أدخل رقم المادة (MC ID) بشكل صحيح', 'error'); return; }
        if (motif !== 1 && motif !== 2) { showToast('اختر سبب الاعتراض', 'error'); return; }
        var btn = form.querySelector('[type="submit"]');
        var orig = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = SPIN + ' جاري الإرسال...';
        var body = { uuid: sess.uuid, kind: kindEl ? kindEl.value : 'exam', mcId: mcId, motif: motif };
        if (sess.dia) body.dia = sess.dia;
        apiPost('recours', body).then(function (resp) {
            showToast(upstreamMsg(resp, 'تم إرسال طلب الاعتراض بنجاح'), 'success');
            form.reset();
        }).catch(function (err) {
            showToast(errMsg(err, 'تعذر إرسال الطلب، حاول لاحقاً'), 'error');
        }).finally(function () {
            btn.disabled = false;
            btn.innerHTML = orig;
        });
    }

    function onRenew(btn) {
        var sess = getSession();
        if (!sess) { showToast('انتهت الجلسة، أعد تسجيل الدخول إلى نقاطي', 'error'); return; }
        var rid = btn.getAttribute('data-lx-renew');
        confirmModal({
            icon: 'fa-bed',
            title: 'تجديد الإقامة',
            body: 'سيتم إرسال طلب تجديد الإقامة الجامعية إلى خدمات السكن. هل تريد المتابعة؟',
            confirmText: 'إرسال الطلب',
            onConfirm: function (close) {
                var orig = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = SPIN + ' جاري الإرسال...';
                apiPost('hebergement-renew', { uuid: sess.uuid, residenceId: rid }).then(function (resp) {
                    showToast(upstreamMsg(resp, 'تم إرسال طلب تجديد الإقامة بنجاح'), 'success');
                    close();
                    delete state.cache.cards;
                    if (state.tab === 'cards') renderPanel(true);
                }).catch(function (err) {
                    showToast(errMsg(err, 'تعذر إرسال طلب التجديد، حاول لاحقاً'), 'error');
                    btn.disabled = false;
                    btn.innerHTML = orig;
                });
            },
        });
    }

    function confirmModal(opts) {
        var ov = document.createElement('div');
        ov.className = 'lx-p-modal';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.innerHTML = '<div class="lx-p-modal-card">' +
            '<div class="m-icon">' + ico(opts.icon || 'fa-circle-question') + '</div>' +
            '<h5>' + esc(opts.title || 'تأكيد') + '</h5>' +
            '<p>' + esc(opts.body || '') + '</p>' +
            '<div class="m-actions">' +
            '<button type="button" class="lx-p-btn" data-m-cancel>إلغاء</button>' +
            '<button type="button" class="lx-p-btn gold" data-m-ok>' + esc(opts.confirmText || 'تأكيد') + '</button>' +
            '</div></div>';
        document.body.appendChild(ov);
        requestAnimationFrame(function () { ov.classList.add('open'); });
        function close() {
            ov.classList.remove('open');
            document.removeEventListener('keydown', onEsc);
            setTimeout(function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }, rm() ? 0 : 220);
        }
        function onEsc(ev) { if (ev.key === 'Escape') close(); }
        document.addEventListener('keydown', onEsc);
        ov.addEventListener('click', function (e) {
            if (e.target === ov || e.target.closest('[data-m-cancel]')) close();
            else if (e.target.closest('[data-m-ok]')) {
                if (opts.onConfirm) opts.onConfirm(close);
                else close();
            }
        });
    }

    // ---------------- tab ⑥ banner ----------------

    function bannerCard(it, i) {
        var title = pickAny(it, ['titre', 'title', 'sujet', 'objet']) || 'إعلان رسمي';
        var body = fmtVal(pickAny(it, ['contenu', 'texte', 'message', 'description', 'body']));
        var date = fmtVal(pickAny(it, DATE_KEYS));
        return '<article class="lx-p-bcard lx-p-in" style="--d:' + Math.min(i * 70, 480) + 'ms">' +
            '<div class="bc-head">' + ico('fa-bullhorn') + '<strong>' + esc(title) + '</strong>' +
            (date ? '<time dir="ltr">' + date + '</time>' : '') + '</div>' +
            (body ? '<p>' + body + '</p>' : '') +
            '</article>';
    }

    function loadBanner(s) {
        return apiGet('banner', { uuid: s.uuid }).then(function (raw) {
            var list = toArray(raw, ['banners', 'news', 'annonces', 'items']);
            if (!list.length) return emptyLine('fa-envelope-open', 'لا توجد أخبار أو إعلانات رسمية حالياً');
            return sectTitle('fa-bullhorn', 'أخبار رسمية', list.length) +
                '<div class="lx-p-blist">' + list.map(bannerCard).join('') + '</div>';
        });
    }

    // ---------------- panel lifecycle ----------------

    var LOADERS = { quitus: loadQuitus, debts: loadDebts, conges: loadConges, emploi: loadEmploi, cards: loadCards, banner: loadBanner };

    function setBusy(on) {
        state.busy = on;
        var root = document.getElementById('lxp-root');
        if (root) root.classList.toggle('busy', !!on);
    }

    function renderPanel(force) {
        var panel = document.getElementById('lxp-panel');
        if (!panel || state.busy) return;
        var sess = getSession();
        if (!sess) { panel.innerHTML = gateHTML(); return; }
        var key = state.tab;
        if (!force && state.cache[key]) {
            panel.innerHTML = state.cache[key];
            postRender(key, panel);
            return;
        }
        setBusy(true);
        panel.innerHTML = skeletonFor(key);
        LOADERS[key](sess).then(function (html) {
            state.cache[key] = html;
            if (state.tab === key) {
                panel.innerHTML = html;
                postRender(key, panel);
            }
        }).catch(function () {
            if (state.tab === key) panel.innerHTML = errorHTML();
        }).finally(function () {
            setBusy(false);
        });
    }

    function activateTab(id, btn) {
        if (!LOADERS[id]) return;
        state.tab = id;
        var tabs = document.querySelectorAll('#lxp-root .lx-p-tab');
        tabs.forEach(function (t) {
            var on = t.getAttribute('data-lx-tab') === id;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        if (btn && btn.scrollIntoView) {
            try { btn.scrollIntoView({ behavior: rm() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' }); } catch (e) { }
        }
        renderPanel(false);
    }

    function refreshTab() {
        delete state.cache[state.tab];
        renderPanel(true);
    }

    function mount(container) {
        if (!container) return;
        container.innerHTML = '<div class="lx-p-root" id="lxp-root">' + shellHTML() + '</div>';
        bindEvents(container);
        renderPanel(false);
    }

    function bindEvents(container) {
        if (container.dataset.lxpBound) return;
        container.dataset.lxpBound = '1';

        container.addEventListener('click', function (e) {
            var el = e.target.closest('[data-lx-tab],[data-lx-refresh],[data-lx-renew],[data-lx-goto-grades]');
            if (!el) return;
            if (el.hasAttribute('data-lx-tab')) { activateTab(el.getAttribute('data-lx-tab'), el); return; }
            if (el.hasAttribute('data-lx-refresh')) { refreshTab(); return; }
            if (el.hasAttribute('data-lx-renew')) {
                if (typeof showToast === 'function') showToast('بانتظار التأكيد...', 'info');
                onRenew(el);
                return;
            }
            if (el.hasAttribute('data-lx-goto-grades')) {
                if (typeof switchSection === 'function') switchSection('grades');
            }
        });

        container.addEventListener('submit', function (e) {
            if (e.target && e.target.id === 'lxp-recours') {
                e.preventDefault();
                submitRecours(e.target);
            }
        });
    }

    window.PortalSections = window.PortalSections || [];
    window.PortalSections.push({
        id: 'profile360',
        title: 'ملفي الشامل',
        icon: 'fa-id-badge',
        mount: mount,
    });
})();
