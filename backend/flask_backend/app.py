"""
University Portal Backend
Flask + PostgreSQL (Neon/Render) + JWT auth + files stored in DB + Telegram bot
"""

import asyncio
import base64
import functools
import hashlib
import hmac
import json
import os
import random
import secrets
import string
import threading
import time
from datetime import datetime, timedelta

import bcrypt
import httpx
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy

# ============================================
# CONFIGURATION (environment variables)
# ============================================
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///university.db')
# Render/Neon sometimes gives postgres:// instead of postgresql://
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

JWT_SECRET = os.environ.get('JWT_SECRET', 'change-me-in-production')
ADMIN_USER = os.environ.get('ADMIN_USER', 'admin')
ADMIN_PASS = os.environ.get('ADMIN_PASS', 'admin123')
TG_BOT_TOKEN = os.environ.get('TG_BOT_TOKEN', '')
PORT = int(os.environ.get('PORT', 5000))
EMAIL_API_KEY = os.environ.get('EMAIL_API_KEY', '')
EMAIL_FROM = os.environ.get('EMAIL_FROM', '')

JWT_EXP_SECONDS = 30 * 24 * 60 * 60  # tokens expire after 30 days
ADMIN_PASS_HASH = hashlib.sha256(ADMIN_PASS.encode()).hexdigest()

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')
SITE_ORIGIN = os.environ.get('SITE_ORIGIN', 'https://university-portal-gv78.onrender.com')
CORS(app, origins=[SITE_ORIGIN], supports_credentials=False)


@app.after_request
def set_security_headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'DENY'
    resp.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    resp.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    if request.is_secure or request.headers.get('X-Forwarded-Proto') == 'https':
        resp.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return resp

app.config['SQLALCHEMY_DATABASE_URI'] = DATABASE_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max

db = SQLAlchemy(app)


# ============================================
# JWT AUTHENTICATION (no external lib)
# ============================================
def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def _b64url_decode(data: str) -> bytes:
    padding = '=' * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def make_token(username: str) -> str:
    header = {'alg': 'HS256', 'typ': 'JWT'}
    now = int(time.time())
    payload = {'sub': username, 'iat': now, 'exp': now + JWT_EXP_SECONDS}
    h = _b64url_encode(json.dumps(header, separators=(',', ':')).encode())
    p = _b64url_encode(json.dumps(payload, separators=(',', ':')).encode())
    sig = hmac.new(JWT_SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest()
    return f'{h}.{p}.{_b64url_encode(sig)}'


def decode_token(token: str):
    """Return the payload dict if valid and unexpired, else None."""
    try:
        h, p, s = token.split('.')
        expected = hmac.new(JWT_SECRET.encode(), f'{h}.{p}'.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_decode(s), expected):
            return None
        payload = json.loads(_b64url_decode(p))
        if int(payload.get('exp', 0)) < time.time():
            return None
        return payload
    except Exception:
        return None


def auth_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing bearer token'}), 401
        payload = decode_token(auth_header[len('Bearer '):])
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401
        request.user = payload.get('sub')
        return f(*args, **kwargs)
    return wrapper


def admin_required(f):
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Missing bearer token'}), 401
        payload = decode_token(auth_header[len('Bearer '):])
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401
        username = payload.get('sub')
        if username != ADMIN_USER:
            return jsonify({'error': 'Admin access required'}), 403
        request.user = username
        return f(*args, **kwargs)
    return wrapper


# ============================================
# RATE LIMITER (DB-backed — works across workers)
# ============================================
class RateLimitHit(db.Model):
    __tablename__ = 'rate_limit_hits'
    id = db.Column(db.Integer, primary_key=True)
    bucket = db.Column(db.String(200), index=True)
    ts = db.Column(db.DateTime, default=datetime.utcnow, index=True)


def get_client_ip() -> str:
    """Prefer CF-Connecting-IP (set by Cloudflare, cannot be spoofed)."""
    cf_ip = request.headers.get('CF-Connecting-IP')
    if cf_ip:
        return cf_ip.strip()
    xff = request.headers.get('X-Forwarded-For', '')
    if xff:
        return xff.split(',')[0].strip()
    return request.remote_addr or 'unknown'


def rate_limit(key_prefix: str, max_attempts: int, window_seconds: int) -> bool:
    """Return True if allowed, False if limit exceeded. Shared across workers via DB."""
    ip = get_client_ip()
    now = datetime.utcnow()
    cutoff = now - timedelta(seconds=window_seconds)
    key = f'{key_prefix}:{ip}'
    try:
        hits = RateLimitHit.query.filter(
            RateLimitHit.bucket == key,
            RateLimitHit.ts > cutoff,
        ).count()
        if hits >= max_attempts:
            return False
        db.session.add(RateLimitHit(bucket=key))
        # occasional cleanup of old rows
        if random.random() < 0.05:
            RateLimitHit.query.filter(RateLimitHit.ts < now - timedelta(hours=2)).delete()
        db.session.commit()
        return True
    except Exception:
        db.session.rollback()
        return True  # fail open rather than block legitimate users


# ============================================
# PASSWORD HASHING HELPERS
# ============================================
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def check_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))


