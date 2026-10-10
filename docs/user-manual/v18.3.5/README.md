# Horde Studio v18.3.5 illustrated user manual

Final PDF: `output/pdf/Horde-Studio-v18.3.5-Illustrated-User-Manual.pdf` at the repository root.

The manual contains 74 task topics, 48 real application screenshots, four workflow illustrations, worked Virtual Human and World examples, searchable text, linked contents, chapter/topic bookmarks, and a 369-term linked index.

`content.py` is the editable manuscript. `build.py` generates the PDF with ReportLab and uses the supplied uncropped screenshots in `screens/`. It embeds Arial from the macOS system font folder. Run from the repository root with Python containing ReportLab and Pillow: `python3 docs/user-manual/v18.3.5/build.py`.

Screenshots use an isolated browser profile and disposable VH2 database. Maya Chen and Harbour Museum Mystery are teaching examples. Existing World Play illustrates the bundled Policy Panic setting with its authored introduction, without paid generation. The capture scripts document the process and use the local Codex-bundled Playwright/Chrome paths; adjust paths on another machine. They do not read the user's saved library or provider credentials.

Validation: all 86 pages rendered and visually reviewed; searchable text extracted from every page; all 74 topic headings verified on their contents-linked pages; 543 internal links validated; page-boundary text checks passed. The illustrated HTML edition is now built into the app beneath Pip. Run `python3 scripts/build-html-handbook.py` to regenerate `horde-handbook.js` and `assets/manual/` from this manuscript. The HTML edition updates Pip’s independent provider settings and adds NanoGPT troubleshooting; the existing PDF remains the original release manual. Its `pip-assistant-settings.png` screenshot captures the new assistant settings in a disposable test library.
