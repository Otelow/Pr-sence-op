// ==========================================
// Point d'entrée — Lance le bot + le serveur web
// ==========================================
require('dotenv').config();

const { client, getBotState } = require('./bot.js');
const { startServer } = require('./server.js');

// Démarrer le serveur web après que le bot soit prêt
client.once('ready', () => {
    startServer(client, getBotState);
});
