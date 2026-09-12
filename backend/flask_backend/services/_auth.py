"""Caller-ownership checks shared by the service blueprints.

Students hold no backend account: the ministry session token vaulted at
/api/progres/login IS the identity. A caller proves uuid ownership by
presenting that same token; backend admins may use their backend JWT.
"""
import base64
import hashlib
import hmac
import json
import os
import time
import time

from flask import jsonify, request
from sqlalchemy import create_engine, text

_ENGINE = None


def _engine():
    global _ENGINE
    if _ENGINE is None:
        url = os.environ.get('DATABASE_URL', 'sqlite:///university.db')
        if url.startswith('postgres://'):
            url = url.replace('postgres://', 'postgresql://', 1)
        _ENGINE = create_engine(url, pool_pre_ping=True, pool_recycle=280, future=True)
    return _ENGINE


def _b64url_decode(s):
    s = str(s or '')
    s += '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


def _denylist_has(jti):
    try:
        with _engine().connect() as c:
            row = c.execute(text('SELECT 1 FROM token_denylist WHERE jti = :j'), {'j': jti}).fetchone()
        return bool(row)
    except Exception:
        return True


def backend_admin():
    """True iff request carries a valid, non-revoked backend-JWT for ADMIN_USER."""
    h = request.headers.get('Authorization', '') or ''
    token = h[7:] if h.startswith('Bearer ') else ''
    if not token or token.count('.') != 2:
        return False
    try:
        hs, ps, sg = token.split('.')
        sec = os.environ.get('JWT_SECRET', 'change-me-in-production')
        exp_sig = hmac.new(sec.encode(), f'{hs}.{ps}'.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url_decode(sg), exp_sig):
            return False
        payload = json.loads(_b64url_decode(ps))
        if int(payload.get('exp', 0)) < time.time():
            return False
        jti = payload.get('jti')
        if not jti or not isinstance(jti, str):
            return False
        if _denylist_has(jti):
            return False
        return payload.get('sub') == os.environ.get('ADMIN_USER', 'admin')
    except Exception:
        return False


def presented_token():
    """Raw caller token; tolerates an optional 'Bearer ' prefix."""
    h = request.headers.get('Authorization', '') or ''
    if h.startswith('Bearer '):
        h = h[7:]
    return h.strip()[:2000]


def require_uuid_owner(uuid_, vault_token):
    """None if caller owns uuid (or is admin); else (response, status)."""
    if not uuid_:
        return jsonify({'error': 'uuid مطلوب'}), 400
    presented = presented_token()
    if vault_token and presented and hmac.compare_digest(presented, vault_token):
        return None
    if backend_admin():
        return None
    if not presented or not vault_token:
        return jsonify({'error': 'جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول'}), 401
    return jsonify({'error': 'غير مصرح'}), 403


def assert_dia_owned(claims, dia):
    """None if dia belongs to the token's dias set; else (response, status)."""
    dia = str(dia or '').strip()
    if not dia:
        return jsonify({'error': 'dia مطلوب'}), 400
    parts = [p.strip() for p in str((claims or {}).get('dias') or '').split(',') if p.strip()]
    if parts and dia not in parts:
        return jsonify({'error': 'غير مصرح'}), 403
    return None
