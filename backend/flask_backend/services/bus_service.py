"""
Bus service proxy — live transport data from mybus.mesrs.dz (ministry API).

No database and no authentication: the upstream API is public, so this
blueprint fetches, normalizes (Arabic statuses, FR/AR names), caches each
response for 60s in process memory and serves it.
"""

import os
import threading
import time
from collections import OrderedDict
from urllib.parse import quote

try:
    from . import _http as requests
except ImportError:
    import requests
from flask import Blueprint, jsonify, request

# ============================================
# CONFIGURATION
# ============================================
BUS_API_BASE = 'https://mybus.mesrs.dz/api'
BUS_TIMEOUT_SECONDS = 15
CACHE_TTL_SECONDS = 60
CACHE_MAX_ENTRIES = 200
NEARBY_LIMIT = 15

# Guelma university campus — used when lat/lng are absent
DEFAULT_LAT = 36.4627
DEFAULT_LNG = 7.4350

STATUS_AR = {
    'pending': 'في المحطة',
    'started': 'في الطريق',
    'en_route': 'في الطريق',
    'enroute': 'في الطريق',
    'en route': 'في الطريق',
    'arrived': 'وصل',
    'arrive': 'وصل',
}

UPSTREAM_ERROR_MESSAGE = 'خدمة النقل غير متاحة حالياً'

bp = Blueprint('bus', __name__, url_prefix='/api/bus')

_session = requests.Session()
_session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    'Accept': 'application/json',
})


class UpstreamError(Exception):
    """mybus.mesrs.dz unreachable or returned an unexpected payload."""


# ============================================
# IN-MEMORY CACHE (thread-safe, TTL + LRU eviction)
# ============================================
_cache_lock = threading.Lock()
_cache = OrderedDict()  # key -> (expires_at_epoch, payload)


def _cache_get(key: str):
    now = time.time()
    with _cache_lock:
        item = _cache.get(key)
        if item is None:
            return None
        expires_at, payload = item
        if expires_at <= now:
            del _cache[key]
            return None
        _cache.move_to_end(key)  # LRU touch
        return payload


def _cache_set(key: str, payload):
    now = time.time()
    with _cache_lock:
        _cache[key] = (now + CACHE_TTL_SECONDS, payload)
        _cache.move_to_end(key)
        while len(_cache) > CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)


def _cached_json(cache_key: str, producer):
    """Serve from cache when fresh; otherwise call producer() and cache it."""
    cached = _cache_get(cache_key)
    if cached is not None:
        return jsonify(cached)
    try:
        payload = producer()
    except UpstreamError as e:
        print(f'[BUS] upstream failed ({cache_key}): {e}', flush=True)
        if request.args.get('debug') == '1':
            import traceback
            return jsonify({'error': str(e),
                            'trace': traceback.format_exc()[-600:]}), 502
        return jsonify({'error': UPSTREAM_ERROR_MESSAGE}), 502
    _cache_set(cache_key, payload)
    return jsonify(payload)


# ============================================
# UPSTREAM HELPERS
# ============================================
_RELAY_URL_MEM = None
_RELAY_URL_TS = 0.0
RELAY_KEY = os.environ.get('PROGRES_RELAY_KEY') or 'dz-relay-2026-x7k9p2'
_DIRECT_BLOCKED_UNTIL = 0
DIRECT_COOLDOWN = 60


def _relay_url():
    """Re-read at most 5 min old — the phone tunnel URL changes on every
    relay restart, so a permanent cache would pin a dead URL forever."""
    global _RELAY_URL_MEM, _RELAY_URL_TS
    if not _RELAY_URL_MEM or time.time() - _RELAY_URL_TS > 300:
        try:
            from .academic_service import _relay_url as _shared
            u = _shared() or ''
        except Exception:
            u = ''
        if u:
            _RELAY_URL_MEM = u
            _RELAY_URL_TS = time.time()
    return _RELAY_URL_MEM or None


def _fetch_json(path: str):
    global _DIRECT_BLOCKED_UNTIL
    try:
        if time.time() >= _DIRECT_BLOCKED_UNTIL:
            try:
                # Short probe: Render egress is usually blocked by the
                # ministry, so don't let the direct attempt stall the request.
                resp = _session.get(f'{BUS_API_BASE}{path}',
                                    timeout=(3, 6))
                if resp.status_code in (502, 503):
                    raise UpstreamError('egress blocked')
                if resp.status_code != 200:
                    raise UpstreamError(f'HTTP {resp.status_code} from {path}')
                return resp.json()
            except UpstreamError:
                raise
            except Exception as e:
                # raw network errors (RemoteDisconnected…) MUST fall through
                # to the relay branch below, not escape as 502
                raise UpstreamError(f'{type(e).__name__}: {e}') from e
        raise UpstreamError('direct cooldown active')
    except UpstreamError as direct_err:
        # Ministry hangs up on datacenter IPs — don't retry direct for 30 min.
        _DIRECT_BLOCKED_UNTIL = time.time() + 1800
        rb = _relay_url()
        if not rb:
            raise direct_err
        try:
            # Fresh session per attempt: a pooled keep-alive connection to a
            # dead tunnel hostname keeps raising RemoteDisconnected even after
            # the relay re-registers under a new URL.
            resp = requests.get(rb.rstrip('/') + '/bus/api' + path,
                                headers={'X-Relay-Key': RELAY_KEY,
                                         'User-Agent': _session.headers.get('User-Agent'),
                                         'Accept': 'application/json'},
                                timeout=BUS_TIMEOUT_SECONDS + 10)
            if resp.status_code != 200:
                raise UpstreamError(f'relay HTTP {resp.status_code} for {path}')
            return resp.json()
        except UpstreamError:
            raise
        except Exception as e:
            raise UpstreamError(f'{type(e).__name__}: {e}') from e
    except Exception as e:
        raise UpstreamError(f'{type(e).__name__}: {e}') from e


