import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import urllib.error

RELAY_KEY = os.environ.get('RELAY_KEY', 'dz-relay-2026-x7k9p2')

# v2: multi-upstream — progres (grades) + ONOU (meal reservations)
DEFAULT_UPSTREAM = 'https://progres.mesrs.dz'
ONOU_UPSTREAM = 'https://gs-api.onou.dz'
ONOU_PREFIX = '/onou/'

PROGRES_POST_EXACT = {'/api/authentication/v1/'}
PROGRES_GET_PREFIXES = (
    '/api/infos/bac/',
    '/api/infos/planningSession/',
    '/api/infos/controleContinue/',
    '/api/infos/image/',
    '/api/infos/logoEtablissement/',
)

ONOU_POST_EXACT = {'/api/reservemeal', '/api/authentication/v1/'}
ONOU_DELETE_PREFIX = '/api/reservemeal/'
ONOU_GET_PREFIXES = (
    '/api/meal-reservations/',
    '/api/getdepotres',
    '/api/checkHebergement/',
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

    def do_DELETE(self):
        self._proxy('DELETE')

    def _route(self, method, path):
        """Returns (upstream, forward_path) or (None, error) if not allowed."""
        if path.startswith(ONOU_PREFIX):
            p = path[len(ONOU_PREFIX) - 1:]  # keep leading '/'
            base = p.split('?')[0]
            if method == 'POST':
                ok = base in ONOU_POST_EXACT
            elif method == 'DELETE':
                ok = base.startswith(ONOU_DELETE_PREFIX)
            else:
                ok = base.startswith(ONOU_GET_PREFIXES)
            return (ONOU_UPSTREAM, p) if ok else (None, 'path not allowed (onou)')
        base = path.split('?')[0]
        if method == 'POST':
            ok = base in PROGRES_POST_EXACT
        elif method == 'DELETE':
            ok = False
        else:
            ok = base.startswith(PROGRES_GET_PREFIXES)
        return (DEFAULT_UPSTREAM, path) if ok else (None, 'path not allowed')

    def _proxy(self, method):
        print(f'[relay] {method} {self.path}', flush=True)
        if self.headers.get('X-Relay-Key') != RELAY_KEY:
            return self._blocked(403, 'forbidden')
        upstream, fwd = self._route(method, self.path)
        if upstream is None:
            return self._blocked(400, fwd)

        length = int(self.headers.get('Content-Length') or 0)
        payload = self.rfile.read(length) if length else None

        req = urllib.request.Request(upstream + fwd, data=payload, method=method)
        # The image endpoint rejects requests carrying Accept: application/json
        if not self.path.startswith('/api/infos/image/'):
            req.add_header('Accept', 'application/json')
        req.add_header('User-Agent', 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36')
        auth = self.headers.get('Authorization')
        if auth:
            req.add_header('authorization', auth)
        if payload:
            req.add_header('Content-Type', 'application/json')

        try:
            with urllib.request.urlopen(req, timeout=30) as r:
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
    print(f'[relay] listening on :{port} -> progres.mesrs.dz + gs-api.onou.dz', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
