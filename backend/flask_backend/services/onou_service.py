"""
خدمة الوجبات الجامعية (ONOU) للواجهة الخلفية — تكامل من جهة الخادم فقط.

توفّر هذه الوحدة تكاملاً كاملاً مع خدمة المطاعم الجامعية عبر خادمَي
api-webetu.mesrs.dz و gs-api.onou.dz دون تخزين أي كلمات سرّ:
- إعادة استخدام رمز بروغرس المخزّن في جدول progres_tokens كمصادقة مباشرة
  (بدون تسجيل دخول webetu) مع إرجاع 401 برسالة عربية عند انتهاء الجلسة.
- تحديد الولاية تلقائياً من wilayaInscription (تخزين مؤقت 6 ساعات) والإقامة
  من demandesHebregement (12 ساعة) أو من قيمة يرسلها العميل.
- تسجيل دخول موقّع بـ HMAC-SHA256 (X-Timestamp/X-Nonce/X-Signature) لخدمة
  gs-api.onou.dz (شهادتها منتهية لذا verify=False) وجلب رمزها (20 ساعة).
- عرض المراكز (depots، ساعة واحدة) والحجوزات، الحجز الجديد، وإلغاء الحجز.
- تفضيلات الحجز التلقائي في جدول onou_autobook (يُنشأ عند أول استخدام)
  وخيط خلفي daemon يحجز الأيام الثلاثة القادمة في الساعة المحددة، متخطياً
  التواريخ المحجوزة مسبقاً؛ يُشغَّل حصراً عبر start_autobook() من المنسّق.

سرّ توقيع HMAC لا يُرسل للعميل أبداً، وكل الأخطاء تعود برسائل عربية JSON.
"""

import base64
import hashlib
import hmac
import json
import os
import threading
import time
import uuid as uuidlib
from datetime import datetime, timedelta

try:
    from . import _http as requests
except ImportError:
    import requests
from flask import Blueprint, jsonify, request
from sqlalchemy import create_engine, text

try:
    from requests.packages import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
except Exception:
    pass

# ============================================
# CONFIGURATION
# ============================================
WEBETU_BASE = 'https://api-webetu.mesrs.dz'
GS_BASE = 'https://gs-api.onou.dz'
_GS_SECRET = b'pUzHUW2WX54uCzhO8JC2eQ6g1Ol21upw'

DATABASE_URL = os.environ.get('DATABASE_URL', 'sqlite:///university.db')
if DATABASE_URL.startswith('postgres://'):
    DATABASE_URL = DATABASE_URL.replace('postgres://', 'postgresql://', 1)

_db = create_engine(DATABASE_URL, pool_pre_ping=True)

bp = Blueprint('onou', __name__, url_prefix='/api/onou')

_session = requests.Session()
_session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    'Accept': 'application/json',
})

MEAL_BY_SLOT = (('breakfast', 1), ('lunch', 2), ('dinner', 3))
_PREF_DEFAULTS = {'enabled': False, 'breakfast': True, 'lunch': True, 'dinner': True, 'depot': None, 'hour': 5}


class ApiError(Exception):
    def __init__(self, msg, status=502):
        super().__init__(msg)
        self.msg = msg
        self.status = status


class SessionExpired(ApiError):
    def __init__(self):
        super().__init__('انتهيت الجلسة، سجل دخول من جديد', 401)


def _fail(e):
    if isinstance(e, ApiError):
        return jsonify({'error': e.msg}), e.status
    print(f'[ONOU] {type(e).__name__}: {e}', flush=True)
    return jsonify({'error': 'حدث خطأ غير متوقع، حاول لاحقاً'}), 500