def generate_otp() -> str:
    return ''.join(secrets.choice(string.digits) for _ in range(6))


# ============================================
# EMAIL SENDING HELPER (Elastic Email API)
# ============================================
def send_otp_email(email: str, otp_code: str, username: str) -> bool:
    if not EMAIL_API_KEY or not EMAIL_FROM:
        print(f'[EMAIL] EMAIL_API_KEY/EMAIL_FROM not set. OTP for {email}: {otp_code}', flush=True)
        return False
    try:
        html_content = f"""
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head><meta charset="UTF-8"></head>
        <body style="font-family: 'Segoe UI', Tahoma, sans-serif; background: #f1f5f9; padding: 40px;">
            <div style="max-width: 480px; margin: auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
                <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px; text-align: center;">
                    <h1 style="color: #fff; margin: 0; font-size: 1.5rem;">&#127891; منصة الجامعية</h1>
                </div>
                <div style="padding: 32px; text-align: center;">
                    <h2 style="color: #1e293b; margin-bottom: 8px;">مرحباً {username}</h2>
                    <p style="color: #64748b; margin-bottom: 24px;">كود التحقق الخاص بك:</p>
                    <div style="background: #f1f5f9; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
                        <span style="font-size: 2rem; font-weight: 800; color: #6366f1; letter-spacing: 8px;">{otp_code}</span>
                    </div>
                    <p style="color: #94a3b8; font-size: 0.85rem;">صالح لمدة 15 دقيقة فقط</p>
                    <p style="color: #94a3b8; font-size: 0.85rem;">إذا لم تطلب هذا الكود، تجاهل هذه الرسالة</p>
                </div>
            </div>
        </body>
        </html>
        """
        with httpx.Client(timeout=30) as client:
            resp = client.post(
                "https://api.elasticemail.com/v2/email/send",
                data={
                    "apikey": EMAIL_API_KEY,
                    "from": EMAIL_FROM,
                    "to": email,
                    "subject": "كود التحقق - منصة الجامعية",
                    "bodyHtml": html_content,
                },
            )
        result = resp.json()
        if result.get("success"):
            print(f'[EMAIL] OTP sent to {email}: {otp_code}', flush=True)
            return True
        else:
            print(f'[EMAIL] Elastic Email error: {result}', flush=True)
            return False
    except Exception as e:
        print(f'[EMAIL] Failed to send to {email}: {e}', flush=True)
        return False


# ============================================
# DATABASE MODELS
# ============================================
class Subject(db.Model):
    __tablename__ = 'subjects'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    icon = db.Column(db.String(50), default='fa-book')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    files = db.relationship('File', backref='subject', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'icon': self.icon,
            'lectures': [f.to_dict() for f in self.files if f.file_type == 'lecture'],
            'tdtp': [f.to_dict() for f in self.files if f.file_type == 'tdtp'],
        }


class File(db.Model):
    __tablename__ = 'files'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(300), nullable=False)
    filename = db.Column(db.String(500), nullable=False)
    file_type = db.Column(db.String(20), nullable=False)
    size = db.Column(db.String(20))
    content = db.Column(db.LargeBinary)  # file binary stored in DB
    mime_type = db.Column(db.String(100), default='application/pdf')
    subject_id = db.Column(db.Integer, db.ForeignKey('subjects.id'), nullable=False)
    telegram_file_id = db.Column(db.String(500))
    uploaded_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'file': self.filename,
            'size': self.size,
            'type': self.file_type,
        }


class Exam(db.Model):
    __tablename__ = 'exams'
    id = db.Column(db.Integer, primary_key=True)
    subject_name = db.Column(db.String(200), nullable=False)
    date = db.Column(db.String(50))
    time = db.Column(db.String(50))
    location = db.Column(db.String(200))
    semester = db.Column(db.String(10), nullable=False, default='sem1')  # sem1 | sem2
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'subject_name': self.subject_name,
            'date': self.date,
            'time': self.time,
            'location': self.location,
            'semester': self.semester,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class VisitLog(db.Model):
    __tablename__ = 'visit_log'
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    ip_address = db.Column(db.String(50))


class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(200), unique=True, nullable=False)
    username = db.Column(db.String(100), nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    is_verified = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'username': self.username,
            'is_verified': self.is_verified,
        }


class PasswordResetToken(db.Model):
    __tablename__ = 'password_reset_tokens'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    otp_code = db.Column(db.String(6), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    used = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class ScheduleCell(db.Model):
    __tablename__ = 'schedule_cells'
    id = db.Column(db.Integer, primary_key=True)
    cell_key = db.Column(db.String(50), unique=True, nullable=False)
    cell_text = db.Column(db.Text, default='')
    cell_type = db.Column(db.String(20), default='')

    def to_dict(self):
        return {'key': self.cell_key, 'text': self.cell_text, 'type': self.cell_type}


# ============================================
# SERVE FRONTEND & STATIC FILES
# ============================================
@app.route('/')
def serve_index():
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.route('/manifest.json')
def serve_manifest():
    return send_from_directory(FRONTEND_DIR, 'manifest.json')


@app.route('/service-worker.js')
def serve_service_worker():
    return send_from_directory(FRONTEND_DIR, 'service-worker.js')


@app.route('/css/<path:filename>')
def serve_css(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'css'), filename)


