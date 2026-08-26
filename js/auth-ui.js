/* ============================================================
   AUTH-UI.JS — Password toggle + Modal helpers
   ============================================================ */
(function () {
    'use strict';

    /* ---- PASSWORD TOGGLE ---- */
    function initPasswordToggles() {
        document.querySelectorAll('.pw-toggle').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var wrap = btn.closest('.pw-wrap');
                if (!wrap) return;
                var input = wrap.querySelector('input');
                var icon = btn.querySelector('i');
                if (!input || !icon) return;
                if (input.type === 'password') {
                    input.type = 'text';
                    icon.className = 'fas fa-eye-slash';
                } else {
                    input.type = 'password';
                    icon.className = 'fas fa-eye';
                }
            });
        });
    }

    /* ---- BUTTON LOADING STATE ---- */
    window.setBtnLoading = function (btn, loading, html) {
        if (!btn) return;
        if (loading) {
            btn.classList.add('loading');
            btn.disabled = true;
            if (html) btn.innerHTML = html;
        } else {
            btn.classList.remove('loading');
            btn.disabled = false;
            if (html) btn.innerHTML = html;
        }
    };

    /* ---- MODAL SHAKE ---- */
    window.shakeModal = function (modalId) {
        var card = document.querySelector('#' + modalId + ' .modal-card');
        if (!card) return;
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        setTimeout(function () { card.classList.remove('shake'); }, 400);
    };

    /* ---- INIT ---- */
    document.addEventListener('DOMContentLoaded', initPasswordToggles);
})();
