"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { Updater } = require("../lib/updater");
function fixture({ badHash = false, same = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "opale-update-"));
  const bytes = Buffer.concat([
      Buffer.from([0x1f, 0x8b]),
      Buffer.alloc(4096, 7),
    ]),
    buildId = "b".repeat(64);
  const manifest = {
    schema: 1,
    file: "Opale_0.2.0_linux-amd64.tar.gz",
    version: "0.2.0",
    buildId,
    bytes: bytes.length,
    sha256: badHash
      ? "0".repeat(64)
      : crypto.createHash("sha256").update(bytes).digest("hex"),
  };
  const urls = [];
  const updater = new Updater({
    home,
    installed: true,
    buildId: same ? buildId : "a".repeat(64),
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("/commits/"))
        return Response.json({ sha: "c".repeat(40) });
      if (url.includes("/contents/"))
        return Response.json({
          content: Buffer.from(JSON.stringify(manifest)).toString("base64"),
        });
      return new Response(bytes);
    },
  });
  return {
    updater,
    home,
    bytes,
    urls,
    close() {
      updater.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
test("Linux updater downloads a pinned Linux branch package and validates its hash before ready", async () => {
  const f = fixture();
  try {
    const [a, b] = await Promise.all([f.updater.check(), f.updater.check()]);
    assert.equal(a.phase, "ready");
    assert.equal(b.percent, 100);
    assert.equal(f.urls.length, 3);
    assert.ok(f.urls[0].endsWith("/commits/Linux"));
    assert.ok(f.urls[1].includes("update-linux-amd64.json"));
    assert.ok(f.urls[2].includes("c".repeat(40)));
    assert.deepEqual(fs.readFileSync(f.updater.path), f.bytes);
  } finally {
    f.close();
  }
});
test("Linux updater rejects a corrupted download and does not offer installation", async () => {
  const f = fixture({ badHash: true });
  try {
    assert.equal((await f.updater.check()).phase, "error");
    assert.equal(fs.existsSync(f.updater.path), false);
    assert.throws(() => f.updater.apply(), /prête/);
  } finally {
    f.close();
  }
});
test("Linux updater does not download the already installed build", async () => {
  const f = fixture({ same: true });
  try {
    assert.equal((await f.updater.check()).phase, "current");
    assert.equal(f.urls.length, 2);
  } finally {
    f.close();
  }
});

test("Linux updater reuses a verified cached download and rechecks it before install", async () => {
  const f = fixture();
  try {
    await f.updater.check();
    f.updater.set({ phase: "idle" });
    await f.updater.check();
    assert.equal(f.urls.length, 5, "Second check reads metadata only");
    fs.writeFileSync(f.updater.path, "changed");
    assert.throws(() => f.updater.apply(), /changé/);
  } finally {
    f.close();
  }
});