@app.route('/js/<path:filename>')
def serve_js(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'js'), filename)


@app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, 'assets'), filename)


@app.route('/<path:path>')
def serve_static(path):
    file_path = os.path.join(FRONTEND_DIR, path)
    if os.path.isfile(file_path):
        return send_from_directory(FRONTEND_DIR, path)
    return send_from_directory(FRONTEND_DIR, 'index.html')


# ============================================
# FILE SERVING - from database
# ============================================
@app.route('/files/<path:filename>')
def serve_uploaded_file(filename):
    try:
        f = File.query.filter_by(filename=filename).first()
        if not f:
            print(f'[FILE] Not found in DB: {filename}', flush=True)
            return jsonify({'error': 'File not found'}), 404

        content = f.content
        if content is None:
            print(f'[FILE] Content is None for: {filename} (id={f.id})', flush=True)
            return jsonify({'error': 'File content is empty'}), 404

        # Ensure content is bytes (not memoryview from PostgreSQL)
        if not isinstance(content, bytes):
            content = bytes(content)

        if len(content) == 0:
            print(f'[FILE] Content is empty (0 bytes) for: {filename}', flush=True)
            return jsonify({'error': 'File content is empty'}), 404

        response = Response(content)
        response.headers['Content-Type'] = f.mime_type or 'application/pdf'
        safe_name = ''.join(c if c.isascii() and c not in '";\\' else '_' for c in f.name)
        response.headers['Content-Disposition'] = f'inline; filename="{safe_name}.pdf"'
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Cache-Control'] = 'public, max-age=3600'
        print(f'[FILE] Serving {filename} ({len(content)} bytes)', flush=True)
        return response
    except Exception as e:
        import traceback
        print(f'[FILE] Error serving {filename}: {e}', flush=True)
        traceback.print_exc()
        return jsonify({'error': 'File serving error', 'detail': str(e)}), 500


# ============================================
# PUBLIC API (no auth)
# ============================================
@app.route('/api/subjects', methods=['GET'])
@auth_required
def get_subjects():
    subjects = Subject.query.order_by(Subject.id).all()
    return jsonify([s.to_dict() for s in subjects])


@app.route('/api/exams', methods=['GET'])
@auth_required
def get_exams():
    semester = request.args.get('semester')
    query = Exam.query.order_by(Exam.date)
    if semester:
        query = query.filter_by(semester=semester)
    return jsonify([e.to_dict() for e in query.all()])


@app.route('/api/stats')
def get_stats():
    return jsonify({
        'visits': VisitLog.query.count(),
        'files': File.query.count(),
        'subjects': Subject.query.count(),
        'exams': Exam.query.count(),
    })


@app.route('/api/visit', methods=['POST'])
def log_visit():
    ip = request.headers.get('X-Forwarded-For', request.remote_addr or '')
    ip = ip.split(',')[0].strip()
    db.session.add(VisitLog(ip_address=ip[:50]))
    db.session.commit()
    return jsonify({'message': 'visit logged'}), 201


# ============================================
# PUBLIC GUEST API (schedule & exams only, no file data)
# ============================================
@app.route('/api/guest/exams', methods=['GET'])
def get_public_exams():
    semester = request.args.get('semester')
    query = Exam.query.order_by(Exam.date)
    if semester:
        query = query.filter_by(semester=semester)
    return jsonify([e.to_dict() for e in query.all()])


# ============================================
# PROGRES PROXY (pass-through only — NO credential storage)
# Student credentials are forwarded to progres.mesrs.dz and immediately
# discarded. Only the session token lives in the student's own browser.
# ============================================
PROGRES_BASE = 'https://progres.mesrs.dz'
_progres_client = httpx.Client(
    timeout=30,
    headers={
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    },
)


def _progres_get(path: str, token: str):
    """Forward a GET to Progres with the student's own token. Whitelisted paths only."""
    try:
        r = _progres_client.get(f'{PROGRES_BASE}{path}', headers={'authorization': token})
        return Response(r.content, status=r.status_code, mimetype='application/json')
    except Exception as e:
        app.logger.error('Progres GET %s failed: %s: %s', path, type(e).__name__, str(e)[:200])
        return jsonify({'error': 'خوادم بروقرس لا تستجيب حالياً، حاول لاحقاً'}), 502


@app.route('/api/progres/login', methods=['POST'])
def progres_login():
    # 6 login attempts / 5 min / IP — protects students from brute-force on their accounts
    if not rate_limit('progres_login', 6, 300):
        return jsonify({'error': 'محاولات كثيرة جداً، انتظر 5 دقائق'}), 429

    data = request.get_json(silent=True) or {}
    username = data.get('username')
    password = data.get('password')
    if not isinstance(username, str) or not isinstance(password, str):
        return jsonify({'error': 'بيانات غير صحيحة'}), 400
    username = username.strip()
    if not username or not password or len(username) > 50 or len(password) > 100:
        return jsonify({'error': 'أدخل اسم المستخدم وكلمة المرور'}), 400

    try:
        r = _progres_client.post(
            f'{PROGRES_BASE}/api/authentication/v1/',
            json={'username': username, 'password': password},
        )
        # Pass through response as-is (token+uuid go to the student's browser only)
        return Response(r.content, status=r.status_code, mimetype='application/json')
    except Exception as e:
        app.logger.error('Progres login failed: %s: %s', type(e).__name__, str(e)[:200])
        return jsonify({'error': 'خوادم بروقرس لا تستجيب حالياً، حاول لاحقاً'}), 502


