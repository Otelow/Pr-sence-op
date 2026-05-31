// STATUT EN COURS 17/05/2026 — toggle vente en cours et actions admin
// BOARD ARMES 17/05/2026 — refresh board live sur mutations Vos Armes
// FINAL POST-STAB A 17/05/2026 ? pino backend
const log = require('../../../shared/logger');
// STABILISATION 15/05/2026 — corrections sécurité et persistance
// MODIFIE CHANTIER 6 - 14/05/2026 - routes Vos Armes extraites
// AUDIT HOOKS 16/05/2026 — annonces Vos Armes tracées dans audit_log
const { audit } = require('../../../shared/auditLog');
const { refreshArmesBoard } = require('../../../bot/services/armesBoard');

function parseId(v, max = 2_000_000) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

function registerMyWeaponsRoutes(app, deps) {
    const {
        requireAuth,
        botClient,
        botState,
        db,
        canValidateCraft,
        canDeleteRequests,
        canDeleteMyWeapons,
        getDiscordUserAvatar,
        getWeapon,
        getWeaponByName,
        getMyWeaponNameByName,
        getAllMyWeaponNames,
        getRequest,
        getWeaponSaleStateForCraftRequest,
        serialAlreadyListed,
        applyCraftRequestStatusTransition,
        invalidateCraftCaches,
        markRequestPosted,
        emitRealtime,
        moneyLabel,
    } = deps;
    // ─── MY WEAPONS ─────────────────────
    const MYWEAPONS_CHANNEL = '1497185767053594695';
    const MYWEAPONS_AUTHORIZED_CRAFTERS = [
        { id: 'otelow', name: 'Otelow' },
        { id: 'ney', name: 'Ney' },
        { id: 'le-h', name: 'Le H' },
    ];

    const maxSalePriceError = (max) => `Le prix ne peut pas dépasser le prix maximal autorisé pour cette arme : ${Number(max).toLocaleString('fr-FR')}$.`;

    function queueArmesBoardRefresh(reason) {
        if (!botClient) return;
        refreshArmesBoard(botClient).catch(e => log.warn({ err: e.message, reason }, 'refresh board armes échoué'));
    }

    function getMyWeaponById(id) {
        return db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);
    }

    function canMarkAnyWeaponSold(user) {
        return canValidateCraft(user) || canDeleteMyWeapons(user);
    }

    function validateMyWeaponPriceLimit({ weaponName, weaponId, askingPrice, minPrice }) {
        const adminWeapon = weaponId ? getWeapon(weaponId) : getWeaponByName(weaponName);
        const myWeaponName = getMyWeaponNameByName(weaponName);
        const adminMaxSalePrice = Number(adminWeapon?.max_sale_price) || 0;
        const maxSalePrice = adminMaxSalePrice > 0 ? adminMaxSalePrice : (Number(myWeaponName?.max_sale_price) || 0);
        if (maxSalePrice <= 0) return null;
        const prices = [askingPrice, minPrice].filter(value => value !== null && typeof value !== 'undefined');
        return prices.some(value => Number(value) > maxSalePrice) ? maxSalePriceError(maxSalePrice) : null;
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

    function normalizeSerialList(input) {
        const raw = Array.isArray(input) ? input.join('\n') : String(input || '');
        return [...new Set(raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean))];
    }

    function aggregateMyWeapons(list, userId) {
        const grouped = new Map();
        for (const item of list) {
            const key = item.batch_id || `single-${item.id}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    ...item,
                    group_id: key,
                    serials: [],
                    sold_serials: [],
                    row_ids: [],
                    available_row_ids: [],
                    quantity_total: 0,
                    quantity_available: 0,
                    is_mine: item.user_id === userId,
                    is_in_progress: item.is_in_progress ? 1 : 0,
                });
            }
            const group = grouped.get(key);
            if (item.is_in_progress) group.is_in_progress = 1;
            group.quantity_total++;
            group.row_ids.push(item.id);
            const serialEntry = {
                id: item.id,
                serial_number: item.serial_number,
                is_sold: !!item.is_sold,
                sold_to: item.sold_to,
                sold_price: item.sold_price,
                sold_at: item.sold_at,
                sold_by_id: item.sold_by_id,
                sold_by_name: item.sold_by_name,
            };
            group.serials.push(serialEntry);
            if (item.is_sold) group.sold_serials.push(serialEntry);
            if (!item.is_sold) {
                group.quantity_available++;
                group.available_row_ids.push(item.id);
                group.id = item.id;
                group.is_sold = 0;
                group.is_in_progress = item.is_in_progress ? 1 : group.is_in_progress;
                group.sold_to = null;
                group.sold_price = null;
                group.sold_at = null;
            }
        }
        return [...grouped.values()].sort((a, b) => {
            if ((a.quantity_available > 0) !== (b.quantity_available > 0)) return a.quantity_available > 0 ? -1 : 1;
            return (b.created_at || 0) - (a.created_at || 0);
        });
    }

    function buildMyWeaponsEmbed(weapon, rows) {
        const { EmbedBuilder } = require('discord.js');
        const total = rows.length;
        const available = rows.filter(w => !w.is_sold).length;
        const serials = rows
            .map(w => `${w.is_sold ? 'Vendu' : 'Disponible'} • ${w.serial_number || 'N° non renseigne'}${w.sold_to ? ` → ${w.sold_to}` : ''}${w.sold_by_name ? ` • vendu par ${w.sold_by_name}` : ''}`)
            .join('\n')
            .slice(0, 1000) || 'N/A';

        return new EmbedBuilder()
            .setTitle(`Marché armurerie • ${weapon.weapon_name}`)
            .setDescription(available > 0 ? `Stock disponible : ${available}/${total} arme(s).` : 'Lot vendu entièrement.')
            .setColor(available > 0 ? 0xff8c00 : 0x22c55e)
            .addFields(
                { name: 'Vendeur', value: weapon.user_name || 'N/A', inline: true },
                { name: 'Origine', value: weapon.is_crafted ? 'Craft 21BS validé' : 'Arme externe', inline: true },
                { name: 'Craftée par', value: weapon.is_crafted ? (weapon.crafted_by_name || 'Non renseigné') : 'Arme externe', inline: true },
                { name: 'Stock', value: `${available}/${total} disponible(s)`, inline: true },
                { name: 'Prix affiché', value: moneyLabel(weapon.asking_price), inline: true },
                { name: 'Seuil minimum', value: moneyLabel(weapon.min_price), inline: true },
                { name: 'N° série', value: serials, inline: false },
            )
            .setTimestamp()
            .setFooter({ text: '21 Block Savage • Marché armurerie' });
    }
    async function updateMyWeaponsDiscordBatch(existing) {
        let rows;
                    rows = existing.batch_id
                ? db.prepare('SELECT * FROM my_weapons WHERE batch_id = ? ORDER BY id ASC').all(existing.batch_id)
                : [db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(existing.id)];

        rows = rows.filter(Boolean);
        if (!rows.length) return;

        const base = rows[0];
        const available = rows.filter(w => !w.is_sold).length;
        const channel = await fetchDiscordChannel(MYWEAPONS_CHANNEL, 'MYWEAPONS_LISTING');
        if (!channel) return;
        const embed = buildMyWeaponsEmbed(base, rows);
        const content = available > 0
            ? `📦 Vente armurerie • **${base.weapon_name}** • ${available}/${rows.length} disponible(s).`
            : `✅ Vente armurerie clôturée • **${base.weapon_name}** • lot vendu.`;
        const messageId = rows.find(w => w.discord_message_id)?.discord_message_id;
        if (messageId) {
            try {
                const msg = await channel.messages.fetch(messageId);
                await msg.edit({ content, embeds: [embed], allowedMentions: { parse: [] } });
                return;
            } catch {}
        }
        const msg = await channel.send({ content, embeds: [embed], allowedMentions: { parse: [] } });
                    if (base.batch_id) db.prepare('UPDATE my_weapons SET discord_message_id = ? WHERE batch_id = ?').run(msg.id, base.batch_id);
            else db.prepare('UPDATE my_weapons SET discord_message_id = ? WHERE id = ?').run(msg.id, base.id);

    }

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

    function getWeaponsLogChannelId() {
        const state = botState();
        return (state?.CONFIG?.CHANNELS?.WEAPONS_LOG) || '1497021044953845791';
    }

    function getSaleLogReadyRows(existing) {
        let rows;
                    rows = existing.batch_id
                ? db.prepare('SELECT * FROM my_weapons WHERE batch_id = ? ORDER BY id ASC').all(existing.batch_id)
                : [db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(existing.id)];


        return rows
            .filter(Boolean)
            .filter(w => {
                const crafted = w.is_crafted === true || w.is_crafted === 1 || w.is_crafted === '1';
                const sold = w.is_sold === true || w.is_sold === 1 || w.is_sold === '1';
                const hasPrice = w.sold_price !== null && typeof w.sold_price !== 'undefined' && String(w.sold_price).trim() !== '';
                return crafted
                    && sold
                    && !w.sale_discord_message_id
                    && String(w.serial_number || '').trim()
                    && String(w.sold_to || '').trim()
                    && hasPrice;
            });
    }

    function buildMyWeaponsSaleLogEmbed(base, rows) {
        const { EmbedBuilder } = require('discord.js');
        const serialValues = rows
            .map(w => String(w.serial_number || '').trim())
            .filter(Boolean);
        const serials = serialValues.length <= 1
            ? (serialValues[0] ? `\`${serialValues[0]}\`` : 'N/A')
            : serialValues
                .map((serial, index) => `${index + 1}. \`${serial}\``)
                .join('\n')
                .slice(0, 1000);
        const saleDates = [...new Set(rows
            .map(w => w.sold_at ? new Date(w.sold_at * 1000).toLocaleDateString('fr-FR') : null)
            .filter(Boolean))];
        const saleDate = saleDates.length === 1 ? saleDates[0] : new Date().toLocaleDateString('fr-FR');
        const soldByLabel = base.sold_by_id && base.sold_by_id !== 'former-21bs'
            ? `<@${base.sold_by_id}>`
            : (base.sold_by_name || base.user_name || 'N/A');
        const declaredById = String(base.created_by_id || '').trim();
        const soldById = String(base.sold_by_id || '').trim();
        const ownerId = String(base.user_id || '').trim();
        const shouldShowDeclaredBy = declaredById
            && declaredById !== 'former-21bs'
            && declaredById !== soldById
            && declaredById !== ownerId;
        const declaredByLabel = shouldShowDeclaredBy
            ? `<@${declaredById}>`
            : null;

        const fields = [
            { name: 'Arme', value: base.weapon_name || 'N/A', inline: true },
            { name: 'Quantité', value: String(rows.length), inline: true },
            { name: 'Acheteur', value: base.sold_to || 'N/A', inline: true },
            { name: 'Montant vendu', value: moneyLabel(base.sold_price), inline: true },
            { name: 'Date de vente', value: saleDate, inline: true },
            { name: 'Vendeur', value: soldByLabel, inline: true },
        ];

        if (declaredByLabel) {
            fields.push({ name: 'Déclarée par', value: declaredByLabel, inline: true });
        }

        fields.push(
            { name: 'Craftée par', value: base.crafted_by_name || 'Non renseigné', inline: true },
            { name: serialValues.length > 1 ? 'Numéros de série' : 'Numéro de série', value: serials, inline: false },
        );

        return new EmbedBuilder()
            .setTitle('✅ Vente d’arme 21BS')
            .setDescription('Une arme craftée par les 21 Block Savage vient d’être déclarée vendue.')
            .setColor(0x22c55e)
            .addFields(...fields);
    }

    async function postMyWeaponsSaleLog(existing) {
        const rows = getSaleLogReadyRows(existing);
        if (!rows.length) return false;

        const channelId = getWeaponsLogChannelId();
        const channel = await fetchDiscordChannel(channelId, 'WEAPONS_LOG');
        if (!channel) return false;

        const base = rows[0];
        const embed = buildMyWeaponsSaleLogEmbed(base, rows);
        try {
            const msg = await channel.send({
                content: `✅ Vente déclarée • **${base.weapon_name}** • ${rows.length} série${rows.length > 1 ? 's' : ''}`,
                embeds: [embed],
                allowedMentions: { parse: [] },
            });
                            const stmt = db.prepare('UPDATE my_weapons SET sale_discord_message_id = ? WHERE id = ?');
                for (const row of rows) stmt.run(msg.id, row.id);

            return true;
        } catch (e) {
            log.error(`[discord] WEAPONS_LOG: log vente impossible pour ${base.weapon_name}: ${e.message}`);
            return false;
        }
    }

    app.get('/api/crafts/myweapons', requireAuth, (req, res) => {
        try {
            const userId = req.session.user.id;
            // Tout le monde voit toutes les armes en vente, mais on note l'auteur
            let list;
                            list = db.prepare('SELECT * FROM my_weapons ORDER BY is_sold ASC, created_at DESC').all();

            res.json({ myweapons: aggregateMyWeapons(list, userId) });
        } catch (e) { res.json({ myweapons: [], error: e.message }); }
    });

    app.get('/api/crafts/myweapons/available-crafts', requireAuth, (req, res) => {
        try {
            const requesterId = req.session.user.id;
            const requestedUserId = String(req.query.userId || '').trim();
            const viewingOtherUser = requestedUserId && requestedUserId !== requesterId;
            if (viewingOtherUser && !canValidateCraft(req.session.user) && !canDeleteMyWeapons(req.session.user)) {
                return res.status(403).json({ crafts: [], error: 'Action non autorisée' });
            }
            const userId = viewingOtherUser ? requestedUserId : requesterId;
            let rows;
                            rows = db.prepare(`
                    SELECT r.*, w.name as weapon_name, w.max_sale_price as max_sale_price
                    FROM craft_requests r
                    JOIN weapons w ON r.weapon_id = w.id
                    WHERE r.user_id = ?
                      AND r.status = 'crafted'
                      AND TRIM(COALESCE(r.serial_number, '')) != ''
                    ORDER BY r.craft_date DESC, r.created_at DESC
                `).all(userId);

            const crafts = rows
                .filter(r => getWeaponSaleStateForCraftRequest(r).state === 'not_listed')
                .map(r => ({
                    id: r.id,
                    user_id: r.user_id,
                    user_name: r.user_name,
                    weapon_name: r.weapon_name,
                    max_sale_price: Number(r.max_sale_price) || 0,
                    serial_number: r.serial_number,
                    craft_date: r.craft_date,
                    crafted_by_id: r.crafted_by_id,
                    crafted_by_name: r.crafted_by_name,
                }));
            res.json({ crafts });
        } catch (e) {
            res.status(500).json({ crafts: [], error: e.message });
        }
    });

    app.post('/api/crafts/myweapons', requireAuth, async (req, res, next) => {
        try {
            const {
                weapon_name,
                is_crafted,
                serial_number,
                serial_numbers,
                quantity,
                asking_price,
                min_price,
                crafted_by_id,
                crafted_by_name,
                sell_for_user_id,
                sell_for_user_name,
                craft_request_id,
            } = req.body;
            const userId = req.session.user.id;
            const userName = req.session.user.username;
            const userAvatar = req.session.user.avatar || null;
            const targetUserId = String(sell_for_user_id || '').trim();
            const targetUserName = String(sell_for_user_name || '').trim();
            const sellingForOther = targetUserId && targetUserId !== userId;
            if (sellingForOther && !canValidateCraft(req.session.user) && !canDeleteMyWeapons(req.session.user)) {
                return res.status(403).json({ error: 'Tu ne peux pas vendre au nom d’un autre membre' });
            }
            const ownerId = sellingForOther ? targetUserId : userId;
            const ownerName = sellingForOther ? (targetUserName || targetUserId) : userName;
            const ownerAvatar = sellingForOther ? await getDiscordUserAvatar(ownerId) : userAvatar;
            const createdById = sellingForOther ? userId : null;
            const createdByName = sellingForOther ? userName : null;
            const requestedWeaponName = String(weapon_name || '').trim();
            if (!requestedWeaponName) return res.status(400).json({ error: "Nom de l'arme requis" });
            const allowedWeaponNames = getAllMyWeaponNames();
            const matchedWeaponName = allowedWeaponNames.find(w => String(w.name || '').toLowerCase() === requestedWeaponName.toLowerCase());
            if (allowedWeaponNames.length && !matchedWeaponName) {
                return res.status(400).json({ error: "Choisis une arme dans la liste autorisée" });
            }
            const weaponName = matchedWeaponName ? matchedWeaponName.name : requestedWeaponName;
            if (typeof is_crafted === 'undefined') return res.status(400).json({ error: "Origine de l'arme obligatoire" });
            const isCrafted21BS = is_crafted === true || is_crafted === 1 || is_crafted === '1' || is_crafted === 'true';
            const linkedCraftRequestId = craft_request_id ? parseId(craft_request_id) : null;
            if (craft_request_id && linkedCraftRequestId === null) return res.status(400).json({ error: 'Demande craft invalide' });
            let linkedCraftRequest = null;
            if (linkedCraftRequestId) {
                if (!isCrafted21BS) {
                    return res.status(400).json({ error: 'Une demande de craft liée doit être déclarée comme arme craftée 21BS' });
                }
                linkedCraftRequest = getRequest(linkedCraftRequestId);
                if (!linkedCraftRequest) return res.status(404).json({ error: 'Demande de craft introuvable' });
                if (String(linkedCraftRequest.user_id || '') !== String(ownerId || '')) {
                    return res.status(400).json({ error: 'La mise en vente doit être faite au nom du demandeur du craft' });
                }
                if (linkedCraftRequest.user_id !== ownerId && !canValidateCraft(req.session.user) && !canDeleteMyWeapons(req.session.user)) {
                    return res.status(403).json({ error: 'Tu ne peux pas lier une demande de craft qui ne t’appartient pas' });
                }
                if (linkedCraftRequest.status !== 'crafted' || !String(linkedCraftRequest.serial_number || '').trim()) {
                    return res.status(400).json({ error: 'Cette demande de craft n’est pas prête à la vente' });
                }
                if (getWeaponSaleStateForCraftRequest(linkedCraftRequest).state !== 'not_listed') {
                    return res.status(409).json({ error: 'Cette arme est déjà en vente ou déjà vendue' });
                }
            }
            const authorizedCrafter = isCrafted21BS ? resolveAuthorizedCrafter(crafted_by_id, crafted_by_name) : null;
            if (isCrafted21BS && !authorizedCrafter) {
                return res.status(400).json({ error: "Armurier autorisé obligatoire : Otelow, Ney ou Le H" });
            }

            let serials = normalizeSerialList(serial_numbers || serial_number);
            if (linkedCraftRequest) {
                serials = [String(linkedCraftRequest.serial_number).trim()];
            }
            const requestedQuantity = parseId(quantity, 50) || serials.length || 1;
            if (isCrafted21BS && serials.length !== requestedQuantity) {
                return res.status(400).json({ error: `Renseigne ${requestedQuantity} N° de série distinct${requestedQuantity > 1 ? 's' : ''}` });
            }
            if (!isCrafted21BS && serials.length < requestedQuantity) {
                serials = [...serials, ...Array(requestedQuantity - serials.length).fill(null)];
            }
            const duplicateSerial = serials.find(serial => serial && serialAlreadyListed(serial));
            if (duplicateSerial) {
                return res.status(409).json({ error: `Le N° de série ${duplicateSerial} est déjà en vente ou vendu` });
            }

            const askingPrice = parseInt(asking_price) || null;
            const minPrice = parseInt(min_price) || null;
            const priceLimitError = validateMyWeaponPriceLimit({
                isCrafted21BS,
                weaponName,
                weaponId: linkedCraftRequest?.weapon_id || null,
                askingPrice,
                minPrice,
            });
            if (priceLimitError) return res.status(400).json({ error: priceLimitError });
            const craftedById = linkedCraftRequest?.crafted_by_id || (isCrafted21BS ? authorizedCrafter.id : null);
            const craftedByName = linkedCraftRequest?.crafted_by_name || (isCrafted21BS ? authorizedCrafter.name : null);
            const batchId = `mw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            let id;

                            const stmt = db.prepare(`INSERT INTO my_weapons (user_id, user_name, user_avatar, weapon_name, craft_request_id, is_crafted, serial_number, asking_price, min_price, batch_id, crafted_by_id, crafted_by_name, created_by_id, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                for (const serial of serials) {
                    const r = stmt.run(ownerId, ownerName, ownerAvatar, weaponName, linkedCraftRequestId, isCrafted21BS ? 1 : 0, serial, askingPrice, minPrice, batchId, craftedById, craftedByName, createdById, createdByName);
                    if (!id) id = r.lastInsertRowid;
                }


            try {
                const first = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);
                if (first) {
                    await updateMyWeaponsDiscordBatch(first);
                }
            } catch (e) { log.error('Erreur post Discord myweapons:', e.message); }

            emitRealtime('craft:status', { requestId: linkedCraftRequestId || null, myWeaponId: id, status: 'listed', action: 'myweapon-listed' });
            audit(req.session.user, 'weapon.create', {
                target_type: 'my_weapon',
                target_id: id,
                details: {
                    name: weaponName,
                    serial_number: serials.filter(Boolean).join(', '),
                    owner: ownerName,
                    quantity: serials.length,
                    is_crafted: isCrafted21BS,
                    craft_request_id: linkedCraftRequestId,
                },
            });
            queueArmesBoardRefresh('weapon.create');
            return res.json({ success: true, id, quantity: serials.length });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/crafts/myweapons-legacy', requireAuth, async (req, res) => {
        return res.status(410).json({ error: 'Endpoint legacy desactive. Utilise /api/crafts/myweapons.' });
    });

    app.get('/api/crafts/myweapons/:id', requireAuth, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const existing = getMyWeaponById(id);
            if (!existing) return res.status(404).json({ error: 'Annonce introuvable' });
            const canManageAny = canValidateCraft(req.session.user) || canDeleteMyWeapons(req.session.user);
            if (String(existing.user_id) !== String(req.session.user.id) && !canManageAny) {
                return res.status(403).json({ error: 'Action non autorisee' });
            }
            if (!canManageAny && existing.is_sold) {
                return res.status(403).json({ error: 'Une annonce vendue ne peut etre modifiee que par un haut grade' });
            }
            res.json({ weapon: existing });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/crafts/my-weapons/:id/toggle-in-progress', requireAuth, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const existing = getMyWeaponById(id);
            if (!existing) return res.status(404).json({ error: 'Annonce introuvable' });
            if (!canMarkAnyWeaponSold(req.session.user)) {
                return res.status(403).json({ error: 'Action admin requise' });
            }
            if (existing.is_sold) {
                return res.status(400).json({ error: 'Une arme vendue ne peut pas passer en cours de vente' });
            }

            const inProgress = req.body?.in_progress === true || req.body?.in_progress === 1 || req.body?.in_progress === '1' || req.body?.in_progress === 'true';
            const now = Math.floor(Date.now() / 1000);
            db.prepare(`
                UPDATE my_weapons
                SET is_in_progress = ?, in_progress_at = ?, in_progress_by = ?
                WHERE id = ?
            `).run(inProgress ? 1 : 0, inProgress ? now : null, inProgress ? req.session.user.id : null, id);

            const updatedWeapon = getMyWeaponById(id);
            emitRealtime('weapon:updated', { id });
            emitRealtime('craft:status', { requestId: updatedWeapon?.craft_request_id || null, myWeaponId: id, status: inProgress ? 'in_progress' : 'listed', action: 'myweapon-in-progress' });
            audit(req.session.user, 'weapon.toggleInProgress', {
                target_type: 'my_weapon',
                target_id: id,
                details: {
                    in_progress: inProgress,
                    weapon_name: existing.weapon_name,
                },
            });
            queueArmesBoardRefresh('weapon.toggleInProgress');
            res.json({ success: true, weapon: updatedWeapon });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/api/crafts/myweapons/:id', requireAuth, async (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const existing = getMyWeaponById(id);
            if (!existing) return res.status(404).json({ error: 'Annonce introuvable' });

            const canManageAny = canValidateCraft(req.session.user) || canDeleteMyWeapons(req.session.user);
            const isOwner = String(existing.user_id) === String(req.session.user.id);
            if (!isOwner && !canManageAny) return res.status(403).json({ error: 'Action non autorisee' });
            if (!canManageAny && existing.is_sold) {
                return res.status(403).json({ error: 'Une annonce vendue ne peut etre modifiee que par un haut grade' });
            }
            const forbiddenSaleFields = [
                'is_sold',
                'sold_to',
                'sold_price',
                'sold_at',
                'sold_by_id',
                'sold_by_name',
                'sale_discord_message_id',
                'weapons_log_message_id',
                'discord_message_id',
            ];
            const forbiddenField = forbiddenSaleFields.find(field => Object.prototype.hasOwnProperty.call(req.body, field));
            if (forbiddenField) {
                return res.status(400).json({ error: `Champ de vente interdit sur cette route (${forbiddenField}). Utilise Marquer vendu.` });
            }

            const weaponName = String(req.body.weapon_name || '').trim();
            if (!weaponName) return res.status(400).json({ error: "Nom de l'arme requis" });
            const isCrafted = req.body.is_crafted === true || req.body.is_crafted === 1 || req.body.is_crafted === '1' || req.body.is_crafted === 'true';
            const serial = String(req.body.serial_number || '').trim();
            if (serial && serialAlreadyListed(serial, id)) {
                return res.status(409).json({ error: `Le N° de série ${serial} est déjà en vente ou vendu` });
            }
            const parseOptionalAmount = value => {
                const raw = String(value ?? '').trim();
                if (!raw) return null;
                const amount = parseInt(raw, 10);
                return Number.isFinite(amount) && amount >= 0 ? amount : null;
            };
            const askingPrice = parseOptionalAmount(req.body.asking_price);
            const minPrice = parseOptionalAmount(req.body.min_price);
            const priceLimitError = validateMyWeaponPriceLimit({
                isCrafted21BS: isCrafted,
                weaponName,
                weaponId: existing.craft_request_id ? getRequest(existing.craft_request_id)?.weapon_id : null,
                askingPrice,
                minPrice,
            });
            if (priceLimitError) return res.status(400).json({ error: priceLimitError });
            let ownerId = existing.user_id;
            let ownerName = existing.user_name;
            let ownerAvatar = existing.user_avatar || null;
            if (canManageAny && req.body.user_id && String(req.body.user_id) !== String(existing.user_id)) {
                ownerId = String(req.body.user_id).trim();
                ownerName = String(req.body.user_name || ownerId).trim();
                ownerAvatar = await getDiscordUserAvatar(ownerId);
            } else if (canManageAny && req.body.user_name) {
                ownerName = String(req.body.user_name).trim() || ownerName;
            }

            const batchId = existing.batch_id || null;
                            if (batchId) {
                    db.prepare(`
                        UPDATE my_weapons
                        SET user_id = ?, user_name = ?, user_avatar = ?, weapon_name = ?, is_crafted = ?,
                            asking_price = ?, min_price = ?
                        WHERE batch_id = ?
                    `).run(ownerId, ownerName, ownerAvatar, weaponName, isCrafted ? 1 : 0, askingPrice, minPrice, batchId);
                }
                db.prepare(`
                    UPDATE my_weapons
                    SET user_id = ?, user_name = ?, user_avatar = ?, weapon_name = ?, is_crafted = ?,
                        serial_number = ?, asking_price = ?, min_price = ?
                    WHERE id = ?
                `).run(ownerId, ownerName, ownerAvatar, weaponName, isCrafted ? 1 : 0, serial || null, askingPrice, minPrice, id);
            const updatedWeapon = getMyWeaponById(id);
            emitRealtime('craft:status', { requestId: updatedWeapon?.craft_request_id || null, myWeaponId: id, status: updatedWeapon?.is_sold ? 'sold' : 'listed', action: 'myweapon-updated' });
            audit(req.session.user, 'weapon.update', {
                target_type: 'my_weapon',
                target_id: id,
                details: {
                    weapon_name: weaponName,
                    serial_number: serial || null,
                    owner: ownerName,
                },
            });
            queueArmesBoardRefresh('weapon.update');
            res.json({ success: true, weapon: updatedWeapon });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Marquer comme vendu
    app.patch('/api/crafts/myweapons/:id/sold', requireAuth, async (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const { sold_to, sold_price, sold_by_id, sold_by_name } = req.body;
            const userId = req.session.user.id;

            // Récupérer
            let existing;
                            existing = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);

            if (!existing) return res.status(404).json({ error: 'Introuvable' });
            const adminMarkSold = String(existing.user_id) !== String(userId) && canMarkAnyWeaponSold(req.session.user);
            if (String(existing.user_id) !== String(userId) && !canMarkAnyWeaponSold(req.session.user)) {
                return res.status(403).json({ error: 'Action non autorisée — seul le vendeur peut marquer comme vendu' });
            }

            const now = Math.floor(Date.now() / 1000);
            const soldTo = String(sold_to || '').trim();
            if (!soldTo) return res.status(400).json({ error: 'Groupe acheteur obligatoire' });
            const rawSoldPrice = String(sold_price ?? '').trim();
            if (!rawSoldPrice) return res.status(400).json({ error: 'Montant vendu obligatoire' });
            const soldPrice = parseInt(rawSoldPrice, 10);
            if (!Number.isFinite(soldPrice) || soldPrice < 0) {
                return res.status(400).json({ error: 'Montant vendu invalide' });
            }
            const soldById = String(sold_by_id || '').trim();
            const soldByName = String(sold_by_name || '').trim();
            if (!soldById) return res.status(400).json({ error: 'Vendeur obligatoire' });

            let autoFilledCraft = null;
            let matchedRequestForLog = null;
            const markSoldTx = db.transaction(() => {
                db.prepare(`UPDATE my_weapons SET is_sold = 1, is_in_progress = 0, in_progress_at = NULL, in_progress_by = NULL, sold_to = ?, sold_price = ?, sold_at = ?, sold_by_id = ?, sold_by_name = ? WHERE id = ?`)
                    .run(soldTo, soldPrice, now, soldById, soldByName, id);

                if (existing.is_crafted && existing.serial_number) {
                    const matchedRequest = db.prepare(`
                        SELECT r.*, w.name as weapon_name FROM craft_requests r
                        JOIN weapons w ON r.weapon_id = w.id
                        WHERE r.user_id = ? AND r.serial_number = ? AND r.status != 'completed'
                        ORDER BY r.created_at DESC LIMIT 1
                    `).get(existing.user_id, existing.serial_number);

                    if (matchedRequest) {
                        matchedRequestForLog = matchedRequest;
                        applyCraftRequestStatusTransition(matchedRequest.id, 'completed', {
                            buyerOrg: soldTo,
                            salePrice: soldPrice,
                            saleDate: now,
                            completedById: soldById,
                            completedByName: soldByName || soldById,
                        });
                        autoFilledCraft = { id: matchedRequest.id, weapon_name: matchedRequest.weapon_name };
                    }
                }
            });
            markSoldTx();
            invalidateCraftCaches?.();

            // Mettre à jour le message Discord (édit ou nouveau message)
            try {
                const channel = await fetchDiscordChannel(MYWEAPONS_CHANNEL, 'MYWEAPONS_LISTING');
                if (channel) {
                    const { EmbedBuilder } = require('discord.js');
                    const embed = new EmbedBuilder()
                        .setTitle(`Vente finalisée • ${existing.weapon_name}`)
                        .setDescription('Transaction confirmée. L’annonce est verrouillée.')
                        .setColor(0x4ade80)
                        .addFields(
                            { name: 'Vendeur', value: soldById !== 'former-21bs' ? `<@${soldById}>` : (soldByName || existing.user_name), inline: true },
                            { name: 'Acheteur', value: soldTo, inline: true },
                            { name: 'Prix final', value: moneyLabel(soldPrice), inline: true },
                        )
                        .setTimestamp()
                        .setFooter({ text: '21 Block Savage • Vente terminée' });

                    if (existing.discord_message_id) {
                        try {
                            const msg = await channel.messages.fetch(existing.discord_message_id);
                            await msg.edit({
                                content: `✅ Annonce clôturée • **VENDU**`,
                                embeds: [embed]
                            });
                        } catch {
                            await channel.send({
                                content: `✅ Vente finalisée • **${existing.weapon_name}**`,
                                embeds: [embed],
                                allowedMentions: { parse: [] }
                            });
                        }
                    } else {
                        await channel.send({
                            content: `✅ Vente finalisée • **${existing.weapon_name}**`,
                            embeds: [embed],
                            allowedMentions: { parse: [] }
                        });
                    }
                }
            } catch (e) { log.error('Erreur update Discord:', e.message); }

            // Auto-remplir Tableau de craft si l'arme est craftée 21BS et a un N°Série
            try {
                await updateMyWeaponsDiscordBatch(existing);
            } catch (e) { log.error('Erreur update Discord lot myweapons:', e.message); }

            try {
                const soldWeaponForLog = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);
                const saleLogged = soldWeaponForLog ? await postMyWeaponsSaleLog(soldWeaponForLog) : false;
                if (saleLogged && matchedRequestForLog && !matchedRequestForLog.posted_to_channel) {
                    markRequestPosted(matchedRequestForLog.id);
                }
            } catch (e) {
                log.error('Erreur log vente WEAPONS_LOG:', e.message);
            }

            emitRealtime('craft:status', { requestId: matchedRequestForLog?.id || existing.craft_request_id || null, myWeaponId: id, status: 'sold', action: 'myweapon-sold' });
            audit(req.session.user, 'weapon.markSold', {
                target_type: 'my_weapon',
                target_id: id,
                details: {
                    buyer: soldTo,
                    price: soldPrice,
                    sold_at: now,
                    sold_by_id: soldById,
                    sold_by_name: soldByName,
                    craft_request_id: matchedRequestForLog?.id || existing.craft_request_id || null,
                },
            });
            if (adminMarkSold) {
                audit(req.session.user, 'weapon.markSold.byAdmin', {
                    target_type: 'my_weapon',
                    target_id: id,
                    details: {
                        weapon_name: existing.weapon_name,
                        original_owner: existing.user_name,
                        original_owner_id: existing.user_id,
                    },
                });
            }
            queueArmesBoardRefresh('weapon.markSold');
            res.json({ success: true, autoFilledCraft });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.delete('/api/crafts/myweapons/:id', requireAuth, async (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const userId = req.session.user.id;
            let existing;
                            existing = db.prepare('SELECT * FROM my_weapons WHERE id = ?').get(id);

            if (!existing) return res.status(404).json({ error: 'Introuvable' });
            // Le vendeur peut supprimer sa propre annonce, OU super admin
            if (existing.user_id !== userId && !canDeleteMyWeapons(req.session.user)) {
                return res.status(403).json({ error: 'Action non autorisée' });
            }
            const loggedRow = existing.batch_id
                ? db.prepare(`
                    SELECT mw.id FROM my_weapons mw
                    LEFT JOIN craft_requests cr ON cr.id = mw.craft_request_id
                    WHERE mw.batch_id = ?
                      AND (
                          mw.is_sold = 1
                          OR mw.sale_discord_message_id IS NOT NULL
                          OR mw.weapons_log_message_id IS NOT NULL
                          OR cr.status = 'completed'
                      )
                    LIMIT 1
                `).get(existing.batch_id)
                : db.prepare(`
                    SELECT mw.id FROM my_weapons mw
                    LEFT JOIN craft_requests cr ON cr.id = mw.craft_request_id
                    WHERE mw.id = ?
                      AND (
                          mw.is_sold = 1
                          OR mw.sale_discord_message_id IS NOT NULL
                          OR mw.weapons_log_message_id IS NOT NULL
                          OR cr.status = 'completed'
                      )
                    LIMIT 1
                `).get(id);
            if (loggedRow) {
                return res.status(409).json({ error: 'Arme vendue ou loguée : suppression physique refusée pour préserver l’historique' });
            }
            if (existing.discord_message_id) {
                try {
                    const channel = await fetchDiscordChannel(MYWEAPONS_CHANNEL, 'MYWEAPONS_LISTING_DELETE');
                    const msg = channel ? await channel.messages.fetch(existing.discord_message_id) : null;
                    if (msg) await msg.delete();
                } catch {}
            }
                            if (existing.batch_id) db.prepare('DELETE FROM my_weapons WHERE batch_id = ?').run(existing.batch_id);
                else db.prepare('DELETE FROM my_weapons WHERE id = ?').run(id);

            emitRealtime('craft:status', { requestId: existing.craft_request_id || null, myWeaponId: id, status: 'deleted', action: 'myweapon-deleted' });
            audit(req.session.user, 'weapon.delete', {
                target_type: 'my_weapon',
                target_id: id,
                details: {
                    weapon_name: existing.weapon_name,
                    owner: existing.user_name,
                    batch_id: existing.batch_id || null,
                },
            });
            queueArmesBoardRefresh('weapon.delete');
            res.json({ success: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
}

module.exports = { registerMyWeaponsRoutes };
