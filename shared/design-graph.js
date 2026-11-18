(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OpalDesignGraph = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const TOOLS = {
    start: {
      label: "Départ",
      category: "Entrées",
      icon: "play",
      inputs: {},
      output: "flow",
    },
    prompt: {
      label: "Consigne",
      category: "Entrées",
      icon: "file",
      inputs: {},
      output: "text",
    },
    image: {
      label: "Image source",
      category: "Entrées",
      icon: "image",
      inputs: {},
      output: "image",
    },
    note: {
      label: "Note",
      category: "Entrées",
      icon: "file-plus",
      inputs: {},
      output: "text",
    },
    text: {
      label: "Assistant texte",
      category: "Intelligence artificielle",
      icon: "sparkles",
      inputs: { text: "text", image: "image" },
      output: "text",
      ai: true,
    },
    refine: {
      label: "Réécrire la consigne",
      category: "Intelligence artificielle",
      icon: "sparkles",
      inputs: { text: "text" },
      required: ["text"],
      output: "text",
      ai: true,
    },
    generate: {
      label: "Générer une image",
      category: "Intelligence artificielle",
      icon: "image",
      inputs: { text: "text", image: "image" },
      output: "image",
      ai: true,
    },
    edit: {
      label: "Retouche ciblée",
      category: "Intelligence artificielle",
      icon: "pencil",
      inputs: { image: "image", text: "text", mask: "mask" },
      required: ["image", "mask"],
      output: "image",
      ai: true,
    },
    segment: {
      label: "Sélection assistée IA",
      category: "Sélection et protection",
      icon: "sparkles",
      inputs: { image: "image", text: "text" },
      required: ["image"],
      output: "mask",
      ai: true,
    },
    mask: {
      label: "Peindre un masque",
      category: "Sélection et protection",
      icon: "board-pen",
      inputs: { image: "image" },
      required: ["image"],
      output: "mask",
    },
    invertMask: {
      label: "Inverser le masque",
      category: "Sélection et protection",
      icon: "swap",
      inputs: { mask: "mask" },
      required: ["mask"],
      output: "mask",
    },
    growMask: {
      label: "Étendre / réduire",
      category: "Sélection et protection",
      icon: "expand",
      inputs: { mask: "mask" },
      required: ["mask"],
      output: "mask",
    },
    crop: {
      label: "Recadrer",
      category: "Transformations",
      icon: "frame",
      inputs: { image: "image" },
      required: ["image"],
      output: "image",
    },
    resize: {
      label: "Redimensionner",
      category: "Transformations",
      icon: "expand",
      inputs: { image: "image" },
      required: ["image"],
      output: "image",
    },
    rotate: {
      label: "Rotation et miroir",
      category: "Transformations",
      icon: "rotate",
      inputs: { image: "image" },
      required: ["image"],
      output: "image",
    },
    color: {
      label: "Couleurs et lumière",
      category: "Transformations",
      icon: "sun",
      inputs: { image: "image" },
      required: ["image"],
      output: "image",
    },
    blur: {
      label: "Flou",
      category: "Transformations",
      icon: "image",
      inputs: { image: "image" },
      required: ["image"],
      output: "image",
    },
    upscale: {
      label: "Agrandir",
      category: "Transformations",
      icon: "expand",
      inputs: { image: "image" },
      required: ["image"],
      output: "image",
    },
    sharpen: {
      label: "Netteté",
      category: "Transformations",
      icon: "sun",
      inputs: { image: "image" },
      required: ["image"],
      output: "image",
    },
    cutout: {
      label: "Détourer le fond",
      category: "Transformations",
      icon: "image",
      inputs: { image: "image" },
      required: ["image"],
      output: "image",
    },
    composite: {
      label: "Composition de calques",
      category: "Composition",
      icon: "layers",
      inputs: { image: "image", overlay: "image", mask: "mask" },
      required: ["image", "overlay"],
      output: "image",
    },
    concat: {
      label: "Assembler les textes",
      category: "Texte",
      icon: "link",
      inputs: { text: "text", extra: "text" },
      output: "text",
    },
    preview: {
      label: "Aperçu / résultat",
      category: "Sorties",
      icon: "eye",
      inputs: { image: "image", text: "text" },
      output: "any",
    },
    compare: {
      label: "Comparer les variantes",
      category: "Sorties",
      icon: "sidebar-right",
      inputs: { image: "image", reference: "image" },
      required: ["image", "reference"],
      output: "image",
    },
    output: {
      label: "Enregistrer le résultat",
      category: "Sorties",
      icon: "download",
      inputs: { image: "image", text: "text" },
      output: "any",
    },
  };
  function nodes(doc) {
    return doc.elements.filter((e) => e.kind === "design");
  }
  function links(doc) {
    return doc.elements
      .filter(
        (e) =>
          e.kind === "connector" &&
          String(e.data?.relation || "").startsWith("design:"),
      )
      .map((e) => ({
        id: e.id,
        from: e.from.id,
        to: e.to.id,
        port: e.data.relation.slice(7),
      }));
  }
  function validateLink(doc, from, to, port, exclude = "") {
    const a = nodes(doc).find((n) => n.id === from),
      b = nodes(doc).find((n) => n.id === to);
    if (!a || !b || from === to)
      throw Error("Choisissez deux nœuds différents.");
    const out = TOOLS[a.data.tool]?.output,
      input = TOOLS[b.data.tool]?.inputs[port];
    if (port === "flow") {
      if (out !== "flow")
        throw Error("Reliez la chaîne depuis le nœud Départ.");
    } else if (!input || !out || (out !== "any" && out !== input))
      throw Error("Ces ports ne transportent pas le même type de contenu.");
    const edges = links(doc).filter(
      (e) => e.id !== exclude && !(e.to === to && e.port === port),
    );
    const visit = (id, seen = new Set()) => {
      if (id === from) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return edges.filter((e) => e.from === id).some((e) => visit(e.to, seen));
    };
    if (visit(to)) throw Error("Cette liaison créerait une boucle.");
    return true;
  }
  function plan(doc, target) {
    const list = nodes(doc),
      edges = links(doc),
      byId = new Map(list.map((n) => [n.id, n])),
      done = new Set(),
      visiting = new Set(),
      out = [];
    const visit = (id) => {
      if (done.has(id)) return;
      if (visiting.has(id)) throw Error("Le workflow contient une boucle.");
      const node = byId.get(id);
      if (!node) throw Error("Un nœud relié est introuvable.");
      visiting.add(id);
      for (const edge of edges.filter((e) => e.to === id)) visit(edge.from);
      visiting.delete(id);
      done.add(id);
      out.push(node);
    };
    const downstream = (id, seen = new Set()) => {
      if (seen.has(id)) return [];
      seen.add(id);
      return [id].concat(edges.filter((edge) => edge.from === id).flatMap((edge) => downstream(edge.to, seen)));
    };
    const starts = list.filter((node) => node.data.tool === "start");
    const chosen = target
      ? byId.get(target)?.data.tool === "start" ? downstream(target) : [target]
      : starts.length ? starts.flatMap((node) => downstream(node.id)) : list.map((node) => node.id);
    for (const id of chosen) visit(id);
    return out;
  }
  function inputs(doc, id) {
    return Object.fromEntries(
      links(doc)
        .filter((e) => e.to === id)
        .map((e) => [e.port, nodes(doc).find((n) => n.id === e.from)]),
    );
  }
  function fingerprint(node, inputs) {
    return JSON.stringify([
      node.data.tool,
      node.data.text,
      node.data.provider,
      node.data.model,
      node.data.params,
      node.data.file,
      node.data.maskFile,
      Object.entries(inputs).map(([port, n]) => [
        port,
        n?.data.resultFile,
        n?.data.resultText,
        n?.data.resultType,
      ]),
    ]);
  }
  return { TOOLS, nodes, links, plan, inputs, validateLink, fingerprint };
});
