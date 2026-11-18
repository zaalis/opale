"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Updater } = require("../lib/updater");

test("macOS updater stays idle and does not look for a Linux package", async () => {
  let called = false;
  const updater = new Updater({
    installed: true,
    fetchImpl: async () => {
      called = true;
      throw new Error("network");
    },
  });
  try {
    const info = await updater.check();
    assert.equal(info.supported, false);
    assert.equal(info.phase, "idle");
    assert.equal(called, false);
    assert.throws(() => updater.apply(), /macOS/);
  } finally {
    updater.close();
  }
});