@app.route('/api/progres/debug', methods=['GET'])
def progres_debug():
    """Temporary connectivity diagnostic — remove once Progres access is confirmed."""
    result = {}
    t0 = time.time()
    try:
        r = _progres_client.post(
            f'{PROGRES_BASE}/api/authentication/v1/',
            json={'username': 'probe', 'password': 'probe'},
        )
        result['reachable'] = True
        result['status'] = r.status_code
        result['elapsed_s'] = round(time.time() - t0, 2)
        result['body'] = r.text[:150]
    except Exception as e:
        result['reachable'] = False
        result['exception'] = type(e).__name__
        result['message'] = str(e)[:300]
        result['elapsed_s'] = round(time.time() - t0, 2)
    return jsonify(result)


@app.route('/api/progres/me', methods=['GET'])
def progres_me():
    if not rate_limit('progres_fetch', 30, 60):
        return jsonify({'error': 'طلبات كثيرة، انتظر قليلاً'}), 429
    token = request.headers.get('Authorization', '')
    if not token or len(token) > 2000:
        return jsonify({'error': 'جلسة غير صالحة'}), 401
    return _progres_get('/api/infos/bac/{uuid}/individu'.replace('{uuid}', request.args.get('uuid', '')), token) \
        if request.args.get('uuid') else (jsonify({'error': 'uuid مطلوب'}), 400)


@app.route('/api/progres/cards', methods=['GET'])
def progres_cards():
    if not rate_limit('progres_fetch', 30, 60):
        return jsonify({'error': 'طلبات كثيرة، انتظر قليلاً'}), 429
    token = request.headers.get('Authorization', '')
    uuid = request.args.get('uuid', '')
    if not token or len(token) > 2000 or not uuid or len(uuid) > 100:
        return jsonify({'error': 'جلسة غير صالحة'}), 401
    return _progres_get(f'/api/infos/bac/{uuid}/dias', token)


@app.route('/api/progres/transcripts/<card_id>', methods=['GET'])
def progres_transcripts(card_id):
    if not rate_limit('progres_fetch', 30, 60):
        return jsonify({'error': 'طلبات كثيرة، انتظر قليلاً'}), 429
    token = request.headers.get('Authorization', '')
    uuid = request.args.get('uuid', '')
    if not token or len(token) > 2000 or not uuid or not card_id.isdigit():
        return jsonify({'error': 'طلب غير صالح'}), 400
    return _progres_get(f'/api/infos/bac/{uuid}/dias/{card_id}/periode/bilans', token)


@app.route('/api/progres/exams/<card_id>', methods=['GET'])
def progres_exam_grades(card_id):
    if not rate_limit('progres_fetch', 30, 60):
        return jsonify({'error': 'طلبات كثيرة، انتظر قليلاً'}), 429
    token = request.headers.get('Authorization', '')
    if not token or len(token) > 2000 or not card_id.isdigit():
        return jsonify({'error': 'طلب غير صالح'}), 400
    return _progres_get(f'/api/infos/planningSession/dia/{card_id}/noteExamens', token)


@app.route('/api/progres/cc/<card_id>', methods=['GET'])
def progres_cc_grades(card_id):
    if not rate_limit('progres_fetch', 30, 60):
        return jsonify({'error': 'طلبات كثيرة، انتظر قليلاً'}), 429
    token = request.headers.get('Authorization', '')
    if not token or len(token) > 2000 or not card_id.isdigit():
        return jsonify({'error': 'طلب غير صالح'}), 400
    return _progres_get(f'/api/infos/controleContinue/dia/{card_id}/notesCC', token)


# ============================================
# SCHEDULE API (public GET, admin POST)
# ============================================
@app.route('/api/schedule', methods=['GET'])
def get_schedule():
    cells = ScheduleCell.query.all()
    data = {c.cell_key: {'text': c.cell_text, 'type': c.cell_type} for c in cells}
    return jsonify(data)


@app.route('/api/schedule', methods=['POST'])
@admin_required
def save_schedule():
    data = request.get_json(silent=True) or {}
    schedule_data = data.get('schedule', {})
    if not isinstance(schedule_data, dict):
        return jsonify({'error': 'Invalid data'}), 400
    ScheduleCell.query.delete()
    for key, val in schedule_data.items():
        cell = ScheduleCell(
            cell_key=key,
            cell_text=val.get('text', ''),
            cell_type=val.get('type', ''),
        )
        db.session.add(cell)
    db.session.commit()
    return jsonify({'message': 'Schedule saved'}), 200


