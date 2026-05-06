// ==========================================
// Point d'entrée — Lance le bot + le serveur web
// ==========================================
require('dotenv').config();

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

// Démarrer le serveur web après que le bot soit prêt
client.once('ready', () => {
    startServer(client, getBotState);
});
