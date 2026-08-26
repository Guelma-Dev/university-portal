/* ============================================================
   AUTH-UI.JS — Dark Luxury UI Enhancements
   Gold dust particles · Password toggle · Micro-interactions
   ============================================================ */
(function () {
    'use strict';

    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---- GOLD DUST PARTICLES ---- */
    function initParticles() {
        if (REDUCED) return;
        const landing = document.getElementById('landing-page');
        if (!landing) return;
        const bg = landing.querySelector('.landing-bg');
        if (!bg) return;

        const canvas = document.createElement('canvas');
        canvas.id = 'auth-particles';
        bg.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        let W, H;
        const PARTICLE_COUNT = 55;
        const particles = [];

        function resize() {
            W = canvas.width = bg.offsetWidth;
            H = canvas.height = bg.offsetHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        function spawn() {
            return {
                x: Math.random() * W,
                y: H + Math.random() * 40,
                r: Math.random() * 1.8 + 0.6,
                vy: -(Math.random() * 0.35 + 0.12),
                vx: (Math.random() - 0.5) * 0.2,
                alpha: Math.random() * 0.4 + 0.15,
                hue: Math.random() * 30 + 35,
            };
        }
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const p = spawn();
            p.y = Math.random() * H;
            particles.push(p);
        }

        function frame() {
            ctx.clearRect(0, 0, W, H);
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                p.x += p.vx;
                p.y += p.vy;
                if (p.y < -10 || p.x < -10 || p.x > W + 10) {
                    particles[i] = spawn();
                    continue;
                }
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${p.hue}, 70%, 55%, ${p.alpha})`;
                ctx.fill();
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

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

    /* ---- BUTTON LOADING STATE HELPER ---- */
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

    /* ---- MODAL SHAKE ON ERROR ---- */
    window.shakeModal = function (modalId) {
        var card = document.querySelector('#' + modalId + ' .modal-card');
        if (!card) return;
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        setTimeout(function () { card.classList.remove('shake'); }, 500);
    };

    /* ---- INIT ---- */
    document.addEventListener('DOMContentLoaded', function () {
        initParticles();
        initPasswordToggles();
    });
})();