# ============================================
# AUTH API - User Registration, Login, Password Reset
# ============================================
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    email = data.get('email')
    username = data.get('username')
    password = data.get('password', '')

    if not all(isinstance(x, str) for x in (email, username, password)):
        return jsonify({'error': 'بيانات غير صحيحة'}), 400
    email = email.strip().lower()
    username = username.strip()
    if not email or not username or not password:
        return jsonify({'error': 'جميع الحقول مطلوبة'}), 400
    if len(password) < 6:
        return jsonify({'error': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'}), 400
    if '@' not in email or len(email) > 200 or len(username) > 50:
        return jsonify({'error': 'بيانات غير صالحة'}), 400

    existing_user = User.query.filter_by(email=email).first()
    if existing_user and existing_user.is_verified:
        return jsonify({'error': 'البريد الإلكتروني مستخدم بالفعل'}), 409
    existing_username = User.query.filter_by(username=username).first()
    if existing_username and (
        not existing_user or existing_username.id != existing_user.id
    ):
        return jsonify({'error': 'اسم المستخدم مستخدم بالفعل'}), 409

    if existing_user:
        # Unverified account: allow re-registration by updating the existing user
        existing_user.username = username
        existing_user.password_hash = hash_password(password)
        user = existing_user
    else:
        user = User(
            email=email,
            username=username,
            password_hash=hash_password(password),
            is_verified=False,
        )
        db.session.add(user)
    db.session.commit()

    # Generate and send OTP for email verification
    otp = generate_otp()
    reset_token = PasswordResetToken(
        user_id=user.id,
        otp_code=otp,
        expires_at=datetime.utcnow().replace(
            hour=datetime.utcnow().hour,
            minute=datetime.utcnow().minute + 15
        ) if datetime.utcnow().minute + 15 < 60 else datetime.utcnow().replace(
            hour=datetime.utcnow().hour + 1,
            minute=(datetime.utcnow().minute + 15) % 60
        ),
    )
    db.session.add(reset_token)
    db.session.commit()
    send_otp_email(email, otp, username)

    return jsonify({
        'message': 'تم التسجيل بنجاح',
        'user': user.to_dict(),
    }), 201


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    raw_login = data.get('email') or data.get('username') or ''
    password = data.get('password', '')

    # Strict type validation — reject non-string payloads with 400, never 500
    if not isinstance(raw_login, str) or not isinstance(password, str):
        return jsonify({'error': 'بيانات غير صحيحة'}), 400
    login_id = raw_login.strip()
    if not login_id or not password or len(login_id) > 200 or len(password) > 200:
        return jsonify({'error': 'أدخل بيانات صحيحة'}), 400

    # Rate limit: 5 login attempts per minute per IP
    if not rate_limit('login', 5, 60):
        return jsonify({'error': 'محاولات كثيرة جداً، انتظر دقيقة وأعد المحاولة'}), 429

    # Check admin first (constant-time comparison to prevent timing attacks)
    admin_user_match = hmac.compare_digest(login_id.encode(), ADMIN_USER.encode())
    admin_pass_match = hmac.compare_digest(password.encode(), ADMIN_PASS.encode())
    if admin_user_match and admin_pass_match:
        return jsonify({
            'token': make_token(ADMIN_USER),
            'username': ADMIN_USER,
            'role': 'admin',
            'expires_in': JWT_EXP_SECONDS,
        })

    # Check regular users
    user = User.query.filter(
        (User.email == login_id.lower()) | (User.username == login_id)
    ).first()

    if not user or not check_password(password, user.password_hash):
        return jsonify({'error': 'بيانات الدخول غير صحيحة'}), 401

    return jsonify({
        'token': make_token(user.username),
        'username': user.username,
        'email': user.email,
        'role': 'student',
        'is_verified': user.is_verified,
        'expires_in': JWT_EXP_SECONDS,
    })


@app.route('/api/auth/forgot-password', methods=['POST'])
def forgot_password():
    # Rate limit: 3 requests per 10 minutes per IP
    if not rate_limit('forgot_pw', 3, 600):
        return jsonify({'error': 'محاولات كثيرة جداً، انتظر 10 دقائق وأعد المحاولة'}), 429

    data = request.get_json(silent=True) or {}
    email = data.get('email')

    if not isinstance(email, str):
        return jsonify({'error': 'بيانات غير صحيحة'}), 400
    email = email.strip().lower()
    if not email or len(email) > 200:
        return jsonify({'error': 'أدخل البريد الإلكتروني'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        # Don't reveal if email exists
        return jsonify({'message': 'إذا كان البريد مسجلاً، ستتلقى رسالة التحقق'}), 200

    # Invalidate old tokens
    PasswordResetToken.query.filter_by(user_id=user.id, used=False).update({'used': True})
    db.session.commit()

    # Create new OTP (expires in 15 minutes)
    otp = generate_otp()
    reset_token = PasswordResetToken(
        user_id=user.id,
        otp_code=otp,
        expires_at=datetime.utcnow() + timedelta(minutes=15),
    )
    db.session.add(reset_token)
    db.session.commit()
    send_otp_email(email, otp, user.username)

    return jsonify({'message': 'إذا كان البريد مسجلاً، ستتلقى رسالة التحقق'}), 200


@app.route('/api/auth/verify-otp', methods=['POST'])
def verify_otp():
    # Rate limit: 10 verification attempts per 15 minutes per IP
    if not rate_limit('otp_verify', 10, 900):
        return jsonify({'error': 'محاولات كثيرة جداً، انتظر 15 دقيقة وأعد المحاولة'}), 429

    data = request.get_json(silent=True) or {}
    email = data.get('email')
    otp_code = data.get('otp')

    if not isinstance(email, str) or not isinstance(otp_code, str):
        return jsonify({'error': 'بيانات غير صحيحة'}), 400
    email = email.strip().lower()
    otp_code = otp_code.strip()
    if not email or not otp_code:
        return jsonify({'error': 'أدخل البريد الإلكتروني وكود التحقق'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'بريد غير مسجل'}), 404

    # Count recent failed OTP attempts for this email (cross-worker, DB-backed).
    now = datetime.utcnow()
    fail_key = f'otp_fail:{email}'
    recent_fails = RateLimitHit.query.filter(
        RateLimitHit.bucket == fail_key,
        RateLimitHit.ts > now - timedelta(minutes=15),
    ).count()

    token = PasswordResetToken.query.filter_by(
        user_id=user.id, otp_code=otp_code, used=False
    ).order_by(PasswordResetToken.id.desc()).first()

    if not token or token.expires_at < now:
        db.session.add(RateLimitHit(bucket=fail_key))
        # After 5 wrong codes, invalidate all active tokens for this email
        if recent_fails + 1 >= 5:
            PasswordResetToken.query.filter_by(user_id=user.id, used=False).update({'used': True})
            db.session.commit()
            return jsonify({'error': 'محاولات كثيرة خاطئة، اطلب كوداً جديداً'}), 429
        db.session.commit()
        return jsonify({'error': 'كود التحقق غير صحيح'}), 400

    # Mark as used
    token.used = True
    db.session.commit()

    # Generate a reset token for password reset
    reset_token_str = secrets.token_urlsafe(32)
    reset_token_record = PasswordResetToken(
        user_id=user.id,
        otp_code=reset_token_str[:6],  # reuse field for token
        expires_at=datetime.utcnow() + timedelta(minutes=15),
    )
    db.session.add(reset_token_record)
    db.session.commit()

    return jsonify({
        'message': 'تم التحقق بنجاح',
        'reset_token': reset_token_str,
    }), 200


@app.route('/api/auth/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    reset_token = data.get('reset_token', '')
    new_password = data.get('new_password', '')

    if not email or not reset_token or not new_password:
        return jsonify({'error': 'جميع الحقول مطلوبة'}), 400
    if len(new_password) < 6:
        return jsonify({'error': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({'error': 'بريد غير مسجل'}), 404

    token = PasswordResetToken.query.filter_by(
        user_id=user.id, used=False
    ).order_by(PasswordResetToken.id.desc()).first()

    if not token or token.otp_code != reset_token[:6]:
        return jsonify({'error': 'رمز غير صالح'}), 400
    if token.expires_at < datetime.utcnow():
        return jsonify({'error': 'انتهت صلاحية الرابط'}), 400

    # Update password
    user.password_hash = hash_password(new_password)
    token.used = True
    db.session.commit()

    return jsonify({'message': 'تم تغيير كلمة المرور بنجاح'}), 200


@app.route('/api/auth/verify-email/<token>', methods=['GET'])
def verify_email(token):
    """Optional: email verification link"""
    user = User.query.filter_by(is_verified=False).first()
    # Simple implementation - verify by OTP
    return jsonify({'message': 'Email verification endpoint'}), 200


@app.route('/api/auth/me', methods=['GET'])
@auth_required
def get_me():
    username = request.user
    if username == ADMIN_USER:
        return jsonify({'username': ADMIN_USER, 'role': 'admin', 'email': 'admin'})
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify({**user.to_dict(), 'role': 'student'})


# ============================================
# PROTECTED ADMIN API
# ============================================
@app.route('/api/admin/subjects', methods=['POST'])
@auth_required
def create_subject():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    subject = Subject(name=name, icon=data.get('icon', 'fa-book'))
    db.session.add(subject)
    db.session.commit()
    return jsonify(subject.to_dict()), 201


@app.route('/api/admin/subjects/<int:subject_id>', methods=['DELETE'])
@auth_required
def delete_subject(subject_id):
    subject = Subject.query.get(subject_id)
    if not subject:
        return jsonify({'error': 'Subject not found'}), 404
    db.session.delete(subject)
    db.session.commit()
    return jsonify({'message': 'deleted'})


@app.route('/api/admin/exams', methods=['POST'])
@auth_required
def create_exam():
    data = request.get_json(silent=True) or {}
    subject_name = (data.get('subject_name') or '').strip()
    semester = data.get('semester', 'sem1')
    if not subject_name:
        return jsonify({'error': 'subject_name is required'}), 400
    if semester not in ('sem1', 'sem2'):
        return jsonify({'error': "semester must be 'sem1' or 'sem2'"}), 400
    exam = Exam(
        subject_name=subject_name,
        date=data.get('date'),
        time=data.get('time'),
        location=data.get('location'),
        semester=semester,
    )
    db.session.add(exam)
    db.session.commit()
    return jsonify(exam.to_dict()), 201


@app.route('/api/admin/exams/<int:exam_id>', methods=['DELETE'])
@auth_required
def delete_exam(exam_id):
    exam = Exam.query.get(exam_id)
    if not exam:
        return jsonify({'error': 'Exam not found'}), 404
    db.session.delete(exam)
    db.session.commit()
    return jsonify({'message': 'deleted'})


# ============================================
# TELEGRAM BOT - Integrated in Flask process
# Token comes from TG_BOT_TOKEN env var.
# Uploaded files are stored as binary in the DB.
# ============================================
user_sessions = {}


def get_subjects_from_db():
    with app.app_context():
        return [(s.id, s.name) for s in Subject.query.order_by(Subject.id).all()]


def build_subject_keyboard():
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    subjects = get_subjects_from_db()
    keyboard = []
    row = []
    for i, (sid, name) in enumerate(subjects):
        row.append(InlineKeyboardButton(name, callback_data=f'pick_subject_{sid}'))
        if len(row) == 2 or i == len(subjects) - 1:
            keyboard.append(row)
            row = []
    return InlineKeyboardMarkup(keyboard)


async def send_subject_list(update, context):
    text = 'اختر المادة:'
    if update.callback_query:
        await update.callback_query.edit_message_text(text, reply_markup=build_subject_keyboard())
    else:
        await update.message.reply_text(text, reply_markup=build_subject_keyboard())


async def cmd_start(update, context):
    chat_id = update.effective_chat.id
    user_sessions.pop(chat_id, None)
    await send_subject_list(update, context)


async def cmd_help(update, context):
    await update.message.reply_text(
        'الهدف: رفع ملفات الدروس للموقع\n\n'
        '1. ابدأ بـ /start\n'
        '2. اختر المادة\n'
        '3. اختر نوع الملف\n'
        '4. أرسل الملف\n\n'
        'الملفات المدعومة: PDF, DOC, DOCX, PPT, ZIP\n'
        'إلغاء: /cancel'
    )


async def cmd_cancel(update, context):
    chat_id = update.effective_chat.id
    user_sessions.pop(chat_id, None)
    await update.message.reply_text('تم الإلغاء. ابدأ من جديد بـ /start')


async def on_callback(update, context):
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    query = update.callback_query
    chat_id = query.message.chat.id
    data = query.data

    if data.startswith('pick_subject_'):
        subject_id = int(data.split('_')[-1])
        subjects = get_subjects_from_db()
        subject_name = next((n for sid, n in subjects if sid == subject_id), None)
        if not subject_name:
            await query.answer('مادة غير موجودة')
            return
        user_sessions[chat_id] = {'step': 'choose_type', 'subject_id': subject_id}
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton('محاضرة', callback_data='pick_type_lecture')],
            [InlineKeyboardButton('عمل تطبيقي (TD/TP)', callback_data='pick_type_tdtp')],
            [InlineKeyboardButton('رجوع للقائمة', callback_data='back_to_list')],
        ])
        await query.answer()
        await query.edit_message_text(f'المادة: {subject_name}\n\nالآن اختر نوع الملف:', reply_markup=keyboard)

    elif data.startswith('pick_type_'):
        file_type = data.replace('pick_type_', '')
        session = user_sessions.get(chat_id)
        if not session:
            await query.answer('انتهت الجلسة، ابدأ بـ /start')
            return
        session['step'] = 'wait_file'
        session['file_type'] = file_type
        subjects = get_subjects_from_db()
        subject_name = next((n for sid, n in subjects if sid == session['subject_id']), '')
        type_label = 'محاضرة' if file_type == 'lecture' else 'عمل تطبيقي (TD/TP)'
        await query.answer()
        await query.edit_message_text(
            f'المادة: {subject_name}\nالنوع: {type_label}\n\n'
            f'الآن أرسل الملف مباشرة هنا.\n'
            f'(PDF, DOC, DOCX, PPT, ZIP)'
        )

    elif data == 'back_to_list':
        user_sessions.pop(chat_id, None)
        await query.answer()
        await query.edit_message_text('اختر المادة:', reply_markup=build_subject_keyboard())

    elif data == 'upload_more':
        await query.answer()
        await send_subject_list(update, context)


MIME_MAP = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
}


async def on_document(update, context):
    chat_id = update.effective_chat.id
    doc = update.message.document
    if not doc:
        return

    session = user_sessions.get(chat_id)
    if not session or session.get('step') != 'wait_file':
        await update.message.reply_text(
            'لم تختر المادة بعد.\nابدأ بـ /start ثم اختر المادة والنوع أولاً.'
        )
        return

    await update.message.reply_text('جاري رفع الملف...')

    try:
        tg_file = await context.bot.get_file(doc.file_id)
        filename = doc.file_name
        file_bytes = await tg_file.download_as_bytearray()

        size_bytes = len(file_bytes)
        size_str = (f'{size_bytes / (1024 * 1024):.1f} MB'
                    if size_bytes > 1024 * 1024
                    else f'{size_bytes / 1024:.0f} KB')
        lesson_name = os.path.splitext(filename)[0]
        ext = os.path.splitext(filename)[1].lower()
        mime_type = MIME_MAP.get(ext, 'application/octet-stream')

        with app.app_context():
            new_file = File(
                name=lesson_name,
                filename=filename,
                file_type=session['file_type'],
                size=size_str,
                content=bytes(file_bytes),
                mime_type=mime_type,
                subject_id=session['subject_id'],
                telegram_file_id=doc.file_id,
            )
            db.session.add(new_file)
            db.session.commit()
            subject = Subject.query.get(session['subject_id'])
            subject_name = subject.name if subject else ''

        type_label = 'محاضرة' if session['file_type'] == 'lecture' else 'عمل تطبيقي'
        user_sessions.pop(chat_id, None)

        from telegram import InlineKeyboardButton, InlineKeyboardMarkup

        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton('رفع ملف آخر', callback_data='upload_more')],
            [InlineKeyboardButton('القائمة الرئيسية', callback_data='back_to_list')],
        ])
        await update.message.reply_text(
            f'تم الرفع بنجاح\n\n'
            f'الملف: {filename}\n'
            f'المادة: {subject_name}\n'
            f'النوع: {type_label}\n'
            f'الحجم: {size_str}',
            reply_markup=keyboard,
        )
    except Exception as e:
        print(f'[BOT] Error handling document: {e}', flush=True)
        user_sessions.pop(chat_id, None)
        await update.message.reply_text('حدث خطأ أثناء رفع الملف. حاول بـ /start')


