"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
if (process.argv[2] === "prepare") {
  const hash = crypto.createHash("sha256");
  const walk = (dir) => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["webview2"].includes(entry.name)) walk(name);
      } else if (!/build-info\.json$|\.(obj|exe|lib|dll|pdb|res)$/.test(name)) {
        hash.update(name.replaceAll("\\", "/"));
        hash.update(fs.readFileSync(name));
      }
    }
  };
  for (const dir of ["lib", "interface", "shared", "native"]) walk(dir);
  for (const file of ["server.js", "package.json"])
    hash.update(fs.readFileSync(file));
  fs.writeFileSync(
    "lib/build-info.json",
    JSON.stringify({ buildId: hash.digest("hex"), builtAt: Date.now() }),
  );
} else {
  const bytes = fs.readFileSync(process.argv[2] || "dist/Opale-Setup.exe");
  fs.writeFileSync(
    "dist/update.json",
    JSON.stringify(
      {
        schema: 1,
        version: require("../package.json").version,
        buildId: require("../lib/build-info.json").buildId,
        builtAt: require("../lib/build-info.json").builtAt,
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
}
