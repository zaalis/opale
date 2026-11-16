"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const Graph = require("../shared/design-graph"),
  Board = require("../shared/board");
const { DesignService } = require("../lib/design/service");
function service(fetchImpl) {
  let data = {};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opale-design-test-"));
  return {
    root,
    service: new DesignService({
      home: root,
      fetchImpl,
      secrets: {
        load: () => structuredClone(data),
        save: (file, next) => {
          data = structuredClone(next);
        },
      },
    }),
    stored: () => data,
    close: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const node = (id, tool) => Board.create("design", { id, data: { tool } });
function edge(id, from, to, port) {
  return Board.create("connector", {
    id,
    from: { id: from, side: "right", portY: 62 },
    to: { id: to, side: "left", portY: 118 },
    data: { relation: `design:${port}` },
  });
}
test("design links are typed and cyclic graphs are refused", () => {
  const doc = {
    elements: [
      node("a", "prompt"),
      node("b", "text"),
      node("c", "text"),
      node("i", "image"),
    ],
  };
  assert.equal(Graph.validateLink(doc, "a", "b", "text"), true);
  assert.throws(() => Graph.validateLink(doc, "a", "b", "image"), /type/);
  doc.elements.push(edge("ab", "a", "b", "text"), edge("bc", "b", "c", "text"));
  assert.throws(() => Graph.validateLink(doc, "c", "b", "text"), /boucle/);
  assert.deepEqual(
    Graph.plan(doc, "c").map((n) => n.id),
    ["a", "b", "c"],
  );
  doc.elements.push(edge("cb", "c", "b", "text"));
  assert.throws(() => Graph.plan(doc), /boucle/);
});
test("Design canvases preserve mode, typed nodes, port anchors, image results and versions", () => {
  const doc = Board.emptyDoc();
  doc.settings.design = true;
  doc.elements.push(
    node("a", "image"),
    node("b", "edit"),
    edge("ab", "a", "b", "image"),
  );
  doc.elements[0].data.file = "input.png";
  doc.elements[1].data.resultFile = "result.png";
  doc.elements[1].data.maskFile = "mask.png";
  doc.elements[1].data.versions = [{ file: "older.png", at: 123 }];
  const text = Board.serialize(doc),
    parsed = Board.parse(text);
  assert.equal(parsed.problem, null);
  assert.equal(parsed.doc.settings.design, true);
  assert.equal(parsed.doc.elements.find((e) => e.id === "ab").to.portY, 118);
  assert.deepEqual(
    new Set(Board.fileRefs(text)),
    new Set(["input.png", "result.png", "mask.png", "older.png"]),
  );
  const rewritten = Board.rewriteFileRefs(text, (file) =>
    file === "result.png" ? "moved.png" : file,
  );
  assert.equal(rewritten.changed, 1);
  assert.ok(Board.fileRefs(rewritten.text).includes("moved.png"));
});
test("all IDE provider families are available and credentials never enter the catalogue", () => {
  const w = service();
  try {
    const info = w.service.info();
    assert.equal(info.providers.length, 39);
    for (const id of [
      "codex",
      "claude",
      "gemini",
      "grok",
      "mistral",
      "kimi",
      "local",
      "gguf",
      "chatgpt",
      "xai-sub",
      "minimax-sub",
      "openrouter",
      "deepseek",
      "custom",
    ])
      assert.ok(
        info.providers.some((p) => p.id === id),
        id,
      );
    w.service.configure("codex", { key: "my-private-key" });
    assert.ok(w.service.info().providers.find((p) => p.id === "codex").keySet);
    assert.ok(!JSON.stringify(w.service.info()).includes("my-private-key"));
    assert.throws(
      () =>
        w.service.configure("custom", { baseUrl: "http://192.168.1.20/v1" }),
      /HTTPS/,
    );
    w.service.configure("custom", { baseUrl: "http://127.0.0.1:1234/v1" });
  } finally {
    w.close();
  }
});
test("text, image and native provider adapters use their actual protocols", async () => {
  const calls = [];
  const w = service(async (url, options) => {
    calls.push([String(url), options]);
    if (String(url).endsWith("/responses"))
      return json({
        output: [{ content: [{ type: "output_text", text: "Compatible" }] }],
      });
    if (String(url).includes("/messages"))
      return json({ content: [{ text: "Claude" }] });
    if (String(url).includes(":generateContent"))
      return json({
        candidates: [{ content: { parts: [{ text: "Gemini" }] } }],
      });
    if (String(url).includes("/images/"))
      return json({
        data: [{ b64_json: Buffer.from("image-bytes").toString("base64") }],
      });
    return json({ choices: [{ message: { content: "Compatible" } }] });
  });
  try {
    for (const id of ["codex", "claude", "gemini"])
      w.service.configure(id, { key: "test-key" });
    assert.equal(
      (
        await w.service.run({
          provider: "codex",
          model: "gpt-6.1-sol",
          prompt: "Bonjour",
        })
      ).text,
      "Compatible",
    );
    assert.equal(
      (
        await w.service.run({
          provider: "claude",
          model: "claude-fable-5-2",
          prompt: "Bonjour",
        })
      ).text,
      "Claude",
    );
    assert.equal(
      (
        await w.service.run({
          provider: "gemini",
          model: "gemini-3.5-flash",
          prompt: "Bonjour",
        })
      ).text,
      "Gemini",
    );
    assert.equal(
      (
        await w.service.run({
          provider: "codex",
          model: "gpt-image-2.6-flare",
          kind: "image",
          prompt: "Une maison",
        })
      ).bytes.toString(),
      "image-bytes",
    );
    assert.ok(calls.some(([url]) => url.endsWith("/images/generations")));
    w.service.configure("grok", { key: "xai-fixture" });
    await w.service.run({
      provider: "grok",
      model: "grok-imagine-image",
      kind: "image",
      prompt: "Une retouche",
      images: [{ mime: "image/png", bytes: Buffer.from("source") }],
      mask: { mime: "image/png", bytes: Buffer.from("mask") },
    });
    const xai = calls.find(
      ([url]) => url === "https://api.x.ai/v1/images/edits",
    )[1];
    assert.equal(xai.headers["Content-Type"], "application/json");
    const xbody = JSON.parse(xai.body);
    assert.equal(xbody.images.length, 2);
    assert.match(xbody.images[0].url, /^data:image\/png;base64,/);
    assert.match(xbody.prompt, /selection mask/);

    await assert.rejects(
      w.service.run({
        provider: "codex",
        model: "gpt-6.1-sol",
        kind: "image",
        prompt: "image",
      }),
      /type de résultat/,
    );
  } finally {
    w.close();
  }
});
test("public ChatGPT browser sign-in uses the IDE PKCE flow and can be cancelled", async () => {
  const w = service();
  try {
    const flow = await w.service.start("chatgpt");
    const url = new URL(flow.verificationUrl);
    assert.equal(url.hostname, "auth.openai.com");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("state"));
    assert.ok(!JSON.stringify(flow).includes("refreshToken"));
    assert.equal(
      (await w.service.poll("chatgpt", flow.flowId)).status,
      "pending",
    );
    w.service.cancel(flow.flowId);
    await assert.rejects(w.service.poll("chatgpt", flow.flowId), /expiré/);
  } finally {
    w.close();
  }
});
test("subscription tokens stay private and a cancelled pending poll cannot reconnect", async () => {
  let release;
  const w = service(async (url, options) => {
    if (String(url).endsWith("/oauth/code")) {
      const body = new URLSearchParams(options.body);
      return json({
        user_code: "CODE-123",
        verification_uri: "https://api.minimax.io/oauth/verify",
        state: body.get("state"),
        interval_ms: 2000,
        expired_in: 600,
      });
    }
    return new Promise((resolve) => {
      release = () =>
        resolve(
          json({
            status: "success",
            access_token: "private-access",
            refresh_token: "private-refresh",
            expired_in: 3600,
          }),
        );
    });
  });
  try {
    const flow = await w.service.start("minimax-sub");
    const pending = w.service.poll("minimax-sub", flow.flowId);
    await new Promise((resolve) => setImmediate(resolve));
    w.service.disconnect("minimax-sub");
    release();
    await assert.rejects(pending, /annulée/);
    assert.equal(
      w.service.info().providers.find((p) => p.id === "minimax-sub").connected,
      false,
    );
    assert.ok(!JSON.stringify(w.service.info()).includes("private-access"));
  } finally {
    w.close();
  }
});
test("saved tools retain the graph but strip per-document images, masks and run results", () => {
  const w = service();
  try {
    const a = node("a", "image"),
      m = node("m", "mask");
    a.data.file = "private.png";
    a.data.resultFile = "private.png";
    m.data.maskFile = "private-mask.png";
    const saved = w.service.saveTemplate({
      name: "Retouche",
      elements: [a, m, edge("am", "a", "m", "image")],
    });
    assert.equal(saved.elements[0].data.file, "");
    assert.equal(saved.elements[1].data.maskFile, "");
    assert.equal(w.service.templates().templates.length, 1);
    assert.deepEqual(
      Graph.plan(saved).map((n) => n.id),
      ["a", "m"],
    );
  } finally {
    w.close();
  }
});

test(
  "Windows stores Design keys with DPAPI outside the vault",
  { skip: process.platform !== "win32" },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "opale-design-dpapi-"));
    try {
      const instance = new DesignService({ home: root });
      instance.configure("codex", { key: "secret-for-encryption-check" });
      const stored = fs.readFileSync(
        path.join(root, "design-connections.json"),
        "utf8",
      );
      assert.ok(!stored.includes("secret-for-encryption-check"));
      assert.equal(JSON.parse(stored).protection, "windows-dpapi");
      assert.equal(
        new DesignService({ home: root })
          .info()
          .providers.find((p) => p.id === "codex").keySet,
        true,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
test("a refresh cannot revive a disconnected subscription and upstream errors redact credentials", async () => {
  let release;
  const w = service(
    async () =>
      new Promise(
        (resolve) =>
          (release = () =>
            resolve(
              json({
                access_token: "new-access",
                refresh_token: "new-refresh",
                expires_in: 3600,
              }),
            )),
      ),
  );
  try {
    w.service.load().connections.chatgpt = {
      session: {
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: Date.now() - 1000,
      },
    };
    const pending = w.service.access("chatgpt");
    await new Promise((resolve) => setImmediate(resolve));
    w.service.disconnect("chatgpt");
    release();
    await assert.rejects(pending, /connexion a changé/);
    assert.equal(
      w.service.info().providers.find((p) => p.id === "chatgpt").connected,
      false,
    );
  } finally {
    w.close();
  }
  const e = service(async () =>
    json({ error: { message: "bad secret-key-from-fixture" } }, 401),
  );
  try {
    e.service.configure("codex", { key: "secret-key-from-fixture" });
    await assert.rejects(
      e.service.run({
        provider: "codex",
        model: "gpt-6.1-sol",
        prompt: "test",
      }),
      (error) =>
        !error.message.includes("secret-key-from-fixture") &&
        error.message.includes("masqué"),
    );
  } finally {
    e.close();
  }
});

test("Design filters unsupported modalities and preserves local image models", () => {
  const catalog = require("../lib/design/catalog");
  for (const id of [
    "text-embedding-3-large",
    "gpt-3.5-turbo", "gpt-4",
    "whisper-1",
    "gpt-realtime",
    "sora-2",
    "tts-1",
  ])
    assert.deepEqual(catalog.modes(id, catalog.get("codex")), []);
  assert.deepEqual(catalog.modes("gpt-image-1", catalog.get("codex")), [
    "image",
  ]);
  assert.deepEqual(catalog.modes("flux-dev", catalog.get("openrouter")), []);
  assert.deepEqual(catalog.modes("qwen-image", catalog.get("local")), [
    "image",
  ]);
  assert.deepEqual(
    catalog.modes("my-image", catalog.get("gguf"), ["my-image"]),
    ["image"],
  );
  const w = service();
  try {
    w.service.configure("codex", {
      availableModels: ["gpt-image-1", "text-embedding-3-large"],
    });
    assert.deepEqual(
      w.service
        .info()
        .providers.find((p) => p.id === "codex")
        .models.map((m) => m.id),
      ["gpt-image-1"],
    );
  } finally {
    w.close();
  }
});
