'use strict';

// Per-user application data: the list of known vaults, the local API token and
// the two small files other programs read to find a running Opale.
//   instance.json  present only while Opale runs (port, token, open vault)
//   install.json   how to start Opale again (written on every launch)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const platform = require('./platform.js');

function homeDir() {
  if (process.env.OPALE_HOME) return path.resolve(process.env.OPALE_HOME);
  return path.join(platform.configRoot(), 'Opale');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}

// Write through a temporary file so a crash never leaves a half-written file.
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

const files = () => {
  const home = homeDir();
  return { home, config: path.join(home, 'opale.json'), instance: path.join(home, 'instance.json'), install: path.join(home, 'install.json') };
};

function loadConfig() {
  const config = readJson(files().config, {}) || {};
  if (!Array.isArray(config.vaults)) config.vaults = [];
  if (typeof config.token !== 'string' || !/^[a-f0-9]{64}$/.test(config.token)) config.token = crypto.randomBytes(32).toString('hex');
  return config;
}
function saveConfig(config) { writeJson(files().config, config); }

function rememberVault(config, root) {
  const key = platform.pathKey(root);
  config.vaults = config.vaults.filter((vault) => vault && typeof vault.path === 'string' && platform.pathKey(vault.path) !== key);
  config.vaults.unshift({ path: root, name: path.basename(root), openedAt: Date.now() });
  config.vaults = config.vaults.slice(0, 24);
  config.lastVault = root;
}
function forgetVault(config, root) {
  const key = platform.pathKey(root || '');
  config.vaults = config.vaults.filter((vault) => platform.pathKey(vault.path) !== key);
  if (config.lastVault && platform.pathKey(config.lastVault) === key) config.lastVault = '';
}

function writeInstance(info) { writeJson(files().instance, info); }
function clearInstance() {
  try {
    const current = readJson(files().instance, null);
    if (!current || current.pid === process.pid) fs.rmSync(files().instance, { force: true });
  } catch {}
}
function writeInstall(info) { try { writeJson(files().install, info); } catch {} }

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

module.exports = { homeDir, files, readJson, writeJson, loadConfig, saveConfig, rememberVault, forgetVault, writeInstance, clearInstance, writeInstall, pidAlive };
