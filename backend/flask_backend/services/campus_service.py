"""
تفويض قسم جامعتي عبر الخادم (قراءة القائمة عامة، الكتابة للمالك فقط).

الخلفية: قائمة المفوضين كانت في localStorage هاتف المالك فقط، فلا يراها
أي هاتف آخر. هنا القائمة في جدول `campus_delegates` والهواتف تزامنه.

إثبات المالك بلا أسرار جديدة: هاتف المالك يرسل توكن Progres الحالي،
والخادم (1) يفك حمولة JWT ويتحقق أن userName هو المالك وأن exp ساري،
(2) يتحقق حياً من التوكن ضد خوادم الوزارة (أي 401 = مرفوض).
كلمات السر لا تُستقبل ولا تُخزن أبداً — التوكن وحده، ويُنسى فوراً.
"""

import base64
import json
import os
import time

try:
    from . import _http as requests
except ImportError:
    import requests
from flask import Blueprint, jsonify, request
from sqlalchemy import create_engine, text

bp = Blueprint('campus', __name__, url_prefix='/api/campus')

CAMPUS_OWNER = '202536255705'
WEBETU = 'https://api-webetu.mesrs.dz/api/infos'

_ENGINE_OBJ = None


def _engine():
    global _ENGINE_OBJ
    if _ENGINE_OBJ is None:
        url = os.environ.get('DATABASE_URL', 'sqlite:///university.db')
        if url.startswith('postgres://'):
            url = url.replace('postgres://', 'postgresql://', 1)
        _ENGINE_OBJ = create_engine(url, pool_pre_ping=True,
                                    pool_recycle=280, future=True)
    return _ENGINE_OBJ


try:
    with _engine().connect() as _c:
        _c.execute(text('''CREATE TABLE IF NOT EXISTS campus_delegates (
            owner_mat TEXT NOT NULL,
            delegate_mat TEXT NOT NULL,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (owner_mat, delegate_mat))'''))
        _c.commit()
except Exception:
    pass

_session = requests.Session()
_session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    'Accept': 'application/json',
})

# حد الكتابة: 8 عمليات / 10 دقائق / IP (ضد العبث بالقائمة).
_write_hits = {}


def _write_allowed(ip: str) -> bool:
    now = time.time()
    hits = [t for t in _write_hits.get(ip, []) if now - t < 600]
    if len(hits) >= 8:
        _write_hits[ip] = hits
        return False
    hits.append(now)
    _write_hits[ip] = hits[-8:]
    return True


def _jwt_claims(token: str):
    try:
        part = str(token or '').split('.')[1]
        part += '=' * (-len(part) % 4)
        data = json.loads(base64.b64decode(part).decode('utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _owner_verified(token) -> bool:
    """توكن Progres حي لمالك القسم؟ (بلا تخزين)."""
    if not isinstance(token, str) or not token or len(token) > 4000:
        return False
    claims = _jwt_claims(token)
    try:
        if str(claims.get('userName') or '') != CAMPUS_OWNER:
            return False
        if float(claims.get('exp') or 0) <= time.time():
            return False
        uuid = str(claims.get('uuid') or '')
        if not uuid:
            return False
    except Exception:
        return False
    # تحقق حي: أي 401 يعني توكن ميت/مزور. 404 مقبول (توكن صالح بلا بيانات).
    try:
        ind = claims.get('idIndividu')
        dias = str(claims.get('dias') or '').split(',')[0].strip()
        headers = {'authorization': token}
        if ind:
            headers['x-ind-id'] = str(ind)
        if dias and len(dias) <= 40:
            headers['x-dia-id'] = dias
        r = _session.get(f'{WEBETU}/bac/{uuid}/quitus', headers=headers, timeout=12)
        return r.status_code in (200, 404)
    except Exception:
        return False


def _delegates():
    try:
        with _engine().connect() as c:
            rows = c.execute(
                text('SELECT delegate_mat FROM campus_delegates WHERE owner_mat = :o ORDER BY added_at'),
                {'o': CAMPUS_OWNER}).fetchall()
        return [str(r[0]) for r in rows]
    except Exception:
        return []


@bp.get('/access')
def access():
    mat = (request.args.get('matricule') or '').strip()
    if mat == CAMPUS_OWNER:
        return jsonify({'level': 'owner'})
    if mat and mat in _delegates():
        return jsonify({'level': 'campus'})
    return jsonify({'level': 'none'})


@bp.get('/delegates')
def list_delegates():
    return jsonify({'delegates': _delegates()})


@bp.post('/delegates')
def add_delegate():
    ip = (request.headers.get('X-Forwarded-For', request.remote_addr or '') or '').split(',')[0].strip()
    if not _write_allowed(ip):
        return jsonify({'error': 'محاولات كثيرة، انتظر قليلاً'}), 429
    data = request.get_json(silent=True) or {}
    if not _owner_verified(data.get('owner_token')):
        return jsonify({'error': 'غير مصرح — سجل دخول المالك أولاً'}), 403
    mat = str(data.get('matricule') or '').strip()
    if not mat.isdigit() or not (8 <= len(mat) <= 20) or mat == CAMPUS_OWNER:
        return jsonify({'error': 'رقم تسجيل غير صالح'}), 400
    try:
        with _engine().connect() as c:
            c.execute(
                text('INSERT INTO campus_delegates (owner_mat, delegate_mat) VALUES (:o, :m) '
                     'ON CONFLICT (owner_mat, delegate_mat) DO NOTHING'
                     if 'postgresql' in str(_engine().url) else
                     'INSERT OR IGNORE INTO campus_delegates (owner_mat, delegate_mat) VALUES (:o, :m)'),
                {'o': CAMPUS_OWNER, 'm': mat})
            c.commit()
    except Exception:
        return jsonify({'error': 'تعذر الحفظ، حاول لاحقاً'}), 500
    return jsonify({'delegates': _delegates()})


@bp.delete('/delegates')
def remove_delegate():
    ip = (request.headers.get('X-Forwarded-For', request.remote_addr or '') or '').split(',')[0].strip()
    if not _write_allowed(ip):
        return jsonify({'error': 'محاولات كثيرة، انتظر قليلاً'}), 429
    data = request.get_json(silent=True) or {}
    if not _owner_verified(data.get('owner_token')):
        return jsonify({'error': 'غير مصرح — سجل دخول المالك أولاً'}), 403
    mat = str(data.get('matricule') or '').strip()
    try:
        with _engine().connect() as c:
            c.execute(
                text('DELETE FROM campus_delegates WHERE owner_mat = :o AND delegate_mat = :m'),
                {'o': CAMPUS_OWNER, 'm': mat})
            c.commit()
    except Exception:
        return jsonify({'error': 'تعذر الحذف، حاول لاحقاً'}), 500
    return jsonify({'delegates': _delegates()})
