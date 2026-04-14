# Browser HomeScreen

A custom browser start page designed to be fast, minimal, and locally persistent. Built with vanilla HTML, CSS, and JavaScript — no dependencies, no build step.

## Features

**Workspaces**
Organize links into named columns. Each workspace has a color label and supports drag-and-drop reordering of both links and workspace columns. Links are automatically sorted by click frequency — the more you use a link, the higher it appears.

**Search**
Two independent search bars: one for web search and one for an AI assistant. Both are configurable from the settings panel and support any search engine via URL templates using the `{q}` placeholder (e.g. `https://www.google.com/search?q={q}`).

**AI Shortcuts**
A row of icon-only shortcuts to AI services, displayed below the search bars. The list is fully configurable — add or remove entries from settings. Order can be changed by dragging.

**Wallpaper**
Upload a local image as background. When a wallpaper is active, workspace columns and link cards apply a glassmorphism effect automatically. The image is stored as base64 in localStorage.

**Settings panel**
Accessible via the gear icon in the bottom-right corner. Controls:
- Show/hide the clock
- Show/hide each search bar independently
- Configure search engine and AI assistant URLs
- Manage AI shortcuts (add, remove)
- Add workspaces
- Upload or remove wallpaper

## Data persistence

All data is stored in the browser's `localStorage` under the following keys:

| Key | Contents |
|---|---|
| `homescreen_v2` | Workspaces and links, including click counts |
| `homescreen_ai` | AI shortcut list and order |
| `homescreen_search` | Configured search engine and AI assistant URLs |
| `homescreen_wallpaper` | Wallpaper image encoded as base64 |
| `homescreen_clock` | Clock visibility preference |
| `homescreen_web_search` | Web search bar visibility preference |
| `homescreen_ai_search` | AI search bar visibility preference |

Data is local to the browser and domain. There is no sync between devices in the current version.

## Usage

Open `index.html` directly in a browser or serve it with any static file server. No installation or build process required.

To use it as your browser's start page, set the file path or local server URL as the homepage in your browser settings.

## Planned: Firefox Extension

The project is structured for straightforward migration to a Firefox WebExtension. The main changes required are:

1. Add a `manifest.json` with `chrome_url_overrides: { newtab: "index.html" }`.
2. Replace `localStorage` calls with the `browser.storage` API (`storage.sync` for settings and links, `storage.local` for the wallpaper).
3. Declare the `storage` permission in the manifest.

Once packaged as an extension, link data and settings will sync across devices via Firefox Sync automatically.

## File structure

```
index.html       Main page and settings panel markup
style.css       All styles
app.js          Application logic, state management, and event handling
favicon.svg     Page icon (Firefox Nightly aesthetic)
```

## Local development

Any static file server works. With the VS Code Live Server extension, open `index.html` and click "Go Live".
