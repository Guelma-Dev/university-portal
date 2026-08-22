// ============================================
// APP STATE & DATA
// ============================================
const APP_STATE = {
    role: null, // 'guest', 'student', or 'admin'
    theme: localStorage.getItem('theme') || 'light',
    currentSection: 'library',
    currentSubject: null,
    currentDetailTab: 'lectures',
    searchQuery: '',
};

// Telegram config (saved in localStorage)
let telegramConfig = JSON.parse(localStorage.getItem('tg_config') || '{}');

// Auth state for password reset flow
let authFlow = { email: '', resetToken: '', otpEmail: '' };

// Visits counter
let visits = parseInt(localStorage.getItem('visits') || '0');
visits++;
localStorage.setItem('visits', visits.toString());

// ============================================
// SUBJECTS DATA - loaded from backend API
// ============================================
const API_BASE = window.location.origin;
let subjects = [];

// ============================================
// AUTH - JWT token helpers
// ============================================
function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('admin_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
}

async function verifyAuth() {
    const token = localStorage.getItem('admin_token');
    if (!token) return false;
    try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        return res.ok;
    } catch (e) {
        return false;
    }
}

function handleAuthError() {
    localStorage.removeItem('admin_token');
    APP_STATE.role = 'student';
    document.getElementById('admin-nav-item').style.display = 'none';
    document.getElementById('user-badge').innerHTML = '<i class="fas fa-user-graduate"></i><span>طالب</span>';
    showToast('انتهت الجلسة، يرجى تسجيل الدخول مجدداً', 'error');
}

// ============================================
// LOAD DATA FROM BACKEND API
// ============================================
async function loadSubjectsFromAPI() {
    try {
        const headers = {};
        const token = localStorage.getItem('admin_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/subjects`, { headers });
        if (res.ok) {
            subjects = await res.json();
        } else if (res.status === 401) {
            subjects = [];
        }
    } catch (e) {
        console.warn('API not available, using empty subjects');
    }
}

// ============================================
// EXAMS DATA - loaded from backend API
// ============================================
let examsData = { sem1: [], sem2: [] };

async function loadExams() {
    const token = localStorage.getItem('admin_token');
    const endpoint = token ? '/api/exams' : '/api/guest/exams';
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    await Promise.all(['sem1', 'sem2'].map(async (sem) => {
        try {
            const res = await fetch(`${API_BASE}${endpoint}?semester=${sem}`, { headers });
            examsData[sem] = res.ok ? await res.json() : [];
        } catch (e) {
            examsData[sem] = [];
        }
        renderExams(sem);
    }));
}

function renderExams(sem) {
    const container = document.getElementById(`exam-${sem}`);
    if (!container) return;
    const list = examsData[sem] || [];
    if (list.length === 0) {
        container.innerHTML = `
            <div class="no-results" style="border: 1px dashed var(--border); border-radius: var(--radius-md); padding: 48px 20px;">
                <i class="fas fa-calendar-xmark"></i>
                <p>لا توجد تواريخ امتحانات متوفرة حالياً</p>
                <p style="font-size: 0.85rem; font-weight: 400; opacity: 0.7;">سيتم إعلان جدول الامتحانات قريباً</p>
            </div>`;
        return;
    }
    const rows = list.map(ex => {
        const subject = ex.subject || ex.subject_name || ex.module || '';
        const date = ex.date || ex.exam_date || '';
        const time = ex.time || ex.start_time || '';
        const place = ex.place || ex.location || ex.room || '';
        return `<tr>
            <td>${subject}</td>
            <td>${date}</td>
            <td>${time}</td>
            <td>${place}</td>
        </tr>`;
    }).join('');
    container.innerHTML = `
        <table class="exam-table">
            <thead>
                <tr>
                    <th>المادة</th>
                    <th>التاريخ</th>
                    <th>الوقت</th>
                    <th>المكان</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

// ============================================
// VISIT TRACKING - once per session
// ============================================
async function trackVisit() {
    if (sessionStorage.getItem('visit_tracked')) return;
    sessionStorage.setItem('visit_tracked', '1');
    try {
        await fetch(`${API_BASE}/api/visit`, { method: 'POST' });
    } catch (e) {
        console.warn('Visit tracking failed');
    }
}

// ============================================
// SCHEDULE - loaded from backend API
// ============================================
async function loadScheduleFromAPI() {
    try {
        const res = await fetch(`${API_BASE}/api/schedule`);
        if (res.ok) {
            schedule = await res.json();
        }
    } catch (e) {
        console.warn('Failed to load schedule from API');
    }
}

async function saveScheduleToAPI() {
    try {
        const res = await fetch(`${API_BASE}/api/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedule }),
        });
        return res.ok;
    } catch (e) {
        console.warn('Failed to save schedule to API');
        return false;
    }
}

// ============================================
// SCHEDULE DATA
// ============================================
const TIME_SLOTS = [
    '08:00 - 09:30',
    '09:30 - 11:00',
    '11:00 - 12:30',
    '14:00 - 15:30',
    '15:30 - 17:00',
];

// Empty schedule - loaded from API
let schedule = {};

