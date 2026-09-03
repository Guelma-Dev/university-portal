"""
خدمة "تسجيلاتي" — سجلّ تسجيل الطالب الجامعي (بنمط بروقرس).

توفر هذه الوحدة تكاملاً من جهة الخادم فقط مع المنصة الوطنية webetu وتُعيد
بيانات تسجيل الطالب (السنة، المؤسسة، الشعبة، المستوى، رقم التسجيل، الولاية)
بنفس لغة بروقرس دون تخزين أي كلمات سرّ.

المصدر: reuses the same session token saved in the `progres_tokens` table after
the student logs into Progres from the app, then reads the student's DIA cards
via https://api-webetu.mesrs.dz/api/infos/bac/<uuid>/dias — the exact endpoint
the app already uses for grades. Only short-lived ministry JWTs (<=24h) are
kept; passwords are never stored.

البيانات (كل بطاقة سنة):
  - anneeAcademiqueCode / anneeAcademique
  - etablissementLibelle + wilaya
  - filiere/domaine/specialite (عربي قدر الإمكان)
  - niveauLibelleLongAr
  - numeroInscription
  - situationId (إن وُجد) — أيقونات الوضعية تُقرر في الواجهة
"""

import json
import os
from datetime import datetime

try:
    from . import _http as requests
except ImportError:
    import requests
from flask import Blueprint, jsonify, request

WEBETU_BASE = 'https://api-webetu.mesrs.dz'

DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///university.db')
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

from sqlalchemy import create_engine, text  # noqa: E402

_db = create_engine(DATABASE_URL, pool_pre_ping=True)

bp = Blueprint('inscription', __name__, url_prefix='/api/inscription')


class ApiError(Exception):
    def __init__(self, msg, status=502):
        super().__init__(msg)
        self.msg = msg
        self.status = status


def _fail(e):
    if isinstance(e, ApiError):
        return jsonify({'error': e.msg}), e.status
    print(f'[INSCRIPTION] {type(e).__name__}: {e}', flush=True)
    return jsonify({'error': 'حدث خطأ غير متوقع، حاول لاحقاً'}), 500


# ---- جلسة بروقرس المخزنة (نفس جدول app.py) ----
def _vault_get(u):
    try:
        with _db.connect() as c:
            row = c.execute(
                text('SELECT token, expires_at FROM progres_tokens WHERE uuid = :u'),
                {'u': u},
            ).fetchone()
        if not row:
            return None
        exp = row[1]
        if isinstance(exp, str):
            try:
                exp = datetime.fromisoformat(exp)
            except ValueError:
                return None
        if not exp or exp <= datetime.utcnow():
            print(f'[INSCRIPTION] vault: token expired at {exp}', flush=True)
            return None
        return row[0]
    except Exception as e:
        print(f'[INSCRIPTION] vault get: {type(e).__name__}: {e}', flush=True)
        return None


def _webetu_get(path, token):
    r = requests._send('GET', WEBETU_BASE + path, headers={'authorization': token}, timeout=30)
    if r.status_code != 200:
        raise ApiError('خوادم الوزارة غير متاحة حالياً، حاول لاحقاً', 502)
    try:
        return r.json()
    except Exception:
        raise ApiError('استجابة غير صالحة من خوادم الوزارة', 502)


def _pick(*vals):
    for v in vals:
        if isinstance(v, str) and v.strip():
            return v.strip()
        if v not in (None, '', 0):
            return v
    return ''


def _as_list(data):
    if isinstance(data, dict):
        for k in ('data', 'items', 'results', 'dias'):
            if isinstance(data.get(k), list):
                return data[k]
        return []
    if isinstance(data, list):
        return data
    return []


def _simplify_dia(d):
    """يبسّط بطاقة سنة واحدة (DIA) إلى هيكل تسجيل جاهز للعرض."""
    s = d or {}
    situ = s.get('situationId')
    return {
        'id': _pick(s.get('id')),
        'anneeAcademiqueCode': _pick(s.get('anneeAcademiqueCode'), s.get('codeAnneeAcademique')),
        'anneeAcademique': _pick(s.get('anneeAcademique'), s.get('anneeAcademiqueLibelle')),
        'etablissement': _pick(
            s.get('etablissementLibelleAr'),
            s.get('etablissementLibelle'),
            s.get('llEtablissementArabe'),
            s.get('llEtablissementLatin'),
            s.get('etablissement'),
        ),
        'wilaya': _pick(s.get('etablissementWilaya'), s.get('wilayaLibelle'), s.get('wilaya')),
        'domaine': _pick(s.get('ofLlDomaineArabe'), s.get('ofLlDomaine')),
        'filiere': _pick(
            s.get('ofLlFiliereArabe'),
            s.get('ofLlFiliere'),
            s.get('filiere'),
            s.get('filiereLibelleAr'),
        ),
        'specialite': _pick(
            s.get('ofLlSpecialiteArabe'),
            s.get('ofLlSpecialite'),
            s.get('specialiteLibelleAr'),
            s.get('specialty'),
        ),
        'cycle': _pick(
            s.get('refLibelleCycleAr'),
            s.get('refLibelleCycle'),
            s.get('cycle'),
        ),
        'niveau': _pick(
            s.get('niveauLibelleLongAr'),
            s.get('niveauLibelleLongLt'),
            s.get('niveauLibelleAr'),
            s.get('niveau'),
        ),
        'numeroInscription': _pick(s.get('numeroInscription')),
        'logoEtablissement': _pick(s.get('logoEtab')),
        'situationId': situ,
    }


# ---- Router ----
@bp.route('')
@bp.route('/')
def inscription_list():
    try:
        u = (request.args.get('uuid') or '').strip()
        if not u:
            raise ApiError('المعرف غير صالح', 400)
        token = _vault_get(u)
        if not token:
            raise ApiError('انتهت الجلسة، سجّل دخول بروقرس من جديد', 401)
        raw = _webetu_get(f'/api/infos/bac/{u}/dias', token)
        cards = _as_list(raw)
        data = [_simplify_dia(c) for c in cards]
        return jsonify({'cards': data})
    except Exception as e:
        return _fail(e)
