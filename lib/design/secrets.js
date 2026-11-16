"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const appdata = require("../appdata.js");
const { VaultError } = require("../vault.js");

function dpapi(value, decrypt) {
  const action = decrypt ? "Unprotect" : "Protect";
  const script = `Add-Type -AssemblyName System.Security; $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $result = [Security.Cryptography.ProtectedData]::${action}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      input: value,
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0 || !result.stdout.trim())
    throw new VaultError(
      "Windows n’a pas pu protéger ou lire les identifiants Opal Design. Réenregistrez-les depuis les paramètres sur ce compte Windows.",
      500,
      "design-credentials",
    );
  return result.stdout.trim();
}

function load(file) {
  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new VaultError(
      "Les identifiants Opal Design enregistrés sont illisibles. Réenregistrez-les dans les paramètres.",
      500,
      "design-credentials",
    );
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    throw new VaultError(
      "La configuration Opal Design enregistrée est invalide. Réenregistrez-la dans les paramètres.",
      500,
      "design-credentials",
    );
  if (stored.protection === "linux-aes-gcm")
    return JSON.parse(
      require("../linux-credentials").open(stored.payload).toString("utf8"),
    );
  if (stored.protection === "windows-dpapi") {
    if (process.platform !== "win32")
      throw new VaultError(
        "Cette connexion Opal Design appartient à un compte Windows. Configurez Opal Design sur cet ordinateur.",
        409,
        "design-credentials",
      );
    try {
      return JSON.parse(
        Buffer.from(dpapi(stored.payload, true), "base64").toString("utf8"),
      );
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError(
        "Les identifiants Opal Design enregistrés sont illisibles. Réenregistrez-les dans les paramètres.",
        500,
        "design-credentials",
      );
    }
  }
  return stored;
}

function save(file, data) {
  appdata.writeJson(
    file,
    process.platform === "win32"
      ? {
          protection: "windows-dpapi",
          payload: dpapi(
            Buffer.from(JSON.stringify(data)).toString("base64"),
            false,
          ),
        }
      : {
          protection: "linux-aes-gcm",
          payload: require("../linux-credentials").seal(
            Buffer.from(JSON.stringify(data)),
          ),
        },
  );
}

module.exports = { load, save };
