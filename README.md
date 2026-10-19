# Text Library - After Effects panel

CEP panel for After Effects 2020+ (Windows): a library of text animations and compositions with preview, In/Out/Remove, a Flow easing editor, and an Edit tab for texts, size and duration of precomps.

## Set up on a new computer

1. Install Git and clone this repo:
   ```
   git clone https://github.com/<your-account>/TextLibrary-AE.git
   ```
2. Close After Effects.
3. Double-click **`install-dev.bat`** in the cloned folder. The panel is linked to this folder, so edits to the code show up in After Effects after reopening the panel.
   (Use `install.bat` instead to copy a fixed version without linking.)
4. Open After Effects: **Window > Extensions > Text Library**.

## Daily workflow

- Before you start working: `git pull`
- After changes: `git add -A`, `git commit -m "..."`, `git push`
- Reopen the panel in After Effects to load the new code.

## Files

| Path | What it is |
| --- | --- |
| `CSXS/manifest.xml` | Extension manifest (AE 2020+ / CEP 9+) |
| `index.html`, `css/style.css` | Panel UI |
| `js/main.js` | Library, Edit tab, menus |
| `js/flow.js` | Flow easing editor |
| `jsx/host.jsx` | After Effects side (ExtendScript) |
| `install.ps1`, `install*.bat` | Installer / updater |

The preset library itself (`Documents\TextLibrary` by default) is **not** part of the repo - copy it separately or point both computers to a shared folder in the panel settings.
