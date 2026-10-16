const { Plugin, PluginSettingTab, Setting, MarkdownRenderer, Component, Notice, TFile } = require("obsidian");

const DEFAULT_SETTINGS = { order: "arrows", mode: "slides" };
const ORDER_LABELS = { arrows: "Arrows", groups: "Groups", position: "Position" };

const CANVAS_COLORS = {
  "1": "#e5484d", "2": "#f08c3a", "3": "#e6c229",
  "4": "#3fb950", "5": "#2fbcc4", "6": "#a371f7",
};
const SVG_NS = "http://www.w3.org/2000/svg";

const byPosition = (a, b) => a.y - b.y || a.x - b.x;

/** Reading order: groups items into rows (half-height tolerance) and sorts each row left to right. */
function readingOrder(items) {
  const sorted = [...items].sort(byPosition);
  const rows = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && it.y <= row.top + row.h * 0.5) { row.items.push(it); row.h = Math.min(row.h, it.height); }
    else rows.push({ top: it.y, h: it.height, items: [it] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x));
}

const single = (n) => ({ id: n.id, box: n, color: n.color, nodes: [n] });

/** Orders nodes by following the arrows (DFS from the roots). */
function orderByArrows(data) {
  const nodes = (data.nodes || []).filter((n) => n.type !== "group");
  const edges = data.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map();
  const hasIncoming = new Set();
  edges.forEach((e) => {
    if (!byId.has(e.fromNode) || !byId.has(e.toNode)) return;
    if (!out.has(e.fromNode)) out.set(e.fromNode, []);
    out.get(e.fromNode).push(e.toNode);
    hasIncoming.add(e.toNode);
  });
  out.forEach((ids) => ids.sort((a, b) => byPosition(byId.get(a), byId.get(b))));

  const roots = nodes.filter((n) => !hasIncoming.has(n.id) && out.has(n.id)).sort(byPosition);
  const seen = new Set();
  const result = [];
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    result.push(byId.get(id));
    (out.get(id) || []).forEach(visit);
  };
  roots.forEach((r) => visit(r.id));
  readingOrder(nodes.filter((n) => !seen.has(n.id))).forEach((n) => visit(n.id));
  return result.map(single);
}

/** Each group becomes one slide; nodes outside groups become individual slides. */
function orderByGroups(data) {
  const all = data.nodes || [];
  const groups = all.filter((n) => n.type === "group");
  const nodes = all.filter((n) => n.type !== "group");
  const inside = (n, g) => {
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
    return cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height;
  };
  const taken = new Set();
  const units = [];
  // Smaller groups first, so a node in nested groups ends up in the innermost one.
  [...groups].sort((a, b) => a.width * a.height - b.width * b.height).forEach((g) => {
    const members = nodes.filter((n) => !taken.has(n.id) && inside(n, g));
    members.forEach((n) => taken.add(n.id));
    if (members.length) units.push({ id: g.id, box: g, color: g.color, label: g.label, nodes: readingOrder(members) });
  });
  nodes.filter((n) => !taken.has(n.id)).forEach((n) => units.push(single(n)));
  return readingOrder(units.map((u) => Object.assign(u, { x: u.box.x, y: u.box.y, width: u.box.width, height: u.box.height })));
}

function orderByPosition(data) {
  return readingOrder((data.nodes || []).filter((n) => n.type !== "group")).map(single);
}

function buildSteps(data, order) {
  if (order === "groups") return orderByGroups(data);
  if (order === "position") return orderByPosition(data);
  return orderByArrows(data);
}

function nodeColor(c) {
  if (!c) return null;
  return CANVAS_COLORS[c] || c;
}

class Presentation extends Component {
  constructor(app, file, data, mode, order) {
    super();
    this.app = app;
    this.file = file;
    this.data = data;
    this.mode = mode; // "slides" | "zoom"
    this.orderMode = order; // "arrows" | "groups" | "position"
    this.order = buildSteps(data, order);
    this.index = 0;
    this.els = new Map();
  }

