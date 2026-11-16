import {
  api,
  app,
  bus,
  h,
  icon,
  iconButton,
  Meta,
  openModal,
  promptText,
  toast,
  reportError,
  fileUrl,
  downloadFile,
} from "../core.js";
import { store } from "../store.js";
import { uploadFile } from "../editing.js";
import { loadConnections } from "./settings.js";
import {
  loadCanvas,
  storeCanvas,
  maskedComposite,
  apiMask,
  transform,
} from "./images.js";
import { editMask } from "./mask.js";
const Board = window.OpaleBoard,
  Graph = window.OpalDesignGraph;
const LABELS = {
  image: "Image",
  text: "Texte",
  mask: "Sélection",
  overlay: "Calque",
  reference: "Référence",
  extra: "Texte complémentaire",
};
const PARAMS = {
  resize: [
    ["width", "Largeur · px", 1024],
    ["height", "Hauteur · px", 1024],
  ],
  crop: [
    ["x", "Gauche · px", 0],
    ["y", "Haut · px", 0],
    ["width", "Largeur · px", 512],
    ["height", "Hauteur · px", 512],
  ],
  rotate: [["angle", "Angle · degrés", 90]],
  color: [
    ["brightness", "Luminosité · %", 100],
    ["contrast", "Contraste · %", 100],
    ["saturation", "Saturation · %", 100],
    ["hue", "Teinte · degrés", 0],
  ],
  blur: [["radius", "Rayon · px", 6]],
  growMask: [["radius", "Extension · px (négatif : réduction)", 3]],
  composite: [
    ["x", "Position X", 0],
    ["y", "Position Y", 0],
    ["width", "Largeur · px", 1024],
    ["height", "Hauteur · px", 1024],
    ["opacity", "Opacité · %", 100],
  ],
};
export class DesignController {
  constructor(view) {
    this.view = view;
    this.states = new Map();
    this.catalog = null;
    this.selected = "";
    this.pending = null;
    this.requests = new Map();
    this.category = "Tous";
    this.build();
    this.applyMode = (active) => {
      if (active === view) {
        document.body.classList.add("design-mode");
      } else if (!active?.design) {
        document.body.classList.remove("design-mode", "design-files");
      }
    };
    this.offs = [
      bus.on("active-view", (active) => this.applyMode(active)),
      bus.on("design-connections", (info) => {
        this.catalog = info;
        this.view.redrawAll();
      }),
      bus.on("design-progress", (event) => {
        const state = [...this.states.values()].find(
          (s) => s.runId === event.runId,
        );
        if (state) {
          state.partial = (state.partial || "") + event.delta;
          this.status.textContent = `Réponse en cours · ${state.partial.length} caractères`;
          const id = [...this.states].find(([id, s]) => s === state)?.[0];
          const content = this.view.nodes.get(id)?.querySelector(".dn-content");
          if (content) {
            let stream = content.querySelector(".dn-stream");
            if (!stream) {
              stream = h("div.dn-text-result.dn-stream");
              content.append(stream);
            }
            stream.textContent = state.partial;
          }
        }
      }),
    ];
    loadConnections()
      .then((info) => {
        if (!this.destroyed) {
          this.catalog = info;
          view.redrawAll();
        }
      })
      .catch(reportError);
    this.renderLibrary();
    this.inspect();
    if (app.workspace.activeView === view)
      document.body.classList.add("design-mode");
  }
  build() {
    const v = this.view;
    v.el.classList.add("is-design");
    v.stage.dataset.grid = "dots";
    this.search = h("input.text-input", {
      type: "search",
      placeholder: "Rechercher un outil…",
      "aria-label": "Rechercher un outil Opal Design",
      onInput: () => this.renderLibrary(),
    });
    this.library = h("div.design-library-results");
    const categories = h("div.design-categories");
    for (const label of [
      "Tous",
      "IA",
      "Images",
      "Sélection",
      "Texte",
      "Sorties",
    ])
      categories.append(
        h(
          "button.design-category",
          {
            type: "button",
            "aria-pressed": String(label === "Tous"),
            onClick: (event) => {
              this.category = label;
              for (const b of categories.children)
                b.setAttribute(
                  "aria-pressed",
                  String(b === event.currentTarget),
                );
              this.renderLibrary();
            },
          },
          label,
        ),
      );
    this.left = h(
      "aside.design-library",
      { "aria-label": "Bibliothèque Opal Design" },
      h(
        "div.design-library-head",
        h("span.design-brand-icon", { html: icon("design", 23) }),
        h(
          "div",
          h("strong", "Opal Design"),
          h("span", "Votre atelier à nœuds"),
        ),
      ),
      this.search,
      categories,
      this.library,
      h(
        "div.design-library-bottom",
        h("button.btn", {
          type: "button",
          onClick: () => app.settings_ui.open("design"),
          html: icon("settings", 15) + " Connexions IA",
        }),
      ),
    );
    this.inspector = h("aside.design-inspector", {
      "aria-label": "Réglages du nœud",
    });
    this.status = h(
      "span.design-workflow-status",
      { role: "status" },
      "Reliez vos idées",
    );
    this.auto = h("input", {
      type: "checkbox",
      "aria-label": "Aperçu automatique des nœuds modifiés",
      onChange: () => {
        this.automatic = this.auto.checked;
        if (this.automatic) this.schedule();
      },
    });
    this.runButton = h(
      "button.btn.primary",
      { type: "button", disabled: v.readOnly, onClick: () => this.run() },
      h("span", { html: icon("play", 15) }),
      "Exécuter",
    );
    this.top = h(
      "div.board-ui.design-topbar",
      h("div.design-topbar-label", h("span.design-live-dot"), "Atelier"),
      this.status,
      h(
        "button.btn",
        {
          type: "button",
          onClick: () => {
            document.body.classList.remove("design-files");
            this.left.hidden = false;
          },
        },
        "Outils",
      ),
      h(
        "button.btn",
        {
          type: "button",
          onClick: () => {
            document.body.classList.add("design-files");
            app.layout.show("left", "files");
          },
        },
        "Dossiers",
      ),
      h(
        "button.btn",
        { type: "button", onClick: () => this.templateMenu() },
        "Modèles de workflow",
      ),
      h("label.design-auto", this.auto, "Auto"),
      iconButton(
        "sidebar-right",
        "Afficher ou masquer les réglages Design",
        () => {
          this.inspector.hidden = !this.inspector.hidden;
        },
      ),
      this.runButton,
      iconButton("x", "Arrêter les traitements", () => this.stop()),
    );
    this.tools = h(
      "div.board-ui.design-bottom-tools",
      iconButton("board-select", "Sélectionner", () =>
        v.input.setTool("select"),
      ),
      iconButton("board-hand", "Déplacer le canevas", () =>
        v.input.setTool("hand"),
      ),
      iconButton("board-sticky", "Ajouter une note libre", () =>
        v.input.setTool("sticky"),
      ),
      iconButton("image", "Importer une image dans Opal Design", () =>
        this.chooseImage(),
      ),
      iconButton("collapse", "Cadrer le workflow", () => v.zoomToFit()),
      iconButton("camera", "Capture et export", () => v.ui.exportVisual("png")),
    );
    for (const [index, tool] of ["select", "hand", "sticky"].entries())
      this.tools.children[index].dataset.tool = tool;
    this.updateTools();
    v.stage.append(this.left, this.inspector, this.top, this.tools);
    const select = v.select.bind(v);
    v.select = (ids, additive) => {
      select(ids, additive);
      const chosen = v.selected.find((n) => n.kind === "design");
      if (chosen?.id !== this.selected) this.inspect(chosen?.id);
    };
    const change = v.change.bind(v);
    v.change = (...args) => {
      const result = change(...args);
      this.renderLibraryCount();
      if (this.automatic && !this.busy) this.schedule();
      return result;
    };
    v.zoomToFit = (animate = true) => this.fit(animate);
    const drop = v.ui.dropFiles.bind(v.ui);
    v.ui.dropFiles = async (files, at) => {
      const images = [...files].filter(
          (f) =>
            /^image\//.test(f.type) ||
            /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name),
        ),
        other = [...files].filter((f) => !images.includes(f));
      await Promise.all(
        images.map(async (file, i) => {
          const node = this.add("image", { x: at.x + i * 380, y: at.y });
          await this.attach(node, file);
        }),
      );
      if (other.length) await drop(other, at);
    };
  }
  updateTools() {
    for (const button of this.tools.querySelectorAll("[data-tool]")) {
      const active = button.dataset.tool === this.view.input.tool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
  schedule() {
    clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      if (!this.destroyed && this.automatic && !this.busy) this.run();
    }, 800);
  }
  fit(animate = true) {
    const v = this.view,
      box = Board.union(
        v.doc.elements
          .filter((e) => v.layer(e.layer)?.visible !== false)
          .map((e) => Board.bounds(e, v.lookup)),
      ),
      r = v.stageRect();
    if (!box) return v.setCamera(r.width / 2, r.height / 2, 1);
    const left = this.left.hidden ? 0 : this.left.offsetWidth,
      right = this.inspector.hidden ? 0 : this.inspector.offsetWidth,
      w = Math.max(100, r.width - left - right - 70),
      height = Math.max(100, r.height - 180),
      k = Math.max(
        0.05,
        Math.min(1, w / Math.max(1, box.w), height / Math.max(1, box.h)),
      ),
      camera = {
        x: left + 35 + w / 2 - (box.x + box.w / 2) * k,
        y: 90 + height / 2 - (box.y + box.h / 2) * k,
        k,
      };
    if (animate) v.animateCamera(camera, 260);
    else v.setCamera(camera.x, camera.y, camera.k);
  }
  startPortDrag(event, id) {
    if (event.button !== 0 || this.view.readOnly) return;
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    const rect = this.view.stageRect(),
      dot = event.currentTarget.getBoundingClientRect(),
      path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "var(--accent)");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-dasharray", "5 4");
    this.view.ui.effects.append(path);
    const move = (e) => {
      moved ||= Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4;
      const x = dot.left + dot.width / 2 - rect.left,
        y = dot.top + dot.height / 2 - rect.top,
        b = e.clientX - rect.left,
        c = e.clientY - rect.top;
      path.setAttribute(
        "d",
        `M${x},${y} C${x + 80},${y} ${b - 80},${c} ${b},${c}`,
      );
    };
    const stop = (e) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
      path.remove();
      this.portCleanup = null;
      if (!moved) return;
      this.skipPortClick = true;
      setTimeout(() => (this.skipPortClick = false), 0);
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest(".dn-port[data-port]");
      if (target) {
        try {
          this.connect(id, target.dataset.node, target.dataset.port);
        } catch (error) {
          toast(error.message, { kind: "error" });
        }
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
    this.portCleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
      path.remove();
    };
  }
  renderLibraryCount() {
    if (!this.destroyed)
      this.status.textContent = this.busy
        ? "Exécution en cours…"
        : `${Graph.nodes(this.view.doc).length} nœuds · ${Graph.links(this.view.doc).length} liaisons`;
  }
  renderLibrary() {
    const query = this.search.value.toLowerCase();
    const allowed = (spec) =>
      this.category === "Tous" ||
      (this.category === "IA" && spec.ai) ||
      (this.category === "Images" &&
        ["Entrées", "Transformations", "Composition"].includes(
          spec.category,
        )) ||
      (this.category === "Sélection" &&
        spec.category === "Sélection et protection") ||
      (this.category === "Texte" &&
        ["Texte", "Entrées"].includes(spec.category)) ||
      (this.category === "Sorties" && spec.category === "Sorties");
    const groups = new Map();
    for (const [id, spec] of Object.entries(Graph.TOOLS)) {
      if (
        !allowed(spec) ||
        !`${spec.label} ${spec.category}`.toLowerCase().includes(query)
      )
        continue;
      if (!groups.has(spec.category)) groups.set(spec.category, []);
      groups.get(spec.category).push([id, spec]);
    }
    this.library.replaceChildren(
      ...[...groups].map(([category, tools]) =>
        h(
          "section.design-tool-section",
          h("h3", category),
          h(
            "div.design-tool-grid",
            ...tools.map(([id, spec]) =>
              h(
                "button.design-tool-card",
                {
                  type: "button",
                  disabled: this.view.readOnly,
                  onClick: () => this.add(id),
                },
                h("span", { html: icon(spec.icon, 20) }),
                h("span", spec.label),
              ),
            ),
          ),
        ),
      ),
    );
    if (!groups.size)
      this.library.append(h("p.setting-note", "Aucun outil correspondant."));
  }
  add(tool, at) {
    if (this.view.readOnly) return;
    const spec = Graph.TOOLS[tool];
    if (!spec) return;
    const center = at || this.view.viewCenter();
    const mode = tool === "text" ? "text" : "image";
    const provider =
      this.catalog?.providers.find(
        (p) => p.configured && p.models.some((m) => m.modes.includes(mode)),
      ) ||
      this.catalog?.providers.find((p) =>
        p.models.some((m) => m.modes.includes(mode)),
      );
    const heights = {
      prompt: 280,
      note: 300,
      image: 390,
      mask: 420,
      text: 430,
      generate: 530,
      edit: 530,
      segment: 530,
      compare: 480,
    };
    const node = Board.create("design", {
      x: at ? center.x : center.x - 180,
      y: at ? center.y : center.y - 180,
      w: 360,
      h: heights[tool] || 370,
      data: {
        tool,
        provider: spec.ai ? provider?.id || "" : "",
        model: spec.ai
          ? provider?.models.find((m) => m.modes.includes(mode))?.id || ""
          : "",
        params: Object.fromEntries(
          (PARAMS[tool] || []).map(([key, label, value]) => [key, value]),
        ),
      },
    });
    this.view.change(() => this.view.add(node));
    this.view.select([node.id]);
    this.inspect(node.id);
    return node;
  }
  addSticky() {
    const p = this.view.viewCenter();
    const node = this.view.change(() =>
      this.view.add(Board.create("sticky", { x: p.x - 100, y: p.y - 100 })),
    );
    this.view.select([node.id]);
    this.view.editField(node, "text");
  }
  async attach(node, file) {
    if (!node || this.view.readOnly) return;
    try {
      const path = await uploadFile(file, this.view.path);
      await app.workspace.waitFor(path);
      const current = this.view.byId.get(node.id);
      if (current)
        this.view.mutate(current, (d) => {
          d.file = path;
          d.resultFile = path;
          d.resultType = "image";
          d.fingerprint = "";
        });
    } catch (error) {
      reportError(error);
    }
  }
  chooseImage(id) {
    const picker = h("input", {
      type: "file",
      accept: "image/*",
      multiple: !id,
    });
    picker.onchange = async () => {
      let index = 0;
      for (const file of picker.files) {
        const point = this.view.viewCenter();
        const node = id
          ? this.view.byId.get(id)
          : this.add("image", {
              x: point.x + index * 380 - 180,
              y: point.y - 180,
            });
        await this.attach(node, file);
        index++;
      }
    };
    picker.click();
  }
  port(id, port) {
    if (this.skipPortClick || this.view.readOnly) return;
    if (!port) {
      this.pending = id;
      this.status.textContent = "Choisissez une entrée sur le nœud suivant.";
      this.view.el.classList.add("is-connecting");
      return;
    }
    if (!this.pending) {
      this.status.textContent = "Cliquez d’abord sur la sortie d’un nœud.";
      return;
    }
    try {
      this.connect(this.pending, id, port);
      this.pending = null;
      this.view.el.classList.remove("is-connecting");
      this.renderLibraryCount();
    } catch (error) {
      toast(error.message, { kind: "error" });
    }
  }
  connect(from, to, port) {
    Graph.validateLink(this.view.doc, from, to, port);
    const node = this.view.byId.get(to),
      spec = Graph.TOOLS[node.data.tool];
    const index = Object.keys(spec.inputs).indexOf(port);
    const existing = Graph.links(this.view.doc).filter(
      (e) => e.to === to && e.port === port,
    );
    this.view.change(() => {
      if (existing.length) this.view.remove(existing.map((e) => e.id));
      this.view.add(
        Board.create("connector", {
          from: { id: from, side: "right", portY: 62 },
          to: { id: to, side: "left", portY: 62 + index * 28 },
          style: {
            color:
              spec.inputs[port] === "mask"
                ? "#a78bfa"
                : spec.inputs[port] === "image"
                  ? "#34d399"
                  : "#fbbf24",
            width: 2,
            path: "curve",
            end: "none",
          },
          data: { relation: `design:${port}` },
        }),
      );
    });
    this.inspect(to);
  }
  inspect(id) {
    this.selected = id || "";
    const node = id && this.view.byId.get(id);
    this.inspector.replaceChildren();
    if (!node || node.kind !== "design") {
      this.inspector.append(
        h("div.design-inspector-head", h("h3", "Votre atelier")),
        h(
          "p.design-inspector-note",
          "Ajoutez un outil, puis reliez sa sortie à une entrée compatible. Les notes libres restent disponibles sur le canevas.",
        ),
        h(
          "button.btn",
          {
            type: "button",
            disabled: this.view.readOnly,
            onClick: () => this.makeTemplate(),
          },
          "Image → sélection → retouche",
        ),
        h(
          "button.btn",
          { type: "button", onClick: () => app.settings_ui.open("design") },
          "Configurer les modèles IA",
        ),
      );
      this.renderLibraryCount();
      return;
    }
    const spec = Graph.TOOLS[node.data.tool];
    this.inspector.append(
      h(
        "div.design-inspector-head",
        h("span", { html: icon(spec.icon, 18) }),
        h("h3", spec.label),
      ),
    );
    const title = h("input.text-input", {
      value: node.data.title || "",
      placeholder: spec.label,
      "aria-label": "Nom du nœud",
      disabled: this.view.readOnly,
      onChange: () =>
        this.view.mutate(
          this.view.byId.get(id),
          (d) => (d.title = title.value),
        ),
    });
    this.inspector.append(
      h("label.design-field", h("span", "Nom du nœud"), title),
    );
    for (const [key, label, initial] of PARAMS[node.data.tool] || []) {
      const input = h("input.text-input", {
        type: "number",
        value: node.data.params?.[key] ?? initial,
        "aria-label": label,
        disabled: this.view.readOnly,
        onChange: () => {
          this.view.mutate(this.view.byId.get(id), (d) => {
            d.params = { ...d.params, [key]: Number(input.value) };
            d.fingerprint = "";
          });
        },
      });
      this.inspector.append(h("label.design-field", h("span", label), input));
    }
    if (node.data.tool === "rotate") {
      const input = h("input", {
        type: "checkbox",
        checked: !!node.data.params?.flip,
        disabled: this.view.readOnly,
        onChange: () =>
          this.view.mutate(
            this.view.byId.get(id),
            (d) => (d.params = { ...d.params, flip: input.checked }),
          ),
      });
      this.inspector.append(
        h("label.design-field.inline", input, "Miroir horizontal"),
      );
    }
    if (node.data.tool === "edit")
      this.inspector.append(
        h(
          "div.design-protection",
          h("span", { html: icon("lock", 17) }),
          h(
            "div",
            h("strong", "Extérieur protégé"),
            h(
              "p",
              "Seuls les pixels autorisés par le masque sont repris du résultat IA.",
            ),
          ),
        ),
      );
    const incoming = Graph.links(this.view.doc).filter((e) => e.to === id);
    this.inspector.append(h("h4", "Entrées"));
    for (const [port, type] of Object.entries(spec.inputs)) {
      const edge = incoming.find((e) => e.port === port),
        source = edge && this.view.byId.get(edge.from);
      const row = h(
        "div.design-input-row",
        h(
          "div",
          h("strong", LABELS[port] || port),
          h(
            "small",
            source
              ? source.data.title || Graph.TOOLS[source.data.tool]?.label
              : "Non reliée",
          ),
        ),
      );
      if (edge && !this.view.readOnly)
        row.append(
          iconButton("x", "Retirer cette liaison", () => {
            this.view.change(() => this.view.remove([edge.id]));
            this.inspect(id);
          }),
        );
      this.inspector.append(row);
    }
    if (["mask", "segment"].includes(node.data.tool))
      this.inspector.append(
        h(
          "button.btn.primary",
          {
            type: "button",
            disabled: this.view.readOnly,
            onClick: () => this.mask(id),
          },
          "Peindre la sélection",
        ),
      );
    if (node.data.tool === "image")
      this.inspector.append(
        h(
          "button.btn",
          {
            type: "button",
            disabled: this.view.readOnly,
            onClick: () => this.chooseImage(id),
          },
          "Remplacer l’image",
        ),
      );
    if (node.data.tool === "note")
      this.inspector.append(
        h(
          "button.btn",
          {
            type: "button",
            disabled: this.view.readOnly,
            onClick: () =>
              this.view.ui.pickFiles(["note"], (path) => {
                this.view.mutate(this.view.byId.get(id), (d) => {
                  d.file = path;
                  d.fingerprint = "";
                });
                this.run(id);
              }),
          },
          "Choisir une note du coffre",
        ),
      );
    const actions = h(
      "div.design-inspector-actions",
      h(
        "button.btn",
        {
          type: "button",
          disabled: this.view.readOnly,
          onClick: () => this.run(id),
        },
        "Exécuter cette branche",
      ),
      h(
        "button.btn",
        {
          type: "button",
          disabled: this.view.readOnly,
          onClick: () => this.duplicate(id),
        },
        "Créer une variante",
      ),
      h(
        "button.btn",
        {
          type: "button",
          disabled: this.view.readOnly,
          onClick: () => this.saveTemplate(),
        },
        "Enregistrer comme outil",
      ),
    );
    if (node.data.resultFile)
      actions.append(
        h(
          "button.btn",
          { type: "button", onClick: () => downloadFile(node.data.resultFile) },
          "Télécharger le résultat",
        ),
      );
    this.inspector.append(actions);
    if (node.data.versions?.length) {
      this.inspector.append(h("h4", "Versions conservées"));
      [...node.data.versions].reverse().forEach((version, index) =>
        this.inspector.append(
          h(
            "button.design-version",
            {
              type: "button",
              disabled: this.view.readOnly,
              onClick: () =>
                this.restore(id, node.data.versions.length - 1 - index),
            },
            `Version ${node.data.versions.length - index} · ${new Date(version.at).toLocaleString("fr-FR")}`,
          ),
        ),
      );
    }
    this.renderLibraryCount();
  }
  duplicate(id) {
    const node = this.view.byId.get(id);
    if (!node) return;
    const copy = Board.create("design", {
      ...Board.clone(node),
      id: Board.newId(),
      x: node.x + node.w + 90,
      data: { ...Board.clone(node.data), versions: [], fingerprint: "" },
    });
    this.view.change(() => this.view.add(copy));
    for (const edge of Graph.links(this.view.doc).filter((e) => e.to === id))
      this.connect(edge.from, copy.id, edge.port);
    this.view.select([copy.id]);
    return copy;
  }
  async mask(id) {
    try {
      const node = this.view.byId.get(id),
        inputs = Graph.inputs(this.view.doc, id),
        source = inputs.image?.data.resultFile || inputs.image?.data.file;
      await editMask(this.view, node, source);
    } catch (error) {
      reportError(error);
    }
  }
  restore(id, index) {
    const node = this.view.byId.get(id),
      version = node?.data.versions?.[index];
    if (!version) return;
    this.view.mutate(node, (d) => {
      d.resultFile = version.file || "";
      d.resultText = version.text || "";
      d.resultType = version.type || "";
      d.fingerprint = "";
    });
    this.inspect(id);
  }
  setState(id, state) {
    this.states.set(id, { ...this.states.get(id), ...state });
    const node = this.view.byId.get(id);
    if (node) this.view.redraw(node);
  }
  fingerprint(node, inputs) {
    const refs = [
      node.data.file,
      ...Object.values(inputs).flatMap((n) => [
        n?.data.file,
        n?.data.resultFile,
      ]),
    ];
    return (
      Graph.fingerprint(node, inputs) +
      JSON.stringify(refs.map((path) => store.files.get(path)?.mtime || 0))
    );
  }
  result(id, value, fingerprint) {
    const node = this.view.byId.get(id);
    if (!node) return;
    this.view.mutate(node, (d) => {
      if (
        (d.resultFile || d.resultText) &&
        (d.resultFile !== (value.file || "") ||
          d.resultText !== (value.text || ""))
      )
        d.versions = [
          ...(d.versions || []),
          {
            file: d.resultFile,
            text: d.resultText,
            type: d.resultType,
            at: Date.now(),
            provider: d.provider,
            model: d.model,
            prompt: d.text,
            params: Board.clone(d.params),
          },
        ].slice(-20);
      d.resultFile = value.file || "";
      d.resultText = value.text || "";
      d.resultType = value.type || (value.file ? "image" : "text");
      if (value.type === "mask" && d.tool === "segment") {
        d.maskFile = value.file;
        const input = Graph.inputs(this.view.doc, id).image;
        d.maskSource = input?.data.resultFile || input?.data.file || "";
      }
      d.fingerprint = fingerprint;
    });
  }
  async execute(node, signal) {
    const data = node.data,
      spec = Graph.TOOLS[data.tool],
      inputs = Graph.inputs(this.view.doc, node.id);
    for (const port of spec.required || [])
      if (!inputs[port])
        throw Error(`Reliez l’entrée ${LABELS[port] || port}.`);
    const files = Object.fromEntries(
      Object.entries(inputs).map(([port, n]) => [
        port,
        n?.data.resultFile || n?.data.file,
      ]),
    );
    let text = [inputs.text?.data.resultText, data.text]
      .filter(Boolean)
      .join("\n\n");
    if (data.tool === "segment" && !text.trim())
      throw Error("Décrivez l’objet ou la zone à sélectionner.");
    if (data.tool === "segment")
      text = `Create a precise binary selection mask for the supplied image. Select only: ${text}. Output the mask alone, white for the selected object and black everywhere else. Preserve the exact composition and aspect ratio. No text, no decoration.`;
    if (data.tool === "prompt") return { text: data.text || "" };
    if (data.tool === "note")
      return {
        text: data.file ? await store.text(data.file) : data.text || "",
      };
    if (data.tool === "image") {
      if (!data.file) throw Error("Choisissez une image source.");
      return { file: data.file, type: "image" };
    }
    if (data.tool === "mask") {
      if (!data.maskFile)
        throw Error(
          "Peignez la zone à modifier avant de lancer cette branche.",
        );
      if (data.maskSource && data.maskSource !== files.image)
        throw Error(
          "L’image source a changé : vérifiez et repeignez la sélection.",
        );
      return { file: data.maskFile, type: "mask" };
    }
    if (data.tool === "concat")
      return {
        text: [text, inputs.extra?.data.resultText]
          .filter(Boolean)
          .join("\n\n"),
      };
    if (["preview", "output"].includes(data.tool)) {
      if (files.image) return { file: files.image };
      if (text) return { text };
      throw Error("Reliez une image ou un texte à ce nœud.");
    }
    if (data.tool === "compare") return { file: files.image };
    if (spec.ai) {
      const mode = data.tool === "text" ? "text" : "image";
      const provider = data.provider
        ? this.catalog?.providers.find((p) => p.id === data.provider)
        : this.catalog?.providers.find(
            (p) => p.configured && p.models.some((m) => m.modes.includes(mode)),
          ) ||
          this.catalog?.providers.find((p) =>
            p.models.some((m) => m.modes.includes(mode)),
          );
      const model = data.model
        ? provider?.models.find(
            (m) => m.id === data.model && m.modes.includes(mode),
          )
        : provider?.models.find((m) => m.modes.includes(mode));
      if (!provider?.configured)
        throw Error("Connectez le fournisseur dans Paramètres → Opal Design.");
      if (!model) throw Error("Aucun modèle compatible disponible.");
      const runId = crypto.randomUUID();
      this.setState(node.id, { runId });
      const mask =
        data.tool === "edit"
          ? provider.protocol === "gemini" || provider.id === "grok"
            ? files.mask
            : await apiMask(files.mask, this.view.path)
          : undefined;
      const response = await fetch("/api/design/run", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Opale": "1" },
        body: JSON.stringify({
          provider: provider.id,
          model: model.id,
          kind: mode,
          prompt: text,
          images: files.image ? [files.image] : [],
          mask,
          source: this.view.path,
          runId,
          size: data.params?.size,
        }),
        signal,
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(
          answer.error || "Le modèle n’a pas pu terminer cette opération.",
        );
      if (data.tool === "segment" && answer.file) {
        const original = await loadCanvas(files.image),
          generated = await loadCanvas(answer.file);
        const canvas = document.createElement("canvas");
        canvas.width = original.width;
        canvas.height = original.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(generated, 0, 0, canvas.width, canvas.height);
        const p = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < p.data.length; i += 4) {
          const value =
            p.data[i] * 0.2126 +
              p.data[i + 1] * 0.7152 +
              p.data[i + 2] * 0.0722 >=
            128
              ? 255
              : 0;
          p.data[i] = p.data[i + 1] = p.data[i + 2] = value;
          p.data[i + 3] = 255;
        }
        ctx.putImageData(p, 0, 0);
        return {
          file: await storeCanvas(
            canvas,
            this.view.path,
            "Sélection assistée IA.png",
          ),
          type: "mask",
          note: "Vérifiez et ajustez la sélection.",
        };
      }
      if (data.tool === "edit" && answer.file) {
        const [original, generated, selection] = await Promise.all([
          loadCanvas(files.image),
          loadCanvas(answer.file),
          loadCanvas(files.mask),
        ]);
        return {
          file: await storeCanvas(
            maskedComposite(original, generated, selection),
            this.view.path,
            "Retouche protégée Opal Design.png",
          ),
        };
      }
      return answer;
    }
    const canvas = await transform(data.tool, files, data.params);
    return {
      file: await storeCanvas(canvas, this.view.path, `${spec.label}.png`),
      type: spec.output,
    };
  }
  async run(target) {
    if (this.view.readOnly || this.busy) return;
    let plan;
    try {
      if (this.view.editing) this.view.finishEdit(true);
      plan = Graph.plan(this.view.doc, target);
    } catch (error) {
      reportError(error);
      return;
    }
    this.busy = true;
    this.runButton.disabled = true;
    const controller = new AbortController();
    this.activeRun = controller;
    try {
      if (!this.catalog) this.catalog = await loadConnections();
      for (const original of plan) {
        if (controller.signal.aborted)
          throw new DOMException("Arrêté", "AbortError");
        const node = this.view.byId.get(original.id);
        if (!node) continue;
        const inputs = Graph.inputs(this.view.doc, node.id),
          fingerprint = this.fingerprint(node, inputs);
        if (
          node.data.fingerprint === fingerprint &&
          (node.data.resultFile || node.data.resultText) &&
          node.id !== target
        ) {
          this.setState(node.id, {
            status: "idle",
            note: "Résultat réutilisé",
            error: "",
          });
          continue;
        }
        this.setState(node.id, {
          status: "running",
          error: "",
          note: "",
          partial: "",
        });
        this.status.textContent = `${Graph.TOOLS[node.data.tool].label} en cours…`;
        try {
          const value = await this.execute(node, controller.signal);
          if (controller.signal.aborted)
            throw new DOMException("Arrêté", "AbortError");
          const current = this.view.byId.get(node.id);
          if (!current) continue;
          if (
            this.fingerprint(current, Graph.inputs(this.view.doc, node.id)) !==
            fingerprint
          ) {
            this.view.mutate(
              current,
              (d) =>
                (d.versions = [
                  ...(d.versions || []),
                  { ...value, at: Date.now() },
                ].slice(-20)),
            );
            this.setState(node.id, {
              status: "idle",
              note: "Nœud modifié · résultat dans l’historique",
            });
          } else {
            this.result(node.id, value, fingerprint);
            this.setState(node.id, {
              status: "idle",
              note: value.note || "Terminé",
            });
          }
        } catch (error) {
          this.setState(node.id, {
            status: "error",
            error:
              error.name === "AbortError" ? "Traitement arrêté" : error.message,
          });
          throw error;
        }
      }
      this.status.textContent = "Workflow terminé";
    } catch (error) {
      this.status.textContent =
        error.name === "AbortError" ? "Traitement arrêté" : error.message;
      if (error.name !== "AbortError") toast(error.message, { kind: "error" });
    } finally {
      this.busy = false;
      this.runButton.disabled = this.view.readOnly;
      this.activeRun = null;
      if (this.selected) this.inspect(this.selected);
    }
  }
  stop() {
    this.activeRun?.abort();
  }
  async makeTemplate() {
    const center = this.view.viewCenter();
    const a = this.add("image", { x: center.x - 630, y: center.y - 200 }),
      m = this.add("mask", { x: center.x - 180, y: center.y - 200 }),
      e = this.add("edit", { x: center.x + 270, y: center.y - 200 }),
      c = this.add("compare", { x: center.x + 720, y: center.y - 200 });
    this.connect(a.id, m.id, "image");
    this.connect(a.id, e.id, "image");
    this.connect(m.id, e.id, "mask");
    this.connect(a.id, c.id, "reference");
    this.connect(e.id, c.id, "image");
    this.view.zoomToFit();
    this.inspect(a.id);
  }
  async saveTemplate() {
    const name = await promptText({
      title: "Enregistrer un outil personnel",
      label: "Nom de l’outil",
      value: "Mon workflow",
    });
    if (!name) return;
    const nodes = Graph.nodes(this.view.doc).filter(
      (n) => !this.view.selection.size || this.view.selection.has(n.id),
    );
    const ids = new Set(nodes.map((n) => n.id));
    const elements = [
      ...nodes,
      ...this.view.doc.elements.filter(
        (n) => n.kind === "connector" && ids.has(n.from.id) && ids.has(n.to.id),
      ),
    ];
    try {
      await api("/api/design/templates", {
        method: "POST",
        body: { name, elements },
      });
      toast("Outil enregistré dans votre bibliothèque locale.");
    } catch (error) {
      reportError(error);
    }
  }
  async templateMenu() {
    try {
      const info = await api("/api/design/templates");
      const list = h(
        "div.design-template-list",
        h(
          "button.btn",
          {
            type: "button",
            disabled: this.view.readOnly,
            onClick: () => {
              modal.close();
              this.makeTemplate();
            },
          },
          "Image → sélection → retouche",
        ),
      );
      for (const item of info.templates)
        list.append(
          h(
            "button.btn",
            {
              type: "button",
              disabled: this.view.readOnly,
              onClick: () => {
                modal.close();
                const p = this.view.viewCenter();
                this.view.change(() =>
                  this.view.input.instantiate(item.elements, p.x, p.y),
                );
                this.view.zoomToSelection();
              },
            },
            item.name,
          ),
        );
      const modal = openModal({
        title: "Modèles de workflow",
        body: list,
        footer: [
          h(
            "button.btn",
            {
              type: "button",
              onClick: () => {
                modal.close();
                this.saveTemplate();
              },
            },
            "Enregistrer la sélection comme outil",
          ),
        ],
      });
    } catch (error) {
      reportError(error);
    }
  }
  destroy() {
    this.destroyed = true;
    if (app.workspace.activeView === this.view)
      document.body.classList.remove("design-mode", "design-files");
    clearTimeout(this.autoTimer);
    this.portCleanup?.();
    this.stop();
    this.offs.forEach((off) => off());
    for (const el of [this.left, this.inspector, this.top, this.tools])
      el.remove();
  }
}
export function installDesign(view) {
  if (view.design || !view.doc.settings.design) return;
  view.design = new DesignController(view);
  view.redrawAll();
  view.sync();
}
