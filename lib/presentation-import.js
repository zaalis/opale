"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { VaultError } = require("./vault.js");
let queue = Promise.resolve();
function convertPresentation(bytes, extension) {
  const task = queue.then(async () => {
    if (!["ppt", "pptx"].includes(extension))
      throw new VaultError(
        "Format PowerPoint non pris en charge.",
        400,
        "invalid",
      );

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opale-presentation-"));
    try {
      const input = path.join(dir, `presentation.${extension}`),
        output = path.join(dir, "presentation.pdf");
      fs.writeFileSync(input, bytes);
      const profile = require("node:url").pathToFileURL(
        path.join(dir, "profile"),
      ).href;
      const app = "/Applications/LibreOffice.app/Contents/MacOS/soffice";
      const command =
        process.platform === "darwin" && fs.existsSync(app) ? app : "soffice";
      await new Promise((resolve, reject) =>
        execFile(
          command,
          [
            `-env:UserInstallation=${profile}`,
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            dir,
            input,
          ],
          { timeout: 180000, maxBuffer: 1024 * 1024 },
          (error) =>
            error
              ? reject(
                  new VaultError(
                    "LibreOffice est requis pour convertir PowerPoint. Installez LibreOffice, ou importez le PDF.",
                    422,
                    "presentation-conversion",
                  ),
                )
              : resolve(),
        ),
      );
      if (!fs.existsSync(output))
        throw new VaultError(
          "LibreOffice ne peut pas convertir cette présentation.",
          422,
          "presentation-conversion",
        );
      return fs.readFileSync(output);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  queue = task.catch(() => {});
  return task;
}
module.exports = { convertPresentation };
