"""طبقة توافق خفيفة تحاكي واجهة requests باستخدام urllib المدمج.
تُستخدم داخل الخدمات لتجنّب أي تبعية خارجية ناقصة في بيئة النشر."""
import json as _json
import urllib.request
import urllib.error
import urllib.parse
import ssl

_CTX_INSECURE = ssl.create_default_context()
_CTX_INSECURE.check_hostname = False
_CTX_INSECURE.verify_mode = ssl.CERT_NONE


class Response:
    def __init__(self, status_code, text, headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}

    @property
    def ok(self):
        return 200 <= self.status_code < 300

    @property
    def content(self):
        return self.text.encode('utf-8', 'replace')

    def json(self):
        return _json.loads(self.text)


def _send(method, url, params=None, json=None, headers=None, timeout=25,
          verify=True, data=None):
    if params:
        sep = '&' if '?' in url else '?'
        url = url + sep + urllib.parse.urlencode(params)
    body = None
    if json is not None:
        body = _json.dumps(json, separators=(',', ':')).encode()
        headers = dict(headers or {})
        headers.setdefault('Content-Type', 'application/json')
    elif data is not None:
        body = data if isinstance(data, bytes) else str(data).encode()
    req = urllib.request.Request(url, data=body, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    req.add_header('Accept', 'application/json')
    ctx = None
    if url.startswith('https://') and not verify:
        ctx = _CTX_INSECURE
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return Response(r.status, r.read().decode('utf-8', 'replace'),
                            dict(r.headers.items()))
    except urllib.error.HTTPError as e:
        return Response(e.code, e.read().decode('utf-8', 'replace'),
                        dict(e.headers.items()) if e.headers else {})


def get(url, **kw):
    return _send('GET', url, **kw)


def post(url, **kw):
    return _send('POST', url, **kw)


def put(url, **kw):
    return _send('PUT', url, **kw)


def delete(url, **kw):
    return _send('DELETE', url, **kw)


def patch(url, **kw):
    return _send('PATCH', url, **kw)


class Session:
    """جلسة مبسّطة تكفي الاستخدامات الفعلية في الخدمات (ترويسات افتراضية + طرق HTTP)."""

    def __init__(self, headers=None):
        self.headers = dict(headers or {})

    def _merge(self, headers):
        h = dict(self.headers)
        if headers:
            h.update(headers)
        return h

    def request(self, method, url, **kw):
        kw['headers'] = self._merge(kw.get('headers'))
        return _send(method.upper(), url, **kw)

    def get(self, url, **kw):
        kw['headers'] = self._merge(kw.get('headers'))
        return _send('GET', url, **kw)

    def post(self, url, **kw):
        kw['headers'] = self._merge(kw.get('headers'))
        return _send('POST', url, **kw)

    def put(self, url, **kw):
        kw['headers'] = self._merge(kw.get('headers'))
        return _send('PUT', url, **kw)

    def delete(self, url, **kw):
        kw['headers'] = self._merge(kw.get('headers'))
        return _send('DELETE', url, **kw)

    def patch(self, url, **kw):
        kw['headers'] = self._merge(kw.get('headers'))
        return _send('PATCH', url, **kw)


def request(method, url, **kw):
    return _send(method.upper(), url, **kw)
