// BOARD ARMES 17/05/2026 — commande refresh board armes
// MODIFIÉ CHANTIER 6 — 14/05/2026 — définitions slash commands isolées
// QUICK WINS 5 18/05/2026 — commande slash stats hebdo
const { SlashCommandBuilder } = require('discord.js');

function buildSlashCommands() {
    return [
        new SlashCommandBuilder().setName('qg').setDescription('🚨 Appel au QG'),
        new SlashCommandBuilder().setName('garage').setDescription('🚨 Appel au Garage Hood'),
        new SlashCommandBuilder().setName('alignement').setDescription('🚨 Demande d\'alignement'),
        new SlashCommandBuilder().setName('tir').setDescription('🚨 Arrêter de tirer'),
        new SlashCommandBuilder().setName('position').setDescription('🚨 Prendre des positions'),
        new SlashCommandBuilder().setName('defense').setDescription('🚨 Défense du laboratoire'),
        new SlashCommandBuilder().setName('weed').setDescription('🚨 Alerte weed'),
        new SlashCommandBuilder().setName('traitement-weed').setDescription('🚨 Traitement de la weed'),
        new SlashCommandBuilder().setName('yellowjack').setDescription('🚨 Rassemblement Yellow Jack'),
        new SlashCommandBuilder().setName('megamall').setDescription('🚨 Rassemblement parking Mega Mall'),
        new SlashCommandBuilder().setName('parking5').setDescription('🚨 Rassemblement Parking 5 Madrazo'),
        new SlashCommandBuilder().setName('ile').setDescription('🚨 Rassemblement près de l\'Ile'),
        new SlashCommandBuilder().setName('trash').setDescription('🚨 Avertissement trash'),
        new SlashCommandBuilder().setName('radio').setDescription('📻 Nouvelle fréquence radio'),
        new SlashCommandBuilder().setName('presence-test').setDescription('🧪 Test 1ère présence OP'),
        new SlashCommandBuilder().setName('presence-test2').setDescription('🧪 Test 2ème présence OP'),
        new SlashCommandBuilder().setName('presence2').setDescription('📋 Envoie la 2ème présence OP (sans relances)'),
        new SlashCommandBuilder().setName('absence').setDescription('📋 Panneau suivi présences/absences'),
        new SlashCommandBuilder()
            .setName('presence-edit')
            .setDescription('✏️ Modifier la liste du message de présence')
            .addStringOption(o => o.setName('liste').setDescription('Sépare par / — Ex: Armes / Eau / Pochons').setRequired(false)),
        new SlashCommandBuilder()
            .setName('clear')
            .setDescription('🧹 Supprime les messages du bot')
            .addIntegerOption(o => o.setName('nombre').setDescription('Nombre (défaut 100)').setRequired(false)),
        new SlashCommandBuilder()
            .setName('clearmessage')
            .setDescription('🧹 Supprime X messages')
            .addIntegerOption(o => o.setName('nombre').setDescription('Nombre').setRequired(true)),
        new SlashCommandBuilder()
            .setName('annonce')
            .setDescription('📢 Annonce avec mention')
            .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true))
            .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),
        new SlashCommandBuilder().setName('presence-force').setDescription('🔄 Force le démarrage de la présence OP (si redéployé en cours)'),
        new SlashCommandBuilder().setName('panel').setDescription('🎮 Ouvrir le panneau de contrôle (rappels programmés)'),
        new SlashCommandBuilder().setName('clips-backfill').setDescription('Lancer le scan historique des clips du forum'),
        new SlashCommandBuilder().setName('clips-backfill-status').setDescription('Voir l etat du scan historique des clips'),
        new SlashCommandBuilder().setName('board-armes-refresh').setDescription('Rafraîchir manuellement la board armes live'),
        new SlashCommandBuilder().setName('stats-hebdo-now').setDescription('Publier le bilan hebdomadaire maintenant'),
    ];
}

module.exports = {
    buildSlashCommands,
};
