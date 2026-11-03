#!/bin/bash
# usage: build.sh <package> "<App Name>" <url> <#color> <out.apk>
set -euo pipefail
SDK=${ANDROID_HOME:-$HOME/android-sdk}
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
JAR=$(ls -d "$SDK"/platforms/android-*/android.jar | sort -V | tail -1)
D=$(dirname "$(readlink -f "$0")")
T=$(mktemp -d)
P=$1
mkdir -p "$T/res/drawable" "$T/java/${P//.//}" "$T/obj" "$T/dex"
sed "s/PKG/$P/;s|APPNAME|$2|" "$D/src/AndroidManifest.xml" > "$T/AndroidManifest.xml"
sed "s/COLOR/$4/" "$D/src/ic.xml" > "$T/res/drawable/ic.xml"
sed "s/PKG/$P/;s|APPURL|$3|" "$D/src/MainActivity.java" > "$T/java/${P//.//}/MainActivity.java"
"$BT/aapt2" compile --dir "$T/res" -o "$T/res.zip"
"$BT/aapt2" link -I "$JAR" --manifest "$T/AndroidManifest.xml" -o "$T/u.apk" "$T/res.zip" --min-sdk-version 24 --target-sdk-version 34
javac --release 8 -nowarn -cp "$JAR" -d "$T/obj" $(find "$T/java" -name '*.java')
"$BT/d8" --min-api 24 --lib "$JAR" --output "$T/dex" $(find "$T/obj" -name '*.class')
(cd "$T/dex" && jar uf "$T/u.apk" classes.dex)
"$BT/zipalign" -f 4 "$T/u.apk" "$T/a.apk"
KS=${KEYSTORE:-$D/demo.keystore}
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass demo1234 -keypass demo1234 -alias demo -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=HCP PTT Demo" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:demo1234 --out "$5" "$T/a.apk"
rm -rf "$T"
