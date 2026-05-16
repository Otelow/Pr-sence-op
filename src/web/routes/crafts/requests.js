// HISTORIQUE CRAFT 16/05/2026 — protection des crafts finalisés permanents
// FINAL POST-STAB A 17/05/2026 ? pino backend
const log = require('../../../shared/logger');
// FIX 15/05/2026 — justificatif Discord craft manuel
// STABILISATION 15/05/2026 — corrections sécurité et persistance
// MODIFIE CHANTIER 6 - 14/05/2026 - routes demandes craft extraites
// AUDIT HOOKS 16/05/2026 — demandes craft tracées dans audit_log
const {
    ADMIN_USER_ID,
    ADMIN_ROLE_ID,
    CRAFT_VALIDATION_ROLES,
    MY_WEAPONS_DELETE_ROLE,
} = require('../../../shared/permissions');
const { emitRealtime } = require('../../../shared/realtime');
const { audit } = require('../../../shared/auditLog');

const MYWEAPONS_AUTHORIZED_CRAFTERS = [
    { id: 'otelow', name: 'Otelow' },
    { id: 'ney', name: 'Ney' },
    { id: 'le-h', name: 'Le H' },
];

function parseId(v, max = 2_000_000) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

function resolveAuthorizedCrafter(craftedById, craftedByName) {
    const rawId = String(craftedById || '').trim().toLowerCase();
    const rawName = String(craftedByName || '').trim().toLowerCase();
    return MYWEAPONS_AUTHORIZED_CRAFTERS.find(c =>
        c.id.toLowerCase() === rawId ||
        c.name.toLowerCase() === rawName ||
        c.name.toLowerCase() === rawId
    ) || null;
}

