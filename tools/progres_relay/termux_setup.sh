#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# جسر بروقرس على أندرويد — تثبيت بأمر واحد
# يشغّل: relay.py + نفق cloudflared + تسجيل الرابط تلقائياً
# ============================================================
set -e

PORTAL="https://university-portal-gv78.onrender.com"
RELAY_KEY="dz-relay-2026-x7k9p2"
DIR="$HOME/progres-relay"

echo "[1/5] تجهيز الحزم..."
pkg update -y >/dev/null 2>&1 || true
pkg install -y python cloudflared >/dev/null 2>&1 || {
  # بعض النسخ لا تحتوي cloudflared في المستودع — نجلب الثنائي مباشرة
  pkg install -y python curl >/dev/null 2>&1
  curl -sL -o "$HOME/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
  chmod +x "$HOME/cloudflared"
  alias cloudflared="$HOME/cloudflared"
}
command -v cloudflared >/dev/null || { cp "$HOME/cloudflared" "$PREFIX/bin/cloudflared"; chmod +x "$PREFIX/bin/cloudflared"; }

mkdir -p "$DIR"; cd "$DIR"

echo "[2/5] كتابة relay.py..."
cat > relay.py << 'PYEOF'
import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request, urllib.error

RELAY_KEY = 'dz-relay-2026-x7k9p2'
UPSTREAM = 'https://progres.mesrs.dz'
POST_EXACT = {'/api/authentication/v1/'}
GET_PREFIXES = (
    '/api/infos/bac/', '/api/infos/planningSession/', '/api/infos/controleContinue/',
    '/api/infos/image/', '/api/infos/logoEtablissement/',
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

    def do_GET(self): self._proxy('GET')
    def do_POST(self): self._proxy('POST')

    def _proxy(self, method):
        if self.headers.get('X-Relay-Key') != RELAY_KEY:
            return self._blocked(403, 'forbidden')
        path = self.path.split('?')[0]
        ok = (path in POST_EXACT) if method == 'POST' else path.startswith(GET_PREFIXES)
        if not ok:
            return self._blocked(400, 'path not allowed')
        length = int(self.headers.get('Content-Length') or 0)
        payload = self.rfile.read(length) if length else None
        req = urllib.request.Request(UPSTREAM + self.path, data=payload, method=method)
        if not path.startswith('/api/infos/image/'):
            req.add_header('Accept', 'application/json')
        req.add_header('User-Agent', 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')
        auth = self.headers.get('Authorization')
        if auth: req.add_header('authorization', auth)
        if payload: req.add_header('Content-Type', 'application/json')
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

    def log_message(self, fmt, *args): pass

if __name__ == '__main__':
    print('[relay] listening on :8899 -> ' + UPSTREAM, flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8899), Handler).serve_forever()
PYEOF

echo "[3/5] كتابة مشغّل الخدمة..."
cat > runner.sh << SHEOF
#!/data/data/com.termux/files/usr/bin/bash
cd "\$HOME/progres-relay"
termux-wake-lock 2>/dev/null
pkill -f relay.py 2>/dev/null; pkill -f cloudflared 2>/dev/null; sleep 1
python relay.py > relay.log 2>&1 &
cloudflared tunnel --url http://127.0.0.1:8899 --no-autoupdate > tunnel.log 2>&1 &
URL=""
for i in \$(seq 1 40); do
  URL=\$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log | head -1)
  [ -n "\$URL" ] && break
  sleep 3
done
if [ -z "\$URL" ]; then echo "FAILED: no tunnel URL — راجع tunnel.log"; exit 1; fi
echo "=================================================="
echo "  رابط الجسر الجديد: \$URL"
echo "  سيتم تسجيله تلقائياً في الموقع خلال ثوانٍ..."
echo "  اترك الهاتف موصولاً بالشاحن ولا تغلق ترموكس"
echo "=================================================="
while true; do
  curl -s -X POST $PORTAL/api/progres/relay-register \\
    -H 'Content-Type: application/json' \\
    -d "{\\"url\\":\\"\$URL\\",\\"key\\":\\"$RELAY_KEY\\"}" >/dev/null 2>&1
  sleep 300
done
SHEOF
chmod +x runner.sh

echo "[4/5] التشغيل..."
if pgrep -f "runner.sh" >/dev/null; then pkill -f runner.sh; sleep 1; fi
nohup bash runner.sh > runner.log 2>&1 &

echo "[5/5] انتظار النفق وتسجيله..."
sleep 20
URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' tunnel.log 2>/dev/null | head -1)
REG=$(curl -s -X POST $PORTAL/api/progres/relay-register -H 'Content-Type: application/json' -d "{\"url\":\"$URL\",\"key\":\"$RELAY_KEY\"}")
echo ""
echo "================= النتيجة ================="
echo "رابط النفق : ${URL:-لم يظهر بعد — شغّل: bash ~/progres-relay/runner.sh}"
echo "التسجيل    : ${REG}"
echo "==========================================="