// ============================================
// PDF VIEWER STATE
// ============================================
let pdfDoc = null;
let pdfPageNum = 1;
let pdfScale = 1.5;
let pdfRendering = false;
let pdfPagePending = null;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    applyTheme(APP_STATE.theme);
    await Promise.all([loadSubjectsFromAPI(), loadScheduleFromAPI()]);
    renderSubjects();
    renderSchedule();
    renderAdminSubjects();
    renderScheduleEditor();
    updateStats();
    initSidebarOverlay();
    renderCalcModules('sem1');
    renderCalcModules('sem2');
    loadExams();
    trackVisit();

    const token = localStorage.getItem('admin_token');
    const role = localStorage.getItem('user_role');

    if (token) {
        try {
            const res = await fetch(`${API_BASE}/api/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                APP_STATE.role = data.role || role || 'student';
                localStorage.setItem('user_role', APP_STATE.role);
                localStorage.setItem('user_name', data.username || localStorage.getItem('user_name') || '');
                document.getElementById('landing-page').classList.add('hidden');
                document.getElementById('main-app').classList.remove('hidden');
                document.getElementById('logout-btn').style.display = 'flex';
                if (APP_STATE.role === 'admin') {
                    document.getElementById('admin-nav-item').style.display = 'flex';
                    document.getElementById('user-badge').innerHTML = '<i class="fas fa-shield-halved"></i><span>مسؤول</span>';
                } else {
                    document.getElementById('admin-nav-item').style.display = 'none';
                    const uname = localStorage.getItem('user_name') || 'طالب';
                    document.getElementById('user-badge').innerHTML = `<i class="fas fa-user-graduate"></i><span>${uname}</span>`;
                }
                applyInitialRoute();
                return;
            }
        } catch (e) { /* token invalid */ }
        localStorage.removeItem('admin_token');
        localStorage.removeItem('user_role');
        localStorage.removeItem('user_name');
    }

    // No valid token - show landing page
    APP_STATE.role = 'guest';
    document.getElementById('landing-page').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');
});

// ============================================
// THEME SYSTEM
// ============================================
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    APP_STATE.theme = theme;
    localStorage.setItem('theme', theme);
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (icon && text) {
        if (theme === 'dark') {
            icon.className = 'fas fa-sun';
            text.textContent = 'الوضع النهاري';
        } else {
            icon.className = 'fas fa-moon';
            text.textContent = 'الوضع الليلي';
        }
    }
}

function toggleTheme() {
    const newTheme = APP_STATE.theme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
}

// ============================================
// AUTHENTICATION
// ============================================
function enterAsStudent() {
    APP_STATE.role = 'guest';
    localStorage.setItem('user_role', 'guest');
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('admin-nav-item').style.display = 'none';
    document.getElementById('logout-btn').style.display = 'none';
    document.getElementById('user-badge').innerHTML = '<i class="fas fa-eye"></i><span>ضيف</span>';
    showToast('مرحباً بك في المنصة (وضع الضيف)', 'info');
    applyInitialRoute();
}

function showAdminLogin() {
    closeAllModals();
    document.getElementById('admin-login-modal').classList.remove('hidden');
}

function closeAdminModal() {
    document.getElementById('admin-login-modal').classList.add('hidden');
    document.getElementById('admin-username').value = '';
    document.getElementById('admin-password').value = '';
}

// ============================================
// AUTH MODAL MANAGEMENT
// ============================================
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    ['login-email', 'login-password', 'reg-email', 'reg-username', 'reg-password', 'reg-password-confirm', 'forgot-email', 'otp-code', 'new-password', 'new-password-confirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function showStudentLogin() {
    closeAllModals();
    document.getElementById('student-login-modal').classList.remove('hidden');
}

function showStudentRegister() {
    closeAllModals();
    document.getElementById('student-register-modal').classList.remove('hidden');
}

function showForgotPassword() {
    closeAllModals();
    document.getElementById('forgot-password-modal').classList.remove('hidden');
}

function showOtpModal() {
    closeAllModals();
    document.getElementById('otp-modal').classList.remove('hidden');
}

function showResetPasswordModal() {
    closeAllModals();
    document.getElementById('reset-password-modal').classList.remove('hidden');
}

// ============================================
// STUDENT AUTH - Login, Register, Forgot Password
// ============================================
async function handleStudentLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'login_failed');
        localStorage.setItem('admin_token', data.token);
        localStorage.setItem('user_role', data.role);
        localStorage.setItem('user_name', data.username);
        closeAllModals();
        if (data.role === 'admin') {
            enterAdminSession(false);
        } else {
            enterStudentSession(data.username);
        }
    } catch (err) {
        showToast(
            err.message === 'login_failed' ? 'بيانات الدخول غير صحيحة' : 'تعذر الاتصال بالخادم',
            'error'
        );
    }
}

function enterStudentSession(username) {
    APP_STATE.role = 'student';
    localStorage.setItem('user_role', 'student');
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('admin-nav-item').style.display = 'none';
    document.getElementById('logout-btn').style.display = 'flex';
    document.getElementById('user-badge').innerHTML = `<i class="fas fa-user-graduate"></i><span>${username || 'طالب'}</span>`;
    showToast(`مرحباً بك ${username || ''}`, 'success');
    loadSubjectsFromAPI().then(() => { renderSubjects(); updateStats(); });
    applyInitialRoute();
}

async function handleStudentRegister(e) {
    e.preventDefault();
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-password-confirm').value;
    if (password !== confirmPassword) {
        showToast('كلمتا المرور غير متطابقتين', 'error');
        return;
    }
    if (password.length < 6) {
        showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, username, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'register_failed');
        authFlow.otpEmail = email;
        showToast('تم التسجيل! تحقق من بريدك (وصندوق Spam إذا لم يصل)', 'success');
        showOtpModal();
    } catch (err) {
        const messages = {
            'البريد الإلكتروني مستخدم بالفعل': 'البريد الإلكتروني مستخدم بالفعل',
            'اسم المستخدم مستخدم بالفعل': 'اسم المستخدم مستخدم بالفعل',
        };
        showToast(messages[err.message] || err.message || 'حدث خطأ', 'error');
    }
}

async function handleForgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    authFlow.otpEmail = email;
    try {
        await fetch(`${API_BASE}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        showToast('تم إرسال كود التحقق. تحقق من صندوق الوارد أو مجلد Spam', 'success');
        showOtpModal();
    } catch (err) {
        showToast('تعذر الاتصال بالخادم', 'error');
    }
}

async function handleVerifyOtp(e) {
    e.preventDefault();
    const otp = document.getElementById('otp-code').value.trim();
    try {
        const res = await fetch(`${API_BASE}/api/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: authFlow.otpEmail, otp }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'otp_failed');
        authFlow.resetToken = data.reset_token;
        showToast('تم التحقق بنجاح!', 'success');
        showResetPasswordModal();
    } catch (err) {
        const messages = {
            'otp_failed': 'كود التحقق غير صحيح',
            'انتهت صلاحية الكود، اطلب كوداً جديداً': 'انتهت صلاحية الكود',
        };
        showToast(messages[err.message] || err.message || 'خطأ في التحقق', 'error');
    }
}

async function resendOtp() {
    if (!authFlow.otpEmail) return;
    try {
        await fetch(`${API_BASE}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: authFlow.otpEmail }),
        });
        showToast('تم إعادة إرسال الكود', 'success');
    } catch (err) {
        showToast('تعذر إعادة الإرسال', 'error');
    }
}

