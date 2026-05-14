// MODIFIE CHANTIER 6 - 14/05/2026 - routes admin suivi commandes/avances extraites

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
            const id = upsertOrderAdvance(req.body || {}, parseInt(req.params.id, 10));
            res.json({ success: true, id, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.put('/api/admin/order-advances/:id/settle', requireAdmin, (req, res) => {
        try {
            settleOrderAdvance(parseInt(req.params.id, 10));
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.delete('/api/admin/order-advances/:id', requireAdmin, (req, res) => {
        try {
            deleteOrderAdvance(parseInt(req.params.id, 10));
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.post('/api/admin/order-advances/:id/repayments', requireAdmin, (req, res) => {
        try {
            const orderId = parseInt(req.params.id, 10);
            const repaymentId = saveOrderAdvanceRepayment(orderId, req.body || {});
            res.json({ success: true, id: repaymentId, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.put('/api/admin/order-advances/:id/repayments/:repaymentId', requireAdmin, (req, res) => {
        try {
            const orderId = parseInt(req.params.id, 10);
            const repaymentId = parseInt(req.params.repaymentId, 10);
            saveOrderAdvanceRepayment(orderId, req.body || {}, repaymentId);
            res.json({ success: true, id: repaymentId, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });

    app.delete('/api/admin/order-advances/:id/repayments/:repaymentId', requireAdmin, (req, res) => {
        try {
            deleteOrderAdvanceRepayment(parseInt(req.params.id, 10), parseInt(req.params.repaymentId, 10));
            res.json({ success: true, advances: getOrderAdvances() });
        } catch (e) {
            res.status(400).json({ error: e.message });
        }
    });


}

module.exports = {
    registerOrderAdvanceRoutes,
};