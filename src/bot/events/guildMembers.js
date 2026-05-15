// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
// MODIFIE CHANTIER 6 - 14/05/2026 - events membres Discord externalises

function registerGuildMemberEvents(client, deps) {
    const {
        CONFIG,
        hasProtectedRole,
        startWelcomeFlow,
    } = deps;

    client.on('guildMemberAdd', async (member) => {
        if (member.user.bot) return;

        // Auto-attribution de rôles spécifiques (pour des utilisateurs précis listés dans AUTO_ROLE_USERS)
        const autoRoleId = CONFIG.AUTO_ROLE_USERS[member.id];
        if (autoRoleId) {
            try {
                const role = member.guild.roles.cache.get(autoRoleId);
                if (role) {
                    await member.roles.add(role);
                    log.info(`🎯 Auto-rôle attribué à ${member.user.tag} : ${role.name}`);
                }
            } catch (e) {
                log.error(`❌ Erreur auto-rôle ${member.user.tag}:`, e.message);
            }
            return;
        }

        // VIP → rôle direct
        if (CONFIG.VIP_USERS.includes(member.id)) {
            try {
                const role = member.guild.roles.cache.get(CONFIG.ROLES.VIP_ROLE);
                if (role) await member.roles.add(role);
            } catch {}
            return;
        }

        if (hasProtectedRole(member)) {
            log.info(`ROLE PROTEGE: ${member.user.tag} a rejoint - accueil ignore`);
            return;
        }

        log.info(`WELCOME: ${member.user.tag} a rejoint - lancement de la procedure d'accueil`);
        await startWelcomeFlow(member);
    });
}

module.exports = {
    registerGuildMemberEvents,
};
