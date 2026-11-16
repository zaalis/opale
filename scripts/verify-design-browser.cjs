"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http");
const { spawn } = require("node:child_process"),
  { chromium } = require("playwright");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "opale-design-browser-"));
const vault = path.join(temp, "vault");
fs.mkdirSync(vault);
process.env.OPALE_HOME = path.join(temp, "home");
process.env.OPALE_FAKE_DRIVE = path.join(temp, "drive");
process.env.OPALE_FAKE_EMAIL = "alice@example.test";
process.env.OPALE_KEY_PROTECTION = "none";
let png = Buffer.alloc(0),
  calls = 0,
  requests = [];
const upstream = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  requests.push({
    url: req.url,
    type: req.headers["content-type"],
    body: Buffer.concat(chunks),
  });
  res.setHeader("Content-Type", "application/json");
  if (req.url.endsWith("/models"))
    return res.end(
      JSON.stringify({ data: [{ id: "gpt-image-test" }, { id: "text-test" }] }),
    );
  calls++;
  if (req.url.includes("/images/"))
    return res.end(
      JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
    );
  res.end(
    JSON.stringify({
      choices: [
        { message: { content: "Résultat texte local de vérification" } },
      ],
    }),
  );
});
let child;
const server = process.env.OPALE_TEST_SERVER
  ? {
      listen: () =>
        new Promise((resolve, reject) => {
          child = spawn(
            path.resolve(process.env.OPALE_TEST_SERVER),
            ["--port", "0", "--vault", vault],
            { windowsHide: true, env: process.env },
          );
          let output = "";
          const timer = setTimeout(
            () => reject(Error("Startup timeout")),
            15000,
          );
          child.on("error", reject);
          child.stderr.on("data", (c) => process.stderr.write(c));
          child.stdout.on("data", (c) => {
            output += c;
            const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
            if (match) {
              clearTimeout(timer);
              resolve(Number(match[1]));
            }
          });
        }),
      close: async () => {
        if (!child || child.exitCode !== null) return;
        const exit = new Promise((r) => child.once("exit", r));
        child.kill();
        await exit;
      },
    }
  : require("../server").createOpale({ port: 0, vaultPath: vault });