async function handleResetPassword(e) {
    e.preventDefault();
    const newPass = document.getElementById('new-password').value;
    const confirmPass = document.getElementById('new-password-confirm').value;
    if (newPass !== confirmPass) {
        showToast('كلمتا المرور غير متطابقتين', 'error');
        return;
    }
    if (newPass.length < 6) {
        showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: authFlow.otpEmail,
                reset_token: authFlow.resetToken,
                new_password: newPass,
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'reset_failed');
        showToast('تم تغيير كلمة المرور بنجاح! يمكنك تسجيل الدخول الآن', 'success');
        authFlow = { email: '', resetToken: '', otpEmail: '' };
        closeAllModals();
        showStudentLogin();
    } catch (err) {
        showToast(err.message || 'حدث خطأ', 'error');
    }
}

async function handleAdminLogin(e) {
    e.preventDefault();
    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;
    try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        if (!res.ok) throw new Error('invalid_credentials');
        const data = await res.json();
        if (!data.token) throw new Error('invalid_credentials');
        localStorage.setItem('admin_token', data.token);
        closeAdminModal();
        enterAdminSession(false);
    } catch (err) {
        showToast(
            err.message === 'invalid_credentials'
                ? 'اسم المستخدم أو كلمة المرور غير صحيحة'
                : 'تعذر الاتصال بالخادم، حاول مجدداً',
            'error'
        );
    }
}

function enterAdminSession(restored = false) {
    APP_STATE.role = 'admin';
    localStorage.setItem('user_role', 'admin');
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('admin-nav-item').style.display = 'flex';
    document.getElementById('logout-btn').style.display = 'flex';
    document.getElementById('user-badge').innerHTML = '<i class="fas fa-shield-halved"></i><span>مسؤول</span>';
    updateStats();
    prefillTelegramConfig();
    loadSubjectsFromAPI().then(() => { renderSubjects(); renderAdminSubjects(); updateStats(); });
    applyInitialRoute();
    showToast(restored ? 'تم استعادة جلسة المسؤول' : 'مرحباً بك أيها المسؤول', 'success');
}

function adminLogout() {
    handleLogout();
}

function handleLogout() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_name');
    APP_STATE.role = 'guest';
    document.getElementById('admin-nav-item').style.display = 'none';
    document.getElementById('logout-btn').style.display = 'none';
    document.getElementById('user-badge').innerHTML = '<i class="fas fa-eye"></i><span>ضيف</span>';
    showToast('تم تسجيل الخروج', 'info');
    switchSection('schedule');
}

// ============================================
// NAVIGATION - SPA HASH ROUTING
// ============================================
const VALID_SECTIONS = ['library', 'schedule', 'calculator', 'exams', 'admin'];

const GUEST_SECTIONS = ['schedule', 'exams'];

function getSectionFromHash() {
    const h = window.location.hash.replace(/^#\/?/, '').trim();
    return VALID_SECTIONS.includes(h) ? h : null;
}

function applyInitialRoute() {
    const section = getSectionFromHash();
    if (section) {
        navigateToSection(section);
    } else {
        history.replaceState(null, '', '#/library');
        navigateToSection('library');
    }
}

function canAccessSection(section) {
    if (APP_STATE.role === 'admin') return true;
    if (APP_STATE.role === 'student') return true;
    if (APP_STATE.role === 'guest') return GUEST_SECTIONS.includes(section);
    return false;
}

function showGuestRestriction() {
    closeAllModals();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'guest-restriction-modal';
    modal.innerHTML = `
        <div class="modal-card guest-restriction-card" style="max-width: 380px; text-align: center;">
            <div style="width: 72px; height: 72px; border-radius: 50%; background: var(--accent-light); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">
                <i class="fas fa-lock" style="font-size: 1.8rem; color: var(--accent);"></i>
            </div>
            <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 8px;">مخصص للطلبة المسجلين</h3>
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 24px; line-height: 1.5;">سجّل دخولك للوصول إلى المحاضرات وملفات الـ TD/TP</p>
            <button class="btn btn-primary btn-full" style="margin-bottom: 10px;" onclick="document.getElementById('guest-restriction-modal').remove(); showStudentLogin();">
                <i class="fas fa-right-to-bracket"></i> تسجيل الدخول
            </button>
            <button class="btn btn-register btn-full" style="margin-bottom: 10px;" onclick="document.getElementById('guest-restriction-modal').remove(); showStudentRegister();">
                <i class="fas fa-user-plus"></i> إنشاء حساب جديد
            </button>
            <button class="btn btn-ghost btn-full" onclick="document.getElementById('guest-restriction-modal').remove()">إلغاء</button>
        </div>
    `;
    document.body.appendChild(modal);
}

function switchSection(section) {
    let target = VALID_SECTIONS.includes(section) ? section : 'library';
    if (target === 'admin' && APP_STATE.role !== 'admin') {
        showToast('هذه الصفحة متاحة للمسؤول فقط', 'error');
        target = 'library';
    }
    if (!canAccessSection(target)) {
        showGuestRestriction();
        return;
    }
    if (getSectionFromHash() === target) {
        navigateToSection(target);
    } else {
        window.location.hash = '/' + target;
    }
}

function navigateToSection(section) {
    if (!VALID_SECTIONS.includes(section)) section = 'library';
    if (section === 'admin' && APP_STATE.role !== 'admin') section = 'library';
    if (!canAccessSection(section)) section = GUEST_SECTIONS[0] || 'schedule';
    APP_STATE.currentSection = section;
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.section === section);
    });
    // Update sections
    document.querySelectorAll('.section').forEach(sec => {
        sec.classList.remove('active');
    });
    const targetSection = document.getElementById(`section-${section}`);
    if (targetSection) {
        targetSection.classList.add('active');
    }
    // Update topbar title
    const titles = {
        library: 'مكتبة المواد',
        schedule: 'الرزنامة الأسبوعية',
        calculator: 'حاسبة المعدل',
        exams: 'تواريخ الامتحانات',
        admin: 'لوحة التحكم',
    };
    document.getElementById('topbar-title').textContent = titles[section] || '';
    // Close sidebar on mobile
    closeSidebar();
}

