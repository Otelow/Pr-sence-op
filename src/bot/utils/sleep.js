// MODIFIÉ CHANTIER 6 — 14/05/2026 — helper sleep isolé
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { sleep };
