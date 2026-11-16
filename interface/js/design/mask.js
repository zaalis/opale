import { h, openModal, toast } from "../core.js";
import { loadCanvas, storeCanvas } from "./images.js";
export async function editMask(view, node, source) {
  if (!source) throw Error("Reliez d’abord une image au nœud de masque.");
  const original = await loadCanvas(source),
    mask = document.createElement("canvas"),
    preview = document.createElement("canvas");
  mask.width = original.width;
  mask.height = original.height;
  const previewScale = Math.min(
    1,
    1200 / Math.max(original.width, original.height),
  );
  preview.width = Math.max(1, Math.round(original.width * previewScale));
  preview.height = Math.max(1, Math.round(original.height * previewScale));
  const ctx = mask.getContext("2d"),
    draw = preview.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, mask.width, mask.height);
  let initial;
  if (node.data.maskFile) {
    initial = await loadCanvas(node.data.maskFile);
    ctx.drawImage(initial, 0, 0, mask.width, mask.height);
  }
  preview.className = "design-mask-canvas";
  preview.setAttribute("aria-label", "Peindre la zone autorisée à changer");
  preview.style.touchAction = "none";
  const tools = h(
    "select.select",
    { "aria-label": "Outil de sélection" },
    [
      ["brush", "Pinceau"],
      ["erase", "Gomme"],
      ["rect", "Rectangle"],
      ["ellipse", "Ellipse"],
    ].map(([value, text]) => h("option", { value }, text)),
  );
  const size = h("input", {
    type: "range",
    min: 2,
    max: 300,
    value: 50,
    "aria-label": "Taille du pinceau",
  });
  const hardness = h("input", {
    type: "range",
    min: 0,
    max: 100,
    value: 80,
    "aria-label": "Dureté du pinceau",
  });
  const label = h(
    "span.design-mask-count",
    { role: "status" },
    "Zone colorée : autorisée · reste de l’image : protégé",
  );
  const history = [];
  let current,
    dirty = false;
  const paint = () => {
    draw.clearRect(0, 0, preview.width, preview.height);
    draw.drawImage(original, 0, 0, preview.width, preview.height);
    const overlay = document.createElement("canvas");
    overlay.width = preview.width;
    overlay.height = preview.height;
    const oc = overlay.getContext("2d");
    oc.drawImage(mask, 0, 0, preview.width, preview.height);
    const data = oc.getImageData(0, 0, preview.width, preview.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const alpha = data.data[i];
      data.data[i] = 251;
      data.data[i + 1] = 191;
      data.data[i + 2] = 36;
      data.data[i + 3] = Math.round(alpha * 0.48);
    }
    oc.putImageData(data, 0, 0);
    draw.drawImage(overlay, 0, 0);
  };
  const stroke = (op) => {
    const [start] = op.points,
      last = op.points.at(-1);
    ctx.fillStyle = op.tool === "erase" ? "#000" : "#fff";
    if (op.tool === "rect" || op.tool === "ellipse") {
      const x = Math.min(start.x, last.x),
        y = Math.min(start.y, last.y),
        w = Math.abs(last.x - start.x),
        h = Math.abs(last.y - start.y);
      if (op.tool === "rect") ctx.fillRect(x, y, w, h);
      else {
        ctx.beginPath();
        ctx.ellipse(
          x + w / 2,
          y + h / 2,
          Math.max(0.5, w / 2),
          Math.max(0.5, h / 2),
          0,
          0,
          2 * Math.PI,
        );
        ctx.fill();
      }
      return;
    }
    const radius = op.size / 2;
    for (let i = 0; i < op.points.length; i++) {
      const p = op.points[i],
        before = op.points[i - 1] || p,
        steps = Math.max(
          1,
          Math.ceil(
            Math.hypot(p.x - before.x, p.y - before.y) /
              Math.max(1, radius / 3),
          ),
        );
      for (let j = 0; j <= steps; j++) {
        const x = before.x + ((p.x - before.x) * j) / steps,
          y = before.y + ((p.y - before.y) * j) / steps;
        const color = op.tool === "erase" ? "0,0,0" : "255,255,255";
        const gradient = ctx.createRadialGradient(
          x,
          y,
          radius * Math.min(0.999, op.hardness / 100),
          x,
          y,
          radius,
        );
        gradient.addColorStop(0, `rgba(${color},1)`);
        gradient.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    }
  };
  const replay = () => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, mask.width, mask.height);
    if (initial) ctx.drawImage(initial, 0, 0, mask.width, mask.height);
    for (const op of history) stroke(op);
    if (current) stroke(current);
    paint();
  };
  const point = (e) => {
    const r = preview.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * mask.width) / r.width,
      y: ((e.clientY - r.top) * mask.height) / r.height,
    };
  };
  preview.onpointerdown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    preview.setPointerCapture(e.pointerId);
    current = {
      tool: tools.value,
      size: (Number(size.value) * mask.width) / preview.clientWidth,
      hardness: Number(hardness.value),
      points: [point(e)],
    };
    replay();
  };
  let replayFrame = 0;
  preview.onpointermove = (e) => {
    if (!current) return;
    current.points.push(point(e));
    if (!replayFrame)
      replayFrame = requestAnimationFrame(() => {
        replayFrame = 0;
        replay();
      });
  };
  const finish = () => {
    if (replayFrame) {
      cancelAnimationFrame(replayFrame);
      replayFrame = 0;
      replay();
    }
    if (current) {
      history.push(current);
      current = null;
      dirty = true;
      paint();
    }
  };
  preview.onpointerup = finish;
  preview.onpointercancel = finish;
  const undo = h(
    "button.btn",
    {
      type: "button",
      onClick: () => {
        history.pop();
        replay();
      },
    },
    "Annuler le trait",
  );
  const clear = h(
    "button.btn",
    {
      type: "button",
      onClick: () => {
        initial = null;
        history.length = 0;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, mask.width, mask.height);
        dirty = true;
        paint();
      },
    },
    "Effacer la sélection",
  );
  const save = h(
    "button.btn.primary",
    { type: "button" },
    "Appliquer la sélection",
  );
  let closed = false;
  save.onclick = async () => {
    finish();
    save.disabled = true;
    save.textContent = "Enregistrement…";
    try {
      const data = ctx.getImageData(0, 0, mask.width, mask.height).data;
      if (!data.some((value, index) => index % 4 === 0 && value > 0))
        throw Error("Peignez au moins une zone à modifier.");
      const path = await storeCanvas(
        mask,
        view.path,
        "Sélection Opal Design.png",
      );
      if (!closed && view.byId.has(node.id)) {
        view.mutate(node, (d) => {
          d.maskFile = path;
          d.maskSource = source;
          d.resultFile = path;
          d.resultType = "mask";
          d.fingerprint = "";
        });
        modal.close();
      }
    } catch (error) {
      toast(error.message, { kind: "error" });
    } finally {
      save.disabled = false;
      save.textContent = "Appliquer la sélection";
    }
  };
  const modal = openModal({
    title: "Sélection et zone protégée",
    className: "modal-design-mask",
    body: h(
      "div",
      h(
        "div.design-mask-tools",
        tools,
        h("label", "Taille ", size),
        h("label", "Dureté ", hardness),
        undo,
        clear,
      ),
      h("div.design-mask-stage", preview),
      label,
    ),
    footer: [
      h(
        "button.btn",
        { type: "button", onClick: () => modal.close() },
        "Annuler",
      ),
      save,
    ],
    onClose: () => {
      closed = true;
    },
  });
  paint();
  return modal;
}
