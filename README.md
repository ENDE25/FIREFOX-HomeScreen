# HomeScreen

A browser extension that replaces the new tab page with a clean, customizable dashboard. Built with vanilla HTML, CSS, and JavaScript.

Available for Firefox soon. Right now it can be installed from [this link](https://addons.mozilla.org/firefox/downloads/file/4765378/7c58e3dbbd11477ca6ae-1.0.xpi)

<img width="1844" height="971" alt="image" src="https://github.com/user-attachments/assets/c56e4432-9d7f-43da-ac4b-8f3881b87530" />



## Features

### Workspaces

Organize your bookmarks into named columns, each with its own color label. You can create as many workspaces as you need, rename them inline, and reorder them by dragging. Links within each workspace are sorted automatically by how often you click them; the most-used links rise to the top over time.

### Web and AI search

Two independent search bars sit at the top of the page: one for web search and one for an AI assistant. Each can be toggled on or off independently. Both support any service via URL templates using the `{q}` placeholder. Quick presets are provided for Google, DuckDuckGo, Bing, Claude, ChatGPT, Gemini, and DeepSeek.

### AI shortcuts

A row of icon shortcuts to AI services is displayed between the search bars and your workspaces. You can add and remove entries, and reorder them by dragging.

### Wallpaper

Upload any image from your device as a background. When a wallpaper is active, workspace columns and link cards automatically apply a glassmorphism effect.

### Settings panel

Open with the gear icon in the bottom-right corner. From here you can:

- Show or hide the clock
- Show or hide each search bar individually
- Set the web search engine and AI assistant URL
- Add, remove, and reorder AI shortcuts
- Create and delete workspaces
- Upload or remove the wallpaper
- Export all your data to a JSON file
- Import a previously exported file to restore everything

### Export and import

All your data: workspaces, links, shortcuts, search settings, and wallpaper can be exported to a single JSON file and imported back at any time. Useful for backups or migrating between browsers.

---

## Data and privacy

All data is stored locally in your browser using the `browser.storage` API. Workspace data and settings use `storage.sync`, which means they sync across your devices automatically through Firefox Sync. The wallpaper image is stored in `storage.local` due to size constraints.

No data is sent to any external server. The extension collects nothing.

---

## File structure

```
index.html    Page markup and settings panel
style.css     All styles
app.js        Application logic, state, and event handling
manifest.json Extension manifest (Manifest V2, Firefox)
favicon.svg   Tab icon
```

---

## Local development

Open `index.html` directly in a browser. The app detects whether it is running as an extension and falls back to `localStorage` automatically, so everything works without packaging.
