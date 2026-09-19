"""
Library service blueprint — public scholarly proxies (/api/lib).
No auth needed: only open-access scholarly metadata (Semantic Scholar).
"""

import json
import os
import time
import urllib.parse
import urllib.request

from flask import Blueprint, Response, jsonify, request
from sqlalchemy import create_engine, text

bp = Blueprint('lib', __name__, url_prefix='/api/lib')

S2_URL = 'https://api.semanticscholar.org/graph/v1/paper/search'
S2_FIELDS = 'title,authors,year,abstract,citationCount,openAccessPdf,url,venue'
TIMEOUT = 20
CACHE_TTL = 24 * 3600

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


def _cache_get(key, ttl):
    try:
        with _engine().connect() as c:
            row = c.execute(
                text('SELECT payload, created_at FROM progres_cache '
                     'WHERE cache_key = :k'), {'k': key}).fetchone()
        if not row:
            return None
        created = row[1]
        if isinstance(created, str):
            try:
                from datetime import datetime
                created = datetime.fromisoformat(created)
            except ValueError:
                return None
        if not created:
            return None
        from datetime import datetime
        if (datetime.utcnow() - created).total_seconds() > ttl:
            return None
        return json.loads(row[0])
    except Exception:
        return None


def _cache_set(key, data):
    try:
        from datetime import datetime
        with _engine().connect() as c:
            c.execute(
                text('''INSERT INTO progres_cache (cache_key, payload, content_type, created_at)
                    VALUES (:k, :p, 'application/json', :ts)
                    ON CONFLICT (cache_key) DO UPDATE
                    SET payload = :p, content_type = 'application/json', created_at = :ts'''),
                {'k': key, 'p': json.dumps(data, ensure_ascii=False), 'ts': datetime.utcnow()},
            )
            c.commit()
    except Exception:
        pass


def _s2_fetch(query):
    params = urllib.parse.urlencode({
        'query': query, 'limit': 20,
        'fields': S2_FIELDS,
    })
    headers = {'Accept': 'application/json',
               'User-Agent': 'university-portal-library/1.0 (contact: t.me/vmw23)'}
    api_key = os.environ.get('S2_API_KEY', '').strip()
    if api_key:
        headers['x-api-key'] = api_key
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                S2_URL + '?' + params,
                headers=headers,
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                if resp.status == 429:
                    last = 'busy'
                    time.sleep(2 * (attempt + 1))
                    continue
                if resp.status != 200:
                    last = f'http-{resp.status}'
                    break
                return json.loads(resp.read()), None
        except Exception as e:
            last = type(e).__name__
            time.sleep(1.5 * (attempt + 1))
    return None, (last or 'unreachable')


@bp.get('/s2')
def s2():
    q = (request.args.get('q') or '').strip()
    if not q or len(q) > 200:
        return jsonify({'error': 'q مطلوب'}), 400
    key = 'lib:s2:' + q.lower()
    hit = _cache_get(key, CACHE_TTL)
    if hit is not None:
        r = jsonify(hit)
        r.headers['X-Cache'] = 'hit'
        return r
    data, err = _s2_fetch(q)
    if data is None:
        return jsonify({'error': 'مصدر البحوث مشغول حالياً — حاول بعد دقيقة'}), 502
    items = data.get('data') if isinstance(data, dict) else None
    out = {'total': (data.get('total') if isinstance(data, dict) else 0) or 0,
           'data': items if isinstance(items, list) else []}
    _cache_set(key, out)
    r = jsonify(out)
    r.headers['X-Cache'] = 'miss'
    return r
