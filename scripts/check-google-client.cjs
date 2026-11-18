'use strict';
// Fail the Windows build rather than silently ship an unusable Drive login.
const { builtinClient } = require('../lib/google.js');
const client = builtinClient();
if (!client || !client.clientSecret) {
  console.error('Client OAuth Google absent ou invalide : renseignez lib/google-client.json avant de compiler.');
  process.exitCode = 1;
} else console.log('Client OAuth Google valide et prêt pour le paquet.');
