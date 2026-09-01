#!/usr/bin/env bash
# Writes the two Android launcher-icon resources that `tauri android init` copies into the generated
# project. They used to be committed, and that is the problem: Unraid's Community Applications parses
# every .xml file in a template repository and reports anything that is not a container template as
# `not_unraid_application` -- two files, two warnings on every scan, with no way to tell CA to skip a
# path. They are four lines of fixed content, so they are written here instead of stored.
#
# `tauri icon <png>` regenerates them too; if you run it, delete them again or leave them, .gitignore
# keeps them out of the repository either way.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
icons="${here}/src-tauri/icons/android"

mkdir -p "${icons}/mipmap-anydpi-v26" "${icons}/values"

cat > "${icons}/mipmap-anydpi-v26/ic_launcher.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <background android:drawable="@color/ic_launcher_background"/>
</adaptive-icon>
XML

cat > "${icons}/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">#fff</color>
</resources>
XML

echo "wrote the Android launcher-icon resources"