def _split_fr_ar(value):
    """Split 'Français#العربية' into (fr, ar); tolerate values without '#'."""
    text = str(value or '').strip()
    if '#' in text:
        fr, ar = text.split('#', 1)
        return fr.strip(), ar.strip()
    return text, ''


def _as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ============================================
# NORMALIZATION
# ============================================
def _normalize_line(raw):
    if not isinstance(raw, dict):
        return None
    name_fr, name_ar = _split_fr_ar(raw.get('name_fr'))
    if not name_ar:
        name_ar = str(raw.get('name_ar') or '').strip()
    start_fr, start_ar = _split_fr_ar(raw.get('start'))
    end_fr, end_ar = _split_fr_ar(raw.get('end'))
    return {
        'id': raw.get('id'),
        'name_fr': name_fr,
        'name_ar': name_ar,
        'start_fr': start_fr,
        'start_ar': start_ar,
        'end_fr': end_fr,
        'end_ar': end_ar,
        'agency_name': str(raw.get('agency_name') or '').strip(),
        'distance_m': _as_float(raw.get('distance')),
        'lat': _as_float(raw.get('lat')),
        'lng': _as_float(raw.get('lng')),
    }


def _extract_lines(payload):
    """Upstream returns either {data: [lines]} or a bare [lines] list."""
    if isinstance(payload, dict):
        rows = payload.get('data')
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = None
    if not isinstance(rows, list):
        raise UpstreamError('unexpected lines payload shape')
    lines = [line for line in (_normalize_line(r) for r in rows) if line]
    lines.sort(key=lambda l: (l['distance_m'] is None, l['distance_m'] or 0))
    return lines


def _normalize_stop(raw):
    if not isinstance(raw, dict):
        return None
    name_fr, name_ar = _split_fr_ar(raw.get('name_fr'))
    if not name_ar:
        name_ar = str(raw.get('name_ar') or '').strip()
    return {
        'name_fr': name_fr,
        'name_ar': name_ar,
        'is_station': bool(raw.get('is_station')),
    }


def _normalize_departure(raw):
    if not isinstance(raw, dict):
        return None
    status_raw = str(raw.get('status') or '').strip().lower()
    stops = [s for s in (_normalize_stop(x) for x in (raw.get('stops') or [])) if s]
    return {
        'time': str(raw.get('time') or '').strip(),
        'bus': str(raw.get('bus') or '').strip(),
        'status': raw.get('status'),
        'status_ar': STATUS_AR.get(status_raw, str(raw.get('status') or '').strip()),
        'stops': stops,
    }


# ============================================
# ROUTES
# ============================================
@bp.route('/nearby', methods=['GET'])
def nearby_lines():
    lat_raw = (request.args.get('lat') or '').strip()
    lng_raw = (request.args.get('lng') or '').strip()
    if not lat_raw and not lng_raw:
        lat, lng = DEFAULT_LAT, DEFAULT_LNG
    else:
        try:
            lat, lng = float(lat_raw), float(lng_raw)
        except ValueError:
            return jsonify({'error': 'إحداثيات غير صحيحة'}), 400
        if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
            return jsonify({'error': 'إحداثيات غير صحيحة'}), 400

    def produce():
        payload = _fetch_json(f'/nearby-lines?lat={lat}&lng={lng}')
        # sorted by distance asc inside _extract_lines
        return {'data': _extract_lines(payload)[:NEARBY_LIMIT]}

    try:
        return _cached_json(f'nearby:{lat:.6f}:{lng:.6f}', produce)
    except UpstreamError as e:
        if request.args.get('debug') == '1':
            import traceback
            return jsonify({'error': str(e),
                            'trace': traceback.format_exc()[-600:]}), 502
        raise


@bp.route('/search', methods=['GET'])
def search_lines():
    q = (request.args.get('q') or '').strip()
    if len(q) < 2 or len(q) > 60:
        return jsonify({'error': 'أدخل كلمة بحث بين حرفين وستين حرفاً'}), 400

    def produce():
        payload = _fetch_json(f'/searchlines/{quote(q, safe="")}')
        return {'data': _extract_lines(payload)}

    return _cached_json(f'search:{q.lower()}', produce)


@bp.route('/starts/<int:line_id>', methods=['GET'])
def line_starts(line_id: int):
    try:
        page = int(request.args.get('page', 1))
    except ValueError:
        return jsonify({'error': 'رقم صفحة غير صالح'}), 400
    if page < 1:
        page = 1

    def produce():
        payload = _fetch_json(f'/starts/{line_id}?page={page}')
        body = payload.get('data') if isinstance(payload, dict) else {}
        body = body if isinstance(body, dict) else {}
        rows = body.get('data')
        meta = body.get('meta') if isinstance(body.get('meta'), dict) else {}
        if not isinstance(rows, list):
            rows = []
        departures = [d for d in (_normalize_departure(r) for r in rows) if d]
        return {
            'data': departures,
            'meta': {
                'current_page': _as_int(meta.get('current_page'), page),
                'last_page': _as_int(meta.get('last_page'), page),
                'per_page': _as_int(meta.get('per_page')),
            },
        }

    return _cached_json(f'starts:{line_id}:p{page}', produce)


def _as_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# Registration (in app.py):
#   from services.bus_service import bp as bus_bp
#   app.register_blueprint(bus_bp)