# ============================================
# PROGRES TOKEN VAULT + progres_cache HELPERS
# ============================================
def _vault_get(u):
    try:
        with _db.connect() as c:
            row = c.execute(
                text('SELECT token, expires_at FROM progres_tokens '
                     'WHERE uuid = :u'),
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
            print(f'[ONOU] vault: token expired at {exp}', flush=True)
            return None
        return row[0]
    except Exception as e:
        print(f'[ONOU] vault get: {type(e).__name__}: {e}', flush=True)
        VAULT_ERR = f'{type(e).__name__}: {e}'
        globals()['VAULT_ERR'] = VAULT_ERR
        return None


@bp.get('/debug-vault')
def debug_vault():
    u = (request.args.get('uuid') or '').strip()
    info = {
        'db_prefix': DATABASE_URL[:38],
        'utcnow': datetime.utcnow().isoformat(),
        'vault_err': globals().get('VAULT_ERR'),
    }
    tok = _vault_get(u) if u else None
    info['token_resolved'] = bool(tok)
    info['token_len'] = len(tok or '')
    try:
        with _db.connect() as c:
            row = c.execute(text("SELECT 1")).fetchone()
        info['db_ping'] = 'ok' if row else 'empty'
    except Exception as e:
        info['db_ping'] = f'{type(e).__name__}: {e}'
    return jsonify(info)


def _cache_get(key, ttl_seconds):
    try:
        with _db.connect() as c:
            row = c.execute(
                text('SELECT payload, created_at FROM progres_cache WHERE cache_key = :k'),
                {'k': key},
            ).fetchone()
        if not row:
            return None
        created = row[1]
        if isinstance(created, str):
            try:
                created = datetime.fromisoformat(created)
            except ValueError:
                return None
        if datetime.utcnow() - created > timedelta(seconds=ttl_seconds):
            return None
        return json.loads(row[0])
    except Exception as e:
        print(f'[ONOU] cache get {key[:40]}: {type(e).__name__}', flush=True)
        return None


def _cache_set(key, obj):
    try:
        with _db.begin() as c:
            c.execute(text('''INSERT INTO progres_cache (cache_key, payload, content_type, created_at)
                VALUES (:k, :p, 'application/json', :ts)
                ON CONFLICT (cache_key) DO UPDATE SET payload = :p, content_type = 'application/json', created_at = :ts'''),
                {'k': key, 'p': json.dumps(obj), 'ts': datetime.utcnow()})
    except Exception as e:
        print(f'[ONOU] cache set {key[:40]}: {type(e).__name__}', flush=True)


def _jwt_claims(token):
    try:
        p = token.split('.')[1]
        p += '=' * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return {}


def _first_dia(claims):
    for part in str(claims.get('dias', '')).split(','):
        part = part.strip()
        if part:
            return part
    return None


# ============================================
# WEBETU (raw progres JWT as authorization header)
# ============================================
_RELAY_URL_MEM = None
RELAY_KEY = os.environ.get('PROGRES_RELAY_KEY') or 'dz-relay-2026-x7k9p2'
_DIRECT_BLOCK = {}
DIRECT_COOLDOWN = 60


def _direct_ok(base):
    return time.time() >= _DIRECT_BLOCK.get(base, 0)


def _block_direct(base):
    _DIRECT_BLOCK[base] = time.time() + DIRECT_COOLDOWN


_RELAY_URL_TS = 0.0


def _relay_url():
    global _RELAY_URL_MEM, _RELAY_URL_TS
    if not _RELAY_URL_MEM or time.time() - _RELAY_URL_TS > 300:
        try:
            with _db.connect() as c:
                row = c.execute(
                    text("SELECT payload FROM progres_cache "
                         "WHERE cache_key = '_relay_url'")).fetchone()
            u = (row[0] or '').strip() if row else ''
        except Exception:
            u = ''
        if u:
            _RELAY_URL_MEM = u
            _RELAY_URL_TS = time.time()
    return _RELAY_URL_MEM or None


def _upstream(method, base, path, headers, kwargs):
    """Direct first (short probe); on failure fall back to the Algerian
    phone relay. GS_BASE -> '/onou' prefix; webetu reads -> bare (progres
    mirror), webetu writes -> '/w'."""
    if _direct_ok(base):
        try:
            kw = dict(kwargs)
            kw['timeout'] = min(kw.get('timeout', 30), 8)
            r = _session.request(method, base + path, headers=headers, **kw)
            if r.status_code in (502, 503):
                raise OSError('egress blocked (%d)' % r.status_code)
            return r
        except Exception:
            _block_direct(base)
    rb = _relay_url()
    if not rb:
        raise RuntimeError('no relay registered')
    h = dict(headers)
    h['X-Relay-Key'] = RELAY_KEY
    if base == GS_BASE:
        prefix = '/onou'
    elif path.startswith('/api/infos/'):
        prefix = ''
    else:
        prefix = '/w'
    kw = dict(kwargs)
    kw.pop('verify', None)
    return _session.request(method, rb.rstrip('/') + prefix + path,
                            headers=h, **kw)


def _webetu_get(path, token):
    r = _upstream('GET', WEBETU_BASE, path,
                  {'authorization': token}, {'timeout': 30})
    if r.status_code != 200:
        raise ApiError('خوادم الوزارة غير متاحة حالياً، حاول لاحقاً')
    try:
        return r.json()
    except ValueError:
        raise ApiError('استجابة غير صالحة من خوادم الوزارة')


def _as_list(data):
    if isinstance(data, dict):
        for k in ('data', 'items', 'results'):
            if isinstance(data.get(k), list):
                return data[k]
        return []
    if isinstance(data, list):
        return data
    return []


def _resolve_wilaya(u, token, dia):
    cached = _cache_get(f'me:{u}:wilaya', 6 * 3600)
    if cached and cached.get('wilaya') is not None:
        return cached['wilaya']
    data = _webetu_get(f'/api/infos/wilayaInscription/{dia}', token)
    item = data[0] if isinstance(data, list) and data else data
    wilaya = None
    if isinstance(item, dict):
        for k in ('idWilaya', 'wilaya', 'idWillaya', 'codeWilaya', 'code', 'id'):
            if item.get(k) is not None:
                wilaya = item[k]
                break
    elif item is not None:
        wilaya = item
    if wilaya is None:
        raise ApiError('تعذر تحديد ولاية الإقامة')
    _cache_set(f'me:{u}:wilaya', {'wilaya': wilaya})
    return wilaya


def _resolve_residence(u, token, residence=None):
    if residence:
        return residence
    cached = _cache_get(f'me:{u}:residence', 12 * 3600)
    if cached and cached.get('residence') is not None:
        return cached['residence']
    data = _webetu_get(f'/api/infos/bac/{u}/demandesHebregement', token)
    items = _as_list(data)
    year = str(datetime.now().year)
    picked = None
    for it in items:
        if isinstance(it, dict) and year in str(it.get('idAnneeAcademique', '')):
            picked = it
            break
    if picked is None and items and isinstance(items[0], dict):
        picked = items[0]
    res = picked.get('idResidance') if isinstance(picked, dict) else None
    if res is None:
        raise ApiError('تعذر تحديد مكان الإقامة')
    _cache_set(f'me:{u}:residence', {'residence': res})
    return res


# ============================================
# GS-API (expired TLS cert + HMAC-signed requests)
# ============================================
def _gs_sign_headers(body_str=''):
    ts = str(int(time.time()))
    nonce = uuidlib.uuid4().hex
    sig = hmac.new(_GS_SECRET, f'{ts}|{nonce}|{body_str}'.encode(), hashlib.sha256).hexdigest()
    return {'X-Timestamp': ts, 'X-Nonce': nonce, 'X-Signature': sig}


def _gs_request(method, path, gs_token=None, body=None, params=None):
    body_str = json.dumps(body, separators=(',', ':')) if body is not None else ''
    headers = _gs_sign_headers(body_str)
    if gs_token:
        headers['authorization'] = f'Bearer {gs_token}'
    kwargs = {'params': params, 'timeout': 30, 'verify': False}
    if body is not None:
        headers['Content-Type'] = 'application/json'
        kwargs['data'] = body_str.encode('utf-8')
    r = _upstream(method, GS_BASE, path, headers, kwargs)
    if r.status_code >= 400:
        raise ApiError(f'خطأ من خدمة الوجبات ({r.status_code})')
    try:
        return r.json()
    except ValueError:
        raise ApiError('استجابة غير صالحة من خدمة الوجبات')


def _get_gs_token(u, token, wilaya, residence):
    cached = _cache_get(f'me:{u}:gs', 20 * 3600)
    if cached and cached.get('token'):
        return cached['token']
    data = _gs_request('POST', '/api/loginpwebetu', body={
        'uuid': u, 'wilaya': wilaya, 'residence': residence, 'token': token,
    })
    gs = data.get('token') if isinstance(data, dict) else None
    if not gs:
        raise ApiError('تعذر تسجيل الدخول إلى خدمة الوجبات')
    _cache_set(f'me:{u}:gs', {'token': gs})
    return gs


def _build_ctx(u, dia=None, residence=None):
    token = _vault_get(u)
    if not token:
        raise SessionExpired()
    claims = _jwt_claims(token)
    dia = str(dia).strip() if dia else _first_dia(claims)
    if not dia:
        raise ApiError('تعذر تحديد رقم التسجيل (dia)', 400)
    wilaya = _resolve_wilaya(u, token, dia)
    residence = _resolve_residence(u, token, residence)
    gs = _get_gs_token(u, token, wilaya, residence)
    return {'u': u, 'token': token, 'gs': gs, 'dia': dia, 'wilaya': wilaya, 'residence': residence}


def _req_uuid():
    u = request.args.get('uuid')
    if not u and request.is_json:
        u = (request.get_json(silent=True) or {}).get('uuid')
    return str(u).strip() if u else ''


def _req_dia():
    d = request.args.get('dia')
    if not d and request.is_json:
        d = (request.get_json(silent=True) or {}).get('dia')
    return str(d).strip() if d else None


# ============================================
# MEAL RESERVATIONS API
# ============================================
@bp.route('/context', methods=['GET'])
def context():
    try:
        u = _req_uuid()
        if not u:
            return jsonify({'error': 'uuid مطلوب'}), 400
        ctx = _build_ctx(u, dia=_req_dia(), residence=request.args.get('residence'))
        cache_key = f'onou:{u}:depots:{ctx["wilaya"]}:{ctx["residence"]}'
        depots = _cache_get(cache_key, 3600)
        if depots is None:
            data = _gs_request('GET', '/getdepotres', ctx['gs'], params={
                'uuid': u, 'wilaya': ctx['wilaya'], 'residence': ctx['residence'], 'token': ctx['gs'],
            })
            depots = _as_list(data)
            if depots:
                _cache_set(cache_key, depots)
        return jsonify({
            'wilaya': ctx['wilaya'],
            'residence': ctx['residence'],
            'dia': ctx['dia'],
            'depots': depots or [],
        })
    except Exception as e:
        if request.args.get('debug') == '1':
            import traceback
            return jsonify({
                'error': str(e), 'type': type(e).__name__,
                'trace': traceback.format_exc()[-900:],
            }), 500
        return _fail(e)


def _fetch_reservations(ctx):
    data = _gs_request('GET', '/meal-reservations/student', ctx['gs'], params={
        'uuid': ctx['u'], 'wilaya': ctx['wilaya'], 'residence': ctx['residence'],
        'token': ctx['gs'], 'page': 1,
    })
    items = data
    if isinstance(items, dict):
        inner = items.get('data')
        if isinstance(inner, dict) and isinstance(inner.get('data'), list):
            items = inner['data']
        elif isinstance(inner, list):
            items = inner
        else:
            items = []
    return items if isinstance(items, list) else []


def _normalize_reservations(items):
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        out.append({
            'id': it.get('id'),
            'date_reserve': it.get('date_reserve'),
            'mealtype_fr': it.get('mealtype_fr'),
            'idDepot': it.get('idDepot'),
            'depot_fr': it.get('depot_fr'),
            'candelete': it.get('candelete', it.get('canDelete')),
        })
    return out


@bp.route('/reservations', methods=['GET'])
def reservations():
    try:
        u = _req_uuid()
        if not u:
            return jsonify({'error': 'uuid مطلوب'}), 400
        ctx = _build_ctx(u, dia=_req_dia())
        return jsonify(_normalize_reservations(_fetch_reservations(ctx)))
    except Exception as e:
        return _fail(e)


@bp.route('/reserve', methods=['POST'])
def reserve():
    try:
        data = request.get_json(silent=True) or {}
        u = str(data.get('uuid') or '').strip()
        if not u:
            return jsonify({'error': 'uuid مطلوب'}), 400
        menu_type = data.get('menu_type')
        try:
            menu_type = int(menu_type)
        except (TypeError, ValueError):
            return jsonify({'error': 'نوع الوجبة غير صحيح'}), 400
        if menu_type not in (1, 2, 3):
            return jsonify({'error': 'نوع الوجبة غير صحيح'}), 400
        depot = data.get('idDepot')
        dates = data.get('dates')
        if depot is None or not isinstance(dates, list) or not dates:
            return jsonify({'error': 'بيانات الحجز ناقصة'}), 400
        clean_dates = []
        for d in dates:
            try:
                clean_dates.append(datetime.fromisoformat(str(d)).date().isoformat())
            except ValueError:
                return jsonify({'error': 'صيغة تاريخ غير صالحة'}), 400
        ctx = _build_ctx(u, dia=data.get('dia'))
        details = [
            json.dumps({'date_reserve': d, 'menu_type': menu_type, 'idDepot': depot}, separators=(',', ':'))
            for d in clean_dates
        ]
        result = _gs_request('POST', '/reservemeal', ctx['gs'], body={
            'uuid': u, 'wilaya': ctx['wilaya'], 'residence': ctx['residence'],
            'token': ctx['gs'], 'details': details,
        })
        return jsonify(result)
    except Exception as e:
        return _fail(e)


@bp.route('/reservations/<int:rid>', methods=['DELETE'])
def delete_reservation(rid):
    try:
        u = _req_uuid()
        if not u:
            return jsonify({'error': 'uuid مطلوب'}), 400
        ctx = _build_ctx(u, dia=_req_dia())
        result = _gs_request('DELETE', f'/reservemeal/{rid}', ctx['gs'], body={
            'uuid': u, 'wilaya': ctx['wilaya'], 'residence': ctx['residence'], 'token': ctx['gs'],
        })
        return jsonify(result)
    except Exception as e:
        return _fail(e)


# ============================================
# AUTO-BOOKER (preferences + background engine)
# ============================================
_autobook_table_ready = False
_autobook_lock = threading.Lock()


def _ensure_autobook_table():
    global _autobook_table_ready
    if _autobook_table_ready:
        return
    with _autobook_lock:
        if _autobook_table_ready:
            return
        try:
            with _db.begin() as c:
                c.execute(text('''CREATE TABLE IF NOT EXISTS onou_autobook (
                    uuid VARCHAR PRIMARY KEY,
                    enabled BOOLEAN,
                    breakfast BOOLEAN,
                    lunch BOOLEAN,
                    dinner BOOLEAN,
                    depot INTEGER,
                    hour INTEGER DEFAULT 5,
                    last_run TIMESTAMP)'''))
            _autobook_table_ready = True
        except Exception as e:
            print(f'[ONOU] autobook table create: {type(e).__name__}', flush=True)


@bp.route('/prefs', methods=['GET'])
def get_prefs():
    try:
        u = _req_uuid()
        if not u:
            return jsonify({'error': 'uuid مطلوب'}), 400
        _ensure_autobook_table()
        row = None
        try:
            with _db.connect() as c:
                row = c.execute(text(
                    'SELECT enabled, breakfast, lunch, dinner, depot, hour FROM onou_autobook WHERE uuid = :u'
                ), {'u': u}).fetchone()
        except Exception as e:
            print(f'[ONOU] prefs get: {type(e).__name__}', flush=True)
        if row:
            prefs = {
                'enabled': bool(row[0]),
                'breakfast': bool(row[1]),
                'lunch': bool(row[2]),
                'dinner': bool(row[3]),
                'depot': row[4],
                'hour': row[5] if row[5] is not None else 5,
            }
        else:
            prefs = dict(_PREF_DEFAULTS)
        prefs['uuid'] = u
        return jsonify(prefs)
    except Exception as e:
        return _fail(e)


@bp.route('/prefs', methods=['POST'])
def save_prefs():
    try:
        data = request.get_json(silent=True) or {}
        u = str(data.get('uuid') or '').strip()
        if not u:
            return jsonify({'error': 'uuid مطلوب'}), 400
        _ensure_autobook_table()
        depot = data.get('depot')
        try:
            depot = int(depot) if depot is not None else None
        except (TypeError, ValueError):
            return jsonify({'error': 'مركز الوجبات غير صحيح'}), 400
        try:
            hour = int(data.get('hour', 5))
        except (TypeError, ValueError):
            return jsonify({'error': 'الساعة غير صحيحة'}), 400
        if not 0 <= hour <= 23:
            return jsonify({'error': 'الساعة يجب أن تكون بين 0 و 23'}), 400
        params = {
            'u': u,
            'enabled': bool(data.get('enabled', False)),
            'breakfast': bool(data.get('breakfast', True)),
            'lunch': bool(data.get('lunch', True)),
            'dinner': bool(data.get('dinner', True)),
            'depot': depot,
            'hour': hour,
        }
        with _db.begin() as c:
            c.execute(text('''INSERT INTO onou_autobook (uuid, enabled, breakfast, lunch, dinner, depot, hour, last_run)
                VALUES (:u, :enabled, :breakfast, :lunch, :dinner, :depot, :hour, NULL)
                ON CONFLICT (uuid) DO UPDATE SET enabled = :enabled, breakfast = :breakfast,
                    lunch = :lunch, dinner = :dinner, depot = :depot, hour = :hour'''), params)
        return jsonify({'message': 'تم حفظ تفضيلات الحجز التلقائي'})
    except Exception as e:
        return _fail(e)


def _load_enabled_rows():
    with _db.connect() as c:
        rows = c.execute(text(
            'SELECT uuid, breakfast, lunch, dinner, depot, hour FROM onou_autobook WHERE enabled = TRUE'
        )).fetchall()
    return [dict(zip(('uuid', 'breakfast', 'lunch', 'dinner', 'depot', 'hour'), r)) for r in rows]


def _get_last_run(u):
    try:
        with _db.connect() as c:
            row = c.execute(text('SELECT last_run FROM onou_autobook WHERE uuid = :u'), {'u': u}).fetchone()
        last = row[0] if row else None
        if isinstance(last, str):
            last = datetime.fromisoformat(last)
        return last
    except Exception:
        return None


def _mark_last_run(u):
    try:
        with _db.begin() as c:
            c.execute(text('UPDATE onou_autobook SET last_run = :ts WHERE uuid = :u'),
                      {'u': u, 'ts': datetime.utcnow()})
    except Exception as e:
        print(f'[ONOU] last_run update: {type(e).__name__}', flush=True)


def _meal_matches(fr_lower, menu_type):
    if 'petit' in fr_lower or 'فطور' in fr_lower:
        return menu_type == 1
    if 'déjeu' in fr_lower or 'dejeu' in fr_lower or 'غدا' in fr_lower:
        return menu_type == 2
    if 'dîn' in fr_lower or 'din' in fr_lower or 'عشا' in fr_lower:
        return menu_type == 3
    return False


def _already_reserved(res_items, iso_date, menu_type):
    for it in res_items:
        if not isinstance(it, dict):
            continue
        if str(it.get('date_reserve') or '')[:10] != iso_date:
            continue
        fr = str(it.get('mealtype_fr') or '').lower().strip()
        if fr and _meal_matches(fr, menu_type):
            return True
    return False


def _autobook_user(row):
    u = row['uuid']
    ctx = _build_ctx(u)
    existing = _fetch_reservations(ctx)
    results = []
    today = datetime.now().date()
    for offset in (1, 2, 3):
        iso = (today + timedelta(days=offset)).isoformat()
        for slot, menu_type in MEAL_BY_SLOT:
            if not row.get(slot):
                continue
            if _already_reserved(existing, iso, menu_type):
                continue
            detail = json.dumps(
                {'date_reserve': iso, 'menu_type': menu_type, 'idDepot': row['depot']},
                separators=(',', ':'),
            )
            try:
                out = _gs_request('POST', '/reservemeal', ctx['gs'], body={
                    'uuid': u, 'wilaya': ctx['wilaya'], 'residence': ctx['residence'],
                    'token': ctx['gs'], 'details': [detail],
                })
                results.append({'date': iso, 'menu_type': menu_type, 'result': out})
            except ApiError as e:
                results.append({'date': iso, 'menu_type': menu_type, 'error': e.msg})
    return results


def _autobook_loop():
    while True:
        time.sleep(60)
        try:
            _ensure_autobook_table()
            now_local = datetime.now()
            today = now_local.date()
            for row in _load_enabled_rows():
                try:
                    if row.get('depot') is None:
                        continue
                    if now_local.hour != int(row.get('hour') or 0):
                        continue
                    last = _get_last_run(row['uuid'])
                    if last is not None and last.date() >= today:
                        continue
                    out = _autobook_user(row)
                    print(f'[ONOU] autobook {row["uuid"][:8]}: {len(out)} action(s)', flush=True)
                except SessionExpired:
                    continue
                except Exception as e:
                    print(f'[ONOU] autobook {row.get("uuid", "?")[:8]}: {type(e).__name__}: {e}', flush=True)
                _mark_last_run(row['uuid'])
        except Exception as e:
            print(f'[ONOU] autobook loop: {type(e).__name__}: {e}', flush=True)


_started = False


def start_autobook():
    """تشغيل خيط الحجز التلقائي (daemon) — يستدعيه المنسق عند إقلاع التطبيق فقط."""
    global _started
    if _started:
        return
    _started = True
    t = threading.Thread(target=_autobook_loop, daemon=True, name='onou-autobook')
    t.start()
    print('[ONOU] Autobook thread started', flush=True)