window.addEventListener('hashchange', () => {
    const app = document.getElementById('main-app');
    if (!app || app.classList.contains('hidden')) return;
    const section = getSectionFromHash();
    if (!section || section === APP_STATE.currentSection) return;
    navigateToSection(section);
});

// ============================================
// SIDEBAR
// ============================================
let sidebarOverlay = null;

function initSidebarOverlay() {
    sidebarOverlay = document.createElement('div');
    sidebarOverlay.className = 'sidebar-overlay';
    sidebarOverlay.onclick = closeSidebar;
    document.body.appendChild(sidebarOverlay);
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
    sidebarOverlay.classList.toggle('active');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('active');
}

// ============================================
// SUBJECTS RENDERING
// ============================================
function renderSubjects(filter = '') {
    const grid = document.getElementById('subjects-grid');
    const filtered = subjects.filter(s =>
        s.name.toLowerCase().includes(filter.toLowerCase())
    );
    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="no-results" style="grid-column: 1 / -1;">
                <i class="fas fa-search"></i>
                <p>لا توجد نتائج مطابقة</p>
            </div>`;
        return;
    }
    grid.innerHTML = filtered.map(subject => {
        const totalFiles = (subject.lectures?.length || 0) + (subject.tdtp?.length || 0);
        return `
        <div class="subject-card" onclick="openSubject(${subject.id})">
            <div class="subject-card-icon">
                <i class="fas ${subject.icon}"></i>
            </div>
            <div class="subject-card-name">${subject.name}</div>
            <div class="subject-card-count">${totalFiles} ملف</div>
        </div>`;
    }).join('');
}

function openSubject(id) {
    const subject = subjects.find(s => s.id === id);
    if (!subject) return;
    APP_STATE.currentSubject = subject;
    document.getElementById('subjects-grid').classList.add('hidden');
    const detail = document.getElementById('subject-detail');
    detail.classList.remove('hidden');
    document.getElementById('detail-subject-name').textContent = subject.name;
    renderFiles('lectures');
    renderFiles('tdtp');
}

function backToSubjects() {
    APP_STATE.currentSubject = null;
    document.getElementById('subjects-grid').classList.remove('hidden');
    document.getElementById('subject-detail').classList.add('hidden');
    document.getElementById('subject-search').value = '';
    APP_STATE.searchQuery = '';
}

function switchDetailTab(tab) {
    APP_STATE.currentDetailTab = tab;
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
    event.currentTarget.classList.add('active');
    document.getElementById('files-lectures').classList.toggle('hidden', tab !== 'lectures');
    document.getElementById('files-tdtp').classList.toggle('hidden', tab !== 'tdtp');
}

function renderFiles(type, filter = '') {
    const subject = APP_STATE.currentSubject;
    if (!subject) return;
    const files = subject[type] || [];
    const container = document.getElementById(`files-${type}`);
    const filtered = files.filter(f => f.name.includes(filter));
    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="no-results">
                <i class="fas fa-folder-open"></i>
                <p>${filter ? 'لا توجد ملفات مطابقة' : 'لا توجد ملفات حالياً'}</p>
            </div>`;
        return;
    }
    container.innerHTML = filtered.map(file => `
        <div class="file-card">
            <div class="file-icon pdf">
                <i class="fas fa-file-pdf"></i>
            </div>
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">${file.size}</div>
            </div>
            <div class="file-actions">
                <button class="btn-icon" onclick="openPdfViewer('${file.file}')" title="عرض">
                    <i class="fas fa-eye"></i>
                </button>
                <button class="btn-icon" onclick="downloadFile('${file.file}')" title="تحميل">
                    <i class="fas fa-download"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function filterFiles(query) {
    APP_STATE.searchQuery = query;
    renderFiles('lectures', query);
    renderFiles('tdtp', query);
}

// ============================================
// GLOBAL SEARCH
// ============================================
function handleSearch(query) {
    if (APP_STATE.currentSubject) {
        backToSubjects();
    }
    renderSubjects(query);
}

// ============================================
// PDF VIEWER
// ============================================
function openPdfViewer(filename) {
    const url = `${API_BASE}/files/${encodeURIComponent(filename)}`;
    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        showMobileSheet(filename, url);
        return;
    }
    // Desktop: show in modal iframe
    const modal = document.getElementById('pdf-viewer-modal');
    modal.classList.remove('hidden');
    document.getElementById('pdf-viewer-title').textContent = filename;
    document.body.style.overflow = 'hidden';
    const dlLink = document.getElementById('pdf-download-link');
    dlLink.href = url;
    dlLink.download = filename;
    const body = document.querySelector('.pdf-viewer-body');
    body.innerHTML = `<iframe src="${url}" style="width:100%;height:100%;border:none;"></iframe>`;
    document.getElementById('pdf-page-info').textContent = '';
    document.querySelectorAll('.pdf-viewer-actions .btn-icon:not(.btn-close-pdf)').forEach(b => b.style.display = 'none');
    if (dlLink) dlLink.style.display = '';
}

// ============================================
// MOBILE FILE BOTTOM SHEET
// ============================================
let mobileSheetUrl = '';
let mobileSheetName = '';

function showMobileSheet(filename, url) {
    mobileSheetUrl = url;
    mobileSheetName = filename;
    document.getElementById('mobile-sheet-title').textContent = filename;
    document.getElementById('mobile-file-sheet').classList.remove('hidden');
}

function closeMobileSheet() {
    document.getElementById('mobile-file-sheet').classList.add('hidden');
}

function mobileSheetOpen() {
    if (mobileSheetUrl) window.open(mobileSheetUrl, '_blank');
    closeMobileSheet();
}

function mobileSheetDownload() {
    if (mobileSheetUrl) {
        const a = document.createElement('a');
        a.href = mobileSheetUrl;
        a.download = mobileSheetName;
        a.click();
    }
    closeMobileSheet();
    showToast('جاري تحميل الملف...', 'info');
}

function closePdfViewer() {
    const modal = document.getElementById('pdf-viewer-modal');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    const body = document.querySelector('.pdf-viewer-body');
    body.innerHTML = '<canvas id="pdf-canvas"></canvas>';
    // Restore zoom/nav buttons
    document.querySelectorAll('.pdf-viewer-actions .btn-icon').forEach(b => b.style.display = '');
}

function loadPdfDemo() {
    // Demo: Use a sample PDF for demonstration
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 595;
    canvas.height = 842;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 24px Noto Kufi Arabic';
    ctx.textAlign = 'center';
    ctx.fillText('عرض الملف', canvas.width / 2, 100);
    ctx.font = '16px Noto Kufi Arabic';
    ctx.fillStyle = '#64748b';
    ctx.fillText('سيتم ربط الملف الفعلي عند الاتصال بالخادم', canvas.width / 2, 150);
    ctx.fillText('يمكنك استخدام PDF.js لعرض أي ملف PDF', canvas.width / 2, 180);
    // Draw a sample page layout
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(40, 220, 515, 500);
    for (let y = 250; y < 700; y += 30) {
        ctx.fillStyle = '#e2e8f0';
        const width = Math.random() * 400 + 100;
        ctx.fillRect(60, y, width, 8);
    }
    document.getElementById('pdf-page-info').textContent = '1 / 1';
}

// Real PDF loading function (for when backend is connected)
async function loadRealPdf(url, filename) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    try {
        pdfDoc = await pdfjsLib.getDocument(url).promise;
        pdfPageNum = 1;
        pdfScale = 1.5;
        document.getElementById('pdf-page-info').textContent = `1 / ${pdfDoc.numPages}`;
        document.getElementById('pdf-viewer-title').textContent = filename;
        renderPdfPage();
    } catch (err) {
        showToast('خطأ في تحميل الملف', 'error');
    }
}

async function renderPdfPage() {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(pdfPageNum);
    const viewport = page.getViewport({ scale: pdfScale });
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: ctx, viewport }).promise;
    document.getElementById('pdf-page-info').textContent = `${pdfPageNum} / ${pdfDoc.numPages}`;
}

function pdfPrevPage() {
    if (pdfDoc && pdfPageNum > 1) {
        pdfPageNum--;
        renderPdfPage();
    }
}

function pdfNextPage() {
    if (pdfDoc && pdfPageNum < pdfDoc.numPages) {
        pdfPageNum++;
        renderPdfPage();
    }
}

function pdfZoomIn() {
    if (pdfDoc) {
        pdfScale += 0.3;
        renderPdfPage();
    }
}

function pdfZoomOut() {
    if (pdfDoc && pdfScale > 0.6) {
        pdfScale -= 0.3;
        renderPdfPage();
    }
}

function downloadFile(filename) {
    const url = `${API_BASE}/files/${encodeURIComponent(filename)}`;
    const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
        window.open(url, '_blank');
        showToast(`جاري فتح الملف...`, 'info');
        return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    showToast(`جاري تحميل ${filename}...`, 'info');
}

// ============================================
// SCHEDULE RENDERING
// ============================================
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
const DAY_LABELS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];

function isScheduleEmpty() {
    return !schedule || Object.keys(schedule).length === 0;
}

function renderSchedule() {
    const tbody = document.getElementById('schedule-body');

    if (isScheduleEmpty()) {
        const msg = '<div class="schedule-not-available"><i class="fas fa-calendar-xmark"></i><p>الرزنامة غير متوفرة حالياً</p><small>سيتم إضافة الرزنامة مع بداية الدخول الجامعي</small></div>';
        tbody.innerHTML = '<tr><td colspan="6" style="border:none;padding:0;">' + msg + '</td></tr>';
    } else {
        tbody.innerHTML = TIME_SLOTS.map((time, i) => {
            return '<tr><td class="time-col">' + time + '</td>' +
                DAYS.map(day => {
                    const cell = schedule[day + '_' + i] || {};
                    let cls = '';
                    if (cell.type === 'lecture') cls = 'schedule-cell-lecture';
                    if (cell.type === 'tdtp') cls = 'schedule-cell-tdtp';
                    return '<td class="' + cls + '">' + (cell.text || '') + '</td>';
                }).join('') + '</tr>';
        }).join('');
    }

    renderMobileDayPicker();
    renderMobileSchedule();
}

let selectedScheduleDay = -1;

function renderMobileDayPicker() {
    const picker = document.getElementById('schedule-day-picker');
    if (!picker) return;
    document.querySelectorAll('.day-btn').forEach((btn, i) => {
        const hasContent = DAYS.some((day, di) => {
            return TIME_SLOTS.some((_, ti) => {
                const cell = schedule[`${day}_${ti}`] || {};
                return cell.text && cell.text.trim();
            });
        });
        const dayHasContent = TIME_SLOTS.some((_, ti) => {
            const cell = schedule[`${DAYS[i]}_${ti}`] || {};
            return cell.text && cell.text.trim();
        });
        btn.classList.toggle('has-classes', dayHasContent);
    });
}

function selectScheduleDay(dayIndex) {
    selectedScheduleDay = dayIndex;
    document.querySelectorAll('.day-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === dayIndex);
    });
    renderMobileSchedule();
}

function renderMobileSchedule() {
    const container = document.getElementById('schedule-mobile-view');
    if (!container) return;
    if (selectedScheduleDay < 0) {
        container.innerHTML = '<div class="mobile-empty"><i class="fas fa-hand-pointer"></i><p>اختر يوماً من الأعلى لعرض جدوله</p></div>';
        return;
    }
    if (isScheduleEmpty()) {
        container.innerHTML = '<div class="schedule-not-available"><i class="fas fa-calendar-xmark"></i><p>الرزنامة غير متوفرة حالياً</p><small>سيتم إضافة الرزنامة مع بداية الدخول الجامعي</small></div>';
        return;
    }
    const day = DAYS[selectedScheduleDay];
    const label = DAY_LABELS[selectedScheduleDay];
    let html = '<div class="mobile-day-title"><i class="fas fa-calendar-check"></i> جدول ' + label + '</div>';
    TIME_SLOTS.forEach((time, i) => {
        const cell = schedule[day + '_' + i] || {};
        let cls = '';
        if (cell.type === 'lecture') cls = 'schedule-cell-lecture';
        if (cell.type === 'tdtp') cls = 'schedule-cell-tdtp';
        const text = cell.text || '';
        html += '<div class="mobile-slot"><div class="mobile-slot-time"><i class="fas fa-clock"></i> ' + time + '</div><div class="mobile-slot-content ' + cls + ' ' + (!text ? 'empty' : '') + '">' + (text || 'فارغ') + '</div></div>';
    });
    container.innerHTML = html;
}

// ============================================
// EXAMS TABS
// ============================================
function switchExamTab(sem) {
    document.querySelectorAll('.exam-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('exam-sem1').classList.toggle('hidden', sem !== 'sem1');
    document.getElementById('exam-sem2').classList.toggle('hidden', sem !== 'sem2');
    event.currentTarget.classList.add('active');
}

// ============================================
// ADMIN FUNCTIONS
// ============================================
function updateStats() {
    document.getElementById('stat-subjects').textContent = subjects.length;
    let totalFiles = 0;
    subjects.forEach(s => {
        totalFiles += (s.lectures?.length || 0) + (s.tdtp?.length || 0);
    });
    document.getElementById('stat-files').textContent = totalFiles;
    document.getElementById('stat-visits').textContent = visits;
    const hasToken = telegramConfig.token && telegramConfig.token.length > 5;
    document.getElementById('stat-bot-status').textContent = hasToken ? 'متصل' : 'غير متصل';
    document.getElementById('stat-bot-status').style.color = hasToken ? 'var(--success)' : 'var(--danger)';
}

function saveTelegramConfig(e) {
    e.preventDefault();
    telegramConfig = {
        token: document.getElementById('tg-bot-token').value,
        chatId: document.getElementById('tg-chat-id').value,
    };
    localStorage.setItem('tg_config', JSON.stringify(telegramConfig));
    updateStats();
    showToast('تم حفظ إعدادات البوت بنجاح', 'success');
}

function prefillTelegramConfig() {
    const tokenInput = document.getElementById('tg-bot-token');
    const chatIdInput = document.getElementById('tg-chat-id');
    if (tokenInput && !tokenInput.value) tokenInput.value = telegramConfig.token || '';
    if (chatIdInput && !chatIdInput.value) chatIdInput.value = telegramConfig.chatId || '';
}

function renderAdminSubjects() {
    const list = document.getElementById('admin-subjects-list');
    if (!list) return;
    list.innerHTML = subjects.map(s => `
        <div class="admin-subject-item">
            <i class="fas ${s.icon}"></i>
            <span>${s.name}</span>
            <button class="btn-icon" onclick="deleteSubject(${s.id})" title="حذف">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
}

