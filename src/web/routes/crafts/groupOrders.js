// COMMANDES GROUPES 26/05/2026 — routes commandes armes organisations
const { audit } = require('../../../shared/auditLog');
const { emitRealtime } = require('../../../shared/realtime');

function parseId(value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sendRouteError(res, error) {
    const status = Number(error?.statusCode) || 400;
    res.status(status).json({ error: error?.message || 'Erreur commande groupe' });
}

function registerGroupOrderRoutes(app, deps) {
    const {
        requireAuth,
        canValidateCraft,
        getGroupOrderCatalog,
        getGroupOrders,
        getGroupOrder,
        upsertGroupOrder,
        recordGroupOrderCraft,
        cancelGroupOrder,
        deleteGroupOrder,
    } = deps;

    function requireGroupOrderAccess(req, res, next) {
        if (!canValidateCraft(req.session?.user)) {
            return res.status(403).json({ error: 'Accès réservé aux hauts gradés' });
        }
        return next();
    }

    const readGuards = [requireAuth];
    const writeGuards = [requireAuth, requireGroupOrderAccess];

    app.get('/api/crafts/group-orders/catalog', ...readGuards, (req, res) => {
        try {
            res.json(getGroupOrderCatalog());
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    app.get('/api/crafts/group-orders', ...readGuards, (req, res) => {
        try {
            res.json({ orders: getGroupOrders() });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    app.get('/api/crafts/group-orders/:id', ...readGuards, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (!id) return res.status(400).json({ error: 'ID invalide' });
            return res.json({ order: getGroupOrder(id) });
        } catch (error) {
            return sendRouteError(res, error);
        }
    });

    app.post('/api/crafts/group-orders', ...writeGuards, (req, res) => {
        try {
            const order = upsertGroupOrder(req.body || {}, req.session.user);
            audit(req.session.user, 'groupOrder.create', {
                target_type: 'group_order',
                target_id: order.id,
                details: {
                    organization_name: order.organization_name,
                    total_amount: order.total_amount,
                    items: order.items?.length || 0,
                },
            });
            emitRealtime('groupOrder:updated', { action: 'create', id: order.id });
            res.json({ success: true, order, orders: getGroupOrders() });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    app.put('/api/crafts/group-orders/:id', ...writeGuards, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (!id) return res.status(400).json({ error: 'ID invalide' });
            const order = upsertGroupOrder(req.body || {}, req.session.user, id);
            audit(req.session.user, 'groupOrder.update', {
                target_type: 'group_order',
                target_id: order.id,
                details: {
                    organization_name: order.organization_name,
                    total_amount: order.total_amount,
                    items: order.items?.length || 0,
                },
            });
            emitRealtime('groupOrder:updated', { action: 'update', id: order.id });
            res.json({ success: true, order, orders: getGroupOrders() });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    app.post('/api/crafts/group-orders/:id/crafts', ...writeGuards, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (!id) return res.status(400).json({ error: 'ID invalide' });
            const order = recordGroupOrderCraft(id, req.body || {}, req.session.user);
            audit(req.session.user, 'groupOrder.craft', {
                target_type: 'group_order',
                target_id: order.id,
                details: {
                    organization_name: order.organization_name,
                    crafted: order.progress?.crafted || 0,
                    ordered: order.progress?.ordered || 0,
                },
            });
            emitRealtime('groupOrder:updated', { action: 'craft', id: order.id });
            res.json({ success: true, order, orders: getGroupOrders() });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    app.patch('/api/crafts/group-orders/:id/cancel', ...writeGuards, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (!id) return res.status(400).json({ error: 'ID invalide' });
            const order = cancelGroupOrder(id, req.session.user);
            audit(req.session.user, 'groupOrder.cancel', {
                target_type: 'group_order',
                target_id: order.id,
                details: { organization_name: order.organization_name },
            });
            emitRealtime('groupOrder:updated', { action: 'cancel', id: order.id });
            res.json({ success: true, order, orders: getGroupOrders() });
        } catch (error) {
            sendRouteError(res, error);
        }
    });

    if (typeof deleteGroupOrder === 'function') {
        app.delete('/api/crafts/group-orders/:id', ...writeGuards, (req, res) => {
            try {
                const id = parseId(req.params.id);
                if (!id) return res.status(400).json({ error: 'ID invalide' });
                const result = deleteGroupOrder(id, req.session.user);
                audit(req.session.user, result === 'deleted' ? 'groupOrder.delete' : 'groupOrder.cancel', {
                    target_type: 'group_order',
                    target_id: id,
                    details: { result },
                });
                emitRealtime('groupOrder:updated', { action: result, id });
                res.json({ success: true, result, orders: getGroupOrders() });
            } catch (error) {
                sendRouteError(res, error);
            }
        });
    }
}

module.exports = {
    registerGroupOrderRoutes,
};
