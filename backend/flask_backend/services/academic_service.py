"""
Academic service blueprint — Progres WebEtudiant proxy (/api/academic).
Independent module: own SQLAlchemy engine against DATABASE_URL, shares the
progres_tokens vault (raw ministry JWT per uuid) and progres_cache table.
"""

import base64
import json
import os
from datetime import datetime, timedelta

import requests
from flask import Blueprint, Response, jsonify, request
from sqlalchemy import create_engine, text

bp = Blueprint('academic', __name__, url_prefix='/api/academic')

BASE_URL = 'https://api-webetu.mesrs.dz/api/infos'
TIMEOUT = 25

_session = requests.Session()
_session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    'Accept': 'application/json',
})

_engine = None

TTL_DEFAULT = 30 * 60
TTL_BANNER = 3 * 3600
TTL_CONFIG = 6 * 3600

QUITUS_KEYS = ['sit_dep', 'sit_bf', 'sit_bc', 'sit_ru', 'sit_brs']

TRANSPORT_STATUS_MAP = {
    'traitement': 'قيد الدراسة',
    'approuvee': 'مقبولة',
    'noNapprouvee': 'غير مقبولة',
}


def _engine():
    global _engine
    if _engine is None:
        url = os.environ.get('DATABASE_URL', 'sqlite:///university.db')
        if url.startswith('postgres://'):
            url = url.replace('postgres://', 'postgresql://', 1)
        _engine = create_engine(url, pool_pre_ping=True, pool_recycle=280, future=True)
    return _engine


def _err(msg, code):
    resp = jsonify({'error': msg})
    resp.status_code = code
    return resp


def _resolve_token(uuid_):
    if not isinstance(uuid_, str):
        return None
    uuid_ = uuid_.strip()
    if not uuid_ or len(uuid_) > 100:
        return None
    try:
        with _engine().connect() as c:
            row = c.execute(
                text('SELECT token, expires_at FROM progres_tokens '
                     'WHERE uuid = :u AND expires_at > :now'),
                {'u': uuid_, 'now': datetime.utcnow()},
            ).fetchone()
    except Exception:
        return None
    if not row:
        return None
    token = row[0]
    exp = row[1]
    if isinstance(exp, str):
        try:
            exp = datetime.fromisoformat(exp)
        except ValueError:
            return None
    if not exp or exp <= datetime.utcnow():
        return None
    return token


def _jwt_claims(token):
    try:
        seg = token.split('.')[1]
        seg += '=' * (-len(seg) % 4)
        data = json.loads(base64.urlsafe_b64decode(seg))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _extra_headers(token, dia=None):
    claims = _jwt_claims(token)
    headers = {'authorization': token}
    ind = claims.get('idIndividu')
    if ind:
        headers['x-ind-id'] = str(ind)
    d = dia or str(claims.get('dias') or '').split(',')[0].strip()
    if d and len(d) <= 40:
        headers['x-dia-id'] = d
    return headers


def _cache_get(key, ttl):
    try:
        with _engine().connect() as c:
            row = c.execute(
                text('SELECT payload, content_type, created_at FROM progres_cache '
                     'WHERE cache_key = :k'),
                {'k': key},
            ).fetchone()
        if not row:
            return None
        created = row[2]
        if isinstance(created, str):
            try:
                created = datetime.fromisoformat(created)
            except ValueError:
                return None
        if not created or datetime.utcnow() - created > timedelta(seconds=ttl):
            return None
        return {'payload': row[0], 'content_type': row[1] or 'application/json'}
    except Exception:
        return None


def _cache_set(key, payload, content_type='application/json'):
    try:
        with _engine().connect() as c:
            c.execute(
                text('''INSERT INTO progres_cache (cache_key, payload, content_type, created_at)
                    VALUES (:k, :p, :ct, :ts)
                    ON CONFLICT (cache_key) DO UPDATE
                    SET payload = :p, content_type = :ct, created_at = :ts'''),
                {'k': key, 'p': payload, 'ct': content_type, 'ts': datetime.utcnow()},
            )
            c.commit()
    except Exception:
        pass