async function addSubject() {
    const name = document.getElementById('new-subject-name').value.trim();
    const icon = document.getElementById('new-subject-icon').value.trim() || 'fa-book';
    if (!name) {
        showToast('أدخل اسم المادة', 'error');
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/api/subjects`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name, icon }),
        });
        if (res.status === 401 || res.status === 403) {
            handleAuthError();
            return;
        }
        if (!res.ok) throw new Error('failed');
        await loadSubjectsFromAPI();
        document.getElementById('new-subject-name').value = '';
        document.getElementById('new-subject-icon').value = '';
        renderAdminSubjects();
        renderSubjects();
        updateStats();
        showToast('تمت إضافة المادة بنجاح', 'success');
    } catch (e) {
        showToast('حدث خطأ أثناء إضافة المادة', 'error');
    }
}

async function deleteSubject(id) {
    if (!confirm('هل أنت متأكد من حذف هذه المادة؟')) return;
    try {
        const res = await fetch(`${API_BASE}/api/subjects/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        if (res.status === 401 || res.status === 403) {
            handleAuthError();
            return;
        }
        if (!res.ok) throw new Error('failed');
        await loadSubjectsFromAPI();
        renderAdminSubjects();
        renderSubjects();
        updateStats();
        showToast('تم حذف المادة', 'success');
    } catch (e) {
        showToast('حدث خطأ أثناء حذف المادة', 'error');
    }
}

