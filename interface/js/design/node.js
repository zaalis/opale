import { app, h, icon, fileUrl, downloadFile } from "../core.js";
import { watchImage } from "../media-loading.js";
const Graph = window.OpalDesignGraph;
export function renderDesignNode(view, node, body) {
  const controller = view.design;
  if (!controller) {
    body.textContent = "Opal Design";
    return;
  }
  const spec = Graph.TOOLS[node.data.tool] || Graph.TOOLS.prompt,
    data = node.data,
    state = controller.states.get(node.id) || {};
  body.setAttribute("aria-busy", String(state.status === "running"));
  body.className = `b-body design-node is-${state.status || "idle"}`;
  body.replaceChildren();
  const button = (label, action, iconName) =>
    h(
      "button.design-control.dn-button",
      {
        type: "button",
        "aria-label": label,
        title: label,
        onClick: (event) => {
          event.stopPropagation();
          action();
        },
      },
      iconName ? h("span", { html: icon(iconName, 14) }) : label,
    );
  const header = h(
    "div.dn-header",
    h("span.dn-tool-icon", { html: icon(spec.icon, 16) }),
    h("span.dn-title", data.title || spec.label),
  );
  const actions = h("div.dn-actions");
  if (state.status === "running")
    actions.append(
      button("Arrêter ce nœud", () => controller.stop(node.id), "x"),
    );
  else if (data.tool === "start")
    actions.append(
      button("Exécuter la chaîne", () => controller.run(node.id), "play"),
    );
  else if (!["prompt", "image", "note", "mask"].includes(data.tool))
    actions.append(
      button("Exécuter ce nœud", () => controller.run(node.id), "play"),
    );
  actions.append(
    button("Réglages du nœud", () => controller.inspect(node.id), "more"),
  );
  header.append(actions);
  body.append(header);
  const content = h("div.dn-content");
  if (spec.ai) {
    const mode = data.tool === "text" ? "text" : "image";
    const providers = (controller.catalog?.providers || []).filter((p) =>
      p.models.some((m) => m.modes.includes(mode)),
    );
    const selected = data.provider
      ? providers.find((p) => p.id === data.provider)
      : providers.find((p) => p.configured) || providers[0];
    const provider = h(
      "select.select.design-control",
      { "aria-label": `Fournisseur du nœud ${node.id}` },
      providers.map((p) =>
        h(
          "option",
          { value: p.id, selected: p.id === selected?.id },
          `${p.label}${p.configured ? "" : " · à connecter"}`,
        ),
      ),
    );
    provider.disabled = view.readOnly;
    provider.onchange = () => {
      const next = providers.find((p) => p.id === provider.value);
      view.mutate(node, (d) => {
        d.provider = provider.value;
        d.model = next?.models.find((m) => m.modes.includes(mode))?.id || "";
        d.fingerprint = "";
      });
    };
    const models = selected?.models.filter((m) => m.modes.includes(mode)) || [];
    const chosen = data.model
      ? models.find((m) => m.id === data.model)
      : models[0];
    const model = h(
      "select.select.design-control",
      { "aria-label": `Modèle du nœud ${node.id}` },
      models.map((m) =>
        h("option", { value: m.id, selected: m.id === chosen?.id }, m.label),
      ),
    );
    if (data.model && !chosen)
      model.prepend(
        h(
          "option",
          { value: data.model, selected: true },
          `${data.model} · indisponible`,
        ),
      );
    model.disabled = view.readOnly;
    model.onchange = () =>
      view.mutate(node, (d) => {
        d.provider = provider.value;
        d.model = model.value;
        d.fingerprint = "";
      });
    content.append(h("div.dn-model-fields", provider, model));
    if (!selected?.configured)
      content.append(
        h(
          "button.dn-connection.design-control",
          { type: "button", onClick: () => app.settings_ui.open("design") },
          "Configurer les connexions IA",
        ),
      );
  }
  if (
    [
      "prompt",
      "text",
      "generate",
      "edit",
      "segment",
      "concat",
      "note",
    ].includes(data.tool)
  ) {
    const prompt = h(
      "div.dn-prompt.design-control",
      {
        "data-edit": "text",
        tabIndex: view.readOnly ? -1 : 0,
        role: "textbox",
        "aria-label": `Consigne du nœud ${node.id}`,
        "aria-multiline": "true",
      },
      data.text ||
        h(
          "span.dn-placeholder",
          data.tool === "note"
            ? "Écrire une note…"
            : "Écrire une consigne ou relier un texte…",
        ),
    );
    const edit = (event) => {
      event.stopPropagation();
      if (!view.readOnly) view.editField(node, "text");
    };
    prompt.onclick = edit;
    prompt.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        edit(e);
      }
    };
    content.append(prompt);
  }
  const resultFile = data.resultFile || data.file;
  if (resultFile) {
    const stage = h("div.dn-image-stage");
    const image = h("img", {
      src: fileUrl(resultFile),
      alt: data.title || spec.label,
      draggable: false,
      decoding: "async",
    });
    stage.append(image);
    watchImage(image);
    if (data.resultType === "mask" || data.tool === "mask")
      stage.classList.add("is-mask");
    content.append(stage);
  } else if (
    [
      "image",
      "generate",
      "edit",
      "mask",
      "segment",
      "preview",
      "compare",
      "composite",
    ].includes(data.tool)
  )
    content.append(
      h(
        `div.dn-image-empty${state.status === "running" ? ".media-loading" : ""}`,
        h("span", {
          html: icon(data.tool === "mask" ? "board-pen" : "image", 28),
        }),
        h(
          "span",
          data.tool === "image"
            ? "Déposer ou choisir une image"
            : data.tool === "mask"
              ? "Relier une image, puis peindre la sélection"
              : "Le résultat apparaîtra ici",
        ),
      ),
    );
  if (data.tool === "image")
    content.append(
      h(
        "button.btn.design-control",
        {
          type: "button",
          disabled: view.readOnly,
          onClick: () => controller.chooseImage(node.id),
        },
        "Choisir une image…",
      ),
    );
  if (["mask", "segment"].includes(data.tool))
    content.append(
      h(
        "button.btn.design-control",
        {
          type: "button",
          disabled: view.readOnly,
          onClick: () => controller.mask(node.id),
        },
        "Peindre la sélection…",
      ),
    );
  if (data.resultText && !["prompt", "note"].includes(data.tool))
    content.append(h("div.dn-text-result", data.resultText));
  if (data.tool === "compare") {
    const linked = Graph.inputs(view.doc, node.id),
      before = linked.reference?.data.resultFile || linked.reference?.data.file,
      after = linked.image?.data.resultFile || linked.image?.data.file;
    if (before && after) {
      const compare = h("div.dn-compare");
      compare.append(
        h("img", { src: fileUrl(before), alt: "Avant" }),
        h("img.dn-compare-after", { src: fileUrl(after), alt: "Après" }),
      );
      const range = h("input.design-control", {
        type: "range",
        min: 0,
        max: 100,
        value: 50,
        "aria-label": "Comparaison avant après",
        onInput: () =>
          (compare.lastChild.style.clipPath = `inset(0 ${100 - Number(range.value)}% 0 0)`),
      });
      content.append(compare, range);
    }
  }
  if (data.versions?.length) {
    const versions = h(
      "select.select.design-control",
      { "aria-label": `Historique du nœud ${node.id}` },
      h("option", { value: "" }, "Revenir à une version…"),
      [...data.versions]
        .reverse()
        .map((version, index) =>
          h(
            "option",
            { value: String(data.versions.length - 1 - index) },
            `Version ${data.versions.length - index} · ${new Date(version.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
          ),
        ),
    );
    versions.onchange = () =>
      controller.restore(node.id, Number(versions.value));
    content.append(versions);
  }
  const footer = h(
    "div.dn-footer",
    h(
      "span.dn-state",
      { role: "status" },
      state.status === "running"
        ? "Traitement en cours…"
        : state.error || state.note || data.resultFile || data.resultText
          ? "Résultat disponible"
          : "Prêt",
    ),
  );
  // Keep detailed errors readable rather than replacing them with a generic state.
  footer.firstChild.textContent =
    state.status === "running"
      ? "Traitement en cours…"
      : state.error ||
        state.note ||
        (data.resultFile || data.resultText ? "Résultat disponible" : "Prêt");
  if (resultFile)
    footer.append(
      button(
        "Télécharger le résultat",
        () => downloadFile(resultFile),
        "download",
      ),
    );
  content.append(footer);
  body.append(content);
  let index = 0;
  const ports = Object.entries(spec.inputs);
  if (node.data.tool !== "start") ports.push(["flow", "flow"]);
  for (const [port, type] of ports) {
    const connected = Graph.links(view.doc).some(
      (link) => link.to === node.id && link.port === port,
    );
    const dot = h(
      `button.dn-port.design-control.type-${type}${connected ? ".is-connected" : ""}`,
      {
        type: "button",
        title: `Entrée ${port} · ${type}`,
        "aria-label": `Relier à ${port} du nœud ${node.id}`,
        dataset: { node: node.id, port },
        style: { top: `${62 + index * 28}px` },
        disabled: view.readOnly,
        onClick: () => controller.port(node.id, port),
      },
      h("span.dn-port-label", port === "flow" ? "Suite" : port),
    );
    body.append(dot);
    index++;
  }
  body.append(
    h(
      `button.dn-port.dn-output.design-control.type-${spec.output}`,
      {
        type: "button",
        title: spec.output === "flow" ? "Chaîne · à relier vers Suite" : `Sortie · ${spec.output}`,
        "aria-label": `Sortie du nœud ${node.id}`,
        style: { top: "62px" },
        disabled: view.readOnly,
        onPointerdown: (event) => controller.startPortDrag(event, node.id),
        onClick: () => controller.port(node.id),
      },
      h("span.dn-port-label", spec.output === "flow" ? "Chaîne" : "Résultat"),
    ),
  );
}
