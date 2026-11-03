#!/bin/bash
# Build a thin WebView APK.
# usage: ./android/build.sh <package> "<App name>" <https-url> <out.apk>
set -euo pipefail
SDK="${ANDROID_HOME:-$HOME/android-sdk}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
ROOT="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
PKG="$1"
APP_NAME="$2"
APP_URL="$3"
OUT="$4"
JAVA_DIR="$WORK/java/${PKG//.//}"
mkdir -p "$WORK/res/drawable" "$JAVA_DIR" "$WORK/obj" "$WORK/dex"
sed "s/PKG/$PKG/;s|APPNAME|$APP_NAME|" "$ROOT/src/AndroidManifest.xml" > "$WORK/AndroidManifest.xml"
cp "$ROOT/src/ic.xml" "$WORK/res/drawable/ic.xml"
sed "s/PKG/$PKG/;s|APPURL|$APP_URL|" "$ROOT/src/MainActivity.java" > "$JAVA_DIR/MainActivity.java"
sed "s/PKG/$PKG/" "$ROOT/src/KeepAliveService.java" > "$JAVA_DIR/KeepAliveService.java"
"$BT/aapt2" compile --dir "$WORK/res" -o "$WORK/res.zip"
"$BT/aapt2" link -I "$JAR" --manifest "$WORK/AndroidManifest.xml" -o "$WORK/unsigned.apk" "$WORK/res.zip"
javac -source 8 -target 8 -encoding UTF-8 -nowarn -cp "$JAR" -d "$WORK/obj" $(find "$JAVA_DIR" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$WORK/dex" $(find "$WORK/obj" -name '*.class')
(cd "$WORK/dex" && jar uf "$WORK/unsigned.apk" classes.dex)
"$BT/zipalign" -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
KEYSTORE="${KEYSTORE:-$ROOT/debug.keystore}"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass hydptt123 -keypass hydptt123 -alias hydptt \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Hyderabad Police PTT Demo" >/dev/null
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:hydptt123 --key-pass pass:hydptt123 --out "$OUT" "$WORK/aligned.apk"
rm -rf "$WORK"
echo "Wrote $OUT"