// ============================================
// SCHEDULE EDITOR (Admin Panel)
// ============================================
const SCHED_TYPES = [
    { value: '', label: 'فارغ' },
    { value: 'lecture', label: 'محاضرة' },
    { value: 'tdtp', label: 'TD / TP' },
];

function renderScheduleEditor() {
    const grid = document.getElementById('schedule-editor-grid');
    if (!grid) return;
    let html = '<div class="sched-editor-wrapper"><table class="schedule-table sched-edit-table"><thead><tr><th class="time-col">الوقت</th>';
    DAY_LABELS.forEach(l => html += `<th>${l}</th>`);
    html += '</tr></thead><tbody>';
    TIME_SLOTS.forEach((time, ti) => {
        html += `<tr><td class="time-col">${time}</td>`;
        DAYS.forEach((day, di) => {
            const key = `${day}_${ti}`;
            const cell = schedule[key] || { text: '', type: '' };
            html += `<td>
                <input type="text" class="sched-edit-input sched-text" data-key="${key}" value="${(cell.text || '').replace(/"/g, '&quot;')}" placeholder="المادة...">
                <select class="sched-edit-select sched-type" data-key="${key}">
                    ${SCHED_TYPES.map(t => `<option value="${t.value}" ${cell.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
                </select>
            </td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table></div>';
    grid.innerHTML = html;
}

async function saveAdminSchedule() {
    const inputs = document.querySelectorAll('.sched-text');
    const selects = document.querySelectorAll('.sched-type');
    const data = {};
    inputs.forEach(inp => {
        const key = inp.dataset.key;
        const sel = document.querySelector(`.sched-type[data-key="${key}"]`);
        data[key] = {
            text: inp.value.trim(),
            type: sel ? sel.value : '',
        };
    });
    schedule = data;
    const ok = await saveScheduleToAPI();
    if (ok) {
        renderSchedule();
        showToast('تم حفظ الرزنامة بنجاح', 'success');
    } else {
        showToast('حدث خطأ أثناء الحفظ', 'error');
    }
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas ${icons[type]}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-30px)';
        toast.style.transition = 'all 0.4s ease';
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}

// Keyboard shortcut: Escape to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePdfViewer();
        closeAdminModal();
    }
});

// ============================================
// LMD GPA CALCULATOR v2
// ============================================
let calcData = JSON.parse(localStorage.getItem('lmd_calc_v2') || '{"sem1":[],"sem2":[]}');

function saveCalc() {
    localStorage.setItem('lmd_calc_v2', JSON.stringify(calcData));
}

function addCalcModule(sem) {
    calcData[sem].push({ name: '', coef: 1, exam: '', hasTd: false, td: '' });
    saveCalc();
    renderCalcModules(sem);
}

function removeCalcModule(sem, idx) {
    const card = document.querySelector(`[data-sem="${sem}"][data-idx="${idx}"]`);
    if (card) {
        card.style.transition = 'all 0.3s ease';
        card.style.opacity = '0';
        card.style.transform = 'translateX(30px) scale(0.95)';
        card.style.maxHeight = card.offsetHeight + 'px';
        setTimeout(() => {
            card.style.maxHeight = '0';
            card.style.padding = '0';
            card.style.margin = '0';
            card.style.border = 'none';
        }, 150);
        setTimeout(() => {
            calcData[sem].splice(idx, 1);
            saveCalc();
            renderCalcModules(sem);
        }, 400);
    } else {
        calcData[sem].splice(idx, 1);
        saveCalc();
        renderCalcModules(sem);
    }
}

function toggleTd(sem, idx) {
    calcData[sem][idx].hasTd = !calcData[sem][idx].hasTd;
    if (!calcData[sem][idx].hasTd) calcData[sem][idx].td = '';
    saveCalc();
    renderCalcModules(sem);
}

function updateCalcField(sem, idx, field, val) {
    calcData[sem][idx][field] = val;
    saveCalc();
    recalcSingle(sem, idx);
    recalcSemester(sem);
    recalcGPA();
    runAdvisor();
}

function getCalcAvg(mod) {
    const exam = parseFloat(mod.exam);
    if (isNaN(exam)) return null;
    if (mod.hasTd) {
        const td = parseFloat(mod.td);
        if (isNaN(td)) return exam * 0.6;
        return (td * 0.40) + (exam * 0.60);
    }
    return exam;
}

function getSemesterAvg(sem) {
    const modules = calcData[sem].filter(m => getCalcAvg(m) !== null);
    if (modules.length === 0) return null;
    let totalW = 0, totalC = 0;
    modules.forEach(m => {
        const avg = getCalcAvg(m);
        const c = parseFloat(m.coef) || 1;
        totalW += avg * c;
        totalC += c;
    });
    return totalC > 0 ? totalW / totalC : null;
}

function getAvgClass(avg) {
    if (avg === null) return '';
    if (avg >= 16) return 'excellent';
    if (avg >= 14) return 'good';
    if (avg >= 10) return 'average';
    return 'poor';
}

function recalcSingle(sem, idx) {
    const el = document.getElementById(`avg-${sem}-${idx}`);
    if (!el) return;
    const avg = getCalcAvg(calcData[sem][idx]);
    el.textContent = avg !== null ? avg.toFixed(2) : '--';
    el.className = 'calc-module-avg ' + getAvgClass(avg);
}

function recalcSemester(sem) {
    const el = document.getElementById(`calc-${sem}-avg`);
    if (!el) return;
    const avg = getSemesterAvg(sem);
    el.textContent = avg !== null ? avg.toFixed(2) + ' / 20' : '--';
}

function recalcGPA() {
    const s1 = getSemesterAvg('sem1');
    const s2 = getSemesterAvg('sem2');
    const gaugeVal = document.getElementById('gauge-value');
    const gaugeCircle = document.getElementById('gauge-circle');
    const finalEl = document.getElementById('calc-final-gpa');
    const statusEl = document.getElementById('calc-status-msg');

    let gpa = null;
    if (s1 !== null && s2 !== null) gpa = (s1 + s2) / 2;
    else if (s1 !== null) gpa = s1;
    else if (s2 !== null) gpa = s2;

    const circumference = 2 * Math.PI * 52;
    const pct = gpa !== null ? Math.max(0, Math.min(1, gpa / 20)) : 0;
    const offset = circumference * (1 - pct);

    gaugeCircle.style.strokeDasharray = circumference;
    gaugeCircle.style.strokeDashoffset = offset;

    if (gpa !== null) {
        gaugeCircle.style.stroke = gpa >= 10 ? '#28a745' : '#dc3545';
        gaugeVal.textContent = gpa.toFixed(2);
        gaugeVal.style.color = gpa >= 10 ? '#28a745' : '#dc3545';
        finalEl.textContent = gpa.toFixed(2) + ' / 20';
        finalEl.style.color = gpa >= 10 ? 'var(--accent)' : '#dc3545';
        statusEl.className = 'calc-status-msg ' + (gpa >= 10 ? 'pass' : 'fail');
        statusEl.innerHTML = gpa >= 10
            ? '<i class="fas fa-check-circle"></i> مبروك! لقد نجحت في السنة'
            : '<i class="fas fa-times-circle"></i> للأسف لم تحقق النجاح';
    } else {
        gaugeCircle.style.stroke = 'var(--accent)';
        gaugeVal.textContent = '--';
        gaugeVal.style.color = '';
        finalEl.textContent = '--';
        finalEl.style.color = '';
        statusEl.className = 'calc-status-msg';
        statusEl.innerHTML = '';
    }
}

function runAdvisor() {
    const advisor = document.getElementById('calc-advisor');
    const advisorText = document.getElementById('calc-advisor-text');
    // Find the one module with empty exam
    let emptyExamModules = [];
    ['sem1', 'sem2'].forEach(sem => {
        calcData[sem].forEach((m, i) => {
            if (m.exam === '' && m.name) emptyExamModules.push({ sem, idx: i, name: m.name });
        });
    });

    if (emptyExamModules.length === 1) {
        const target = emptyExamModules[0];
        const sem = target.sem;
        const idx = target.idx;
        const mod = calcData[sem][idx];
        const coef = parseFloat(mod.coef) || 1;

        // Calculate what's needed from all other modules
        let totalCoef = 0, totalPoints = 0;
        ['sem1', 'sem2'].forEach(s => {
            calcData[s].forEach((m, i) => {
                if (s === sem && i === idx) return;
                const avg = getCalcAvg(m);
                if (avg !== null) {
                    const c = parseFloat(m.coef) || 1;
                    totalPoints += avg * c;
                    totalCoef += c;
                }
            });
        });
        totalCoef += coef;
        const needed = (10 * totalCoef - totalPoints) / coef;

        if (needed > 0 && needed <= 20) {
            advisor.classList.remove('hidden');
            let tdNote = mod.hasTd && mod.td ? ` (مع TD = ${mod.td})` : '';
            advisorText.innerHTML = `في مادة <strong>${target.name}</strong>${tdNote}: تحتاج <strong>${needed.toFixed(2)}/20</strong> في الامتحان للوصول إلى معدل 10`;
        } else if (needed > 20) {
            advisor.classList.remove('hidden');
            advisorText.innerHTML = `<strong>تنبيه:</strong> حتى لو حصلت على 20 في مادة ${target.name} فلن تتمكن من رفع المعدل إلى 10 بمفردها`;
        } else {
            advisor.classList.add('hidden');
        }
    } else {
        advisor.classList.add('hidden');
    }
}

function renderCalcModules(sem) {
    const container = document.getElementById(`calc-modules-${sem}`);
    container.innerHTML = '';
    calcData[sem].forEach((m, i) => {
        const avg = getCalcAvg(m);
        const card = document.createElement('div');
        card.className = 'calc-module-card';
        card.setAttribute('data-sem', sem);
        card.setAttribute('data-idx', i);

        const examInput = m.hasTd
            ? `<div class="calc-field calc-field-exam"><label>الامتحان (⁄20)</label><input type="number" min="0" max="20" step="0.01" placeholder="0-20" value="${m.exam}" oninput="updateCalcField('${sem}',${i},'exam',this.value)"></div>
               <div class="calc-field calc-field-td"><label>TD / TP (⁄20)</label><input type="number" min="0" max="20" step="0.01" placeholder="0-20" value="${m.td}" oninput="updateCalcField('${sem}',${i},'td',this.value)"></div>`
            : `<div class="calc-field calc-field-exam"><label>الامتحان (⁄20)</label><input type="number" min="0" max="20" step="0.01" placeholder="0-20" value="${m.exam}" oninput="updateCalcField('${sem}',${i},'exam',this.value)"></div>`;

        card.innerHTML = `
            <div class="calc-module-header-row">
                <div class="calc-module-num">${i + 1}</div>
                <button class="calc-remove-btn" onclick="removeCalcModule('${sem}',${i})" title="حذف">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <input class="calc-module-name" type="text" placeholder="اسم المادة..."
                value="${m.name}" oninput="updateCalcField('${sem}',${i},'name',this.value)">
            <div class="calc-module-fields ${m.hasTd ? 'has-td' : ''}">
                <div class="calc-field calc-field-coef">
                    <label>المعامل</label>
                    <input type="number" min="1" max="10" step="0.5" placeholder="1"
                        value="${m.coef}" oninput="updateCalcField('${sem}',${i},'coef',this.value)">
                </div>
                ${examInput}
                <div class="calc-module-avg ${getAvgClass(avg)}" id="avg-${sem}-${i}">
                    ${avg !== null ? avg.toFixed(2) : '--'}
                </div>
            </div>
            <div class="calc-td-toggle-row">
                <span class="calc-td-label"> TD / TP</span>
                <div class="calc-switch ${m.hasTd ? 'on' : ''}" onclick="toggleTd('${sem}',${i})"></div>
                <span class="calc-td-hint">${m.hasTd ? 'مفعّل' : 'معطّل'}</span>
            </div>
        `;
        container.appendChild(card);
    });
    recalcGPA();
    runAdvisor();
}

function switchCalcTab(btn, sem) {
    document.querySelectorAll('.calc-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.calc-sem').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`calc-${sem}`).classList.add('active');
}

