// STABILISATION 15/05/2026 — corrections sécurité et persistance
// ==========================================
// Point d'entrée — Lance le bot + le serveur web
// ==========================================
require('dotenv').config();

const config = require('./src/shared/config');

if ((config.isProduction || config.isRailway) && !process.env.SESSION_SECRET) {
    console.error('❌ SESSION_SECRET non défini en production — refus de démarrer');
    process.exit(1);
}

const REQUIRED_ENV = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'SESSION_SECRET',
];

const missingEnv = REQUIRED_ENV.filter(name => !process.env[name]);
if (missingEnv.length) {
    console.error(`Variables d'environnement manquantes: ${missingEnv.join(', ')}`);
    process.exit(1);
}

const { client, getBotState } = require('./bot.js');
const { startServer } = require('./server.js');

// Le dashboard doit rester disponible meme si Discord met du temps a se connecter.
startServer(client, getBotState);

client.once('ready', () => {
    console.log('Bot Discord pret, dashboard deja demarre.');
});