  async start() {
    if (!this.order.length) {
      new Notice("This canvas has no nodes to present.");
      return;
    }
    this.load();
    this.root = document.body.createDiv({ cls: "cs-overlay" });
    this.registerDomEvent(window, "keydown", (e) => this.onKey(e), true);
    this.registerDomEvent(window, "resize", () => !this.paused && this.show(false));
    this.registerDomEvent(this.root, "mousemove", () => this.flashHud());
    this.registerDomEvent(this.root, "click", (e) => this.onLinkClick(e), true);
    this.register(() => this.root.remove());

    this.hud = this.root.createDiv({ cls: "cs-hud" });
    this.progress = this.root.createDiv({ cls: "cs-progress" }).createDiv({ cls: "cs-progress-bar" });
    this.root.createDiv({ cls: "cs-nav cs-prev", text: "‹" }).onclick = () => this.go(-1);
    this.root.createDiv({ cls: "cs-nav cs-next", text: "›" }).onclick = () => this.go(1);
    this.root.createDiv({ cls: "cs-close", text: "✕" }).onclick = () => this.unload();

    await this.build();
    this.show(false);
  }

  async build() {
    this.stage = this.root.createDiv({ cls: "cs-stage cs-" + this.mode });
    if (this.mode === "zoom") {
      this.world = this.stage.createDiv({ cls: "cs-world" });
      this.drawGroups();
      this.drawEdges();
      const seen = new Set();
      for (const step of this.order) {
        for (const n of step.nodes) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          const el = this.world.createDiv({ cls: "cs-node" });
          el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px;`;
          this.styleColor(el, n.color);
          await this.renderNode(n, el.createDiv({ cls: "cs-content markdown-rendered" }));
          this.els.set(n.id, el);
        }
      }
    } else {
      for (const step of this.order) {
        const slide = this.stage.createDiv({ cls: "cs-slide" });
        const multi = step.nodes.length > 1 || step.label;
        const wrap = multi ? slide.createDiv({ cls: "cs-multi" }) : slide;
        if (multi && step.label) wrap.createDiv({ cls: "cs-multi-title", text: step.label });
        const cards = multi ? wrap.createDiv({ cls: "cs-cards" }) : wrap;
        for (const n of step.nodes) {
          const card = cards.createDiv({ cls: "cs-card" });
          this.styleColor(card, n.color);
          await this.renderNode(n, card.createDiv({ cls: "cs-content markdown-rendered" }));
        }
        this.els.set(step.id, slide);
      }
    }
  }

  styleColor(el, color) {
    const c = nodeColor(color);
    if (c) el.style.setProperty("--cs-accent", c);
  }

  drawGroups() {
    for (const g of (this.data.nodes || []).filter((n) => n.type === "group")) {
      const el = this.world.createDiv({ cls: "cs-group" });
      el.style.cssText = `left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px;`;
      this.styleColor(el, g.color);
      if (g.label) el.createDiv({ cls: "cs-group-label", text: g.label });
    }
  }

  drawEdges() {
    const nodes = new Map((this.data.nodes || []).map((n) => [n.id, n]));
    const anchor = (n, side) => {
      switch (side) {
        case "top": return [n.x + n.width / 2, n.y];
        case "bottom": return [n.x + n.width / 2, n.y + n.height];
        case "left": return [n.x, n.y + n.height / 2];
        default: return [n.x + n.width, n.y + n.height / 2];
      }
    };
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("cs-edges");
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");
    svg.style.overflow = "visible";
    for (const e of this.data.edges || []) {
      const a = nodes.get(e.fromNode), b = nodes.get(e.toNode);
      if (!a || !b) continue;
      const [x1, y1] = anchor(a, e.fromSide || "right");
      const [x2, y2] = anchor(b, e.toSide || "left");
      const horiz = (s) => s === "left" || s === "right";
      const d1 = 120;
      const c1 = horiz(e.fromSide) ? [x1 + (e.fromSide === "right" ? d1 : -d1), y1] : [x1, y1 + (e.fromSide === "bottom" ? d1 : -d1)];
      const c2 = horiz(e.toSide) ? [x2 + (e.toSide === "right" ? d1 : -d1), y2] : [x2, y2 + (e.toSide === "bottom" ? d1 : -d1)];
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", `M${x1},${y1} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}`);
      p.setAttribute("class", "cs-edge");
      svg.appendChild(p);
    }
    this.world.appendChild(svg);
  }

  async renderNode(n, el) {
    const sourcePath = this.file.path;
    try {
      if (n.type === "text") {
        await MarkdownRenderer.render(this.app, n.text || "", el, sourcePath, this);
      } else if (n.type === "file") {
        const f = this.app.vault.getAbstractFileByPath(n.file);
        if (!(f instanceof TFile)) {
          el.createEl("p", { text: "File not found: " + n.file });
        } else if (f.extension === "md") {
          let text = await this.app.vault.cachedRead(f);
          if (n.subpath) text = this.extractSubpath(text, n.subpath);
          el.dataset.csSource = f.path;
          const title = el.createEl("h1", { cls: "cs-file-title" });
          title.createEl("a", { text: f.basename, cls: "internal-link", attr: { "data-href": f.path + (n.subpath || "") } });
          await MarkdownRenderer.render(this.app, text, el, f.path, this);
        } else if (/^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.extension)) {
          el.addClass("cs-media");
          el.createEl("img", { attr: { src: this.app.vault.getResourcePath(f) } });
        } else if (f.extension === "pdf") {
          el.addClass("cs-media");
          el.createEl("embed", { attr: { src: this.app.vault.getResourcePath(f), type: "application/pdf" } });
        } else {
          el.createEl("p", { text: f.name });
        }
      } else if (n.type === "link") {
        el.createEl("a", { text: n.url, href: n.url });
      }
    } catch (err) {
      console.error("canvas-slides:", err);
      el.createEl("p", { text: "Error rendering this node." });
    }
  }

  extractSubpath(text, subpath) {
    const heading = subpath.replace(/^#/, "").trim();
    const lines = text.split("\n");
    const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#{1,6}\s+/, "").trim() === heading);
    if (start < 0) return text;
    const level = lines[start].match(/^#+/)[0].length;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s/);
      if (m && m[1].length <= level) { end = i; break; }
    }
    return lines.slice(start, end).join("\n");
  }

  onKey(e) {
    if (this.paused) return;
    const k = e.key;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " " || k === "Enter") { handled(); this.go(1); }
    else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") { handled(); this.go(-1); }
    else if (k === "Home") { handled(); this.index = 0; this.show(); }
    else if (k === "End") { handled(); this.index = this.order.length - 1; this.show(); }
    else if (k === "Escape") { handled(); this.unload(); }
    else if (k === "m" || k === "M") { handled(); this.switchMode(); }
    else if (k === "o" || k === "O") { handled(); this.cycleOrder(); }
  }

  async switchMode() {
    this.mode = this.mode === "zoom" ? "slides" : "zoom";
    this.stage.remove();
    this.els.clear();
    await this.build();
    this.show(false);
  }

  async cycleOrder() {
    const keys = Object.keys(ORDER_LABELS);
    this.orderMode = keys[(keys.indexOf(this.orderMode) + 1) % keys.length];
    this.order = buildSteps(this.data, this.orderMode);
    this.index = 0;
    this.stage.remove();
    this.els.clear();
    await this.build();
    this.show(false);
  }

  /** Clicking an internal link pauses the presentation and opens the note in a new tab. */
  onLinkClick(e) {
    const a = e.target.closest("a.internal-link");
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute("data-href") || a.getAttribute("href");
    if (!href) return;
    const holder = a.closest("[data-cs-source]");
    const source = holder ? holder.dataset.csSource : this.file.path;
    this.pause();
    this.app.workspace.openLinkText(href, source, "tab");
  }

  /** Hides the presentation and shows a floating button to come back to the same slide. */
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.root.hidden = true;
    this.resumeBar = document.body.createDiv({ cls: "cs-resume" });
    const back = this.resumeBar.createEl("button", { cls: "cs-resume-back", text: `▶ Back to presentation (${this.index + 1} / ${this.order.length})` });
    back.onclick = () => this.resume();
    const close = this.resumeBar.createEl("button", { cls: "cs-resume-close", text: "✕", attr: { "aria-label": "End presentation" } });
    close.onclick = () => this.unload();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.resumeBar.remove();
    this.resumeBar = null;
    this.root.hidden = false;
    this.show(false);
  }

  go(delta) {
    // Moving forward past the last element ends the presentation.
    if (delta > 0 && this.index === this.order.length - 1) { this.unload(); return; }
    const next = Math.max(0, Math.min(this.order.length - 1, this.index + delta));
    if (next === this.index) return;
    this.index = next;
    this.show();
  }

  show(animate = true) {
    const step = this.order[this.index];
    const box = step.box;
    this.hud.setText(`${this.index + 1} / ${this.order.length}   ·   Order: ${ORDER_LABELS[this.orderMode]} (O)   ·   Mode (M)   ·   Esc: exit`);
    this.progress.style.width = ((this.index + 1) / this.order.length) * 100 + "%";
    this.flashHud();

    if (this.mode === "zoom") {
      const active = new Set(step.nodes.map((n) => n.id));
      this.els.forEach((el, id) => el.toggleClass("cs-active", active.has(id)));
      const vw = this.root.clientWidth, vh = this.root.clientHeight;
      const scale = Math.min((vw * 0.88) / box.width, (vh * 0.86) / box.height);
      const tx = vw / 2 - (box.x + box.width / 2) * scale;
      const ty = vh / 2 - (box.y + box.height / 2) * scale;
      // will-change only while moving, so the browser re-renders the text sharply at the final scale.
      const world = this.world;
      world.toggleClass("cs-moving", animate);
      world.style.transition = animate ? "transform 0.8s cubic-bezier(.45,.05,.25,1)" : "none";
      world.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      if (animate) world.addEventListener("transitionend", () => world.removeClass("cs-moving"), { once: true });
    } else {
      this.els.forEach((el, id) => el.toggleClass("cs-active", id === step.id));
    }
  }

  /** Shows the HUD briefly, then fades it out so it doesn't cover the slide. */
  flashHud() {
    this.hud.removeClass("cs-hidden");
    window.clearTimeout(this.hudTimer);
    this.hudTimer = window.setTimeout(() => this.hud.addClass("cs-hidden"), 2500);
  }

  onunload() {
    window.clearTimeout(this.hudTimer);
    this.resumeBar && this.resumeBar.remove();
    this.plugin && (this.plugin.current = null);
  }
}

const PRESENT_ICON = "presentation";

module.exports = class CanvasSlidesPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new CanvasSlidesSettingTab(this.app, this));
    this.actionViews = new WeakSet();

    this.addCommand({
      id: "present-slides",
      name: "Present canvas: slide by slide",
      checkCallback: (checking) => this.run("slides", checking),
    });
    this.addCommand({
      id: "present-zoom",
      name: "Present canvas: zoom through the canvas",
      checkCallback: (checking) => this.run("zoom", checking),
    });
    this.addCommand({
      id: "present",
      name: "Present canvas (default mode from settings)",
      checkCallback: (checking) => this.run(this.settings.mode, checking),
    });
    this.addRibbonIcon(PRESENT_ICON, "Present canvas", () => {
      const file = this.app.workspace.getActiveFile();
      if (file && file.extension === "canvas") this.present(file, this.settings.mode);
      else new Notice("Open a canvas to present it.");
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "canvas") {
          menu.addItem((i) => i.setTitle("Present as slides").setIcon(PRESENT_ICON).onClick(() => this.present(file, "slides")));
          menu.addItem((i) => i.setTitle("Present with zoom").setIcon(PRESENT_ICON).onClick(() => this.present(file, "zoom")));
        }
      })
    );

    // Icon in the title bar of each canvas tab.
    const addActions = () => this.app.workspace.getLeavesOfType("canvas").forEach((leaf) => this.addViewAction(leaf.view));
    this.registerEvent(this.app.workspace.on("layout-change", addActions));
    this.registerEvent(this.app.workspace.on("active-leaf-change", addActions));
    this.app.workspace.onLayoutReady(addActions);
  }

  addViewAction(view) {
    if (!view || this.actionViews.has(view) || typeof view.addAction !== "function") return;
    this.actionViews.add(view);
    view.addAction(PRESENT_ICON, "Present canvas", () => {
      if (view.file) this.present(view.file, this.settings.mode);
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    this.current && this.current.unload();
  }

  run(mode, checking) {
    const file = this.app.workspace.getActiveFile();
    const ok = file && file.extension === "canvas";
    if (!checking && ok) this.present(file, mode);
    return !!ok;
  }

  async present(file, mode) {
    // Presenting the same canvas while paused picks up where it left off.
    if (this.current && this.current.paused && this.current.file.path === file.path) return this.current.resume();
    if (this.current) this.current.unload();
    let data;
    try {
      data = JSON.parse(await this.app.vault.read(file));
    } catch (e) {
      new Notice("Could not read this canvas.");
      return;
    }
    const p = new Presentation(this.app, file, data, mode, this.settings.order);
    p.plugin = this;
    this.current = p;
    await p.start();
  }
};

class CanvasSlidesSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Slide order")
      .setDesc("Arrows: follows the canvas connections. Groups: each group becomes a slide. Position: reading order (top→bottom, left→right). During the presentation, press O to cycle.")
      .addDropdown((d) =>
        d.addOptions(ORDER_LABELS).setValue(this.plugin.settings.order).onChange(async (v) => {
          this.plugin.settings.order = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Default mode")
      .setDesc("Used by the canvas icon and the default command. During the presentation, press M to toggle.")
      .addDropdown((d) =>
        d.addOptions({ slides: "Slide by slide", zoom: "Zoom through the canvas" }).setValue(this.plugin.settings.mode).onChange(async (v) => {
          this.plugin.settings.mode = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
