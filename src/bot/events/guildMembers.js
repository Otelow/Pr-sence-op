// FINAL D2 16/05/2026 ? logs bot via pino
const log = require('../../shared/logger');
// FINAL POST-STAB F 17/05/2026 — invalidation cache membres web
const { invalidateMembersCache } = require('../../web/services/membersCache');
// MODIFIE CHANTIER 6 - 14/05/2026 - events membres Discord externalises

function registerGuildMemberEvents(client, deps) {
    const {
        CONFIG,
        hasProtectedRole,
        startWelcomeFlow,
    } = deps;

    client.on('guildMemberAdd', async (member) => {
        invalidateMembersCache();
        if (member.user.bot) return;

        if (hasProtectedRole(member)) {
            log.info(`ROLE PROTEGE: ${member.user.tag} a rejoint - accueil ignore`);
            return;
        }

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
        }

        // VIP → rôle direct
        if (CONFIG.VIP_USERS.includes(member.id)) {
            try {
                const role = member.guild.roles.cache.get(CONFIG.ROLES.VIP_ROLE);
                if (role) await member.roles.add(role);
            } catch {}
        }

        log.info(`WELCOME: ${member.user.tag} a rejoint - attribution directe des roles`);
        await startWelcomeFlow(member);
        invalidateMembersCache();
    });

    client.on('guildMemberUpdate', () => {
        invalidateMembersCache();
    });

    client.on('guildMemberRemove', () => {
        invalidateMembersCache();
    });
}

module.exports = {
    registerGuildMemberEvents,
};