def run_bot():
    while True:
        try:
            import telegram.ext
            from telegram.ext import Application, CommandHandler, CallbackQueryHandler, MessageHandler, filters
            import _thread as _tb

            print('[BOT] Starting bot...', flush=True)
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            application = (Application.builder()
                           .token(TG_BOT_TOKEN)
                           .bootstrap_retries(5)
                           .build())
            application.add_handler(CommandHandler('start', cmd_start))
            application.add_handler(CommandHandler('help', cmd_help))
            application.add_handler(CommandHandler('cancel', cmd_cancel))
            application.add_handler(CommandHandler('subjects', cmd_start))
            application.add_handler(CallbackQueryHandler(on_callback))
            application.add_handler(MessageHandler(filters.Document.ALL, on_document))

            async def safe_start():
                try:
                    await application.initialize()
                    await application.start()
                    await application.updater.start_polling(
                        drop_pending_updates=True,
                        read_timeout=30,
                        connect_timeout=30,
                    )
                    print('[BOT] Polling started successfully', flush=True)
                except Exception as e:
                    print(f'[BOT] Init error: {e}', flush=True)
                    _tb.print_exc()

            loop.run_until_complete(safe_start())

            try:
                loop.run_forever()
            except (KeyboardInterrupt, SystemExit):
                print('[BOT] Shutting down...', flush=True)
                break
        except Exception as e:
            print(f'[BOT] Bot crashed: {e}. Retrying in 10s...', flush=True)
            import traceback
            traceback.print_exc()
            time.sleep(10)


