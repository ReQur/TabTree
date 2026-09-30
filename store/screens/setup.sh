#!/usr/bin/env bash
# Once, before `node make.js`, on the owner's WSL Ubuntu, without root: what Chrome for Testing is missing there, and
# the panel's fonts. Neither goes into git.
set -euo pipefail
cd "$(dirname "$0")"

# Chrome needs libgbm and libwayland-server: Ubuntu's packages, unpacked into libs/ (lib/browser.js points at them).
mkdir -p libs/deb libs/root
(cd libs/deb && apt-get download libgbm1 libwayland-server0)
for deb in libs/deb/*.deb; do dpkg -x "$deb" libs/root; done

# The panel is drawn in Segoe UI, as on Windows: the fonts come from Windows, with a fontconfig of their own.
mkdir -p fonts
for f in segoeui segoeuib segoeuil seguisb SegUIVar seguiemj seguisym consola consolab; do
  cp "/mnt/c/Windows/Fonts/$f.ttf" fonts/
done
cat > fonts/fonts.conf <<CONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>$PWD/fonts</dir>
  <cachedir>$PWD/fonts/cache</cachedir>
  <!-- The panel asks for "Segoe UI Variable Text" first: fontconfig names the variable font "Segoe UI Variable". -->
  <alias binding="same"><family>Segoe UI Variable Text</family><prefer><family>Segoe UI</family></prefer></alias>
  <alias binding="same"><family>system-ui</family><prefer><family>Segoe UI</family></prefer></alias>
  <alias binding="same"><family>sans-serif</family><prefer><family>Segoe UI</family></prefer></alias>
  <alias binding="same"><family>Cascadia Mono</family><prefer><family>Consolas</family></prefer></alias>
  <alias binding="same"><family>monospace</family><prefer><family>Consolas</family></prefer></alias>
</fontconfig>
CONF
echo "libs/ and fonts/ are ready"