async function verifyLibrary(page) {
  for (const [label, tool] of [
    ["Déplacer le canevas", "hand"],
    ["Sélectionner", "select"],
    ["Ajouter une note libre", "sticky"],
    ["Sélectionner", "select"],
  ]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.click();
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    assert.equal(
      await page.evaluate(() => app.workspace.activeView.input.tool),
      tool,
    );
  }
  await page.getByRole("button", { name: "Dossiers", exact: true }).click();
  assert.ok(
    await page.evaluate(() => document.body.classList.contains("design-files")),
  );
  await page.getByRole("button", { name: "Outils", exact: true }).click();
  assert.equal(
    await page.evaluate(() => document.body.classList.contains("design-files")),
    false,
  );
  await page.locator(".design-library").waitFor({ state: "visible" });
  const options = page.getByRole("button", {
    name: "Options du moodboard",
    exact: true,
  });
  await options.click();
  await page.locator(".menu").waitFor({ state: "visible" });
  await options.click();
  await page.locator(".menu").waitFor({ state: "detached" });
  await options.click();
  await page.keyboard.press("Escape");
  await page.locator(".menu").waitFor({ state: "detached" });
  console.log(
    "PASS active tools, Files to Tools navigation, repeat-click and Escape menu closing",
  );

  const search = page.getByRole("searchbox", {
    name: "Rechercher un outil Opal Design",
  });
  await search.click();
  await page.keyboard.type("Consigne");
  assert.equal(await search.inputValue(), "Consigne");
  assert.equal(await page.locator(".design-tool-card").count(), 1);
  await search.fill("");
  for (const category of [
    "IA",
    "Images",
    "S\u00e9lection",
    "Texte",
    "Sorties",
    "Tous",
  ]) {
    await page
      .locator(".design-category")
      .getByText(category, { exact: true })
      .click();
    assert.equal(
      await page.locator('.design-category[aria-pressed="true"]').innerText(),
      category,
    );
    assert.ok((await page.locator(".design-tool-card").count()) > 0);
  }
  for (const tool of ["Consigne", "Image source", "Note"]) {
    const before = await page.evaluate(
      () => app.workspace.activeView.doc.elements.length,
    );
    await page
      .locator(".design-tool-card")
      .getByText(tool, { exact: true })
      .click();
    assert.equal(
      await page.evaluate(() => app.workspace.activeView.doc.elements.length),
      before + 1,
    );
  }
  const camera = await page.evaluate(() =>
    JSON.stringify(app.workspace.activeView.camera),
  );
  await page.locator(".design-library-results").hover();
  await page.mouse.wheel(0, 600);
  await page.waitForFunction(
    () => document.querySelector(".design-library-results").scrollTop > 0,
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify(app.workspace.activeView.camera)),
    camera,
  );
  await page
    .getByRole("button", { name: "Connexions IA", exact: true })
    .click();
  await page.waitForSelector(".modal-settings .design-settings");
  await page.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.locator(".modal-settings").waitFor({ state: "detached" });
  await page.evaluate(() => {
    const v = app.workspace.activeView;
    v.change(() => v.remove(v.doc.elements.map((e) => e.id)));
  });
  console.log(
    "PASS real sidebar search, all filters, tool clicks, independent wheel and AI settings",
  );
}
(async () => {
  let browser, page;
  try {
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${upstream.address().port}/v1`;
    const port = await server.listen();
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("JS ERROR", e.message);
    });
    page.on("console", (m) => {
      if (m.type() === "error") console.log("BROWSER", m.text());
    });
    page.setDefaultTimeout(12000);
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForSelector(".tabs");
    await page.evaluate(async (base) => {
      const { app, api } = await import("/js/core.js");
      window.app = app;
      window.api = api;
      await api("/api/design/connection", {
        method: "PUT",
        body: {
          provider: "custom",
          baseUrl: base,
          key: "local-fixture-key",
          models: ["gpt-image-test", "text-test"],
          imageModels: ["gpt-image-test"],
        },
      });
      await app.explorer.newBoard("", "design");
    }, base);
    await page.waitForFunction(() => app.workspace.activeView?.design?.catalog);
    await page.waitForSelector(".design-library");
    await verifyLibrary(page);
    const info = await page.evaluate(() => api("/api/design"));
    assert.equal(info.providers.length, 39);
    assert.ok(!JSON.stringify(info).includes("local-fixture-key"));
    console.log(
      "PASS personal Opal Design creation and all 39 IDE provider entries; no secret in public catalogue",
    );
    const assets = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const x = c.getContext("2d");
      x.fillStyle = "#ff0000";
      x.fillRect(0, 0, 128, 128);
      const red = c.toDataURL();
      x.fillStyle = "#0000ff";
      x.fillRect(0, 0, 128, 128);
      const blue = await new Promise((r) => c.toBlob(r));
      const result = await api(
        `/api/file?name=source.png&source=${encodeURIComponent(app.workspace.activeView.path)}`,
        {
          method: "PUT",
          body: new File([blue], "source.png", { type: "image/png" }),
          raw: true,
        },
      );
      return { red, file: result.path };
    });
    png = Buffer.from(assets.red.split(",")[1], "base64");
    const ids = await page.evaluate((file) => {
      const v = app.workspace.activeView,
        d = v.design;
      const image = d.add("image", { x: 0, y: 0 }),
        mask = d.add("mask", { x: 430, y: 0 }),
        edit = d.add("edit", { x: 860, y: 0 }),
        prompt = d.add("prompt", { x: 860, y: 650 });
      v.mutate(image, (n) => {
        n.file = file;
        n.resultFile = file;
        n.resultType = "image";
      });
      v.mutate(edit, (n) => {
        n.provider = "custom";
        n.model = "gpt-image-test";
      });
      v.mutate(
        prompt,
        (n) => (n.text = "Remplacer uniquement la sélection par du rouge."),
      );
      d.connect(image.id, mask.id, "image");
      d.connect(image.id, edit.id, "image");
      d.connect(mask.id, edit.id, "mask");
      d.connect(prompt.id, edit.id, "text");
      window.designIds = {
        image: image.id,
        mask: mask.id,
        edit: edit.id,
        prompt: prompt.id,
      };
      v.zoomToFit(false);
      return designIds;
    }, assets.file);
    await page.evaluate(() => {
      const v = app.workspace.activeView;
      v.change(() =>
        v.remove(
          window.OpalDesignGraph.links(v.doc)
            .filter((e) => e.to === designIds.edit && e.port === "text")
            .map((e) => e.id),
        ),
      );
    });
    const outputPort = page.locator(`[data-id="${ids.prompt}"] .dn-output`);
    const inputPort = page.locator(
      `[data-id="${ids.edit}"] .dn-port[data-port="text"]`,
    );
    await outputPort.dragTo(inputPort);
    assert.ok(
      await page.evaluate(() =>
        window.OpalDesignGraph.links(app.workspace.activeView.doc).some(
          (e) =>
            e.from === designIds.prompt &&
            e.to === designIds.edit &&
            e.port === "text",
        ),
      ),
    );
    console.log("PASS pointer drag connects typed ports");
    await page.evaluate(() =>
      app.workspace.activeView.design.mask(designIds.mask),
    );
    await page.waitForSelector(".design-mask-canvas");
    await page
      .getByRole("combobox", { name: "Outil de sélection", exact: true })
      .selectOption("rect");
    const maskBox = await page.locator(".design-mask-canvas").boundingBox();
    await page.mouse.move(
      maskBox.x + maskBox.width * 0.35,
      maskBox.y + maskBox.height * 0.35,
    );
    await page.mouse.down();
    await page.mouse.move(
      maskBox.x + maskBox.width * 0.65,
      maskBox.y + maskBox.height * 0.65,
      { steps: 5 },
    );
    await page.mouse.up();
    await page
      .getByRole("button", { name: "Appliquer la sélection", exact: true })
      .click();
    await page.locator(".modal-design-mask").waitFor({ state: "detached" });
    assert.ok(
      await page.evaluate(
        () => app.workspace.activeView.byId.get(designIds.mask).data.maskFile,
      ),
    );
    console.log(
      "PASS real mask painting with pointer events and local mask persistence",
    );
    await page.evaluate(() =>
      app.workspace.activeView.design.run(designIds.edit),
    );
    const pixels = await page.evaluate(async () => {
      const { loadCanvas } = await import("/js/design/images.js"),
        v = app.workspace.activeView,
        result = v.byId.get(designIds.edit).data.resultFile,
        selection = v.byId.get(designIds.mask).data.maskFile;
      if (!result) return { error: v.design.states.get(designIds.edit) };
      const [image, mask] = await Promise.all([
        loadCanvas(result),
        loadCanvas(selection),
      ]);
      const out = image.getContext("2d").getImageData(0, 0, 128, 128).data,
        m = mask.getContext("2d").getImageData(0, 0, 128, 128).data;
      let untouched = 0,
        edited = 0,
        wrong = 0;
      for (let i = 0; i < out.length; i += 4) {
        if (m[i] === 0) {
          untouched++;
          if (
            out[i] !== 0 ||
            out[i + 1] !== 0 ||
            out[i + 2] !== 255 ||
            out[i + 3] !== 255
          )
            wrong++;
        } else if (out[i] > 0) edited++;
      }
      return { result, untouched, edited, wrong };
    });
    assert.equal(pixels.wrong, 0, JSON.stringify(pixels));
    assert.ok(pixels.untouched > 10000);
    assert.ok(pixels.edited > 1000);
    assert.equal(calls, 1);
    assert.ok(
      requests.some(
        (r) =>
          r.url.endsWith("/images/edits") &&
          r.type.includes("multipart/form-data"),
      ),
    );
    console.log(
      `PASS masked AI editing: ${pixels.untouched} exterior pixels exactly preserved; ${pixels.edited} selected pixels changed`,
    );
    await page.evaluate(() =>
      app.workspace.activeView.design.run(designIds.edit),
    );
    assert.equal(calls, 2);
    assert.ok(
      await page.evaluate(
        () =>
          app.workspace.activeView.byId.get(designIds.edit).data.versions
            .length > 0,
      ),
    );
    const resized = await page.evaluate(async () => {
      const v = app.workspace.activeView,
        n = v.design.add("resize", { x: 1300, y: 0 });
      v.mutate(n, (d) => (d.params = { width: 64, height: 64 }));
      v.design.connect(designIds.edit, n.id, "image");
      await v.design.run(n.id);
      const { loadCanvas } = await import("/js/design/images.js");
      const result = await loadCanvas(v.byId.get(n.id).data.resultFile);
      return { width: result.width, height: result.height };
    });
    assert.deepEqual(resized, { width: 64, height: 64 });
    assert.equal(
      calls,
      2,
      "Cached upstream image is reused for a downstream local operation",
    );
    console.log(
      "PASS variants/history and dependency cache avoid repeating paid model calls",
    );
    const invalid = await page.evaluate(() => {
      const d = app.workspace.activeView.design;
      try {
        d.connect(designIds.prompt, designIds.mask, "image");
        return "";
      } catch (e) {
        return e.message;
      }
    });
    assert.match(invalid, /type/);
    await page.route("**/api/design", async (route) => {
      const response = await route.fetch();
      const info = await response.json();
      info.providers.find((p) => p.id === "chatgpt").connected = true;
      await route.fulfill({ response, json: info });
    });
    await page.evaluate(() => app.settings_ui.open("design"));
    await page.waitForSelector(".design-provider");
    assert.equal(await page.locator(".design-provider").count(), 39);
    const connected = page.locator(".design-provider-status.is-connected");
    await connected.waitFor();
    assert.match(await connected.innerText(), /Abonnement/);
    const color = await connected.evaluate((e) => getComputedStyle(e).color);
    const rgb = color.match(/[\d.]+/g).map(Number);
    assert.ok(rgb[1] > rgb[0] && rgb[1] > rgb[2], color);
    await page.unroute("**/api/design");
    console.log(
      "PASS subscription connected status uses a subtle green badge (simulated connection)",
    );

    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".modal-settings")).opacity ===
        "1",
    );
    await page.screenshot({
      path: path.resolve("artifacts/design-settings.png"),
    });
    await page.getByRole("button", { name: "Fermer", exact: true }).click();
    await page.locator(".modal-settings").waitFor({ state: "detached" });
    await page.evaluate(() => app.settings_ui.open("editor"));
    await page
      .getByRole("combobox", { name: "Mode par défaut", exact: true })
      .click();
    await page.waitForSelector(".opal-select-menu");
    assert.ok(
      await page
        .locator(".opal-select-menu")
        .evaluate((el) => getComputedStyle(el).borderRadius !== "0px"),
    );
    await page
      .locator(".opal-select-option")
      .filter({ hasText: "Lecture" })
      .click();
    await page.waitForFunction(
      () => window.app.settings.defaultMode === "reading",
    );
    assert.equal(await page.locator(".opal-select-menu").count(), 0);
    await page.getByRole("button", { name: "Fermer", exact: true }).click();
    await page.locator(".modal-settings").waitFor({ state: "detached" });
    console.log(
      "PASS model settings and animated custom select replaces the native square popup",
    );
    const exported = await page.evaluate(async () => {
      const v = app.workspace.activeView;
      await v.flush();
      return { path: v.path, text: JSON.stringify(v.doc) };
    });
    assert.ok(!exported.text.includes("local-fixture-key"));
    await page.evaluate(async () => {
      const v = app.workspace.activeView;
      v.design.inspector.hidden = true;
      v.design.fit(false);
    });
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".design-topbar")).opacity ===
        "1",
    );
    await page.screenshot({ path: path.resolve("artifacts/opal-design.png") });
    // A second tab reconstructs the same saved document from disk.
    await page.reload();
    await page.waitForSelector(".design-library");
    await page.evaluate(async () => {
      const core = await import("/js/core.js");
      window.app = core.app;
      window.api = core.api;
    });
    assert.ok(
      await page.evaluate(() =>
        app.workspace.activeView.doc.elements.some(
          (n) =>
            n.kind === "design" && n.data.tool === "edit" && n.data.resultFile,
        ),
      ),
    );
    console.log("PASS saved graph reopens with its generated image");
    await page.evaluate(async () => {
      const created = await api("/api/collab/create", {
        method: "POST",
        body: { name: "Design partagé" },
      });
      await app.collab.load();
      const project = (window.project = await app.collab.open(
        created.projectId,
      ));
      const id = project.createFile("board", "Création");
      const doc = window.OpaleBoard.emptyDoc();
      doc.settings.design = true;
      project.commit(
        window.OpaleCrdt.metaOps(project.replica, id, null, {
          layers: doc.layers,
          settings: doc.settings,
          vote: null,
        }),
        { scope: `board:${id}` },
      );
      app.workspace.openPath(project.pathOf(project.file(id)));
    });
    await page.waitForFunction(
      () =>
        app.workspace.activeView?.shared &&
        app.workspace.activeView.design?.catalog,
    );
    await verifyLibrary(page);
    const stable = await page.evaluate(async () => {
      const { collabUi } = await import("/js/collab/ui.js");
      collabUi.open.add(project.id);
      collabUi.render();
      const previous = [...collabUi.list.querySelectorAll(".tree-row")];
      for (let i = 0; i < 8; i++) collabUi.render();
      return (
        previous.length > 1 &&
        previous.every((n) => n.isConnected && collabUi.list.contains(n))
      );
    });
    assert.ok(
      stable,
      "Shared project and file rows must survive unchanged status refreshes",
    );
    console.log(
      "PASS shared project rows remain mounted across repeated sync refreshes",
    );
    const shared = await page.evaluate(async () => {
      const v = app.workspace.activeView,
        d = v.design,
        n = d.add("generate", { x: 0, y: 0 });
      v.mutate(n, (data) => {
        data.provider = "custom";
        data.model = "gpt-image-test";
        data.text = "Une image de validation";
      });
      await d.run(n.id);
      await v.flush();
      return {
        path: v.path,
        file: v.byId.get(n.id).data.resultFile,
        state: d.states.get(n.id),
      };
    });
    assert.match(shared.file || "", /^@shared\//, JSON.stringify(shared));
    assert.equal(calls, 3);
    const sharedResponse = await page.evaluate(async (file) => {
      const r = await fetch(`/api/file?path=${encodeURIComponent(file)}`);
      return { status: r.status, bytes: (await r.arrayBuffer()).byteLength };
    }, shared.file);
    assert.equal(sharedResponse.status, 200);
    assert.ok(sharedResponse.bytes > 0);
    const copy = await page.evaluate(() =>
      api("/api/collab/export", {
        method: "POST",
        body: { project: project.id },
      }),
    );
    assert.ok(copy);
    console.log(
      "PASS shared Design generation, attachment access and export copy",
    );
    await page.evaluate(()=>app.settings_ui.open('about'));
    await page.waitForSelector('.about-version');
    assert.equal(await page.locator('.about-version').innerText(),'Version 0.2.0');
    await page.getByRole('button',{name:'Fermer',exact:true}).click();
    await page.locator('.modal-settings').waitFor({state:'detached'});
    console.log('PASS settings About displays Version 0.2.0');
    let updatePhase = "current",
      applies = 0;
    await page.route("**/api/update", (route) =>
      route.fulfill({
        json: {
          supported: true,
          phase: updatePhase,
          percent: updatePhase === "ready" ? 100 : 37,
        },
      }),
    );
    await page.route("**/api/update/apply", (route) => {
      applies++;
      return route.fulfill({ json: { ok: true } });
    });
    await page.evaluate(() => {
      window.testClosed = false;
      window.close = () => {
        window.testClosed = true;
      };
    });
    const updateButton = page.locator(".ribbon-update");
    await page.waitForFunction(
      () =>
        document.querySelector(".ribbon-update").dataset.phase === "current",
    );
    assert.equal(
      await updateButton.isVisible(),
      false,
      "No update icon when current",
    );
    updatePhase = "checking";
    await page.waitForFunction(()=>document.querySelector('.ribbon-update').dataset.phase==='checking');
    assert.equal(await updateButton.isVisible(),false,'Silent check must not flash an icon');
    updatePhase = "downloading";
    await page.waitForFunction(
      () =>
        document.querySelector(".ribbon-update").dataset.phase ===
        "downloading",
    );
    assert.equal(await updateButton.isVisible(), true);
    assert.match(await updateButton.getAttribute("title"), /37 %/);
    assert.equal(
      await updateButton.evaluate((e) =>
        e.nextElementSibling.classList.contains("ribbon-agent"),
      ),
      true,
    );
    updatePhase = "ready";
    await page.waitForFunction(
      () => document.querySelector(".ribbon-update").dataset.phase === "ready",
    );
    await updateButton.click();
    await page.waitForFunction(() => window.testClosed);
    assert.equal(applies, 1);
    console.log(
      "PASS update arrow above IDE, download percentage, ready action and save-before-close (simulated installer)",
    );
    assert.deepEqual(errors, []);
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.resolve("artifacts/design-failure.png") })
        .catch(() => {});
    throw error;
  } finally {
    if (browser) await browser.close();
    await server.close();
    await new Promise((r) => upstream.close(r));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