def start_bot_thread():
    bot_thread = threading.Thread(target=run_bot, daemon=True, name='telegram-bot')
    bot_thread.start()


# ============================================
# INITIALIZE
# ============================================
with app.app_context():
    db.create_all()
    if Subject.query.count() == 0:
        default_subjects = [
            Subject(name='المحاسبة المالية', icon='fa-calculator'),
            Subject(name='التمويل الخارجي', icon='fa-money-bill-trend-up'),
            Subject(name='القانون التجاري', icon='fa-scale-balanced'),
            Subject(name='الاقتصاد القياسي', icon='fa-chart-line'),
            Subject(name='اللغة الإنجزية', icon='fa-language'),
            Subject(name='أساسيات التسويق', icon='fa-bullseye'),
            Subject(name='المحاسبة التحليلية', icon='fa-chart-pie'),
            Subject(name='النظام الضريبي', icon='fa-file-invoice-dollar'),
            Subject(name='نظم المعلومات المحاسبية', icon='fa-database'),
        ]
        db.session.add_all(default_subjects)
        db.session.commit()
        print('[INIT] Seeded 9 default subjects', flush=True)

if TG_BOT_TOKEN:
    try:
        start_bot_thread()
        print(f'[BOT] Telegram bot thread started with token: {TG_BOT_TOKEN[:10]}...', flush=True)
    except Exception as e:
        print(f'[BOT] Failed to start: {e}', flush=True)
else:
    print('[BOT] TG_BOT_TOKEN not set - skipping bot startup', flush=True)

print(f'[INIT] University portal backend starting on port {PORT}', flush=True)
print(f"[INIT] Database: {'postgresql' if DATABASE_URL.startswith('postgresql') else 'sqlite'}", flush=True)
print(f'[INIT] Admin user: {ADMIN_USER}', flush=True)


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=PORT)
