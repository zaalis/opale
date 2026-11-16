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
  const version = require("../package.json").version,
    build = require("../lib/build-info.json"),
    arch = process.argv[3] || "amd64";
  const describe = (file) => {
    const bytes = fs.readFileSync(path.join("dist", file));
    return {
      file,
      bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  };
  fs.writeFileSync(
    `dist/update-linux-${arch}.json`,
    JSON.stringify(
      {
        schema: 1,
        version,
        ...build,
        ...describe(`Opale_${version}_linux-${arch}.tar.gz`),
        deb: describe(`Opale_${version}_${arch}.deb`),
      },
      null,
      2,
    ) + "\n",
  );
}
