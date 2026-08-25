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
pkg install -y python cloudflared curl >/dev/null 2>&1 || {
  # بعض النسخ لا تحتوي cloudflared في المستودع — نجلب الثنائي مباشرة
  pkg install -y python curl >/dev/null 2>&1
  curl -sL -o "$HOME/cloudflared" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
  chmod +x "$HOME/cloudflared"
  alias cloudflared="$HOME/cloudflared"
}
command -v cloudflared >/dev/null || { cp "$HOME/cloudflared" "$PREFIX/bin/cloudflared"; chmod +x "$PREFIX/bin/cloudflared"; }

mkdir -p "$DIR"; cd "$DIR"

echo "[2/5] تحميل أحدث relay.py من المستودع..."
curl -sL -o "$DIR/relay.py" https://raw.githubusercontent.com/Guelma-Dev/university-portal/main/tools/progres_relay/relay.py
if [ ! -s "$DIR/relay.py" ]; then echo "FAILED: تعذر تحميل relay.py — تحقق من الاتصال"; exit 1; fi

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
