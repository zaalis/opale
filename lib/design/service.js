"use strict";
const path = require("path"),
  crypto = require("crypto");
const appdata = require("../appdata"),
  { VaultError } = require("../vault");
const secretStore = require("./secrets"),
  catalog = require("./catalog");
const { beginSignIn } = require("./accounts/chatgpt-sign-in");
const chatgpt = require("./accounts/chatgpt-subscription"),
  subscriptions = require("./accounts/account-subscriptions");
const fail = (message, status = 400) =>
  new VaultError(message, status, "design");
class DesignService {
  constructor({ home, fetchImpl = fetch, secrets = secretStore } = {}) {
    this.file = path.join(home || appdata.homeDir(), "design-connections.json");
    this.fetch = fetchImpl;
    this.secrets = secrets;
    this.data = null;
    this.flows = new Map();
    this.refreshing = new Map();
  }
  close() {
    for (const flow of this.flows.values()) flow.cancel?.();
    this.flows.clear();
  }
  load() {
    if (!this.data) this.data = this.secrets.load(this.file);
    this.data.connections ||= {};
    return this.data;
  }
  save() {
    this.secrets.save(this.file, this.data);
  }
  connection(id) {
    const provider = catalog.get(id);
    if (!provider) throw fail("Fournisseur inconnu.");
    return { provider, config: this.load().connections[id] || {} };
  }
  info() {
    return {
      providers: catalog.PROVIDERS.map((provider) => {
        const config = this.load().connections[provider.id] || {};
        const names = [
          ...new Set([
            ...(Array.isArray(config.availableModels) && !provider.local
              ? config.availableModels
              : [...(config.models || []), ...provider.models]),
            ...(config.imageModels || []),
          ]),
        ];
        return {
          ...provider,
          models: names
            .filter(
              (id) =>
                catalog.modes(id, provider, config.imageModels || []).length,
            )
            .map((id) => ({
              id,
              label: catalog.modelLabel(id),
              modes: catalog.modes(id, provider, config.imageModels || []),
            })),
          baseUrl: config.baseUrl || provider.baseUrl,
          configured: !!(
            config.key ||
            config.session ||
            (provider.keyless && (config.baseUrl || provider.baseUrl))
          ),
          keySet: !!config.key,
          connected: !!config.session,
          customModels: config.models || [],
          imageModels: config.imageModels || [],
          connectedAt: config.session?.connectedAt || "",
        };
      }),
    };
  }
  configure(id, input) {
    const { provider, config } = this.connection(id);
    const next = { ...config };
    if (input.baseUrl !== undefined && provider.editableUrl) {
      const url = catalog.normalizeBaseUrl(input.baseUrl);
      if (!url) throw fail("Adresse de serveur invalide.");
      if (
        new URL(url).protocol === "http:" &&
        !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
      )
        throw fail("Utilisez HTTPS, sauf pour un serveur sur cet ordinateur.");
      if (
        config.key &&
        config.baseUrl &&
        new URL(config.baseUrl).origin !== new URL(url).origin &&
        !String(input.key || "").trim()
      )
        delete next.key;
      next.baseUrl = url;
    }
    if (input.key !== undefined && String(input.key).trim()) {
      if (String(input.key).length > 16000) throw fail("Clé trop longue.");
      next.key = String(input.key).trim();
    }
    for (const key of ["models", "imageModels", "availableModels"])
      if (input[key] !== undefined) {
        if (!Array.isArray(input[key]))
          throw fail("Liste de modèles invalide.");
        next[key] = [
          ...new Set(
            input[key]
              .map((x) => String(x).trim())
              .filter((x) => x && x.length <= 200),
          ),
        ].slice(0, 5000);
      }
    this.load().connections[id] = next;
    this.save();
    return this.info();
  }
  disconnect(id) {
    this.connection(id);
    delete this.data.connections[id];
    for (const [key, flow] of this.flows)
      if (flow.id === id) {
        flow.cancel?.();
        this.flows.delete(key);
      }
    this.save();
    return this.info();
  }
  templates() {
    return {
      templates: appdata.readJson(
        path.join(path.dirname(this.file), "design-templates.json"),
        [],
      ),
    };
  }
  saveTemplate(input) {
    const graph = require("../../shared/design-graph");
    const board = require("../../shared/board");
    const name = String(input.name || "")
      .trim()
      .slice(0, 100);
    if (!name) throw fail("Donnez un nom à cet outil.");
    if (!Array.isArray(input.elements) || input.elements.length > 500)
      throw fail("Ce workflow doit contenir au plus 500 éléments.");
    const elements = input.elements
      .filter((e) => e && ["design", "connector"].includes(e.kind))
      .map((raw) => {
        const e = board.create(raw.kind, raw);
        if (e.kind === "design") {
          const d = e.data;
          e.data = {
            tool: d.tool,
            title: d.title || "",
            text: String(d.text || "").slice(0, 64000),
            provider: d.provider || "",
            model: d.model || "",
            params: d.params || {},
            file: "",
            maskFile: "",
            resultFile: "",
            resultText: "",
            resultType: "",
            versions: [],
            fingerprint: "",
          };
          if (!graph.TOOLS[d.tool])
            throw fail("Outil inconnu dans le workflow.");
        }
        return e;
      });
    const spatial = elements.filter((e) => e.kind !== "connector");
    const originX = Math.min(0, ...spatial.map((e) => e.x)),
      originY = Math.min(0, ...spatial.map((e) => e.y));
    for (const e of spatial) {
      e.x -= originX;
      e.y -= originY;
    }
    const doc = { elements };
    graph.plan(doc);
    for (const edge of graph.links(doc))
      graph.validateLink(doc, edge.from, edge.to, edge.port, edge.id);
    const items = this.templates().templates;
    const item = { id: crypto.randomUUID(), name, elements };
    items.push(item);
    appdata.writeJson(
      path.join(path.dirname(this.file), "design-templates.json"),
      items.slice(-100),
    );
    return item;
  }
  async start(id) {
    const { provider, config } = this.connection(id);
    if (!provider.oauth) throw fail("Ce fournisseur utilise une clé API.");
    for (const [key, flow] of this.flows)
      if (flow.expiresAt < Date.now()) {
        flow.cancel?.();
        this.flows.delete(key);
      }
    if (this.flows.size >= 8)
      throw fail("Terminez ou annulez une connexion en cours.");
    const flowId = crypto.randomUUID();
    if (provider.oauth === "chatgpt") {
      if (!this.data.hostId) {
        this.data.hostId = `urn:uuid:${crypto.randomUUID()}`;
        this.save();
      }
      const flow = await beginSignIn({
        hostId: this.data.hostId,
        previous: config.session,
        fetchImpl: this.fetch,
        onSession: (session) => {
          if (!this.flows.has(flowId)) throw fail("Connexion annulée.");
          this.data.connections[id] = {
            ...(this.data.connections[id] || {}),
            session,
          };
          this.save();
        },
      });
      this.flows.set(flowId, { ...flow, id, modern: true, lastPoll: 0 });
      return {
        flowId,
        verificationUrl: flow.verificationUrl,
        expiresAt: flow.expiresAt,
        interval: flow.interval,
      };
    }
    const flow = await subscriptions.start(provider.oauth, {
      fetchImpl: this.fetch,
    });
    this.flows.set(flowId, {
      ...flow,
      id,
      expiresAt: flow.expiresAt,
      lastPoll: 0,
    });
    return {
      flowId,
      userCode: flow.userCode,
      verificationUrl: flow.verificationUrl,
      expiresAt: flow.expiresAt,
      interval: flow.interval,
    };
  }
  async poll(id, flowId) {
    const flow = this.flows.get(flowId);
    if (!flow || flow.id !== id || flow.expiresAt < Date.now())
      throw fail("La demande de connexion a expiré.");
    if (flow.modern) {
      const status = flow.poll();
      if (status.status === "error")
        throw fail(status.error || "Connexion refusée.");
      if (status.status === "connected") {
        flow.cancel();
        this.flows.delete(flowId);
      }
      return status;
    }
    if (
      flow.polling ||
      Date.now() - flow.lastPoll < (flow.interval || 3) * 1000
    )
      return { status: "pending" };
    flow.lastPoll = Date.now();
    flow.polling = true;
    try {
      const { provider, config } = this.connection(id);
      const session =
        provider.oauth === "chatgpt"
          ? await chatgpt.pollDeviceCode(flow, { fetchImpl: this.fetch })
          : await subscriptions.poll(flow, { fetchImpl: this.fetch });
      if (!session) return { status: "pending" };
      if (this.flows.get(flowId) !== flow) throw fail("Connexion annulée.");
      this.data.connections[id] = { ...config, session };
      this.save();
      this.flows.delete(flowId);
      return { status: "connected" };
    } finally {
      flow.polling = false;
    }
  }
  cancel(flowId) {
    this.flows.get(flowId)?.cancel?.();
    this.flows.delete(flowId);
    return { ok: true };
  }
  async access(id) {
    const { provider, config } = this.connection(id);
    let session = config.session;
    if (provider.oauth) {
      if (!session)
        throw fail(
          "Connectez cet abonnement dans Paramètres → Opal Design.",
          401,
        );
      const needs =
        provider.oauth === "chatgpt"
          ? chatgpt.needsRefresh(session)
          : subscriptions.needsRefresh(session);
      if (needs) {
        if (!this.refreshing.has(id))
          this.refreshing.set(
            id,
            (async () => {
              const updated =
                provider.oauth === "chatgpt"
                  ? await chatgpt.refreshSession(session, {
                      fetchImpl: this.fetch,
                    })
                  : await subscriptions.refresh(session, {
                      fetchImpl: this.fetch,
                    });
              if (
                this.data.connections[id]?.session?.refreshToken !==
                  session.refreshToken ||
                this.data.connections[id]?.session?.accessToken !==
                  session.accessToken
              )
                throw fail(
                  "La connexion a changé pendant son renouvellement.",
                  401,
                );
              this.data.connections[id] = {
                ...this.data.connections[id],
                session: updated,
              };
              this.save();
              return updated;
            })().finally(() => this.refreshing.delete(id)),
          );
        session = await this.refreshing.get(id);
      }
    } else if (!provider.keyless && !config.key)
      throw fail("Renseignez une clé dans Paramètres → Opal Design.", 401);
    if (!provider.oauth && !(config.baseUrl || provider.baseUrl))
      throw fail(
        "Configurez l’adresse de ce fournisseur dans Paramètres → Opal Design.",
      );
    return {
      provider,
      config,
      session,
      key: config.key || "",
      base: (config.baseUrl || provider.baseUrl).replace(/\/+$/, ""),
    };
  }
  async json(url, options = {}) {
    const response = await this.fetch(url, { ...options, redirect: "error" });
    const raw = await response.text();
    if (raw.length > 50 * 1024 * 1024)
      throw fail(
        "La réponse du modèle dépasse la taille prise en charge.",
        413,
      );
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw fail("Le fournisseur a renvoyé une réponse illisible.", 502);
    }
    if (!response.ok)
      throw fail(
        String(
          data.error?.message ||
            data.error?.detail ||
            data.error ||
            `Le fournisseur refuse la requête (HTTP ${response.status}).`,
        ).slice(0, 1000),
        response.status,
      );
    return data;
  }
  async discover(id) {
    const a = await this.access(id);
    let ids = [];
    if (a.provider.oauth === "chatgpt") {
      const models = await chatgpt.listModels(a.session.accessToken, {
        fetchImpl: this.fetch,
        publicApi: a.session.transport === "public",
      });
      ids = (Array.isArray(models) ? models : models.models || []).map((m) =>
        typeof m === "string" ? m : m.id || m.slug,
      );
    } else if (a.provider.oauth) return this.info();
    else if (a.provider.protocol === "gemini") {
      const data = await this.json(`${a.base}/models?pageSize=1000`, {
        headers: { "x-goog-api-key": a.key },
      });
      ids = (data.models || []).map((m) => m.name.replace(/^models\//, ""));
    } else {
      const data = await this.json(`${a.base}/models`, {
        headers:
          a.provider.protocol === "anthropic"
            ? { "x-api-key": a.key, "anthropic-version": "2023-06-01" }
            : a.key
              ? { Authorization: `Bearer ${a.key}` }
              : {},
      });
      ids = (data.data || data.models || []).map((m) => m.id || m.name);
    }
    return this.configure(id, {
      availableModels: ids.filter(Boolean),
    });
  }
  async run(input, { signal, onDelta = () => {} } = {}) {
    const {
      provider: id,
      model,
      kind = "text",
      prompt = "",
      images = [],
      mask,
    } = input;
    if (
      !["text", "image"].includes(kind) ||
      !model ||
      String(model).length > 200
    )
      throw fail("Choisissez un modèle et un type de génération.");
    if (!String(prompt).trim()) throw fail("Ajoutez une consigne au nœud.");
    const a = await this.access(id);
    const allowed = catalog.modes(
      model,
      a.provider,
      a.config.imageModels || [],
    );
    if (!allowed.includes(kind))
      throw fail(
        "Ce modèle ne produit pas ce type de résultat. Choisissez un modèle compatible.",
      );
    const timeout = AbortSignal.timeout(180000),
      requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const json = (body) => JSON.stringify(body),
      auth = a.key ? { Authorization: `Bearer ${a.key}` } : {},
      headers = { ...auth, "Content-Type": "application/json" };
    try {
      if (a.provider.oauth) {
        const chat = {
          model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: String(prompt) },
                ...images.map((image) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:${image.mime};base64,${image.bytes.toString("base64")}`,
                  },
                })),
              ],
            },
          ],
          stream: true,
          max_tokens: 4096,
        };
        const response =
          a.provider.oauth === "chatgpt"
            ? await chatgpt.openResponseStream(
                a.session.accessToken,
                chatgpt.toResponsesRequest(chat, {
                  subscription: a.session.transport !== "public",
                  publicApi: a.session.transport === "public",
                  cacheScope: "opal-design",
                }),
                {
                  signal: requestSignal,
                  fetchImpl: this.fetch,
                  publicApi: a.session.transport === "public",
                },
              )
            : await subscriptions.openStream(
                a.provider.oauth,
                a.session.accessToken,
                chat,
                { signal: requestSignal, fetchImpl: this.fetch },
              );
        const reader = chatgpt.createSseReader();
        let text = "";
        const consume = (event) => {
          if (event.type === "error" || event.error)
            throw fail("Le fournisseur a interrompu la génération.", 502);
          const delta =
            event.type === "response.output_text.delta"
              ? event.delta
              : event.choices?.[0]?.delta?.content || event.delta?.text || "";
          if (typeof delta === "string" && delta) {
            text += delta;
            onDelta(delta);
          }
        };
        for await (const chunk of response.body)
          for (const event of reader.push(chunk)) consume(event);
        for (const event of reader.finish()) consume(event);
        if (!text) throw fail("Le modèle n’a renvoyé aucun texte.", 502);
        return { text };
      }
      if (a.provider.protocol === "gemini") {
        const parts = [
          { text: String(prompt) },
          ...images.map((image) => ({
            inlineData: {
              mimeType: image.mime,
              data: image.bytes.toString("base64"),
            },
          })),
        ];
        if (mask)
          parts.push(
            {
              text: "The additional image is the edit mask: white is editable, black must be preserved.",
            },
            {
              inlineData: {
                mimeType: mask.mime,
                data: mask.bytes.toString("base64"),
              },
            },
          );
        const data = await this.json(
          `${a.base}/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": a.key,
            },
            body: json({
              contents: [{ role: "user", parts }],
              generationConfig:
                kind === "image"
                  ? { responseModalities: ["TEXT", "IMAGE"] }
                  : { maxOutputTokens: 4096 },
            }),
            signal: requestSignal,
          },
        );
        const result = data.candidates?.[0]?.content?.parts || [];
        if (kind === "image") {
          const image = result.find((p) => p.inlineData || p.inline_data);
          const content = image?.inlineData || image?.inline_data;
          if (!content) throw fail("Ce modèle n’a renvoyé aucune image.", 502);
          return {
            bytes: Buffer.from(content.data, "base64"),
            mime: content.mimeType || content.mime_type,
          };
        }
        return { text: result.map((p) => p.text || "").join("") };
      }
      if (kind === "image") {
        let data;
        if (images.length && id === "grok") {
          // xAI edits use JSON, unlike OpenAI multipart edits.
          const references = [...images, ...(mask ? [mask] : [])].map(
            (image) => ({
              type: "image_url",
              url: `data:${image.mime};base64,${image.bytes.toString("base64")}`,
            }),
          );
          data = await this.json(`${a.base}/images/edits`, {
            method: "POST",
            headers,
            signal: requestSignal,
            body: json({
              model,
              prompt:
                String(prompt) +
                (mask
                  ? "\nThe last reference is a selection mask: white marks the region to edit, black marks the protected exterior. Return the edited first image, not the mask."
                  : ""),
              ...(references.length === 1
                ? { image: references[0] }
                : { images: references }),
              response_format: "b64_json",
            }),
          });
        } else if (images.length) {
          const body = new FormData();
          body.set("model", model);
          body.set("prompt", String(prompt));
          body.set("n", "1");
          const field = "image[]";
          for (const image of images)
            body.append(
              field,
              new Blob([image.bytes], { type: image.mime }),
              "reference.png",
            );
          if (mask)
            body.append(
              "mask",
              new Blob([mask.bytes], { type: mask.mime }),
              "mask.png",
            );
          data = await this.json(`${a.base}/images/edits`, {
            method: "POST",
            headers: auth,
            body,
            signal: requestSignal,
          });
        } else
          data = await this.json(`${a.base}/images/generations`, {
            method: "POST",
            headers,
            body: json({
              model,
              prompt: String(prompt),
              n: 1,
              ...(input.size ? { size: input.size } : {}),
            }),
            signal: requestSignal,
          });
        const image = data.data?.[0];
        if (image?.b64_json)
          return {
            bytes: Buffer.from(image.b64_json, "base64"),
            mime: "image/png",
          };
        if (image?.url)
          return {
            bytes: await require("../miro-media").download(
              image.url,
              0,
              25 * 1024 * 1024,
            ),
            mime: "image/png",
          };
        throw fail("Le modèle n’a renvoyé aucune image.", 502);
      }
      if (a.provider.id === "codex") {
        const content = [
          { type: "input_text", text: String(prompt) },
          ...images.map((image) => ({
            type: "input_image",
            image_url: `data:${image.mime};base64,${image.bytes.toString("base64")}`,
          })),
        ];
        const data = await this.json(`${a.base}/responses`, {
          method: "POST",
          headers,
          body: json({
            model,
            input: [{ role: "user", content }],
            max_output_tokens: 4096,
            store: false,
          }),
          signal: requestSignal,
        });
        const text =
          data.output_text ||
          (data.output || [])
            .flatMap((item) => item.content || [])
            .map((item) => item.text || "")
            .join("");
        if (!text) throw fail("Le modèle n’a renvoyé aucun texte.", 502);
        return { text };
      }
      const imagesContent = images.map((image) => ({
        type: "image_url",
        image_url: {
          url: `data:${image.mime};base64,${image.bytes.toString("base64")}`,
        },
      }));
      if (a.provider.protocol === "anthropic") {
        const data = await this.json(`${a.base}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": a.key,
            "anthropic-version": "2023-06-01",
          },
          body: json({
            model,
            max_tokens: 4096,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: String(prompt) },
                  ...images.map((image) => ({
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: image.mime,
                      data: image.bytes.toString("base64"),
                    },
                  })),
                ],
              },
            ],
          }),
          signal: requestSignal,
        });
        return { text: (data.content || []).map((p) => p.text || "").join("") };
      }
      const data = await this.json(`${a.base}/chat/completions`, {
        method: "POST",
        headers,
        body: json({
          model,
          messages: [
            {
              role: "user",
              content: imagesContent.length
                ? [{ type: "text", text: String(prompt) }, ...imagesContent]
                : String(prompt),
            },
          ],
          stream: false,
        }),
        signal: requestSignal,
      });
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw fail("Le modèle n’a renvoyé aucun texte.", 502);
      return { text: typeof text === "string" ? text : JSON.stringify(text) };
    } catch (error) {
      for (const secret of [
        a.key,
        a.session?.accessToken,
        a.session?.refreshToken,
      ])
        if (secret && error.message)
          error.message = error.message
            .split(secret)
            .join("[identifiant masqué]");
      throw error;
    }
  }
}
module.exports = { DesignService };
