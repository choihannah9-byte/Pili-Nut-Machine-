# Pili Cracker — Interactive Design Models

Interactive 3D models for the TUP BSME capstone: an integrated grading and
dual counter-rotating roller pili nut shell cracker.

Included models (switch with the bar at the top of the app):
- **Rev C Assembly (current)** — full machine with buffer-bin architecture,
  single-lane queue feed, containment, and flow-path overlay.
- **Nip Simulator** — set the gap and nut grade, feed nuts, watch outcomes
  (whole kernel / crushed / uncracked).
- **Rev B Assembly (superseded)** — kept for design-history comparison.

> These models are illustrative concept models built to Rev B/C proportions.
> They are NOT fabrication references — the dimensioned PNC CAD drawing set is.

## Run it — three options

### Option 1 — StackBlitz (no install, in the browser)
1. Put this folder in a GitHub repo (see Option 2, steps 1–3).
2. Open: `https://stackblitz.com/github/YOUR_USERNAME/YOUR_REPO`
3. It installs and runs automatically. Edits are live.

(Alternative without GitHub: go to https://vite.new/react, then drag-drop the
files from this folder into the StackBlitz file panel, replacing the starter's
`src/` and `package.json`, and let it reinstall.)

### Option 2 — GitHub (storage + versioning)
1. Create a new repository at github.com (private is fine).
2. "Add file → Upload files" and drag the entire contents of this folder
   (keep the `src/` structure).
3. Commit. The repo now archives the source; open it in StackBlitz per
   Option 1, or clone it locally per Option 3.

CodeSandbox works the same way: `https://codesandbox.io/s/github/YOUR_USERNAME/YOUR_REPO`

### Option 3 — Run locally
Requires Node.js 18+ (nodejs.org).
```
npm install
npm run dev
```
Open the printed local URL (usually http://localhost:5173).

## Notes
- `three` is pinned to **0.128.0** to match the API version the models were
  written against. Upgrading to newer three.js will mostly work (only core
  APIs are used) but re-test the serrated-roller extrusions and tube
  geometry if you bump it.
- Each component is self-contained (scene, controls, UI in one file), so you
  can copy any single `.jsx` into another React project along with the
  `three` dependency.
- A zero-setup distribution copy also exists:
  `Pili_Assembly_Model_RevC_Standalone.html` (single file, opens in any
  browser) — use that for demos; use THIS project for editing.
