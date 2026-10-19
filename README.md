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

## Preset library

The presets live in `library/` inside this repo, so they travel with git.

- Saving, deleting a preset or creating a category in the panel commits **only `library/`** and pushes it to GitHub automatically.
- When the panel opens it pulls from GitHub; the cloud button in the top bar syncs on demand.
- Deleted presets disappear from the repo but stay in the git history, so they can be restored.
- Git must be installed and signed in to GitHub (e.g. `gh auth login` + `gh auth setup-git`) for the sync to work.
