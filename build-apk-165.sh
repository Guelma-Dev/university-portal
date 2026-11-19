#!/usr/bin/env bash
# ==================================================================
#  Build signed release APK - "Student Portal" v1.4.65 (81)
#  Branch: fix/session-persistence
#  Changes: permanent session — no automatic logout. Silent renewal
#           with retries at boot / on resume, vault never wiped on a
#           transient 400/401, native meal booker re-armed after every
#           renewal, duplicate logout controls removed (account only).
#  Run from inside your university-portal project folder.
#  Your signing key (android/keystore.properties) stays on YOUR PC.
# ==================================================================
set -e
cd "$(dirname "$0")"

echo "[1/6] Checking project folder..."
if [ ! -f package.json ]; then
  echo "ERROR: package.json not found."
  echo "       Copy this file into your university-portal folder and run it there."
  exit 1
fi
if [ ! -f android/keystore.properties ]; then
  echo "WARNING: android/keystore.properties not found."
  echo "         The APK may build unsigned. Make sure your keystore.properties"
  echo "         is inside the android/ folder, as usual."
fi

echo "[2/6] Switching to branch fix/session-persistence..."
git fetch origin
git checkout fix/session-persistence
git pull --ff-only origin fix/session-persistence

echo "[3/6] Installing dependencies (npm install)..."
npm install

echo "[4/6] Preparing web assets (npm run app:sync)..."
npm run app:sync

echo "[5/6] Building release APK (takes a few minutes)..."
(cd android && ./gradlew assembleRelease)

echo "[6/6] Collecting the APK..."
SRC="android/app/build/outputs/apk/release/app-release.apk"
[ -f "$SRC" ] || { echo "ERROR: APK not found at $SRC"; exit 1; }
cp -f "$SRC" "app-81.apk"
echo
echo "APK ready: $(pwd)/app-81.apk"
sha256sum app-81.apk
echo
echo "Publish app-81.apk to gh-pages:app/releases/ + update.json, then push both branches."
