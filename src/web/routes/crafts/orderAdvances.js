// STABILISATION 15/05/2026 — corrections sécurité et persistance
// MODIFIE CHANTIER 6 - 14/05/2026 - routes admin suivi commandes/avances extraites

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
    } = deps;

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
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/admin/order-advances/:id/repayments', requireAdmin, (req, res) => {
        try {
            const orderId = parseId(req.params.id);
            if (orderId === null) return res.status(400).json({ error: 'ID invalide' });
            const repaymentId = saveOrderAdvanceRepayment(orderId, req.body || {});
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
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });


}

module.exports = {
    registerOrderAdvanceRoutes,
};
