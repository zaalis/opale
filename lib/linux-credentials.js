"use strict";
// Independent Linux profile key; no Windows account material is copied.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const appdata = require("./appdata");
function key() {
  const file = path.join(appdata.homeDir(), "credentials.key");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    const bytes = fs.readFileSync(file);
    if (bytes.length !== 32) throw Error("Invalid Linux profile key");
    return bytes;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const bytes = crypto.randomBytes(32);
    try {
      fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
      return bytes;
    } catch (e) {
      if (e.code === "EEXIST") return key();
      throw e;
    }
  }
}
function seal(bytes) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function open(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 28) throw Error("Invalid encrypted credentials");
  const cipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    bytes.subarray(0, 12),
  );
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
}
module.exports = { seal, open };
