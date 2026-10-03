CHAPTER LINK IMPORTER TEST V5 — DIRECT ADAPTERS

Direct sources
--------------
MangaDex
- Public API.
- Chapter link -> exact page list -> verified ZIP.

ReManga
- Publicly accessible chapter API only.
- Chapter link -> chapter id -> exact image list -> verified ZIP.
- Does not send login cookies and does not bypass paid/private chapter access.

WeebCentral
- Public chapter image response only.
- Chapter link -> chapter id -> exact image list -> verified ZIP.
- Does not bypass login, CAPTCHA or access controls.

Verification
------------
- Expected page count is determined before download.
- Every response must be a non-empty image.
- Each failed page retries up to 3 times.
- SHA-256 duplicate detection.
- ZIP is blocked if any expected page fails.
- ZIP is assembled locally in the browser.

Other modes
-----------
InkStory
- Public page count + official ZIP verifier.

MangaLib / Senkuro / MangaBuff
- Existing official Scanlate Downloader helper remains.

Deploy update
-------------
Overwrite your current repo files with this package, then:

  git add .
  git commit -m "Add direct ReManga and WeebCentral adapters"
  git push origin main

No new environment variables are required.
