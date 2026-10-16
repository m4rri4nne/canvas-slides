<div align="center">

# 🎞️ Canvas Slides ✨

**Turn any Obsidian canvas into a lovely presentation** 🌸

*Follow the arrows, hop between groups, or zoom through your ideas, all in full screen.*

![Obsidian](https://img.shields.io/badge/Obsidian-plugin-a78bfa?style=for-the-badge&logo=obsidian&logoColor=white)
![Version](https://img.shields.io/badge/version-0.1.0-f9a8d4?style=for-the-badge)
![Mobile](https://img.shields.io/badge/mobile-friendly-86efac?style=for-the-badge)

</div>

---

## 💖 What it does

Your canvas is already a beautiful map of ideas, so why not present it? Canvas Slides walks through your nodes one step at a time and shows each one big and pretty.

### 🎬 Two modes

| Mode | What happens |
|---|---|
| 🖼️ **Slide by slide** | Each step fills the whole screen. |
| 🔭 **Zoom through the canvas** | The camera glides and zooms across your canvas from one step to the next. |

### 🧭 Three ways to order your slides

- ➡️ **Arrows**: follows the canvas connections (depth-first from the root nodes).
- 🫧 **Groups**: each group becomes one slide, and loose nodes become slides of their own.
- 📍 **Position**: reading order (top → bottom, left → right).

### 🧁 Shows everything a canvas can hold

📝 Text cards (Markdown) · 📒 Notes (even heading subpaths) · 🖼️ Images · 📄 PDFs · 🔗 Links

And your canvas colors come along too 🎨, used as accents on each slide.

---

## 🚀 How to use

Open a canvas, then start presenting in whichever way you like best:

- 🖱️ Click the presentation icon in the canvas tab's title bar
- 🎀 Click the presentation icon in the ribbon
- 👉 Right-click a `.canvas` file and pick **Present as slides** or **Present with zoom**
- ⌨️ Open the command palette and run one of:
  - `Present canvas: slide by slide`
  - `Present canvas: zoom through the canvas`
  - `Present canvas (default mode from settings)`

### ⌨️ Keyboard shortcuts

| Key | Action |
|---|---|
| `→` `↓` `PageDown` `Space` `Enter` | Next slide ➡️ (on the last slide, ends the presentation) |
| `←` `↑` `PageUp` `Backspace` | Previous slide ⬅️ |
| `Home` / `End` | First / last slide ⏮️⏭️ |
| `M` | Switch between slide and zoom mode 🔄 |
| `O` | Cycle the slide order (arrows → groups → position) 🔀 |
| `Esc` | Exit the presentation 👋 |

🔗 Clicking an internal link (`[[note]]`) or a note card's title pauses the presentation and opens that note in a new tab. Click **▶ Back to presentation** (or present the same canvas again) to pick up on the same slide, or **✕** to end it.

---

## ⚙️ Settings

- 🧭 **Slide order**: the default ordering (Arrows, Groups or Position)
- 🎬 **Default mode**: the mode used by the title bar icon, the ribbon icon and the default command

---

## 📦 Installation

Canvas Slides isn't on the Obsidian community plugin store yet, so install it by hand:

1. 📁 Create the folder `<vault>/.obsidian/plugins/canvas-slides/`
2. 📋 Copy `main.js`, `manifest.json` and `styles.css` into it
3. 🔌 In Obsidian, go to **Settings → Community plugins** and enable **Canvas Slides**

---

<div align="center">

Made with 💜 by **Alicia Marianne**

*Happy presenting!* 🌷

</div>
