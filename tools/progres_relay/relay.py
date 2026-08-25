import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import urllib.error

RELAY_KEY = os.environ.get('RELAY_KEY', 'dz-relay-2026-x7k9p2')

# v3: generic ministry bridge — every upstream is reachable only under its
# prefix, every forwarded path must start with /api/, any method allowed.
# Header forwarding whitelist covers auth + dia/ind ids + ONOU HMAC trio.
DEFAULT_UPSTREAM = 'https://progres.mesrs.dz'
UPSTREAMS = (
    ('/onou/', 'https://gs-api.onou.dz'),
    ('/w/', 'https://api-webetu.mesrs.dz'),
    ('/bus/', 'https://mybus.mesrs.dz'),
)

FORWARD_HEADERS = (
    'authorization', 'content-type',
    'x-dia-id', 'x-ind-id', 'x-timestamp', 'x-nonce', 'x-signature',
)

PROGRES_POST_EXACT = {'/api/authentication/v1/'}
PROGRES_GET_PREFIXES = (
    '/api/infos/',
    '/api/authentication/',
)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _blocked(self, code, msg):
        body = json.dumps({'error': msg}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._proxy('GET')

    def do_POST(self):
        self._proxy('POST')

    def do_PUT(self):
        self._proxy('PUT')

    def do_DELETE(self):
        self._proxy('DELETE')

    def _route(self, path):
        """Returns (upstream, forward_path) or (None, error)."""
        base = path.split('?')[0]
        for prefix, upstream in UPSTREAMS:
            if path.startswith(prefix):
                fwd = path[len(prefix) - 1:]
                if not fwd.startswith('/') or len(fwd) > 480:
                    return (None, 'path not allowed')
                return (upstream, fwd)
        if not base.startswith('/api/'):
            return (None, 'path not allowed')
        if base in PROGRES_POST_EXACT:
            return (DEFAULT_UPSTREAM, path)
        if base.startswith(PROGRES_GET_PREFIXES):
            return (DEFAULT_UPSTREAM, path)
        return (None, 'path not allowed')

    def _proxy(self, method):
        print(f'[relay] {method} {self.path}', flush=True)
        if self.headers.get('X-Relay-Key') != RELAY_KEY:
            return self._blocked(403, 'forbidden')
        upstream, fwd = self._route(self.path)
        if upstream is None:
            return self._blocked(400, fwd)

        length = int(self.headers.get('Content-Length') or 0)
        payload = self.rfile.read(length) if length else None

        req = urllib.request.Request(upstream + fwd, data=payload, method=method)
        if not self.path.startswith('/api/infos/image'):
            req.add_header('Accept', 'application/json')
        req.add_header('User-Agent', 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36')
        for h in FORWARD_HEADERS:
            v = self.headers.get(h)
            if v:
                req.add_header(h, v)
        if payload and not self.headers.get('Content-Type'):
            req.add_header('Content-Type', 'application/json')

        try:
            ctx = None
            if 'onou' in fwd[:1] + self.path[:5]:
                import ssl
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
            r = urllib.request.urlopen(req, timeout=30, context=ctx)
            with r:
                data = r.read()
                self.send_response(r.status)
                self.send_header('Content-Type', r.headers.get('Content-Type', 'application/json'))
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', e.headers.get('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            return self._blocked(502, 'upstream error: %s' % type(e).__name__)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8899))
    print(f'[relay] listening on :{port} -> progres + webetu + onou + mybus', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
