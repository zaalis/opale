"use strict";
const { VaultError } = require("./vault");

// macOS has no published update channel yet. The button stays hidden, and a
// check never contacts the network or offers a Linux or Windows package.
class Updater {
  constructor() {
    this.state = { phase: "idle", percent: 0, supported: false };
  }
  info() {
    return { ...this.state };
  }
  check() {
    return Promise.resolve(this.info());
  }
  apply() {
    throw new VaultError("Aucune mise à jour macOS n’est prête à installer.", 409);
  }
  close() {}
}

module.exports = { Updater };