def _auth_args():
    uuid_ = (request.args.get('uuid') or '').strip()
    if not uuid_:
        return None, _err('uuid مطلوب', 400)
    if len(uuid_) > 100:
        return None, _err('طلب غير صالح', 400)
    token = _resolve_token(uuid_)
    if not token:
        return None, _err('جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول', 401)
    return (uuid_, token), None


def _cached_fetch(cache_key, path, token, ttl, dia=None, uuid_suffix=None, transform=None):
    cached = _cache_get(cache_key, ttl)
    if cached:
        r = Response(cached['payload'], status=200, mimetype=cached['content_type'])
        r.headers['X-Cache'] = 'hit'
        return r
    try:
        headers = _extra_headers(token, dia)
        resp = _session.get(f'{BASE_URL}{path}', headers=headers, timeout=TIMEOUT)
        if (resp.status_code == 404 and uuid_suffix
                and len(path) < 480 and not path.endswith(uuid_suffix)):
            resp = _session.get(f'{BASE_URL}{path}{uuid_suffix}',
                                headers=headers, timeout=TIMEOUT)
        if resp.status_code == 401:
            return _err('انتهت صلاحية جلسة الوزارة، أعد تسجيل الدخول', 401)
        if resp.status_code == 404:
            return _err('لا توجد بيانات متوفرة', 404)
        if resp.status_code != 200:
            return _err('تعذر جلب البيانات من خوادم الوزارة، حاول لاحقاً', 502)
        try:
            data = resp.json()
        except Exception:
            return _err('استجابة غير صالحة من خوادم الوزارة', 502)
        if transform:
            data = transform(data)
        payload = json.dumps(data, ensure_ascii=False)
        _cache_set(cache_key, payload)
        r = Response(payload, status=200, mimetype='application/json')
        r.headers['X-Cache'] = 'miss'
        return r
    except Exception:
        return _err('خوادم الوزارة غير متاحة حالياً، حاول لاحقاً', 502)


def _post_plain(path, token, dia=None):
    try:
        resp = _session.post(f'{BASE_URL}{path}', headers=_extra_headers(token, dia),
                             timeout=TIMEOUT)
        return Response(resp.text, status=resp.status_code, mimetype='text/plain')
    except Exception:
        return _err('خوادم الوزارة غير متاحة حالياً، حاول لاحقاً', 502)


# ============================================
# ROUTES
# ============================================
@bp.get('/quitus')
def quitus():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args

    def transform(data):
        if isinstance(data, dict):
            valid = sum(
                1 for k in QUITUS_KEYS
                if isinstance(data.get(k), dict)
                and str(data[k].get('statut') or '').lower() == 'validee'
            )
            data['completion'] = {
                'valid': valid,
                'total': len(QUITUS_KEYS),
                'percent': round(valid * 100.0 / len(QUITUS_KEYS)),
            }
        return data

    return _cached_fetch(f'me:{uuid_}:quitus', f'/bac/{uuid_}/quitus',
                         token, TTL_DEFAULT, uuid_suffix=uuid_, transform=transform)


@bp.get('/dettes')
def dettes():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args

    def transform(data):
        if isinstance(data, list):
            return [x for x in data if x]
        return data

    return _cached_fetch(f'me:{uuid_}:dettes', f'/dettes/{uuid_}',
                         token, TTL_DEFAULT, uuid_suffix=uuid_, transform=transform)


@bp.get('/absences')
def absences():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args
    return _cached_fetch(f'me:{uuid_}:absences', f'/bac/{uuid_}/absences',
                         token, TTL_DEFAULT, uuid_suffix=uuid_)


@bp.get('/exclusions')
def exclusions():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args
    return _cached_fetch(f'me:{uuid_}:exclusions', f'/bac/{uuid_}/exclusions',
                         token, TTL_DEFAULT, uuid_suffix=uuid_)


@bp.get('/conges')
def conges():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args

    def transform(data):
        items = data if isinstance(data, list) else []
        validee = sum(
            1 for x in items
            if isinstance(x, dict) and str(x.get('statut') or '').lower() == 'validee'
        )
        return {
            'items': items,
            'summary': {'validee': validee, 'nonValidee': len(items) - validee},
        }

    return _cached_fetch(f'me:{uuid_}:conges', f'/bac/{uuid_}/conges',
                         token, TTL_DEFAULT, uuid_suffix=uuid_, transform=transform)