function resetCalculator() {
    if (!confirm('هل تريد مسح جميع البيانات؟')) return;
    calcData = { sem1: [], sem2: [] };
    saveCalc();
    renderCalcModules('sem1');
    renderCalcModules('sem2');
    document.getElementById('calc-advisor').classList.add('hidden');
}

function shareCalcResult() {
    const s1 = getSemesterAvg('sem1');
    const s2 = getSemesterAvg('sem2');
    let gpa = null;
    if (s1 !== null && s2 !== null) gpa = (s1 + s2) / 2;
    else if (s1 !== null) gpa = s1;
    else if (s2 !== null) gpa = s2;

    let text = 'حاسبة المعدل - نظام LMD\n';
    text += 'جامعة 8 ماي 1945 قالمة\n';
    text += '━━━━━━━━━━━━━━━━━━\n';
    ['sem1', 'sem2'].forEach(sem => {
        const label = sem === 'sem1' ? 'السداسي الأول' : 'السداسي الثاني';
        text += `\n${label}:\n`;
        calcData[sem].forEach((m, i) => {
            const avg = getCalcAvg(m);
            const td = m.hasTd ? `TD=${m.td || '-'}` : '';
            text += `  ${i+1}. ${m.name || 'بدون اسم'} | معامل ${m.coef} ${td} | امتحان ${m.exam || '-'} | ${avg !== null ? avg.toFixed(2) : '--'}\n`;
        });
        const sAvg = getSemesterAvg(sem);
        text += `  → معدل ${label}: ${sAvg !== null ? sAvg.toFixed(2) : '--'}\n`;
    });
    text += `\n━━━━━━━━━━━━━━━━━━\n`;
    text += `المعدل العام: ${gpa !== null ? gpa.toFixed(2) + ' / 20' : '--'}\n`;
    text += gpa !== null ? (gpa >= 10 ? '✅ ناجح' : '❌ راسب') : '';

    if (navigator.share) {
        navigator.share({ title: 'حاسبة المعدل', text });
    } else {
        navigator.clipboard.writeText(text).then(() => showToast('تم نسخ النتيجة', 'success'));
    }
}
