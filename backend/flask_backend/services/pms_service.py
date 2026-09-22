"""
خدمة PMS جامعة قالمة (بروكسي قراءة فقط) — تكامل من جهة الخادم فقط.

الخلفية: تطبيق PMS الرسمي (Flutter) يتحدث مع
https://vp.univ-guelma.dz/pms/endpoints/*.php
عبر POST بنمط form-urlencoded، دخول برقم التسجيل + كلمة سر (جلسة opaque).

ما توفره هذه الوحدة:
- POST /api/pms/login {username, password} → تمرير لauth_router.php (بلا تخزين).
- POST /api/pms/fetch {endpoint, student_id, module_id?} → تمرير لنقاط
  القراءة المسموحة فقط (قائمة بيضاء)، مع كاش ذاكرة قصير للنقاط العامة.

الممنوع صراحة: api_save_token / action_notifications / api_forgot_password
(كتابة/آثار جانبية) — أي POST مغير يحتاج موافقة صريحة وendpoint خاص به.
كلمات السر تُمرر وتُنسى فوراً، ولا تُخزن في أي جدول.

ملاحظة TLS: سيرفر الجامعة يقدم سلسلة شهادات ناقصة (intermediate غائب)
فعمليات التحقق القياسية تفشل — لذلك verify=False هنا حصراً لهذا الهوست،
مع كتم تحذير InsecureRequestWarning. إن أصلحت الجامعة سلسلتها نعيد True.
"""

import time
import urllib.parse

try:
    from . import _http as requests
except ImportError:
    import requests
from flask import Blueprint, jsonify, request

try:
    from requests.packages import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except Exception:
    pass

PMS_BASE = 'https://vp.univ-guelma.dz/pms/endpoints'

bp = Blueprint('pms', __name__, url_prefix='/api/pms')

_session = requests.Session()
_session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    'Accept': 'application/json',
})

# نقاط القراءة المسموح تمريرها فقط (قراءة بحتة، student_id إجباري).
READ_ENDPOINTS = {
    'get_dashboard_data',
    'api_student_profile',
    'get_student_modules',
    'get_group_schedule',
    'get_student_absences',
    'get_student_exams',
    'get_tutoring',
    'get_student_stage',
    'get_student_defense',
    'get_occupancy_data',
    'get_syllabus',
    'get_news',
    'get_announcements',
    'get_all_notifications',
}

# كاش ذاكرة قصير (120s) للنقاط العامة الثقيلة فقط.
_CACHEABLE = {'get_dashboard_data', 'get_news', 'get_announcements', 'get_occupancy_data'}
_CACHE_TTL = 120
_cache = {}

# حد بسيط ضد التخمين عبر البروكسي: 10 محاولات دخول / 5 دقائق / IP.
_login_hits = {}


def _login_allowed(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _login_hits.get(ip, []) if now - t < 300]
    if len(hits) >= 10:
        _login_hits[ip] = hits
        return False
    hits.append(now)
    _login_hits[ip] = hits[-10:]
    return True


def _pms_post(endpoint: str, form: dict):
    # كل النقاط تقبل form-urlencoded (نقطتان ترفضان JSON) — نرمّز يدوياً لأن
    # طبقة _http البديلة ترسل str(dict) لا urlencode.
    body = urllib.parse.urlencode(form)
    r = _session.post(f'{PMS_BASE}/{endpoint}.php', data=body, timeout=25,
                      verify=False, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        return jsonify(r.json()), r.status_code
    except Exception:
        return jsonify({'error': 'رد غير متوقع من سيرفر الجامعة'}), 502


@bp.route('/login', methods=['POST'])
def pms_login():
    ip = (request.headers.get('X-Forwarded-For', request.remote_addr or '') or '').split(',')[0].strip()
    if not _login_allowed(ip):
        return jsonify({'error': 'محاولات كثيرة جداً، انتظر 5 دقائق'}), 429
    data = request.get_json(silent=True) or {}
    username = data.get('username')
    password = data.get('password')
    if not isinstance(username, str) or not isinstance(password, str):
        return jsonify({'error': 'بيانات غير صحيحة'}), 400
    username = username.strip()
    if not username or not password or len(username) > 50 or len(password) > 100:
        return jsonify({'error': 'أدخل رقم التسجيل وكلمة المرور'}), 400
    try:
        return _pms_post('auth_router', {'username': username, 'password': password})
    except Exception:
        return jsonify({'error': 'سيرفر الجامعة غير متاح حالياً، حاول لاحقاً'}), 502


@bp.route('/fetch', methods=['POST'])
def pms_fetch():
    data = request.get_json(silent=True) or {}
    endpoint = data.get('endpoint', '')
    if endpoint not in READ_ENDPOINTS:
        return jsonify({'error': 'نقطة غير مسموحة'}), 403
    try:
        sid = int(data.get('student_id') or 0)
    except (TypeError, ValueError):
        return jsonify({'error': 'student_id مطلوب'}), 400
    if sid <= 0:
        return jsonify({'error': 'student_id مطلوب'}), 400
    form = {'student_id': str(sid)}
    if endpoint == 'get_syllabus':
        try:
            mid = int(data.get('module_id') or 0)
        except (TypeError, ValueError):
            return jsonify({'error': 'module_id مطلوب'}), 400
        if mid <= 0:
            return jsonify({'error': 'module_id مطلوب'}), 400
        form['module_id'] = str(mid)
    if endpoint in _CACHEABLE:
        key = f'{endpoint}:{sid}:{form.get("module_id", "")}'
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < _CACHE_TTL:
            return jsonify(hit[1]), 200
    try:
        resp, status = _pms_post(endpoint, form)
        if status == 200 and endpoint in _CACHEABLE:
            try:
                _cache[key] = (time.time(), resp.get_json())
            except Exception:
                pass
        return resp, status
    except Exception:
        return jsonify({'error': 'سيرفر الجامعة غير متاح حالياً، حاول لاحقاً'}), 502
