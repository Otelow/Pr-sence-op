// CHANTIER COMMANDES 15/05/2026 — routes catalogue/publish commandes
// STABILISATION 15/05/2026 — corrections sécurité et persistance
// MODIFIE CHANTIER 6 - 14/05/2026 - routes admin suivi commandes/avances extraites

// STABILISATION FINALE v2 16/05/2026 — audit des actions avances commandes
const { audit } = require('../../../shared/auditLog');

function parseId(v, max = 2_000_000) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

function registerOrderAdvanceRoutes(app, deps) {
    const {
        requireAdmin,
        getOrderAdvances,
        upsertOrderAdvance,
        deleteOrderAdvance,
        settleOrderAdvance,
        saveOrderAdvanceRepayment,
        deleteOrderAdvanceRepayment,
        getOrderAdvanceCatalog,
        publishOrderAdvance,
        refreshOrderDiscordMessage,
    } = deps;

    app.get('/api/admin/order-advances/catalog', requireAdmin, (req, res) => {
        try {
            res.json({ ingredients: getOrderAdvanceCatalog() });
        } catch (e) {
            res.status(500).json({ ingredients: [], error: e.message });
        }
    });

    app.get('/api/admin/order-advances', requireAdmin, (req, res) => {
        try {
            res.json({ advances: getOrderAdvances() });
        } catch (e) {
            res.status(500).json({ advances: [], error: e.message });
        }
    });

    app.post('/api/admin/order-advances', requireAdmin, (req, res) => {
        try {
            const id = upsertOrderAdvance(req.body || {});
            audit(req.session.user, 'order.create', { target_type: 'order', target_id: id, details: req.body || {} });
            res.json({ success: true, id, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.put('/api/admin/order-advances/:id', requireAdmin, (req, res) => {
        try {
            const orderId = parseId(req.params.id);
            if (orderId === null) return res.status(400).json({ error: 'ID invalide' });
            const id = upsertOrderAdvance(req.body || {}, orderId);
            audit(req.session.user, 'order.update', { target_type: 'order', target_id: id, details: req.body || {} });
            res.json({ success: true, id, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.put('/api/admin/order-advances/:id/settle', requireAdmin, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            settleOrderAdvance(id);
            audit(req.session.user, 'order.settle', { target_type: 'order', target_id: id });
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.delete('/api/admin/order-advances/:id', requireAdmin, (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            deleteOrderAdvance(id);
            audit(req.session.user, 'order.delete', { target_type: 'order', target_id: id });
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/admin/order-advances/:id/publish', requireAdmin, async (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            const result = await publishOrderAdvance(id);
            audit(req.session.user, 'order.publish', { target_type: 'order', target_id: id, details: { messageId: result.messageId } });
            res.json({ success: true, messageId: result.messageId, advances: getOrderAdvances() });
        } catch (e) {
            const message = e.message || 'Publication impossible';
            const status = message.toLowerCase().includes('déjà publiée') || message.toLowerCase().includes('deja publiee') ? 400 : 502;
            res.status(status).json({ error: message });
        }
    });

    app.post('/api/admin/order-advances/:id/refresh-message', requireAdmin, async (req, res) => {
        try {
            const id = parseId(req.params.id);
            if (id === null) return res.status(400).json({ error: 'ID invalide' });
            await refreshOrderDiscordMessage(id);
            audit(req.session.user, 'order.refresh_message', { target_type: 'order', target_id: id });
            res.json({ success: true });
        } catch (e) {
            res.status(502).json({ error: e.message || 'Édition Discord impossible' });
        }
    });

    app.post('/api/admin/order-advances/:id/repayments', requireAdmin, (req, res) => {
        try {
            const orderId = parseId(req.params.id);
            if (orderId === null) return res.status(400).json({ error: 'ID invalide' });
            const repaymentId = saveOrderAdvanceRepayment(orderId, req.body || {});
            audit(req.session.user, 'order.repayment.create', { target_type: 'order', target_id: orderId, details: { repaymentId, ...(req.body || {}) } });
            res.json({ success: true, id: repaymentId, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.put('/api/admin/order-advances/:id/repayments/:repaymentId', requireAdmin, (req, res) => {
        try {
            const orderId = parseId(req.params.id);
            const repaymentId = parseId(req.params.repaymentId);
            if (orderId === null || repaymentId === null) return res.status(400).json({ error: 'ID invalide' });
            saveOrderAdvanceRepayment(orderId, req.body || {}, repaymentId);
            audit(req.session.user, 'order.repayment.update', { target_type: 'order', target_id: orderId, details: { repaymentId, ...(req.body || {}) } });
            res.json({ success: true, id: repaymentId, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.delete('/api/admin/order-advances/:id/repayments/:repaymentId', requireAdmin, (req, res) => {
        try {
            const orderId = parseId(req.params.id);
            const repaymentId = parseId(req.params.repaymentId);
            if (orderId === null || repaymentId === null) return res.status(400).json({ error: 'ID invalide' });
            deleteOrderAdvanceRepayment(orderId, repaymentId);
            audit(req.session.user, 'order.repayment.delete', { target_type: 'order', target_id: orderId, details: { repaymentId } });
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });


}

module.exports = {
    registerOrderAdvanceRoutes,
};