@bp.get('/emploi')
def emploi():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args
    dia = (request.args.get('dia') or '').strip()
    if not dia or len(dia) > 40:
        return _err('dia مطلوب', 400)
    return _cached_fetch(f'me:{uuid_}:emploi:{dia}',
                         f'/seanceEmploi/inscription/{dia}',
                         token, TTL_DEFAULT, dia=dia, uuid_suffix=dia)


@bp.get('/transport')
def transport():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args
    dia = (request.args.get('dia') or '').strip()
    if not dia or len(dia) > 40:
        return _err('dia مطلوب', 400)

    def transform(data):
        if isinstance(data, dict):
            st = data.get('statut') or data.get('traitement')
            if isinstance(st, str):
                data['statusLabel'] = TRANSPORT_STATUS_MAP.get(st.lower(), st)
            data['statusMap'] = TRANSPORT_STATUS_MAP
        return data

    return _cached_fetch(f'me:{uuid_}:transport:{dia}',
                         f'/demandeTransport/{uuid_}/{dia}',
                         token, TTL_DEFAULT, dia=dia, uuid_suffix=uuid_,
                         transform=transform)


@bp.get('/setram')
def setram():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args
    dia = (request.args.get('dia') or '').strip()
    if not dia or len(dia) > 40:
        return _err('dia مطلوب', 400)
    return _cached_fetch(f'me:{uuid_}:setram:{dia}',
                         f'/getCardeTransportSetram/{uuid_}/{dia}',
                         token, TTL_DEFAULT, dia=dia, uuid_suffix=uuid_)


@bp.post('/recours')
def recours():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return _err('بيانات غير صحيحة', 400)
    uuid_ = str(data.get('uuid') or '').strip()
    token = _resolve_token(uuid_)
    if not token:
        return _err('جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول', 401)
    dia = str(data.get('dia') or '').strip()
    mc_id = data.get('mcId')
    motif = data.get('motif')
    kind = data.get('kind')
    if not dia or len(dia) > 40:
        return _err('dia مطلوب', 400)
    if not isinstance(mc_id, int) or isinstance(mc_id, bool):
        return _err('mcId يجب أن يكون رقماً صحيحاً', 400)
    if motif not in (1, 2):
        return _err('motif يقبل القيمة 1 أو 2 فقط', 400)
    if kind not in ('exam', 'cc'):
        return _err("kind يقبل القيمة 'exam' أو 'cc' فقط", 400)
    seg = 'noteExamens' if kind == 'exam' else 'noteCC'
    return _post_plain(f'/{seg}/dia/{dia}/{mc_id}/recours/{motif}', token, dia)


@bp.post('/hebergement-renew')
def hebergement_renew():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return _err('بيانات غير صحيحة', 400)
    uuid_ = str(data.get('uuid') or '').strip()
    token = _resolve_token(uuid_)
    if not token:
        return _err('جلسة غير صالحة أو منتهية الصلاحية، أعد تسجيل الدخول', 401)
    residence_id = str(data.get('residenceId') or '').strip()
    if not residence_id.isdigit() or len(residence_id) > 20:
        return _err('residenceId غير صالح', 400)
    return _post_plain(f'/demanderRenouvellementHebregement/{uuid_}/{residence_id}',
                       token)


@bp.get('/hebergement')
def hebergement():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args
    return _cached_fetch(f'me:{uuid_}:hebergement', f'/bac/{uuid_}/demandesHebregement',
                         token, TTL_DEFAULT, uuid_suffix=uuid_)


@bp.get('/banner')
def banner():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args
    return _cached_fetch(f'me:{uuid_}:banner', '/bannerInformations',
                         token, TTL_BANNER)


@bp.get('/configuration')
def configuration():
    args, err = _auth_args()
    if err:
        return err
    uuid_, token = args
    return _cached_fetch(f'me:{uuid_}:configuration', '/configuration',
                         token, TTL_CONFIG)