function registerCraftRequestRoutes(app, deps) {
    const {
        requireAuth,
        botClient,
        botState,
        db,
        isCraftManager,
        sweepRequestsForMissingMembers,
        getRequests,
        getWeaponSaleStateForCraftRequest,
        getRequest,
        normalizeCraftRequestType,
        getWeapon,
        insertRequest,
        updateRequestCraft,
        invalidateCraftCaches,
        deleteCraftRequestCleanly,
        deleteRequest,
        markRequestPosted,
    } = deps;

    async function fetchDiscordChannel(channelId, label) {
        if (!botClient) {
            log.error(`[discord] ${label}: botClient indisponible`);
            return null;
        }
        const cached = botClient.channels.cache.get(channelId);
        if (cached) return cached;
        try {
            return await botClient.channels.fetch(channelId);
        } catch (e) {
            log.error(`[discord] ${label}: salon ${channelId} introuvable ou inaccessible: ${e.message}`);
            return null;
        }
    }
    app.get('/api/crafts/requests', requireAuth, (req, res) => {
        try {
            if (req.query.view === 'board' && !isCraftManager(req.session.user)) {
                return res.status(403).json({ requests: [], error: 'Accès réservé aux hauts gradés' });
            }
            sweepRequestsForMissingMembers().catch(e => log.error('[craft] vérification membres absents:', e.message));
            const requests = getRequests(req.query.status, {
                productionOnly: req.query.view === 'board',
                hideTests: !isCraftManager(req.session.user),
            });
            const list = requests.map(r => ({
                ...r,
                weapon_image_url: r.weapon_image ? `/crafts/images/${r.weapon_image}` : null,
                sale_state: getWeaponSaleStateForCraftRequest(r).state,
                has_plan: !!r.has_plan, has_money: !!r.has_money, crafted: !!r.crafted,
            }));
            res.json({ requests: list });
        } catch (e) { res.json({ requests: [], error: e.message }); }
    });

    // Salons crafts
    const CRAFT_REQUEST_CHANNEL = '1501593802014720061';
    const CRAFT_STATUS_CHANNEL = '1496977220097282290';
    const CRAFT_PLAN_PROVIDER_ROLE = '1490361524408291459';
    const moneyLabel = (amount) => Number(amount) === 0 ? 'Gratuit' : (amount ? `${Number(amount).toLocaleString('fr-FR')}$` : 'N/A');

    // Helper : créer/éditer le message de demande de craft sur Discord
    async function postOrUpdateCraftRequestMessage(requestId) {
        try {
            const fullReq = getRequest(requestId);
            if (!fullReq) return;

            const channel = await fetchDiscordChannel(CRAFT_REQUEST_CHANNEL, 'CRAFT_REQUEST');
            if (!channel) return;

            const statusMeta = {
                pending: {
                    icon: '🟧',
                    label: 'Demande en attente',
                    color: 0xff8c00,
                    description: 'Demande enregistrée. Les pré-requis sont en cours de vérification.',
                },
                waiting_materials: {
                    icon: '📦',
                    label: 'En attente des matières premières',
                    color: 0xf59e0b,
                    description: 'Commande mise en attente : les matières premières doivent être fournies avant la construction.',
                },
                in_progress: {
                    icon: '🔨',
                    label: 'Ton arme est en cours de construction',
                    color: 0xfb923c,
                    description: 'La construction est lancée. Ton arme est en cours de construction.',
                },
                crafted: {
                    icon: '✅',
                    label: 'Craft terminé',
                    color: 0x22c55e,
                    description: 'L’arme est prête. La vente peut maintenant être renseignée.',
                },
                completed: {
                    icon: '✅',
                    label: 'Transaction clôturée',
                    color: 0x22c55e,
                    description: 'Le craft et la vente sont terminés. Le dossier est clôturé.',
                },
                rejected: {
                    icon: '⛔',
                    label: 'Demande refusée',
                    color: 0xef4444,
                    description: 'La demande a été refusée. Contacte un haut gradé si une précision est nécessaire.',
                },
            };
            const meta = statusMeta[fullReq.status] || statusMeta.pending;
            const prereqText = `Plan : ${fullReq.has_plan ? 'validé' : 'manquant'}\nFonds : ${fullReq.has_money ? 'validés' : 'manquants'}`;
            const serialLine = fullReq.serial_number ? `\nN° série : \`${fullReq.serial_number}\`` : '';
            const planProviderLine = fullReq.status === 'pending' ? `\n||<@&${CRAFT_PLAN_PROVIDER_ROLE}>||` : '';

            const contentByStatus = {
                pending:
                    `${meta.icon} **Nouvelle demande de Craft**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Arme demandée : **${fullReq.weapon_name}**\n` +
                    `Statut : **${meta.label}**\n\n` +
                    `Merci de fournir rapidement le plan d'arme et les Corps le plus rapidement possible.` +
                    planProviderLine,
                waiting_materials:
                    `${meta.icon} **Matières premières attendues**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Arme demandée : **${fullReq.weapon_name}**\n` +
                    `Statut : **${meta.label}**\n\n` +
                    `Les hauts gradés attendent les matières premières avant de lancer la construction.`,
                in_progress:
                    `${meta.icon} **Construction lancée**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Arme demandée : **${fullReq.weapon_name}**\n` +
                    `Statut : **${meta.label}**`,
                crafted:
                    `${meta.icon} **Arme craftée • ${fullReq.weapon_name}**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Statut : **${meta.label}**` +
                    serialLine,
                completed:
                    `${meta.icon} **Transaction clôturée • ${fullReq.weapon_name}**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Statut : **${meta.label}**`,
                rejected:
                    `${meta.icon} **Demande de craft refusée**\n` +
                    `Demandeur : <@${fullReq.user_id}>\n` +
                    `Arme demandée : **${fullReq.weapon_name}**\n` +
                    `Statut : **${meta.label}**`,
            };
            const content = contentByStatus[fullReq.status] || contentByStatus.pending;

            const { EmbedBuilder } = require('discord.js');
            const embedFields = [
                { name: 'Demandeur', value: fullReq.user_name || 'N/A', inline: true },
                { name: 'Statut', value: meta.label, inline: true },
                { name: 'Pré-requis', value: prereqText, inline: true },
            ];
            if (fullReq.serial_number) {
                embedFields.push({ name: 'Numéro de série', value: `\`${fullReq.serial_number}\``, inline: true });
            }

            const embed = new EmbedBuilder()
                .setTitle(`Demande de Craft • ${fullReq.weapon_name}`)
                .setDescription(meta.description)
                .setColor(meta.color)
                .addFields(...embedFields)
                .setTimestamp()
                .setFooter({ text: '21 Block Savage • Suivi craft' });

            const allowedMentions = {
                users: [fullReq.user_id],
                roles: fullReq.status === 'pending' ? [CRAFT_PLAN_PROVIDER_ROLE] : [],
            };

            if (fullReq.discord_message_id) {
                try {
                    const msg = await channel.messages.fetch(fullReq.discord_message_id);
                    await msg.edit({ content, embeds: [embed], allowedMentions });
                    return;
                } catch (e) {
                    log.error('Édition message craft échouée, création nouveau:', e.message);
                }
            }

            const msg = await channel.send({ content, embeds: [embed], allowedMentions });

                            db.prepare('UPDATE craft_requests SET discord_message_id = ? WHERE id = ?').run(msg.id, requestId);

        } catch (e) {
            log.error('Erreur postOrUpdateCraftRequestMessage:', e.message);
        }
    }
    // Helper : message de notification de changement de statut dans CRAFT_STATUS_CHANNEL
    async function postCraftStatusUpdate(requestId, newStatus) {
        try {
            const fullReq = getRequest(requestId);
            if (!fullReq) return;
            const channel = await fetchDiscordChannel(CRAFT_STATUS_CHANNEL, 'CRAFT_STATUS');
            if (!channel) return;

            const statusMeta = {
                pending: {
                    content: `🟧 <@${fullReq.user_id}> ta demande de craft est remise en attente.`,
                    title: 'Demande en attente',
                    description: `La demande **${fullReq.weapon_name}** est à nouveau en attente de validation.`,
                    color: 0xff8c00,
                },
                waiting_materials: {
                    content: `📦 <@${fullReq.user_id}> ta commande attend les matières premières.`,
                    title: 'Matières premières attendues',
                    description: `La construction de **${fullReq.weapon_name}** commencera dès que les matières premières seront fournies.`,
                    color: 0xf59e0b,
                },
                in_progress: {
                    content: `🔨 <@${fullReq.user_id}> ton arme est en cours de construction.`,
                    title: 'Construction lancée',
                    description: `Ton arme **${fullReq.weapon_name}** est en cours de construction.`,
                    color: 0xfb923c,
                },
                rejected: {
                    content: `⛔ <@${fullReq.user_id}> ta demande de craft a été refusée.`,
                    title: 'Demande refusée',
                    description: `La demande **${fullReq.weapon_name}** a été refusée. Contacte un haut gradé si besoin.`,
                    color: 0xef4444,
                },
            };
            const meta = statusMeta[newStatus];
            if (!meta) return;

            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle(`Craft d’armes • ${meta.title}`)
                .setDescription(meta.description)
                .setColor(meta.color)
                .addFields(
                    { name: 'Arme', value: fullReq.weapon_name || 'N/A', inline: true },
                    { name: 'Demandeur', value: fullReq.user_name || 'N/A', inline: true },
                )
                .setTimestamp()
                .setFooter({ text: '21 Block Savage • Suivi craft' });

            await channel.send({
                content: meta.content,
                embeds: [embed],
                allowedMentions: { users: [fullReq.user_id] },
            });
        } catch (e) {
            log.error('Erreur postCraftStatusUpdate:', e.message);
        }
    }
    app.post('/api/crafts/requests', requireAuth, async (req, res) => {
        try {
            const { weapon_id, has_plan, has_money, request_type, is_test } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            if (!weapon_id) return res.status(400).json({ error: 'Arme requise' });
            const normalizedType = normalizeCraftRequestType(request_type);
            if (!normalizedType) return res.status(400).json({ error: 'Type de demande obligatoire' });
            const weapon = getWeapon(weapon_id);
            if (!weapon) return res.status(404).json({ error: 'Arme introuvable' });
            const requestIsTest = !!is_test && isCraftManager(req.session.user);
            if (is_test && !requestIsTest) {
                return res.status(403).json({ error: 'Mode test réservé aux hauts gradés' });
            }
            const id = insertRequest(userId, userName, weapon_id, has_plan, has_money, normalizedType, requestIsTest);

            // Message Discord
            if (!requestIsTest) {
                postOrUpdateCraftRequestMessage(id).catch(e => log.error('post craft request async:', e.message));
            }

            emitRealtime('craft:status', { requestId: id, status: 'pending', action: 'created' });
            audit(req.session.user, 'craft.request.create', {
                target_type: 'craft_request',
                target_id: id,
                details: {
                    weapon_id,
                    weapon_name: weapon.name,
                    request_type: normalizedType,
                    is_test: requestIsTest,
                    has_plan: !!has_plan,
                    has_money: !!has_money,
                },
            });
            res.json({ success: true, id });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    function canValidateCraft(user) {
        if (!user) return false;
        if (user.id === ADMIN_USER_ID) return true;
        const userRoles = user.roles || [];
        return CRAFT_VALIDATION_ROLES.some(r => userRoles.includes(r));
    }

    function canDeleteRequests(user) {
        if (!user) return false;
        if (user.id === ADMIN_USER_ID) return true;
        return (user.roles || []).includes(ADMIN_ROLE_ID);
    }

    function canDeleteMyWeapons(user) {
        if (!user) return false;
        if (user.id === ADMIN_USER_ID) return true;
        const roles = user.roles || [];
        return roles.includes(MY_WEAPONS_DELETE_ROLE) || canDeleteRequests(user);
    }

    async function postManualCraftSaleJustification(requestId, saleTimestamp, myWeaponId = null) {
        const updated = getRequest(requestId);
        if (!updated || updated.posted_to_channel) return;

        const state = botState();
        const channelId = (state?.CONFIG?.CHANNELS?.WEAPONS_LOG) || '1497021044953845791';
        const channel = await fetchDiscordChannel(channelId, 'WEAPONS_LOG_MANUAL_CRAFT');
        if (!channel) return;

        const saleDate = saleTimestamp ? new Date(saleTimestamp * 1000).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');
        const sellerLabel = updated.completed_by_id && updated.completed_by_id !== 'former-21bs'
            ? `<@${updated.completed_by_id}>`
            : (updated.completed_by_name || 'N/A');
        const declaredById = String(updated.user_id || '').trim();
        const soldById = String(updated.completed_by_id || '').trim();
        const shouldShowDeclaredBy = declaredById
            && declaredById !== 'former-21bs'
            && declaredById !== soldById;
        const fields = [
            { name: 'Arme', value: updated.weapon_name || 'N/A', inline: true },
            { name: 'Quantité', value: '1', inline: true },
            { name: 'Acheteur', value: updated.buyer_org || 'N/A', inline: true },
            { name: 'Montant vendu', value: moneyLabel(updated.sale_price), inline: true },
            { name: 'Date de vente', value: saleDate, inline: true },
            { name: 'Vendeur', value: sellerLabel, inline: true },
        ];
        if (shouldShowDeclaredBy) {
            fields.push({ name: 'Déclarée par', value: `<@${declaredById}>`, inline: true });
        }
        fields.push(
            { name: 'Craftée par', value: updated.crafted_by_name || 'Non renseigné', inline: true },
            { name: 'Numéro de série', value: updated.serial_number ? `\`${updated.serial_number}\`` : 'N/A', inline: false },
        );
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
            .setTitle('✅ Vente d’arme 21BS')
            .setDescription('Une arme craftée par les 21 Block Savage vient d’être déclarée vendue.')
            .setColor(0x22c55e)
            .addFields(...fields);

        const msg = await channel.send({
            content: `✅ Vente déclarée • **${updated.weapon_name || 'Arme'}** • 1 série`,
            embeds: [embed],
            allowedMentions: { parse: [] },
        });
        if (myWeaponId) {
            try {
                db.prepare('UPDATE my_weapons SET sale_discord_message_id = ? WHERE id = ?').run(msg.id, myWeaponId);
            } catch (e) {
                log.error('Erreur liaison justificatif craft manuel my_weapons:', e.message);
            }
        }
        markRequestPosted(requestId);
    }

    app.post('/api/crafts/requests/manual', requireAuth, async (req, res) => {
        try {
            if (!canValidateCraft(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }

            const {
                weapon_id,
                serial_number,
                craft_date,
                crafted_by_id,
                crafted_by_name,
                is_sold,
                buyer_org,
                sale_price,
                sale_date,
                sold_by_id,
                sold_by_name,
                free_sale,
            } = req.body;
            const weaponId = parseId(weapon_id);
            if (weaponId === null) return res.status(400).json({ error: 'Arme invalide' });
            const weapon = getWeapon(weaponId);
            if (!weapon) return res.status(404).json({ error: 'Arme introuvable' });
            if (!serial_number || !String(serial_number).trim()) return res.status(400).json({ error: 'N° de série obligatoire' });
            if (!craft_date) return res.status(400).json({ error: 'Date craft obligatoire' });
            if (is_sold && !buyer_org) return res.status(400).json({ error: 'Organisation acheteuse obligatoire si vendu' });
            if (is_sold && !sale_date) return res.status(400).json({ error: 'Date de vente obligatoire si vendu' });
            const authorizedCrafter = resolveAuthorizedCrafter(crafted_by_id, crafted_by_name);
            if (!authorizedCrafter) return res.status(400).json({ error: 'Armurier obligatoire : Otelow, Ney ou Le H' });

            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const userAvatar = req.session.user.avatar || null;
            const soldById = String(sold_by_id || '').trim();
            const soldByName = String(sold_by_name || '').trim();
            const serial = String(serial_number).trim();
            const craftTimestamp = Math.floor(new Date(`${craft_date}T12:00:00+01:00`).getTime() / 1000);
            if (!Number.isFinite(craftTimestamp)) return res.status(400).json({ error: 'Date craft invalide' });
            const sold = !!is_sold;
            if (sold && !soldById) return res.status(400).json({ error: 'Vendeur obligatoire si vendu' });
            const now = Math.floor(Date.now() / 1000);
            const saleTimestamp = sold ? Math.floor(new Date(`${sale_date}T12:00:00+01:00`).getTime() / 1000) : null;
            if (sold && !Number.isFinite(saleTimestamp)) return res.status(400).json({ error: 'Date de vente invalide' });
            const soldPrice = free_sale ? 0 : (parseInt(sale_price) || null);
            const status = sold ? 'completed' : 'crafted';
            let requestId;
            let myWeaponId;

                            const r = db.prepare(`
                    INSERT INTO craft_requests (
                        user_id, user_name, weapon_id, has_plan, has_money, status, crafted,
                        serial_number, craft_date, crafted_by_id, crafted_by_name,
                        buyer_org, sale_price, sale_date, completed_by_id, completed_by_name
                    ) VALUES (?, ?, ?, 1, 1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    userId, userName, weapon.id, status, serial, craftTimestamp,
                    authorizedCrafter.id, authorizedCrafter.name, sold ? buyer_org : null, soldPrice,
                    sold ? saleTimestamp : null, sold ? soldById : null, sold ? soldByName : null
                );
                requestId = r.lastInsertRowid;

                const mw = db.prepare(`
                    INSERT INTO my_weapons (
                        user_id, user_name, user_avatar, weapon_name, is_crafted, serial_number,
                        asking_price, min_price, is_sold, sold_to, sold_price, sold_at,
                        crafted_by_id, crafted_by_name, sold_by_id, sold_by_name
                    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    userId, userName, userAvatar, weapon.name, serial, soldPrice, null,
                    sold ? 1 : 0, sold ? buyer_org : null, soldPrice, sold ? saleTimestamp : null,
                    authorizedCrafter.id, authorizedCrafter.name, sold ? soldById : null, sold ? soldByName : null
                );
                myWeaponId = mw.lastInsertRowid;


            if (sold) {
                try {
                    await postManualCraftSaleJustification(requestId, saleTimestamp, myWeaponId);
                } catch (e) {
                    log.error('Erreur justification craft manuel:', e.message);
                }
            }

            audit(req.session.user, 'craft.request.create', {
                target_type: 'craft_request',
                target_id: requestId,
                details: {
                    source: 'manual',
                    weapon_id: weapon.id,
                    weapon_name: weapon.name,
                    serial_number: serial,
                    status,
                    myWeaponId,
                    is_sold: sold,
                },
            });
            res.json({ success: true, id: requestId, myWeaponId });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.patch('/api/crafts/requests/:id/craft', requireAuth, async (req, res) => {
        try {
            if (!canValidateCraft(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const { crafted, serial_number } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const existing = getRequest(id);
            if (!existing) return res.status(404).json({ error: 'Demande introuvable' });
            updateRequestCraft(id, crafted, serial_number, userId, userName);

            // Mettre à jour le message Discord original
            if (!existing.is_test) {
                postOrUpdateCraftRequestMessage(id).catch(e => log.error('post craft request async:', e.message));
            }

            if (crafted && !existing.is_test) {
                const channel = await fetchDiscordChannel(CRAFT_STATUS_CHANNEL, 'CRAFT_STATUS_READY');
                if (channel) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`Arme prête • ${existing.weapon_name}`)
                        .setDescription('La construction est terminée. Renseigne la vente quand la transaction est effectuée.')
                        .setColor(0x22c55e)
                        .addFields(
                            { name: 'Demandeur', value: existing.user_name || 'N/A', inline: true },
                            { name: 'Numéro de série', value: `\`${serial_number || 'N/A'}\``, inline: true },
                            { name: 'Prochaine étape', value: 'Compléter le prix de vente, le groupe acheteur et la date de vente.', inline: false },
                        )
                        .setTimestamp()
                        .setFooter({ text: '21 Block Savage • Atelier craft' });

                    channel.send({
                        content: `✅ <@${existing.user_id}> ton arme est prête : **${existing.weapon_name}**.`,
                        embeds: [embed],
                        allowedMentions: { users: [existing.user_id] },
                    }).catch(e => log.error('Erreur notification craft terminé:', e.message));
                }
            }
            emitRealtime('craft:status', { requestId: id, status: crafted ? 'crafted' : 'in_progress', action: 'crafted' });
            audit(req.session.user, crafted ? 'craft.request.validate' : 'craft.request.statusChange', {
                target_type: 'craft_request',
                target_id: id,
                details: {
                    from: existing.status,
                    to: crafted ? 'crafted' : 'in_progress',
                    serial_number,
                },
            });
            res.json({ success: true });
        } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
    });

    // Changement de statut (En attente / Matières / En cours / Refusé)
    app.patch('/api/crafts/requests/:id/status', requireAuth, async (req, res) => {
        try {
            if (!canValidateCraft(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const { status } = req.body;
            const allowed = ['pending', 'waiting_materials', 'in_progress', 'rejected'];
            if (!allowed.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
            const existing = getRequest(id);

                            db.prepare('UPDATE craft_requests SET status = ? WHERE id = ?').run(status, id);

            invalidateCraftCaches();

            const updatedForDiscord = getRequest(id);
            if (!updatedForDiscord?.is_test) {
                // Mettre à jour le message Discord original (édition embed)
                postOrUpdateCraftRequestMessage(id).catch(e => log.error('post craft request async:', e.message));

                // Notification dans le salon de statut
                postCraftStatusUpdate(id, status).catch(e => log.error('post craft status async:', e.message));
            }

            emitRealtime('craft:status', { requestId: id, status, action: 'status' });
            audit(req.session.user, status === 'rejected' ? 'craft.request.refuse' : 'craft.request.statusChange', {
                target_type: 'craft_request',
                target_id: id,
                details: {
                    from: existing?.status || null,
                    to: status,
                    reason: req.body.reason || req.body.refusal_reason || null,
                },
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.patch('/api/crafts/requests/:id/sale', requireAuth, async (req, res) => {
        return res.status(410).json({
            error: 'Route legacy désactivée. Utiliser le workflow Vos Armes / Marquer vendu.'
        });
    });

    // Annuler/supprimer sa propre demande (pour le demandeur uniquement, ou super admin)
    app.delete('/api/crafts/requests/:id/cancel', requireAuth, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const userId = req.session.user.id;
            const existing = getRequest(id);
            if (!existing) return res.status(404).json({ error: 'Demande introuvable' });

            // Le demandeur peut annuler uniquement une demande encore en attente.
            // Les hauts gradés passent par la suppression propre pour restaurer le stock/liens éventuels.
            const isOwner = existing.user_id === userId;
            const isSuperAdmin = canDeleteRequests(req.session.user);

            if (!isOwner && !isSuperAdmin) {
                return res.status(403).json({ error: 'Tu peux annuler uniquement tes propres demandes' });
            }
            if (isSuperAdmin) {
                if (existing.status === 'completed') {
                    return res.status(409).json({ error: 'Craft finalisé permanent : impossible de le supprimer depuis le dashboard' });
                }
                deleteCraftRequestCleanly(id);
                emitRealtime('craft:status', { requestId: id, status: 'deleted', action: 'deleted' });
                audit(req.session.user, 'craft.request.delete', {
                    target_type: 'craft_request',
                    target_id: id,
                    details: { via: 'cancel', mode: 'admin' },
                });
                return res.json({ success: true });
            }
            if (existing.status !== 'pending') {
                return res.status(403).json({ error: 'Demande déjà active, contacte un haut gradé' });
            }

            deleteRequest(id);
            emitRealtime('craft:status', { requestId: id, status: 'deleted', action: 'cancelled' });
            audit(req.session.user, 'craft.request.delete', {
                target_type: 'craft_request',
                target_id: id,
                details: { via: 'cancel', mode: 'owner' },
            });
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/requests/:id', requireAuth, (req, res) => {
        try {
            if (!isCraftManager(req.session.user)) {
                return res.status(403).json({ error: 'Action réservée aux hauts gradés' });
            }
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const existing = getRequest(id);
            if (!existing) return res.status(404).json({ error: 'Demande introuvable' });
            if (existing.status === 'completed') {
                return res.status(409).json({ error: 'Craft finalisé permanent : impossible de le supprimer depuis le dashboard' });
            }
            deleteCraftRequestCleanly(id);
            emitRealtime('craft:status', { requestId: id, status: 'deleted', action: 'deleted' });
            audit(req.session.user, 'craft.request.delete', {
                target_type: 'craft_request',
                target_id: id,
                details: { via: 'admin-delete' },
            });
            res.json({ success: true });
        } catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
    });


}

module.exports = { registerCraftRequestRoutes };
