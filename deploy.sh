#!/bin/bash
set -e

echo "=== University Portal Deployment ==="

# 1. System deps
sudo apt update
sudo apt install -y python3-pip python3-venv nginx certbot python3-certbot-nginx

# 2. Project setup
PROJECT_DIR="/var/www/university-portal"
sudo mkdir -p $PROJECT_DIR /var/log/university
sudo cp -r . $PROJECT_DIR/
cd $PROJECT_DIR

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 3. Gunicorn service
sudo tee /etc/systemd/system/university-web.service > /dev/null <<EOF
[Unit]
Description=University Portal Web
After=network.target

[Service]
User=root
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/venv/bin/gunicorn -c gunicorn.conf.py flask_backend.app:app
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# 4. Telegram bot service
sudo tee /etc/systemd/system/university-bot.service > /dev/null <<EOF
[Unit]
Description=University Telegram Bot
After=network.target

[Service]
User=root
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/venv/bin/python bot.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

# 5. Nginx
sudo tee /etc/nginx/sites-available/university > /dev/null < nginx.conf
sudo ln -sf /etc/nginx/sites-available/university /etc/nginx/sites-enabled/university
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 6. Start services
sudo systemctl daemon-reload
sudo systemctl enable university-web university-bot
sudo systemctl start university-web university-bot

echo ""
echo "=== DONE ==="
echo "Website: http://$(curl -s ifconfig.me)"
echo "Bot running: systemctl status university-bot"
echo ""
echo "Next: run 'sudo certbot --nginx' to add SSL"
