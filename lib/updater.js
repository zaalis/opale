"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { VaultError } = require("./vault");
const appdata = require("./appdata");
let build = { buildId: "development" };
try {
  build = require("./build-info.json");
} catch {}
const ROOT = "https://api.github.com/repos/zaalis/opale";
class Updater {
  constructor({
    home = appdata.homeDir(),
    fetchImpl = fetch,
    installed = !!process.env.OPALE_SHELL_EXE,
    buildId = build.buildId,
    builtAt = build.builtAt || 0,
    launch,
  } = {}) {
    this.home = path.join(home, "updates");
    this.fetch = fetchImpl;
    this.installed = installed;
    this.buildId = buildId;
    this.builtAt = builtAt;
    this.launch = launch;
    this.state = {
      phase: "idle",
      percent: 0,
      supported: process.platform === "linux" && installed,
    };
    this.path = path.join(this.home, "Opale-Update.tar.gz");
  }
  info() {
    return { ...this.state };
  }
  set(patch) {
    Object.assign(this.state, patch);
  }
  async json(url) {
    const response = await this.fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Opale-Linux-Updater",
      },
      signal: this.controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw Error(`GitHub indisponible (${response.status}).`);
    return response.json();
  }
  check() {
    if (this.pending) return this.pending;
    if (
      !this.state.supported ||
      this.state.phase === "ready" ||
      this.state.phase === "installing"
    )
      return Promise.resolve(this.info());
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller.abort(), 5 * 60 * 1000);
    timeout.unref?.();
    this.pending = this.perform()
      .catch((error) => this.set({ phase: "error", error: error.message }))
      .then(() => this.info())
      .finally(() => {
        clearTimeout(timeout);
        this.pending = null;
      });
    return this.pending;
  }
  async perform() {
    this.set({ phase: "checking", percent: 0, error: "" });
    const head = await this.json(`${ROOT}/commits/Linux`);
    if (!head || !/^[a-f0-9]{40}$/.test(head.sha))
      throw Error("Branche main inaccessible.");
    const entry = await this.json(
      `${ROOT}/contents/dist/update-linux-${process.arch === "arm64" ? "arm64" : "amd64"}.json?ref=${head.sha}`,
    );
    if (!entry) {
      this.set({
        phase: "current",
        note: "Aucune mise à jour Linux publiée.",
      });
      return;
    }
    let manifest = JSON.parse(
      Buffer.from(entry.content || "", "base64").toString("utf8"),
    );
    if (
      manifest.schema !== 1 ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      !/^[a-f0-9]{64}$/.test(manifest.buildId) ||
      !Number.isSafeInteger(manifest.bytes) ||
      manifest.bytes < 1000 ||
      manifest.bytes > 500 * 1024 * 1024
    )
      throw Error("Manifeste de mise à jour invalide.");
    this.kind = "archive";
    if (process.env.OPALE_SHELL_EXE) {
      try {
        fs.accessSync(
          path.dirname(process.env.OPALE_SHELL_EXE),
          fs.constants.W_OK,
        );
      } catch {
        if (!manifest.deb)
          throw Error("Paquet système absent de cette publication.");
        manifest = { ...manifest, ...manifest.deb };
        this.kind = "deb";
      }
    }
    this.path = path.join(
      this.home,
      this.kind === "deb" ? "Opale-Update.deb" : "Opale-Update.tar.gz",
    );
    if (
      !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      !Number.isSafeInteger(manifest.bytes) ||
      manifest.bytes < 1000 ||
      manifest.bytes > 500 * 1024 * 1024
    )
      throw Error("Paquet Linux invalide.");
    if (!/^Opale_[A-Za-z0-9_.-]+\.(?:tar\.gz|deb)$/.test(manifest.file || ""))
      throw Error("Nom du paquet Linux invalide.");
    if (
      manifest.buildId === this.buildId ||
      (Number.isSafeInteger(manifest.builtAt) &&
        manifest.builtAt <= this.builtAt)
    ) {
      this.set({ phase: "current", note: "Opale est à jour." });
      return;
    }
    fs.mkdirSync(this.home, { recursive: true });
    this.manifest = manifest;
    this.set({
      phase: "downloading",
      commit: head.sha,
      percent: 0,
      version: manifest.version,
    });
    if (fs.existsSync(this.path)) {
      const cached = fs.readFileSync(this.path);
      if (
        cached.length === manifest.bytes &&
        crypto.createHash("sha256").update(cached).digest("hex") ===
          manifest.sha256
      ) {
        this.set({ phase: "ready", percent: 100 });
        return;
      }
    }
    const url = `https://raw.githubusercontent.com/zaalis/opale/${head.sha}/dist/${manifest.file}`;
    const response = await this.fetch(url, { signal: this.controller.signal });
    if (!response.ok || !response.body)
      throw Error("Téléchargement Linux indisponible.");
    const partial = `${this.path}.part`,
      handle = fs.openSync(partial, "w");
    const hash = crypto.createHash("sha256");
    let received = 0;
    let prefix = Buffer.alloc(0);
    try {
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        received += bytes.length;
        if (received > manifest.bytes)
          throw Error("Taille de mise à jour incorrecte.");
        if (prefix.length < 2)
          prefix = Buffer.concat([prefix, bytes]).subarray(0, 2);
        hash.update(bytes);
        fs.writeSync(handle, bytes);
        this.set({
          percent: Math.min(99, Math.floor((received * 100) / manifest.bytes)),
        });
      }
    } finally {
      fs.closeSync(handle);
    }
    if (
      received !== manifest.bytes ||
      hash.digest("hex") !== manifest.sha256 ||
      (this.kind === "deb"
        ? prefix.toString() !== "!<"
        : prefix.toString("hex") !== "1f8b")
    )
      throw Error("La vérification du téléchargement a échoué.");
    fs.renameSync(partial, this.path);
    this.set({ phase: "ready", percent: 100 });
  }
  apply() {
    if (!this.state.supported || this.state.phase !== "ready")
      throw new VaultError("Aucune mise à jour prête à installer.", 409);
    const bytes = fs.readFileSync(this.path);
    if (
      crypto.createHash("sha256").update(bytes).digest("hex") !==
      this.manifest.sha256
    )
      throw new VaultError("Le fichier de mise à jour a changé.", 409);
    const shell = process.env.OPALE_SHELL_EXE;
    if (
      !shell ||
      !path.isAbsolute(shell) ||
      !/^opale$/i.test(path.basename(shell))
    )
      throw new VaultError(
        "Démarrez la version Linux pour installer la mise à jour.",
        409,
      );
    const directory = path.dirname(shell);
    const executable = path.join(directory, "opale-updater");
    const args = [
      path.join(directory, "opale-update-install"),
      this.path,
      String(process.env.OPALE_SHELL_PID || 0),
      String(process.pid),
      directory,
      this.manifest.sha256,
      this.kind,
      shell,
    ];
    this.set({ phase: "installing" });
    if (this.launch) return this.launch(executable, args);
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.once("error", (error) => {
        this.set({ phase: "ready" });
        reject(error);
      });
      child.once("spawn", () => {
        child.unref();
        resolve({ ok: true });
      });
    });
  }
  close() {
    this.controller?.abort();
    clearInterval(this.timer);
  }
}
module.exports = { Updater };
