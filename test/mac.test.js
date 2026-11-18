"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const platform = require("../lib/platform.js");

test("the macOS edition names Finder and looks for Opale.app", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../interface/js/platform.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "../lib/platform.js"), "utf8");
  assert.match(ui, /PLATFORM = 'mac'/);
  assert.match(ui, /le Finder/);
  assert.match(ui, /la Corbeille/);
  assert.match(server, /Opale\.app', 'Contents', 'MacOS', 'Opale'/);
  if (!platform.MAC) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opale-mac-shell-"));
  try {
    const exe = path.join(root, "dist", "Opale.app", "Contents", "MacOS");
    fs.mkdirSync(exe, { recursive: true });
    const file = path.join(exe, "Opale");
    fs.writeFileSync(file, "shell");
    assert.equal(platform.findShell(root), file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("macOS profile key seals and rejects a tampered payload", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opale-mac-key-"));
  const previous = process.env.OPALE_HOME;
  process.env.OPALE_HOME = home;
  try {
    const creds = require("../lib/mac-credentials");
    const sealed = creds.seal(Buffer.from("original"));
    assert.equal(creds.open(sealed).toString(), "original");
    const changed = Buffer.from(sealed, "base64");
    changed[changed.length - 1] ^= 1;
    assert.throws(() => creds.open(changed.toString("base64")));
    if (process.platform === "darwin") {
      const secrets = require("../lib/design/secrets");
      const file = path.join(home, "design.json");
      secrets.save(file, { key: "local-test-secret" });
      const stored = fs.readFileSync(file, "utf8");
      assert.equal(stored.includes("local-test-secret"), false);
      assert.match(stored, /mac-aes-gcm/);
      assert.equal(secrets.load(file).key, "local-test-secret");
      assert.equal(fs.statSync(path.join(home, "credentials.key")).mode & 0o777, 0o600);
    }
  } finally {
    if (previous === undefined) delete process.env.OPALE_HOME;
    else process.env.OPALE_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("exact link spelling resolves two files with different case", () => {
  const Meta = require("../shared/meta.js");
  const resolver = Meta.buildResolver(["Note.md", "note.md"]);
  assert.equal(resolver.resolve("Note", null), "Note.md");
  assert.equal(resolver.resolve("note", null), "note.md");
});

test("this edition compares paths without case, as macOS does", { skip: process.platform === "linux" }, () => {
  assert.equal(platform.pathKey("/Users/Notes"), platform.pathKey("/users/notes"));
});
