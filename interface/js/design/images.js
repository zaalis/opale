import { fileUrl } from "../core.js";
import { fetchMedia } from "../media-loading.js";
import { uploadFile } from "../editing.js";
export async function loadCanvas(file) {
  const response = await fetchMedia(fileUrl(file));
  const image = await createImageBitmap(await response.blob());
  if (image.width * image.height > 64000000) {
    image.close();
    throw Error("Cette image dépasse 64 mégapixels.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d").drawImage(image, 0, 0);
  image.close();
  return canvas;
}
export async function storeCanvas(canvas, source, name = "Opal Design.png") {
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw Error("Impossible de créer le résultat.");
  return uploadFile(new File([blob], name, { type: "image/png" }), source);
}
export function maskedComposite(original, generated, mask) {
  const canvas = document.createElement("canvas");
  canvas.width = original.width;
  canvas.height = original.height;
  const context = canvas.getContext("2d");
  context.drawImage(original, 0, 0);
  const temp = document.createElement("canvas");
  temp.width = canvas.width;
  temp.height = canvas.height;
  const ctx = temp.getContext("2d");
  ctx.drawImage(generated, 0, 0, canvas.width, canvas.height);
  const changed = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  const selection = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const output = context.getImageData(0, 0, canvas.width, canvas.height),
    base = output.data;
  for (let i = 0; i < base.length; i += 4) {
    const weight = selection[i] / 255;
    if (weight === 0) continue;
    for (let c = 0; c < 4; c++)
      base[i + c] = Math.round(
        base[i + c] * (1 - weight) + changed[i + c] * weight,
      );
  }
  context.putImageData(output, 0, 0);
  return canvas;
}
export async function apiMask(file, source) {
  const canvas = await loadCanvas(file),
    context = canvas.getContext("2d"),
    pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = pixels.data[i];
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 0;
    pixels.data[i + 3] = 255 - value;
  }
  context.putImageData(pixels, 0, 0);
  return storeCanvas(canvas, source, "Masque IA.png");
}
export async function transform(tool, files, params = {}) {
  const first = await loadCanvas(files.image || files.mask);
  let width = first.width,
    height = first.height;
  if (tool === "upscale") {
    const scale = Math.max(1, Math.min(4, Number(params.scale) || 2));
    width = Math.max(1, Math.round(first.width * scale));
    height = Math.max(1, Math.round(first.height * scale));
  }
  if (tool === "resize") {
    width = params.width === undefined ? width : Number(params.width);
    height =
      params.height === undefined
        ? Math.round((width * first.height) / first.width)
        : Number(params.height);
  }
  if (tool === "crop") {
    width = Math.min(
      first.width,
      Math.max(1, Number(params.width) || first.width),
    );
    height = Math.min(
      first.height,
      Math.max(1, Number(params.height) || first.height),
    );
  }
  const rotation = (((Number(params.angle) || 0) % 360) + 360) % 360;
  if (tool === "rotate") {
    const radians = (rotation * Math.PI) / 180;
    width = Math.ceil(
      Math.abs(first.width * Math.cos(radians)) +
        Math.abs(first.height * Math.sin(radians)) -
        1e-8,
    );
    height = Math.ceil(
      Math.abs(first.width * Math.sin(radians)) +
        Math.abs(first.height * Math.cos(radians)) -
        1e-8,
    );
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 64000000
  )
    throw Error(
      "Dimensions invalides : 16 384 px par côté et 64 mégapixels au maximum.",
    );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  if (tool === "crop")
    ctx.drawImage(
      first,
      Math.max(0, Math.min(first.width - width, Number(params.x) || 0)),
      Math.max(0, Math.min(first.height - height, Number(params.y) || 0)),
      width,
      height,
      0,
      0,
      width,
      height,
    );
  else if (tool === "rotate") {
    ctx.translate(width / 2, height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(params.flip ? -1 : 1, 1);
    ctx.drawImage(first, -first.width / 2, -first.height / 2);
  } else if (tool === "composite") {
    ctx.drawImage(first, 0, 0);
    const overlay = await loadCanvas(files.overlay);
    const layer = document.createElement("canvas");
    layer.width = width;
    layer.height = height;
    const l = layer.getContext("2d");
    l.globalAlpha = Math.max(
      0,
      Math.min(1, Number(params.opacity ?? 100) / 100),
    );
    l.drawImage(
      overlay,
      Number(params.x) || 0,
      Number(params.y) || 0,
      Number(params.width) || width,
      Number(params.height) || height,
    );
    if (files.mask) {
      const mask = await loadCanvas(files.mask);
      const m = document.createElement("canvas");
      m.width = width;
      m.height = height;
      const mc = m.getContext("2d");
      mc.drawImage(mask, 0, 0, width, height);
      const p = mc.getImageData(0, 0, width, height);
      for (let i = 0; i < p.data.length; i += 4) p.data[i + 3] = p.data[i];
      mc.putImageData(p, 0, 0);
      l.globalCompositeOperation = "destination-in";
      l.drawImage(m, 0, 0);
    }
    ctx.drawImage(layer, 0, 0);
  } else if (tool === "invertMask") {
    ctx.drawImage(first, 0, 0);
    const p = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < p.data.length; i += 4) {
      const value = 255 - p.data[i];
      p.data[i] = p.data[i + 1] = p.data[i + 2] = value;
      p.data[i + 3] = 255;
    }
    ctx.putImageData(p, 0, 0);
  } else if (tool === "growMask") {
    ctx.drawImage(first, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height),
      amount = Math.max(
        -30,
        Math.min(30, Math.round(Number(params.radius ?? 3))),
      ),
      radius = Math.abs(amount),
      max = amount >= 0;
    let values = new Uint8Array(width * height);
    for (let i = 0; i < values.length; i++) values[i] = pixels.data[i * 4];
    // Two separable passes; monotonic deque keeps large masks responsive.
    const pass = (input, horizontal) => {
      const out = new Uint8Array(input.length),
        outer = horizontal ? height : width,
        inner = horizontal ? width : height;
      for (let line = 0; line < outer; line++) {
        const queue = [];
        let head = 0,
          tail = 0;
        const index = (i) => (horizontal ? line * width + i : i * width + line);
        for (let i = 0; i < inner + radius; i++) {
          if (i < inner) {
            const value = input[index(i)];
            while (
              tail > head &&
              (max
                ? input[index(queue[tail - 1])] <= value
                : input[index(queue[tail - 1])] >= value)
            )
              tail--;
            queue[tail++] = i;
          }
          const at = i - radius;
          if (at >= 0) {
            while (tail > head && queue[head] < at - radius) head++;
            out[index(at)] = input[index(queue[head])];
          }
        }
      }
      return out;
    };
    values = pass(pass(values, true), false);
    for (let i = 0; i < values.length; i++) {
      pixels.data[i * 4] =
        pixels.data[i * 4 + 1] =
        pixels.data[i * 4 + 2] =
          values[i];
      pixels.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
  } else if (tool === "sharpen") {
    ctx.drawImage(first, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const src = new Uint8ClampedArray(image.data);
    const amount = Math.max(0, Math.min(100, Number(params.amount ?? 60))) / 100;
    const at = (x, y, c) => src[(y * width + x) * 4 + c];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const value = at(x, y, c) * (1 + 4 * amount) - amount * (at(x - 1, y, c) + at(x + 1, y, c) + at(x, y - 1, c) + at(x, y + 1, c));
          image.data[i + c] = Math.max(0, Math.min(255, value));
        }
      }
    }
    ctx.putImageData(image, 0, 0);
  } else if (tool === "cutout") {
    ctx.drawImage(first, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const sample = (x, y) => {
      const i = (y * width + x) * 4;
      return [image.data[i], image.data[i + 1], image.data[i + 2]];
    };
    const corners = [sample(0, 0), sample(width - 1, 0), sample(0, height - 1), sample(width - 1, height - 1)];
    const bg = corners[0].map((_, c) => corners.reduce((sum, color) => sum + color[c], 0) / corners.length);
    const tolerance = Math.max(1, Math.min(120, Number(params.threshold) || 28));
    for (let i = 0; i < image.data.length; i += 4) {
      const distance = Math.hypot(image.data[i] - bg[0], image.data[i + 1] - bg[1], image.data[i + 2] - bg[2]);
      if (distance <= tolerance) image.data[i + 3] = 0;
      else if (distance < tolerance * 1.6) image.data[i + 3] = Math.round(image.data[i + 3] * ((distance - tolerance) / (tolerance * 0.6)));
    }
    ctx.putImageData(image, 0, 0);
  } else {
    if (tool === "blur")
      ctx.filter = `blur(${Math.max(0, Math.min(100, Number(params.radius ?? 6)))}px)`;
    if (tool === "color")
      ctx.filter = `brightness(${Math.max(0, Number(params.brightness ?? 100))}%) contrast(${Math.max(0, Number(params.contrast ?? 100))}%) saturate(${Math.max(0, Number(params.saturation ?? 100))}%) hue-rotate(${Number(params.hue) || 0}deg)`;
    ctx.drawImage(first, 0, 0, width, height);
  }
  return canvas;
}
