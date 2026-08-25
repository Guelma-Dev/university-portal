// ==== محمّل الأقسام الحديثة (النقل/الوجبات/الملف الشامل) ====
(function () {
    window.getOnouSession = window.getOnouSession || function () {
        try {
            const s = (typeof getProgresSession === 'function' && getProgresSession()) || {};
            const dia = s.selectedCard || s.idCardYear || (s.cards && s.cards[0] && (s.cards[0].id || s.cards[0])) || '';
            return { uuid: s.uuid || '', dia: String(dia || '') };
        } catch (e) { return { uuid: '', dia: '' }; }
    };

    function ensureSection(id) {
        let el = document.getElementById('section-' + id);
        if (!el && document.getElementById('app-main')) {
            el = document.createElement('section');
            el.id = 'section-' + id;
            el.className = 'section';
            document.getElementById('app-main').appendChild(el);
        }
        return el;
    }

    function mountEntry(e, force) {
        const el = ensureSection(e.id);
        if (!el) return;
        if (force || !el.dataset.mounted) {
            try { e.mount(el); el.dataset.mounted = '1'; }
            catch (err) { console.error('[lx] mount ' + e.id, err); }
        }
    }

    function boot() {
        const list = window.PortalSections || [];
        list.forEach((e) => {
            if (typeof VALID_SECTIONS !== 'undefined' && !VALID_SECTIONS.includes(e.id)) VALID_SECTIONS.push(e.id);
            ensureSection(e.id);
        });
        if (typeof navigateToSection === 'function' && !navigateToSection.__lxPatched) {
            const orig = navigateToSection;
            window.navigateToSection = function (sec) {
                const r = orig.apply(this, arguments);
                const entry = (window.PortalSections || []).find((x) => x.id === sec);
                if (entry) setTimeout(() => mountEntry(entry, true), 30);
                return r;
            };
            navigateToSection.__lxPatched = true;
        }
    }

    if (document.readyState !== 'loading') boot();
    else document.addEventListener('DOMContentLoaded', boot);
})();
