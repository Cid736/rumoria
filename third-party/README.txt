Rumoria — third-party components
================================

Rumoria itself is MIT-licensed (see LICENSE).

yt-dlp (bin/yt-dlp.exe in Rumoria.exe and Rumoria-Setup.exe; Rumoria-Lite
downloads it from github.com/yt-dlp on first launch)
  License: YT-DLP-LICENSE.txt (The Unlicense — public domain).
  The Windows .exe is built with PyInstaller and includes Python and other
  libraries under their own licenses: YT-DLP-THIRD_PARTY_LICENSES.txt.
  Source: https://github.com/yt-dlp/yt-dlp
  Rumoria only runs it as a separate program.

npm packages (the local server and the page)
  THIRD-PARTY-NOTICES.txt — every package with its license text
  (all MIT at the time of writing).

Electron and Chromium
  Their licenses are added by the build next to the program:
  LICENSE.electron.txt and LICENSES.chromium.html.

Rumoria does not include FFmpeg.
