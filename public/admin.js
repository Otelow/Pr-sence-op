// CC PATCH 19/05/2026 — vrais effets visibles
// QUICK WINS 2 18/05/2026 — export CSV audit log
// QUICK WINS 3 18/05/2026 — erreurs 24h monitoring
// ONGLET HISTORIQUE 16/05/2026 — consultation visuelle audit log admin

// ==========================================
// COMMAND CENTER — particules orange flottantes
// Injection volontairement placée tout en haut : si une autre logique
// JS plante plus loin, l'effet visuel est déjà posé.
// ==========================================
(function injectCommandCenterParticlesEarly() {
    function inject() {
        if (document.querySelector('.cc-particles')) return;
        if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return;

        const container = document.createElement('div');
        container.className = 'cc-particles';
        container.setAttribute('aria-hidden', 'true');

        for (let i = 0; i < 14; i++) {
            const particle = document.createElement('div');
            particle.className = 'cc-particle';
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.animationDelay = `${Math.random() * 9}s`;
            particle.style.animationDuration = `${8 + Math.random() * 6}s`;
            container.appendChild(particle);
        }

        document.body.appendChild(container);
    }

    if (document.body) inject();
    else document.addEventListener('DOMContentLoaded', inject, { once: true });
})();

// CHANTIER COMMANDES v3 15/05/2026 — couleurs ingrédients + total jaune
// CHANTIER COMMANDES v2 15/05/2026 — fusion enregistrer + publier
// CHANTIER COMMANDES 15/05/2026 — UI commandes ingrédients et publication Discord
// FINAL D3 16/05/2026 — monitoring runtime admin
// RÉORG ADMIN 17/05/2026 — drag-drop onglets + localStorage
// ============================================================
// ADMIN PANEL — JS
// ============================================================
let adminWeapons = [];
let adminMyWeaponNames = [];
let adminIngredients = [];
let adminStocks = [];
let adminOrgs = [];
let adminRoles = [];
let adminMembers = [];
let adminOrderAdvances = [];
let orderIngredientsCatalog = [];
let adminAuditLogs = [];
let adminAuditTotal = 0;
let adminAuditOffset = 0;
let adminAuditLoaded = false;
const ADMIN_AUDIT_PAGE_SIZE = 50;
let adminAuditFilters = {};
let monitoringTimer = null;
let adminMembersLoadedAt = 0;
let editingIngredients = []; // [{ ingredient_id, name, amount }]
let adminWeaponQuery = '';
const ADMIN_TAB_ORDER_KEY = 'admin.tabOrder.v1';
let adminReorderMode = false;
let adminDraggedTab = null;

const ORDER_ADVANCE_PARTICIPANTS = [
    { id: 'otelow', name: 'Otelow' },
    { id: 'ney', name: 'Ney' },
    { id: 'le-h', name: 'Le H' },
];
let adminIngredientQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
    applySavedAdminTabOrder();

    // Vérifier admin
    try {
        const r = await fetch('/api/admin/check');
        const d = await r.json();
        if (!d.isAdmin) {
            window.location.href = '/dashboard';
            return;
        }
    } catch {
        window.location.href = '/dashboard';
        return;
    }

    loadAdminWeapons();
    loadAdminMyWeaponNames();
    loadAdminIngredients();
    loadAdminStocks();
    loadAdminOrgs();
    loadAdminRoles();
    await loadOrderIngredientsCatalog();
    renderOrderAdvanceItems();
    loadAdminOrderAdvances();
    initOrderAdvanceParticipants();

    document.getElementById('adminWeaponSearch')?.addEventListener('input', e => {
        adminWeaponQuery = e.target.value.trim().toLowerCase();
        renderAdminWeapons();
    });
    document.getElementById('adminIngredientSearch')?.addEventListener('input', e => {
        adminIngredientQuery = e.target.value.trim().toLowerCase();
        renderAdminIngredients();
    });
});

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeAttr(value) {
    return escapeHtml(value);
}

function escapeJsArg(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ');
}

function safeImageUrl(url) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    try {
        const parsed = new URL(value, window.location.origin);
        if (['http:', 'https:'].includes(parsed.protocol)) return parsed.href;
        if (parsed.protocol === 'data:' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) return value;
    } catch {}
    return '';
}

function stockImageUrl(stock) {
    const directUrl = safeImageUrl(stock?.image_url);
    if (directUrl) return directUrl;

    const imagePath = String(stock?.image_path || '').trim();
    if (!imagePath) return '';
    return safeImageUrl(imagePath.startsWith('/') || /^https?:\/\//i.test(imagePath)
        ? imagePath
        : `/crafts/images/${imagePath}`);
}

function safeColor(color) {
    const value = String(color || '').trim();
    return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#888';
}

function toast(msg, type) {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

function confirmAction(options = {}) {
    const {
        title = 'Confirmer',
        message = 'Confirmer cette action ?',
        confirmText = 'Confirmer',
        cancelText = 'Annuler',
        danger = false,
    } = options;

    return new Promise(resolve => {
        let modal = document.getElementById('confirmActionModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'confirmActionModal';
            modal.className = 'confirm-action-modal';
            modal.innerHTML = `
                <div class="confirm-action-backdrop" data-confirm-cancel></div>
                <div class="confirm-action-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmActionTitle">
                    <div class="confirm-action-icon">!</div>
                    <h3 id="confirmActionTitle" class="confirm-action-title"></h3>
                    <p class="confirm-action-message"></p>
                    <div class="confirm-action-buttons">
                        <button type="button" class="btn-secondary" data-confirm-cancel></button>
                        <button type="button" class="btn-primary" data-confirm-ok></button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        const okButton = modal.querySelector('[data-confirm-ok]');
        const cancelButtons = modal.querySelectorAll('[data-confirm-cancel]');
        modal.querySelector('.confirm-action-title').textContent = title;
        modal.querySelector('.confirm-action-message').textContent = message;
        modal.querySelector('.confirm-action-buttons [data-confirm-cancel]').textContent = cancelText;
        okButton.textContent = confirmText;
        modal.classList.toggle('danger', !!danger);
        modal.style.display = 'flex';
        okButton.focus();

        const cleanup = value => {
            modal.style.display = 'none';
            okButton.removeEventListener('click', onOk);
            cancelButtons.forEach(btn => btn.removeEventListener('click', onCancel));
            document.removeEventListener('keydown', onKey);
            resolve(value);
        };
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        const onKey = e => {
            if (e.key === 'Escape') cleanup(false);
            if (e.key === 'Enter') cleanup(true);
        };
        okButton.addEventListener('click', onOk);
        cancelButtons.forEach(btn => btn.addEventListener('click', onCancel));
        document.addEventListener('keydown', onKey);
    });
}

// ─── TABS ───────────────────────────────────────
function switchAdminTab(name) {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.toggle('active', b.dataset.adminTab === name));
    document.querySelectorAll('.admin-tab-content').forEach(s => {
        s.style.display = (s.id === `adminTab-${name}`) ? 'block' : 'none';
    });
    if (name === 'advances') {
        loadAdminMembers();
        loadAdminOrderAdvances();
    }
    if (name === 'audit') {
        if (!adminAuditLoaded) initAdminAuditTab();
        else renderAdminAuditTable();
    }
    if (name === 'monitoring') {
        startMonitoringPolling();
    } else {
        stopMonitoringPolling();
    }
}
window.switchAdminTab = switchAdminTab;

// ─── MONITORING ─────────────────────────────────────
async function loadAdminMonitoring() {
    const grid = document.getElementById('monitoringGrid');
    try {
        const res = await fetch('/api/admin/health-detailed');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        renderMonitoringGrid(data);
    } catch (e) {
        if (grid) {
            grid.innerHTML = `<div class="monitoring-card monitoring-error">❌ ${escapeHtml(e.message)}</div>`;
        }
    }
}

function formatUptime(seconds) {
    const value = Number(seconds) || 0;
    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    if (days) return `${days}j ${hours}h ${minutes}m`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function renderMonitoringGrid(data) {
    const grid = document.getElementById('monitoringGrid');
    if (!grid) return;

    const cards = [
        { label: 'Uptime', value: formatUptime(data.uptime_seconds), color: 'green' },
        { label: 'Mémoire heap', value: `${data.memory_heap_mb} MB`, color: data.memory_heap_mb > 500 ? 'orange' : 'normal' },
        { label: 'Mémoire RSS', value: `${data.memory_rss_mb} MB`, color: data.memory_rss_mb > 800 ? 'orange' : 'normal' },
        { label: 'Bot Discord', value: data.bot_ready ? '✅ Ready' : '❌ Down', color: data.bot_ready ? 'green' : 'red' },
        { label: 'Ping Discord', value: data.bot_ping_ms != null ? `${data.bot_ping_ms} ms` : '—', color: data.bot_ping_ms > 300 ? 'orange' : 'normal' },
        { label: 'Clients WS', value: data.ws_clients ?? 0, color: 'normal' },
        {
            label: 'Taille DB',
            value: data.db_size_kb < 1024 ? `${data.db_size_kb} KB` : `${(data.db_size_kb / 1024).toFixed(1)} MB`,
            color: 'normal',
        },
        {
            label: 'Backups',
            value: `${data.backups_count || 0} (${data.backups_last ? new Date(data.backups_last).toLocaleDateString('fr-FR') : '—'})`,
            color: data.backups_count ? 'normal' : 'orange',
        },
        {
            label: 'Erreurs 24h',
            value: data.errors_24h ?? 0,
            color: (data.errors_24h ?? 0) > 10 ? 'red' : (data.errors_24h ?? 0) > 0 ? 'orange' : 'green',
        },
        { label: 'Version', value: `v${data.version} (Node ${data.node_version})`, color: 'normal' },
    ];

    const cardsHtml = cards.map(card => `
        <div class="monitoring-card monitoring-card-${card.color}">
            <div class="monitoring-label">${escapeHtml(card.label)}</div>
            <div class="monitoring-value">${escapeHtml(String(card.value))}</div>
        </div>
    `).join('');

    const tableHtml = `
        <div class="monitoring-card monitoring-card-wide">
            <div class="monitoring-label">Tables SQLite</div>
            <table class="monitoring-table">
                ${(data.db_tables || []).map(table => `
                    <tr>
                        <td>${escapeHtml(table.name)}</td>
                        <td>${Number(table.rows || 0).toLocaleString('fr-FR')}</td>
                    </tr>
                `).join('')}
            </table>
        </div>
    `;

    grid.innerHTML = cardsHtml + tableHtml;
}

function startMonitoringPolling() {
    loadAdminMonitoring();
    if (monitoringTimer) clearInterval(monitoringTimer);
    monitoringTimer = setInterval(loadAdminMonitoring, 10000);
}

function stopMonitoringPolling() {
    if (!monitoringTimer) return;
    clearInterval(monitoringTimer);
    monitoringTimer = null;
}

window.loadAdminMonitoring = loadAdminMonitoring;

// ==========================================
// RÉORGANISATION ONGLETS ADMIN (drag & drop)
// ==========================================
function getAdminTabsNav() {
    return document.getElementById('adminTabsNav') || document.querySelector('.admin-tabs');
}

function getAdminTabButtons() {
    const nav = getAdminTabsNav();
    return nav ? Array.from(nav.querySelectorAll('[data-admin-tab]')) : [];
}

function applySavedAdminTabOrder() {
    const raw = localStorage.getItem(ADMIN_TAB_ORDER_KEY);
    if (!raw) return;

    let savedOrder;
    try {
        savedOrder = JSON.parse(raw);
    } catch {
        return;
    }
    if (!Array.isArray(savedOrder)) return;

    const nav = getAdminTabsNav();
    if (!nav) return;

    const buttons = getAdminTabButtons();
    const byName = new Map(buttons.map(button => [button.dataset.adminTab, button]));
    savedOrder.forEach(name => {
        const button = byName.get(name);
        if (button) nav.appendChild(button);
    });
    buttons.forEach(button => {
        if (!savedOrder.includes(button.dataset.adminTab)) nav.appendChild(button);
    });
}

function saveAdminTabOrder() {
    const order = getAdminTabButtons().map(button => button.dataset.adminTab);
    localStorage.setItem(ADMIN_TAB_ORDER_KEY, JSON.stringify(order));
}

function toggleAdminTabReorder() {
    adminReorderMode = !adminReorderMode;
    const nav = getAdminTabsNav();
    const toggleBtn = document.getElementById('adminReorderToggleBtn');
    const resetBtn = document.getElementById('adminReorderResetBtn');
    if (!nav || !toggleBtn) return;

    if (adminReorderMode) {
        nav.classList.add('admin-tabs-reorder');
        toggleBtn.innerHTML = '✅ Terminé';
        toggleBtn.classList.add('btn-primary');
        toggleBtn.classList.remove('btn-secondary');
        if (resetBtn) resetBtn.style.display = '';
        enableTabDragAndDrop();
        toast('🔧 Glisse les onglets pour réorganiser', 'info');
    } else {
        nav.classList.remove('admin-tabs-reorder');
        toggleBtn.innerHTML = '🔧 Réorganiser';
        toggleBtn.classList.remove('btn-primary');
        toggleBtn.classList.add('btn-secondary');
        if (resetBtn) resetBtn.style.display = 'none';
        disableTabDragAndDrop();
        saveAdminTabOrder();
        toast('✅ Ordre sauvegardé', 'success');
    }
}

function enableTabDragAndDrop() {
    getAdminTabButtons().forEach(button => {
        button.setAttribute('draggable', 'true');
        button.addEventListener('click', onTabReorderClick, true);
        button.addEventListener('dragstart', onTabDragStart);
        button.addEventListener('dragover', onTabDragOver);
        button.addEventListener('drop', onTabDrop);
        button.addEventListener('dragend', onTabDragEnd);
        button.addEventListener('dragenter', onTabDragEnter);
        button.addEventListener('dragleave', onTabDragLeave);
    });
}

function disableTabDragAndDrop() {
    getAdminTabButtons().forEach(button => {
        button.removeAttribute('draggable');
        button.removeEventListener('click', onTabReorderClick, true);
        button.removeEventListener('dragstart', onTabDragStart);
        button.removeEventListener('dragover', onTabDragOver);
        button.removeEventListener('drop', onTabDrop);
        button.removeEventListener('dragend', onTabDragEnd);
        button.removeEventListener('dragenter', onTabDragEnter);
        button.removeEventListener('dragleave', onTabDragLeave);
        button.classList.remove('tab-dragging', 'tab-drag-over');
    });
}

function onTabReorderClick(e) {
    if (!adminReorderMode) return;
    e.preventDefault();
    e.stopImmediatePropagation();
}

function onTabDragStart(e) {
    adminDraggedTab = e.currentTarget;
    e.currentTarget.classList.add('tab-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.currentTarget.dataset.adminTab);
}

function onTabDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function onTabDragEnter(e) {
    if (e.currentTarget !== adminDraggedTab) {
        e.currentTarget.classList.add('tab-drag-over');
    }
}

function onTabDragLeave(e) {
    e.currentTarget.classList.remove('tab-drag-over');
}

function onTabDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.classList.remove('tab-drag-over');
    if (!adminDraggedTab || adminDraggedTab === target) return;

    const nav = getAdminTabsNav();
    const buttons = getAdminTabButtons();
    const fromIdx = buttons.indexOf(adminDraggedTab);
    const toIdx = buttons.indexOf(target);
    if (!nav || fromIdx < 0 || toIdx < 0) return;

    if (fromIdx < toIdx) {
        nav.insertBefore(adminDraggedTab, target.nextSibling);
    } else {
        nav.insertBefore(adminDraggedTab, target);
    }
}

function onTabDragEnd(e) {
    e.currentTarget.classList.remove('tab-dragging');
    getAdminTabButtons().forEach(button => button.classList.remove('tab-drag-over'));
    adminDraggedTab = null;
}

async function resetAdminTabOrder() {
    const ok = await confirmAction({
        title: 'Réinitialiser',
        message: 'Réinitialiser l’ordre des onglets ?',
        confirmText: 'Réinitialiser',
        danger: true,
    });
    if (!ok) return;
    localStorage.removeItem(ADMIN_TAB_ORDER_KEY);
    location.reload();
}

window.toggleAdminTabReorder = toggleAdminTabReorder;
window.resetAdminTabOrder = resetAdminTabOrder;

// ─── HISTORIQUE AUDIT ─────────────────────────────────────
async function initAdminAuditTab() {
    adminAuditOffset = 0;
    adminAuditLogs = [];
    adminAuditLoaded = true;
    await loadAdminAuditLogs();
}

async function loadAdminAuditLogs() {
    const params = new URLSearchParams();
    params.set('limit', ADMIN_AUDIT_PAGE_SIZE);
    params.set('offset', adminAuditOffset);
    if (adminAuditFilters.action) params.set('action', adminAuditFilters.action);
    if (adminAuditFilters.user_id) params.set('user_id', adminAuditFilters.user_id);
    if (adminAuditFilters.since) params.set('since', adminAuditFilters.since);

    try {
        const res = await fetch(`/api/admin/audit-log?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const newLogs = data.logs || [];
        if (adminAuditOffset === 0) adminAuditLogs = newLogs;
        else adminAuditLogs = adminAuditLogs.concat(newLogs);
        adminAuditTotal = Number.isFinite(Number(data.total))
            ? Number(data.total)
            : adminAuditLogs.length + (newLogs.length === ADMIN_AUDIT_PAGE_SIZE ? ADMIN_AUDIT_PAGE_SIZE : 0);
        renderAdminAuditTable();
    } catch (e) {
        console.error('Erreur chargement audit log:', e);
        toast('❌ Erreur chargement historique', 'error');
    }
}

async function loadMoreAuditLogs() {
    adminAuditOffset += ADMIN_AUDIT_PAGE_SIZE;
    await loadAdminAuditLogs();
}

function applyAuditFilters() {
    adminAuditFilters = {
        action: document.getElementById('auditFilterAction')?.value.trim() || '',
        user_id: document.getElementById('auditFilterUserId')?.value.trim() || '',
    };
    const sinceDate = document.getElementById('auditFilterSince')?.value;
    if (sinceDate) {
        adminAuditFilters.since = Math.floor(new Date(`${sinceDate}T00:00:00+02:00`).getTime() / 1000);
    }
    adminAuditOffset = 0;
    loadAdminAuditLogs();
}

function resetAuditFilters() {
    const actionInput = document.getElementById('auditFilterAction');
    const userInput = document.getElementById('auditFilterUserId');
    const sinceInput = document.getElementById('auditFilterSince');
    if (actionInput) actionInput.value = '';
    if (userInput) userInput.value = '';
    if (sinceInput) sinceInput.value = '';
    adminAuditFilters = {};
    adminAuditOffset = 0;
    loadAdminAuditLogs();
}

function exportAuditCSV() {
    const params = new URLSearchParams();
    if (adminAuditFilters.action) params.set('action', adminAuditFilters.action);
    if (adminAuditFilters.user_id) params.set('user_id', adminAuditFilters.user_id);
    if (adminAuditFilters.since) params.set('since', adminAuditFilters.since);
    const query = params.toString();
    window.location.href = `/api/admin/audit-log/export.csv${query ? `?${query}` : ''}`;
}

function auditActionClass(action) {
    const category = String(action || '').split('.')[0] || 'default';
    return category.replace(/[^a-zA-Z0-9_-]/g, '');
}

function renderAdminAuditTable() {
    const tbody = document.getElementById('auditTableBody');
    const totalEl = document.getElementById('auditTotal');
    const loadedEl = document.getElementById('auditLoaded');
    const moreBtn = document.getElementById('auditLoadMoreBtn');
    if (!tbody || !totalEl || !loadedEl || !moreBtn) return;

    totalEl.textContent = adminAuditTotal.toLocaleString('fr-FR');
    loadedEl.textContent = adminAuditLogs.length.toLocaleString('fr-FR');
    moreBtn.style.display = adminAuditLogs.length < adminAuditTotal ? '' : 'none';

    if (!adminAuditLogs.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">Aucune action trouvée.</td></tr>';
        return;
    }

    tbody.innerHTML = adminAuditLogs.map(log => {
        const timestamp = Number(log.created_at) || 0;
        const date = new Date(timestamp * 1000);
        const dateStr = date.toLocaleString('fr-FR', {
            dateStyle: 'short',
            timeStyle: 'medium',
            timeZone: 'Europe/Paris',
        });
        const userCell = log.user_name
            ? `${escapeHtml(log.user_name)} <small class="audit-user-id">${escapeHtml((log.user_id || '').slice(-6))}</small>`
            : '<em>—</em>';
        const actionName = String(log.action || 'unknown');
        const actionCell = `<span class="audit-action audit-action-${escapeHtml(auditActionClass(actionName))}">${escapeHtml(actionName)}</span>`;
        const targetCell = log.target_type
            ? `${escapeHtml(log.target_type)} <small>#${escapeHtml(log.target_id || '?')}</small>`
            : '<em>—</em>';
        const detailsCell = log.details
            ? `<details class="audit-details"><summary>Voir</summary><pre>${escapeHtml(JSON.stringify(log.details, null, 2))}</pre></details>`
            : '<em>—</em>';
        return `
            <tr>
                <td class="audit-date">${escapeHtml(dateStr)}</td>
                <td>${userCell}</td>
                <td>${actionCell}</td>
                <td>${targetCell}</td>
                <td>${detailsCell}</td>
            </tr>
        `;
    }).join('');
}

window.applyAuditFilters = applyAuditFilters;
window.resetAuditFilters = resetAuditFilters;
window.loadMoreAuditLogs = loadMoreAuditLogs;
window.exportAuditCSV = exportAuditCSV;

// ─── ROLES (impersonate) ────────────────────────
async function loadAdminRoles() {
    try {
        const r = await fetch('/api/roles');
        const d = await r.json();
        adminRoles = d.roles || [];
        renderImpersonateDropdown();
    } catch {}
}

function renderImpersonateDropdown() {
    const list = document.getElementById('impersonateList');
    if (!list) return;
    list.innerHTML = adminRoles.map(role => {
        const color = safeColor(role.color);
        const colorDot = `<span class="role-color-dot" style="background:${color};"></span>`;
        return `
            <div class="custom-dropdown-item js-impersonate-role-option" data-role-name="${escapeAttr(String(role.name || '').toLowerCase())}" data-role-id="${escapeAttr(role.id)}" data-role-label="${escapeAttr(role.name)}" data-role-color="${color}">
                ${colorDot}
                <span class="custom-dropdown-item-label" style="color:${color};">@${escapeHtml(role.name)}</span>
                <span class="custom-dropdown-item-count">${role.memberCount || 0}</span>
            </div>
        `;
    }).join('');

    const search = document.getElementById('impersonateSearch');
    if (search) {
        search.oninput = () => {
            const q = search.value.toLowerCase().trim();
            list.querySelectorAll('.custom-dropdown-item').forEach(item => {
                const name = item.dataset.roleName || '';
                item.style.display = !q || name.includes(q) ? 'flex' : 'none';
            });
        };
    }
}

document.addEventListener('click', event => {
    const roleOption = event.target.closest?.('.js-impersonate-role-option');
    if (!roleOption) return;
    selectImpersonateRole(
        roleOption.dataset.roleId || '',
        roleOption.dataset.roleLabel || '',
        roleOption.dataset.roleColor || ''
    );
});

function toggleImpersonateDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('impersonateMenu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    if (menu.style.display === 'block') {
        const search = document.getElementById('impersonateSearch');
        if (search) {
            search.value = '';
            document.querySelectorAll('#impersonateList .custom-dropdown-item').forEach(i => i.style.display = 'flex');
            setTimeout(() => search.focus(), 50);
        }
    }
}

function selectImpersonateRole(id, name, color) {
    document.getElementById('impersonateRoleId').value = id;
    const label = document.getElementById('impersonateLabel');
    const safe = safeColor(color);
    if (label) {
        label.classList.remove('custom-dropdown-placeholder');
        label.innerHTML = `<span class="role-color-dot" style="background:${safe};margin-right:8px;"></span> @${escapeHtml(name)}`;
        label.style.color = safe;
    }
    document.getElementById('impersonateMenu').style.display = 'none';
}

window.toggleImpersonateDropdown = toggleImpersonateDropdown;
window.selectImpersonateRole = selectImpersonateRole;

document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown-menu').forEach(m => m.style.display = 'none');
    }
});

function applyImpersonate() {
    const roleId = document.getElementById('impersonateRoleId').value;
    if (!roleId) { toast('❌ Choisis un rôle', 'error'); return; }
    localStorage.setItem('impersonate_role', roleId);
    toast('✅ Vue impersonate active. Retourne au dashboard.');
}

function resetImpersonate() {
    localStorage.removeItem('impersonate_role');
    toast('↩ Vue impersonate désactivée');
}
window.applyImpersonate = applyImpersonate;
window.resetImpersonate = resetImpersonate;

// ─── ARMES ─────────────────────────────────────
async function loadAdminWeapons() {
    try {
        const r = await fetch('/api/crafts/weapons');
        const d = await r.json();
        adminWeapons = d.weapons || [];
        renderAdminWeapons();
    } catch {}
}

function renderAdminWeapons() {
    const list = document.getElementById('adminWeaponsList');
    if (adminWeapons.length === 0) {
        list.innerHTML = '<p class="empty">Aucune arme. Clique sur "+ Ajouter" pour commencer.</p>';
        return;
    }

    const filtered = adminWeapons.filter(w => {
        if (!adminWeaponQuery) return true;
        const haystack = [
            w.name,
            w.craft_price,
            w.sale_price,
            w.max_sale_price,
            ...(w.ingredients || []).map(i => i.name),
        ].join(' ').toLowerCase();
        return haystack.includes(adminWeaponQuery);
    });

    if (filtered.length === 0) {
        list.innerHTML = '<p class="empty">Aucune arme ne correspond a la recherche.</p>';
        return;
    }

    list.innerHTML = filtered.map(w => {
        const imageUrl = safeImageUrl(w.image_url);
        return `
        <div class="admin-weapon-row">
            ${imageUrl ? `<img class="admin-weapon-img" src="${imageUrl}" alt="${escapeHtml(w.name)}">` : '<span class="admin-weapon-placeholder">Arme</span>'}
            <div class="admin-weapon-info">
                <strong>${escapeHtml(w.name)}</strong>
                <small>
                    ${w.craft_time ? formatTime(w.craft_time) : ''}
                    ${w.craft_price ? ' - Craft : ' + w.craft_price.toLocaleString('fr-FR') + '$' : ''}
                    ${w.sale_price ? ' - Vente : ' + w.sale_price.toLocaleString('fr-FR') + '$' : ''}
                    ${w.max_sale_price ? ' - Max : ' + w.max_sale_price.toLocaleString('fr-FR') + '$' : ''}
                    - ${(w.ingredients || []).length} ingredients
                </small>
            </div>
            <div class="admin-weapon-actions">
                <button class="btn-secondary btn-small" onclick="openWeaponEditor(${w.id})">Modifier</button>
                <button class="btn-danger btn-small" onclick="deleteWeapon(${w.id})">Supprimer</button>
            </div>
        </div>
    `;
    }).join('');
}

function formatTime(s) {
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

function openWeaponEditor(id) {
    const modal = document.getElementById('weaponEditorModal');
    const title = document.getElementById('weaponEditorTitle');

    document.getElementById('weaponEditorForm').reset();
    document.getElementById('weaponImagePreview').innerHTML = '';
    document.getElementById('weaponPlanImagePreview').innerHTML = '';
    document.getElementById('planImageField').style.display = 'none';
    editingIngredients = [];

    const saleInput = document.getElementById('weaponSalePrice');
    if (saleInput) saleInput.value = 0;
    const maxSaleInput = document.getElementById('weaponMaxSalePrice');
    if (maxSaleInput) maxSaleInput.value = 0;

    if (id) {
        const w = adminWeapons.find(w => w.id === id);
        if (!w) return;

        title.textContent = `Modifier : ${w.name}`;
        document.getElementById('weaponId').value = w.id;
        document.getElementById('weaponName').value = w.name;
        document.getElementById('weaponCraftTime').value = w.craft_time || 0;
        document.getElementById('weaponCraftPrice').value = w.craft_price || 0;

        // Prix de vente conseillé
        if (saleInput) saleInput.value = w.sale_price || 0;
        if (maxSaleInput) maxSaleInput.value = w.max_sale_price || 0;

        document.getElementById('weaponRequiresPlan').checked = !!w.requires_plan;
        if (w.requires_plan) document.getElementById('planImageField').style.display = 'block';
        if (safeImageUrl(w.image_url)) document.getElementById('weaponImagePreview').innerHTML = `<img src="${safeImageUrl(w.image_url)}" alt="">`;
        if (safeImageUrl(w.plan_image_url)) document.getElementById('weaponPlanImagePreview').innerHTML = `<img src="${safeImageUrl(w.plan_image_url)}" alt="">`;

        editingIngredients = (w.ingredients || []).map(ing => ({
            ingredient_id: ing.ingredient_id || null,
            name: ing.name || '',
            amount: ing.amount || 0,
        }));
    } else {
        title.textContent = 'Ajouter une arme';
        document.getElementById('weaponId').value = '';
    }

    renderIngredientsEditor();
    modal.style.display = 'flex';
}

function closeWeaponEditor() {
    document.getElementById('weaponEditorModal').style.display = 'none';
}
window.openWeaponEditor = openWeaponEditor;
window.closeWeaponEditor = closeWeaponEditor;

function addIngredient() {
    editingIngredients.push({ ingredient_id: null, name: '', amount: 0 });
    renderIngredientsEditor();
}

function renderIngredientsEditor() {
    const list = document.getElementById('ingredientsList');
    if (!editingIngredients.length) {
        list.innerHTML = '<p class="empty-small">Aucun ingrédient — clique sur "+ Ajouter"</p>';
        return;
    }
    list.innerHTML = editingIngredients.map((ing, i) => {
        const options = '<option value="">— Choisir —</option>' +
            adminIngredients.map(opt => {
                const selected = ing.name === opt.name ? 'selected' : '';
                return `<option value="${opt.id}" data-name="${escapeHtml(opt.name)}" data-image="${opt.image_url || ''}" ${selected}>${escapeHtml(opt.name)}</option>`;
            }).join('');

        const previewImg = ing.name && adminIngredients.find(opt => opt.name === ing.name)?.image_url;
        const preview = previewImg ? `<img src="${previewImg}" class="ingredient-row-preview" alt="">` : '<span class="ingredient-row-placeholder">🧪</span>';

        return `
            <div class="ingredient-row">
                ${preview}
                <select onchange="updateIngredientName(${i}, this)">${options}</select>
                <input type="number" placeholder="Quantité" value="${ing.amount || 0}" oninput="updateIngredientAmount(${i}, this.value)" min="0">
                <button type="button" class="btn-danger btn-small" onclick="removeIngredient(${i})">×</button>
            </div>
        `;
    }).join('');
}

function updateIngredientName(index, selectEl) {
    if (!editingIngredients[index]) return;
    const opt = selectEl.options[selectEl.selectedIndex];
    editingIngredients[index].name = opt.dataset.name || '';
    editingIngredients[index].ingredient_id = parseInt(opt.value) || null;
    renderIngredientsEditor();
}

function updateIngredientAmount(index, value) {
    if (!editingIngredients[index]) return;
    editingIngredients[index].amount = parseInt(value) || 0;
}

function removeIngredient(index) {
    editingIngredients.splice(index, 1);
    renderIngredientsEditor();
}

window.addIngredient = addIngredient;
window.updateIngredientName = updateIngredientName;
window.updateIngredientAmount = updateIngredientAmount;
window.removeIngredient = removeIngredient;

// Toggle plan image field + previews images
document.addEventListener('change', (e) => {
    if (e.target.id === 'weaponRequiresPlan') {
        document.getElementById('planImageField').style.display = e.target.checked ? 'block' : 'none';
    }
    if (e.target.id === 'weaponImage') {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('weaponImagePreview').innerHTML = `<img src="${ev.target.result}">`;
        };
        reader.readAsDataURL(file);
    }
    if (e.target.id === 'weaponPlanImage') {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('weaponPlanImagePreview').innerHTML = `<img src="${ev.target.result}">`;
        };
        reader.readAsDataURL(file);
    }
    if (e.target.id === 'ingredientImage') {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('ingredientImagePreview').innerHTML = `<img src="${ev.target.result}">`;
        };
        reader.readAsDataURL(file);
    }
});

async function saveWeapon(e) {
    e.preventDefault();

    const id = document.getElementById('weaponId').value;
    const formData = new FormData();

    formData.append('name', document.getElementById('weaponName').value);
    formData.append('craft_time', document.getElementById('weaponCraftTime').value || '0');
    formData.append('craft_price', document.getElementById('weaponCraftPrice').value || '0');

    // Prix de vente conseillé
    const saleInput = document.getElementById('weaponSalePrice');
    formData.append('sale_price', saleInput ? (saleInput.value || '0') : '0');
    const maxSaleInput = document.getElementById('weaponMaxSalePrice');
    formData.append('max_sale_price', maxSaleInput ? (maxSaleInput.value || '0') : '0');

    formData.append('requires_plan', document.getElementById('weaponRequiresPlan').checked ? '1' : '0');
    formData.append('ingredients', JSON.stringify(editingIngredients));

    const file = document.getElementById('weaponImage').files[0];
    if (file) formData.append('image', file);

    const planFile = document.getElementById('weaponPlanImage').files[0];
    if (planFile) formData.append('plan_image', planFile);

    try {
        const url = id ? `/api/crafts/weapons/${id}` : '/api/crafts/weapons';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, { method, body: formData });
        const data = await res.json();

        if (res.ok) {
            toast('✅ Arme enregistrée');
            closeWeaponEditor();
            await loadAdminWeapons();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}
window.saveWeapon = saveWeapon;

async function deleteWeapon(id) {
    if (!await confirmAction({ title: 'Supprimer l’arme', message: 'Supprimer cette arme du catalogue ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/weapons/${id}`, { method: 'DELETE' });
        if (res.ok) {
            toast('Supprim?e');
            await loadAdminWeapons();
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}
window.deleteWeapon = deleteWeapon;

// ─── ARMES A VENDRE (Vos Armes) ───────────────────────────
async function loadAdminMyWeaponNames() {
    try {
        const r = await fetch('/api/crafts/myweapon-names');
        const d = await r.json();
        adminMyWeaponNames = d.names || [];
        renderAdminMyWeaponNames();
    } catch {
        adminMyWeaponNames = [];
        renderAdminMyWeaponNames();
    }
}

function renderAdminMyWeaponNames() {
    const list = document.getElementById('adminMyWeaponNamesList');
    if (!list) return;
    if (!adminMyWeaponNames.length) {
        list.innerHTML = '<p class="empty">Aucun nom configuré. Ajoute les armes disponibles pour Vos Armes.</p>';
        return;
    }
    list.innerHTML = adminMyWeaponNames.map(item => `
        <div class="admin-myweapon-name-row">
            <input type="text" class="comm-input admin-myweapon-name-input" id="myWeaponName-${item.id}" value="${escapeHtml(item.name)}">
            <input type="number" class="comm-input admin-myweapon-price-input" id="myWeaponSalePrice-${item.id}" min="0" value="${Number(item.sale_price) || 0}" placeholder="Prix vente">
            <input type="number" class="comm-input admin-myweapon-price-input" id="myWeaponMaxSalePrice-${item.id}" min="0" value="${Number(item.max_sale_price) || 0}" placeholder="Prix maximal">
            <span class="admin-myweapon-price-source">${item.price_source === 'craft_catalog' ? 'Prix catalogue craftable prioritaires si renseignés' : 'Prix Vos Armes'}</span>
            <div class="admin-myweapon-name-actions">
                <button class="btn-secondary btn-small" onclick="saveMyWeaponNameFromAdmin(${item.id})">Enregistrer</button>
                <button class="btn-danger btn-small" onclick="deleteMyWeaponNameFromAdmin(${item.id})">Supprimer</button>
            </div>
        </div>
    `).join('');
}

async function addMyWeaponNameFromAdmin() {
    const input = document.getElementById('newMyWeaponName');
    const name = input?.value?.trim();
    const saleInput = document.getElementById('newMyWeaponSalePrice');
    const maxSaleInput = document.getElementById('newMyWeaponMaxSalePrice');
    if (!name) { toast('❌ Nom requis', 'error'); return; }
    try {
        const res = await fetch('/api/crafts/myweapon-names', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                sale_price: saleInput?.value || 0,
                max_sale_price: maxSaleInput?.value || 0
            })
        });
        const data = await res.json();
        if (res.ok) {
            toast('✅ Nom ajouté');
            input.value = '';
            if (saleInput) saleInput.value = '';
            if (maxSaleInput) maxSaleInput.value = '';
            await loadAdminMyWeaponNames();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

async function saveMyWeaponNameFromAdmin(id) {
    const name = document.getElementById(`myWeaponName-${id}`)?.value?.trim();
    const salePrice = document.getElementById(`myWeaponSalePrice-${id}`)?.value || 0;
    const maxSalePrice = document.getElementById(`myWeaponMaxSalePrice-${id}`)?.value || 0;
    if (!name) { toast('Nom requis', 'error'); return; }
    try {
        const res = await fetch(`/api/crafts/myweapon-names/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, sale_price: salePrice, max_sale_price: maxSalePrice })
        });
        const data = await res.json();
        if (res.ok) {
            toast('Nom/prix enregistrés');
            await loadAdminMyWeaponNames();
        } else {
            toast(`Erreur : ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`Erreur : ${e.message}`, 'error');
    }
}

async function deleteMyWeaponNameFromAdmin(id) {
    if (!await confirmAction({ title: 'Supprimer le nom', message: 'Retirer ce nom du menu Vos Armes ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/myweapon-names/${id}`, { method: 'DELETE' });
        if (res.ok) {
            toast('Nom supprim?');
            await loadAdminMyWeaponNames();
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

window.addMyWeaponNameFromAdmin = addMyWeaponNameFromAdmin;
window.saveMyWeaponNameFromAdmin = saveMyWeaponNameFromAdmin;
window.deleteMyWeaponNameFromAdmin = deleteMyWeaponNameFromAdmin;

// ─── INGRÉDIENTS ─────────────────────
async function loadAdminIngredients() {
    try {
        const r = await fetch('/api/crafts/ingredients');
        const d = await r.json();
        adminIngredients = d.ingredients || [];
        renderAdminIngredients();
    } catch {}
}

function renderAdminIngredients() {
    const list = document.getElementById('adminIngredientsList');
    if (!adminIngredients.length) {
        list.innerHTML = '<p class="empty">Aucun ingredient.</p>';
        return;
    }

    const filtered = adminIngredients.filter(i => !adminIngredientQuery || String(i.name || '').toLowerCase().includes(adminIngredientQuery));
    if (!filtered.length) {
        list.innerHTML = '<p class="empty">Aucun ingredient ne correspond a la recherche.</p>';
        return;
    }

    list.innerHTML = filtered.map(i => {
        const imageUrl = safeImageUrl(i.image_url);
        return `
        <div class="admin-ingredient-card">
            ${imageUrl ? `<img class="admin-ingredient-img" src="${imageUrl}" alt="${escapeHtml(i.name)}">` : '<span class="admin-ingredient-placeholder">Ingredient</span>'}
            <div class="admin-ingredient-name">${escapeHtml(i.name)}</div>
            <div class="admin-ingredient-actions">
                <button class="btn-secondary btn-small" onclick="openIngredientEditor(${i.id})">Modifier</button>
                <button class="btn-danger btn-small" onclick="deleteIngredient(${i.id})">Supprimer</button>
            </div>
        </div>
    `;
    }).join('');
}

function openIngredientEditor(id) {
    const modal = document.getElementById('ingredientEditorModal');
    const title = document.getElementById('ingredientEditorTitle');
    document.getElementById('ingredientEditorForm').reset();
    document.getElementById('ingredientImagePreview').innerHTML = '';

    if (id) {
        const ing = adminIngredients.find(i => i.id === id);
        if (!ing) return;
        title.textContent = `Modifier : ${ing.name}`;
        document.getElementById('ingredientId').value = ing.id;
        document.getElementById('ingredientName').value = ing.name;
        if (safeImageUrl(ing.image_url)) document.getElementById('ingredientImagePreview').innerHTML = `<img src="${safeImageUrl(ing.image_url)}" alt="">`;
    } else {
        title.textContent = 'Ajouter un ingrédient';
        document.getElementById('ingredientId').value = '';
    }
    modal.style.display = 'flex';
}

function closeIngredientEditor() {
    document.getElementById('ingredientEditorModal').style.display = 'none';
}
window.openIngredientEditor = openIngredientEditor;
window.closeIngredientEditor = closeIngredientEditor;

async function saveIngredient(e) {
    e.preventDefault();
    const id = document.getElementById('ingredientId').value;
    const formData = new FormData();
    formData.append('name', document.getElementById('ingredientName').value);
    const file = document.getElementById('ingredientImage').files[0];
    if (file) formData.append('image', file);

    try {
        const url = id ? `/api/crafts/ingredients/${id}` : '/api/crafts/ingredients';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, { method, body: formData });
        const data = await res.json();
        if (res.ok) {
            toast('✅ Ingrédient enregistré');
            closeIngredientEditor();
            await loadAdminIngredients();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}
window.saveIngredient = saveIngredient;

async function deleteIngredient(id) {
    if (!await confirmAction({ title: 'Supprimer l’ingrédient', message: 'Supprimer cet ingrédient ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/ingredients/${id}`, { method: 'DELETE' });
        if (res.ok) { toast('Supprim?'); await loadAdminIngredients(); }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}
window.deleteIngredient = deleteIngredient;

// STOCKS MATIERES
async function loadAdminStocks() {
    try {
        const r = await fetch('/api/crafts/stocks');
        const d = await r.json();
        adminStocks = d.stocks || [];
        renderAdminStocks();
    } catch (e) {
        adminStocks = [];
        renderAdminStocks();
    }
}

function renderAdminStocks() {
    const list = document.getElementById('adminStocksList');
    if (!list) return;
    if (!adminStocks.length) {
        list.innerHTML = '<p class="empty">Aucune matière première suivie.</p>';
        return;
    }

    list.innerHTML = adminStocks.map(stock => {
        const imageUrl = stockImageUrl(stock);
        return `
            <label class="admin-stock-card">
                ${imageUrl ? `<img class="admin-stock-img" src="${imageUrl}" alt="${escapeHtml(stock.name)}">` : '<span class="admin-stock-placeholder">Stock</span>'}
                <span class="admin-stock-name">${escapeHtml(stock.name)}</span>
                <input class="admin-stock-input" type="number" min="0" step="1" value="${Number(stock.quantity) || 0}" data-stock-ingredient="${stock.ingredient_id}">
            </label>
        `;
    }).join('');
}

async function saveAdminStocks() {
    const inputs = [...document.querySelectorAll('[data-stock-ingredient]')];
    const materials = inputs.map(input => ({
        ingredient_id: input.dataset.stockIngredient,
        quantity: input.value,
    }));

    try {
        const res = await fetch('/api/admin/stocks/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ materials }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sauvegarde impossible');
        adminStocks = data.stocks || [];
        renderAdminStocks();
        toast('Stocks sauvegardés');
    } catch (e) {
        toast(e.message, 'error');
    }
}

window.loadAdminStocks = loadAdminStocks;
window.saveAdminStocks = saveAdminStocks;

// ─── ORGANISATIONS ──────────────────
async function loadAdminOrgs() {
    try {
        const r = await fetch('/api/crafts/organizations');
        const d = await r.json();
        adminOrgs = d.organizations || [];
        renderAdminOrgs();
    } catch {}
}

function renderAdminOrgs() {
    const list = document.getElementById('adminOrgsList');
    if (adminOrgs.length === 0) {
        list.innerHTML = '<p class="empty">Aucune organisation</p>';
        return;
    }
    list.innerHTML = adminOrgs.map(o => `
        <div class="admin-org-row">
            <span>🏢 ${escapeHtml(o.name)}</span>
            <button class="btn-danger btn-small" onclick="deleteOrg(${o.id})">×</button>
        </div>
    `).join('');
}

async function addOrgFromAdmin() {
    const name = document.getElementById('newOrgName').value.trim();
    if (!name) return;
    try {
        const res = await fetch('/api/crafts/organizations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            document.getElementById('newOrgName').value = '';
            toast('✅ Ajoutée');
            await loadAdminOrgs();
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}

async function deleteOrg(id) {
    if (!await confirmAction({ title: 'Supprimer l’organisation', message: 'Supprimer cette organisation ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/organizations/${id}`, { method: 'DELETE' });
        if (res.ok) await loadAdminOrgs();
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}
window.addOrgFromAdmin = addOrgFromAdmin;
window.deleteOrg = deleteOrg;

// ─── AVANCES COMMANDES ─────────────────────────────────────
function moneyDisplay(value) {
    return `${(Number(value) || 0).toLocaleString('fr-FR')}$`;
}

function formatEuropeanDate(value) {
    if (!value) return 'Date non renseignée';
    const clean = String(value).slice(0, 10);
    const parts = clean.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return clean;
}

function todayDateValue() {
    return new Date().toISOString().slice(0, 10);
}

function orderAdvanceTitle(order) {
    return `Commande matières premières du ${formatEuropeanDate(order?.order_date)}`;
}

function advanceStatusMeta(order) {
    const remaining = Number(order?.remaining_amount) || 0;
    const recovered = Number(order?.recovered_amount) || 0;
    if (order?.status === 'settled' || remaining <= 0) {
        return { className: 'settled', label: 'Soldée' };
    }
    if (recovered > 0) {
        return { className: 'partial', label: 'Partiel' };
    }
    return { className: 'open', label: 'À récupérer' };
}

function ingredientSlug(name) {
    const normalized = (name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
    if (normalized.includes('titane')) return 'titane';
    if (normalized.includes('chrome')) return 'chrome';
    if (normalized.includes('tungst')) return 'tungstene';
    return 'default';
}

async function loadAdminMembers() {
    adminMembers = [...ORDER_ADVANCE_PARTICIPANTS];
    adminMembersLoadedAt = Date.now();
    populateAdvanceParticipantSelects();
}

function selectedAdvanceParticipantIds(currentSelect = null) {
    return getVisibleAdvanceParticipantRows()
        .map(row => row.querySelector('.order-advance-participant-user'))
        .filter(select => select && select !== currentSelect && select.value)
        .map(select => String(select.value));
}

function memberOptions(selectedId = '', currentSelect = null, selectedNameOverride = '') {
    const selected = String(selectedId || '');
    const selectedElsewhere = new Set(selectedAdvanceParticipantIds(currentSelect));
    const knownIds = new Set(adminMembers.map(member => String(member.id)));
    const legacyName = selectedNameOverride || currentSelect?.selectedOptions?.[0]?.dataset?.name || currentSelect?.selectedOptions?.[0]?.textContent || selected;
    const legacySelected = selected && !knownIds.has(selected)
        ? `<option value="${escapeHtml(selected)}" data-name="${escapeHtml(legacyName)}" selected>${escapeHtml(legacyName)} (ancien)</option>`
        : '';
    return [
        '<option value="">-- Choisir une personne --</option>',
        ...adminMembers.map(member => {
            const id = escapeHtml(member.id);
            const name = escapeHtml(member.name || member.username || member.id);
            const disabled = selectedElsewhere.has(String(member.id)) && String(member.id) !== selected ? 'disabled' : '';
            return `<option value="${id}" data-name="${name}" ${String(member.id) === selected ? 'selected' : ''} ${disabled}>${name}</option>`;
        }),
        legacySelected,
    ].join('');
}

function ensureAdvanceParticipantRows() {
    const container = document.getElementById('orderAdvanceParticipants');
    if (!container || container.children.length) return;
    container.innerHTML = [0, 1, 2].map(index => `
        <div class="order-advance-participant-row" data-advance-participant="${index}">
            <div class="advance-participant-badge">${index + 1}</div>
            <div class="comm-field">
                <label class="comm-label">Participant</label>
                <select class="comm-input order-advance-participant-user">${memberOptions()}</select>
            </div>
            <div class="comm-field">
                <label class="comm-label">Montant mis ($)</label>
                <input type="number" min="0" class="comm-input order-advance-participant-contributed" placeholder="0">
            </div>
        </div>
    `).join('');
    container.querySelectorAll('select, input').forEach(input => {
        input.addEventListener('input', updateOrderAdvanceBalance);
        input.addEventListener('change', () => {
            populateAdvanceParticipantSelects();
            updateOrderAdvanceBalance();
        });
    });
}

function initOrderAdvanceParticipants() {
    normalizeOrderAdvanceLabels();
    ensureAdvanceParticipantRows();
    populateAdvanceParticipantSelects();
    setOrderAdvanceParticipantCount();
    updateOrderAdvanceSubmitButtonLabel();
}

function updateOrderAdvanceSubmitButtonLabel() {
    const btn = document.getElementById('orderAdvanceSubmitBtn');
    if (!btn) return;
    const id = document.getElementById('orderAdvanceId')?.value;
    btn.innerHTML = id
        ? '💾 Mettre à jour la commande'
        : '🚀 Passer commande';
}

async function loadOrderIngredientsCatalog() {
    try {
        const res = await fetch('/api/admin/order-advances/catalog');
        if (!res.ok) return;
        const data = await res.json();
        orderIngredientsCatalog = data.ingredients || [];
    } catch {
        orderIngredientsCatalog = [];
    }
}

function renderOrderAdvanceItems(prefillItems = null) {
    const container = document.getElementById('orderAdvanceItems');
    if (!container) return;
    if (!orderIngredientsCatalog.length) {
        container.innerHTML = '<p class="empty">Catalogue ingrédients indisponible.</p>';
        updateOrderAdvanceTotalFromItems();
        return;
    }
    container.innerHTML = orderIngredientsCatalog.map(ing => {
        const prefilledQty = prefillItems?.find(it => it.ingredient_name === ing.name)?.quantity || 0;
        const imageHtml = ing.image_url
            ? `<img src="${escapeHtml(ing.image_url)}" alt="" class="order-item-image">`
            : `<div class="order-item-image order-item-image-placeholder">📦</div>`;
        return `
            <div class="order-advance-item-row" data-ingredient="${escapeHtml(ing.name)}">
                ${imageHtml}
                <div class="order-item-info">
                    <div class="order-item-name">${escapeHtml(ing.name)}</div>
                    <div class="order-item-price">${Number(ing.unit_price || 0).toLocaleString('fr-FR')} $ / unité</div>
                </div>
                <input type="number"
                       class="comm-input order-item-quantity"
                       min="0" step="1"
                       placeholder="0"
                       value="${prefilledQty || ''}"
                       data-unit-price="${Number(ing.unit_price) || 0}"
                       data-ingredient-name="${escapeHtml(ing.name)}"
                       oninput="updateOrderAdvanceTotalFromItems()">
                <div class="order-item-line-total" data-line-total="${escapeHtml(ing.name)}">
                    ${(prefilledQty * (Number(ing.unit_price) || 0)).toLocaleString('fr-FR')} $
                </div>
            </div>
        `;
    }).join('');
    updateOrderAdvanceTotalFromItems();
}

function updateOrderAdvanceTotalFromItems() {
    let total = 0;
    document.querySelectorAll('.order-item-quantity').forEach(input => {
        const qty = parseInt(input.value, 10) || 0;
        const price = parseInt(input.dataset.unitPrice, 10) || 0;
        const lineTotal = qty * price;
        total += lineTotal;
        const lineDisplay = input.closest('.order-advance-item-row')?.querySelector('.order-item-line-total');
        if (lineDisplay) lineDisplay.textContent = `${lineTotal.toLocaleString('fr-FR')} $`;
    });
    const totalInput = document.getElementById('orderAdvanceTotal');
    const totalDisplay = document.getElementById('orderAdvanceTotalDisplay');
    if (totalInput) totalInput.value = total;
    if (totalDisplay) totalDisplay.innerHTML = `Total : <strong>${total.toLocaleString('fr-FR')} $</strong>`;
    updateOrderAdvanceBalance();
}

function collectOrderAdvanceItems() {
    return Array.from(document.querySelectorAll('.order-advance-item-row'))
        .map(row => {
            const input = row.querySelector('.order-item-quantity');
            const qty = parseInt(input?.value, 10) || 0;
            if (qty <= 0) return null;
            const unitPrice = parseInt(input.dataset.unitPrice, 10) || 0;
            return {
                ingredient_name: input.dataset.ingredientName,
                unit_price: unitPrice,
                quantity: qty,
                line_total: qty * unitPrice,
            };
        })
        .filter(Boolean);
}

function normalizeOrderAdvanceLabels() {
    const section = document.getElementById('adminTab-advances');
    if (!section) return;
    const title = section.querySelector('.section-title');
    const info = section.querySelector('.admin-info');
    if (title) title.textContent = 'Suivi commandes / avances';
    if (info) info.textContent = 'Suivi admin des commandes de matières premières et remboursements détaillés.';
    const resetButton = section.querySelector('button[onclick="resetOrderAdvanceForm()"]');
    if (resetButton) resetButton.textContent = 'Réinitialiser';
    const submitButton = section.querySelector('button[type="submit"]');
    if (submitButton) submitButton.textContent = 'Enregistrer la commande';
}

function populateAdvanceParticipantSelects() {
    document.querySelectorAll('.order-advance-participant-user').forEach(select => {
        const selected = select.value;
        const selectedName = select.selectedOptions?.[0]?.dataset?.name || select.selectedOptions?.[0]?.textContent || '';
        select.innerHTML = memberOptions(selected, select, selectedName);
        if (selected && !select.value) {
            const option = document.createElement('option');
            option.value = selected;
            option.dataset.name = selectedName;
            option.textContent = selectedName || selected;
            option.selected = true;
            select.appendChild(option);
        }
    });
}

function setOrderAdvanceParticipantCount(count) {
    ensureAdvanceParticipantRows();
    const select = document.getElementById('orderAdvanceParticipantCount');
    const wanted = Math.min(3, Math.max(1, Number(count || select?.value || 1) || 1));
    if (select) select.value = String(wanted);
    document.querySelectorAll('[data-advance-participant]').forEach((row, index) => {
        row.style.display = index < wanted ? 'grid' : 'none';
    });
    updateOrderAdvanceBalance();
}

function getVisibleAdvanceParticipantRows() {
    return [...document.querySelectorAll('[data-advance-participant]')].filter(row => row.style.display !== 'none');
}

function updateOrderAdvanceBalance() {
    const target = document.getElementById('orderAdvanceBalance');
    if (!target) return;
    const total = Number(document.getElementById('orderAdvanceTotal')?.value || 0) || 0;
    const participantTotal = getVisibleAdvanceParticipantRows()
        .reduce((sum, row) => sum + (Number(row.querySelector('.order-advance-participant-contributed')?.value || 0) || 0), 0);
    const diff = participantTotal - total;
    const className = diff === 0 ? 'ok' : 'warning';
    target.innerHTML = `
        <span>Total commande : <strong>${moneyDisplay(total)}</strong></span>
        <span>Total participants : <strong>${moneyDisplay(participantTotal)}</strong></span>
        <span class="${className}">${diff === 0 ? 'Équilibré' : `Écart : ${moneyDisplay(Math.abs(diff))}`}</span>
    `;
}

async function loadAdminOrderAdvances() {
    try {
        const res = await fetch('/api/admin/order-advances');
        const data = await res.json();
        adminOrderAdvances = data.advances || [];
        renderOrderAdvances();
    } catch (e) {
        adminOrderAdvances = [];
        renderOrderAdvances();
    }
}

function collectOrderAdvancePayload() {
    const orderDate = document.getElementById('orderAdvanceDate')?.value;
    if (!orderDate) { toast('Date de commande requise', 'error'); return null; }
    const items = collectOrderAdvanceItems();
    if (!items.length) { toast('Ajoute au moins un ingrédient à la commande', 'error'); return null; }

    const participants = [];
    const participantIds = new Set();
    for (const row of getVisibleAdvanceParticipantRows()) {
        const select = row.querySelector('.order-advance-participant-user');
        const userId = select?.value || '';
        const userName = select?.selectedOptions?.[0]?.dataset?.name || select?.selectedOptions?.[0]?.textContent || '';
        const contributed = row.querySelector('.order-advance-participant-contributed')?.value || '';
        if (!userId && !Number(contributed)) continue;
        if (!userId) { toast('Choisis une personne pour chaque ligne renseignée', 'error'); return null; }
        if (participantIds.has(userId)) { toast('Chaque participant ne peut être choisi qu’une seule fois', 'error'); return null; }
        if (!Number(contributed)) { toast('Renseigne le montant mis par chaque participant', 'error'); return null; }
        participantIds.add(userId);
        participants.push({
            user_id: userId,
            user_name: userName,
            amount_contributed: contributed,
        });
    }

    if (!participants.length) {
        toast('Ajoute au moins un participant', 'error');
        return null;
    }

    return {
        order_date: orderDate,
        total_amount: document.getElementById('orderAdvanceTotal')?.value || 0,
        items,
        participants,
    };
}

async function saveOrderAdvance(event) {
    if (event) event.preventDefault();
    const payload = collectOrderAdvancePayload();
    if (!payload) return;
    const id = document.getElementById('orderAdvanceId')?.value;
    const isEdit = Boolean(id);
    const wasPublished = document.getElementById('orderAdvanceHadMessageId')?.value === '1';
    const shouldPublishAfter = !isEdit || !wasPublished;
    try {
        const res = await fetch(isEdit ? `/api/admin/order-advances/${id}` : '/api/admin/order-advances', {
            method: isEdit ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Sauvegarde impossible');

        if (shouldPublishAfter) {
            try {
                const orderId = data.id || id;
                const pubRes = await fetch(`/api/admin/order-advances/${orderId}/publish`, { method: 'POST' });
                const pubData = await pubRes.json();
                if (!pubRes.ok) {
                    throw new Error(`Commande créée mais publication Discord échouée : ${pubData.error || 'erreur inconnue'}. Tu peux relancer en éditant puis re-soumettant la commande.`);
                }
                adminOrderAdvances = pubData.advances || [];
                toast('✅ Commande passée et publiée sur Discord', 'success');
            } catch (pubErr) {
                adminOrderAdvances = data.advances || [];
                toast(`⚠️ ${pubErr.message}`, 'warning');
            }
        } else {
            adminOrderAdvances = data.advances || [];
            toast('✅ Commande mise à jour', 'success');
        }

        resetOrderAdvanceForm();
        renderOrderAdvances();
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

function fillParticipantRow(row, participant = {}) {
    const select = row.querySelector('.order-advance-participant-user');
    if (select) {
        select.innerHTML = memberOptions(participant.user_id, select, participant.user_name);
        if (participant.user_id && !select.value) {
            const option = document.createElement('option');
            option.value = participant.user_id;
            option.dataset.name = participant.user_name || participant.user_id;
            option.textContent = participant.user_name || participant.user_id;
            option.selected = true;
            select.appendChild(option);
        }
    }
    row.querySelector('.order-advance-participant-contributed').value = participant.amount_contributed || '';
}

function editOrderAdvance(id) {
    const order = adminOrderAdvances.find(item => Number(item.id) === Number(id));
    if (!order) return;
    initOrderAdvanceParticipants();
    document.getElementById('orderAdvanceId').value = order.id;
    document.getElementById('orderAdvanceHadMessageId').value = order.discord_message_id ? '1' : '';
    updateOrderAdvanceSubmitButtonLabel();
    document.getElementById('orderAdvanceDate').value = order.order_date || '';
    document.getElementById('orderAdvanceTotal').value = order.total_amount || '';
    renderOrderAdvanceItems(order.items || []);
    const rows = [...document.querySelectorAll('[data-advance-participant]')];
    const participantCount = Math.min(3, Math.max(1, (order.participants || []).length || 1));
    setOrderAdvanceParticipantCount(participantCount);
    rows.forEach((row, index) => fillParticipantRow(row, (order.participants || [])[index] || {}));
    populateAdvanceParticipantSelects();
    updateOrderAdvanceBalance();
    document.getElementById('orderAdvanceForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetOrderAdvanceForm() {
    const form = document.getElementById('orderAdvanceForm');
    if (form) form.reset();
    const idInput = document.getElementById('orderAdvanceId');
    if (idInput) idInput.value = '';
    const hadMessageInput = document.getElementById('orderAdvanceHadMessageId');
    if (hadMessageInput) hadMessageInput.value = '';
    document.getElementById('orderAdvanceDate').value = todayDateValue();
    renderOrderAdvanceItems();
    setOrderAdvanceParticipantCount(1);
    document.querySelectorAll('[data-advance-participant]').forEach(row => fillParticipantRow(row, {}));
    updateOrderAdvanceBalance();
    updateOrderAdvanceSubmitButtonLabel();
}

async function deleteOrderAdvance(id) {
    if (!await confirmAction({ title: 'Supprimer la commande', message: 'Supprimer ce suivi de commande ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/admin/order-advances/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Suppression impossible');
        adminOrderAdvances = data.advances || [];
        renderOrderAdvances();
        toast('Commande supprimée');
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function settleOrderAdvance(id) {
    if (!await confirmAction({ title: 'Marquer soldée', message: 'Marquer cette commande comme entièrement récupérée ?', confirmText: 'Marquer soldée' })) return;
    try {
        const res = await fetch(`/api/admin/order-advances/${id}/settle`, { method: 'PUT' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Action impossible');
        adminOrderAdvances = data.advances || [];
        renderOrderAdvances();
        toast('Commande soldée');
    } catch (e) {
        toast(e.message, 'error');
    }
}

function repaymentParticipantOptions(order, selectedId = '') {
    return '<option value="">-- Choisir --</option>' + (order.participants || []).map(p => (
        `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${escapeHtml(p.user_name)}</option>`
    )).join('');
}

function toggleOrderRepaymentForm(orderId, repaymentId = '') {
    const form = document.getElementById(`orderRepaymentForm-${orderId}`);
    if (!form) return;
    form.style.display = form.style.display === 'none' || !form.style.display ? 'grid' : 'none';
    if (!repaymentId && form.style.display !== 'none') {
        form.querySelector('.order-repayment-id').value = '';
        form.querySelector('.order-repayment-participant').value = '';
        form.querySelector('.order-repayment-amount').value = '';
        form.querySelector('.order-repayment-reason').value = '';
        form.querySelector('.order-repayment-weapon').value = '';
        form.querySelector('.order-repayment-date').value = todayDateValue();
    }
}

async function saveOrderRepayment(orderId) {
    const form = document.getElementById(`orderRepaymentForm-${orderId}`);
    if (!form) return;
    const repaymentId = form.querySelector('.order-repayment-id')?.value;
    const payload = {
        participant_id: form.querySelector('.order-repayment-participant')?.value,
        amount: form.querySelector('.order-repayment-amount')?.value,
        reason: form.querySelector('.order-repayment-reason')?.value.trim(),
        weapon_name: form.querySelector('.order-repayment-weapon')?.value.trim(),
        repayment_date: form.querySelector('.order-repayment-date')?.value,
    };
    try {
        const res = await fetch(
            repaymentId ? `/api/admin/order-advances/${orderId}/repayments/${repaymentId}` : `/api/admin/order-advances/${orderId}/repayments`,
            {
                method: repaymentId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Remboursement impossible');
        adminOrderAdvances = data.advances || [];
        renderOrderAdvances();
        toast('Remboursement enregistré');
    } catch (e) {
        toast(e.message, 'error');
    }
}

function editOrderRepayment(orderId, repaymentId) {
    const order = adminOrderAdvances.find(item => Number(item.id) === Number(orderId));
    const repayment = order?.repayments?.find(item => Number(item.id) === Number(repaymentId));
    const form = document.getElementById(`orderRepaymentForm-${orderId}`);
    if (!order || !repayment || !form) return;
    form.style.display = 'grid';
    form.querySelector('.order-repayment-id').value = repayment.id;
    form.querySelector('.order-repayment-participant').value = repayment.participant_id || '';
    form.querySelector('.order-repayment-amount').value = repayment.amount || '';
    form.querySelector('.order-repayment-reason').value = repayment.reason || '';
    form.querySelector('.order-repayment-weapon').value = repayment.weapon_name || '';
    form.querySelector('.order-repayment-date').value = repayment.repayment_date || todayDateValue();
}

async function deleteOrderRepayment(orderId, repaymentId) {
    if (!await confirmAction({ title: 'Supprimer le remboursement', message: 'Supprimer ce remboursement ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/admin/order-advances/${orderId}/repayments/${repaymentId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Suppression impossible');
        adminOrderAdvances = data.advances || [];
        renderOrderAdvances();
        toast('Remboursement supprimé');
    } catch (e) {
        toast(e.message, 'error');
    }
}

function renderOrderAdvances() {
    const list = document.getElementById('orderAdvanceList');
    if (!list) return;
    if (!adminOrderAdvances.length) {
        list.innerHTML = '<p class="empty">Aucune avance commande enregistrée.</p>';
        return;
    }

    list.innerHTML = adminOrderAdvances.map(order => {
        const meta = advanceStatusMeta(order);
        const orderTitle = orderAdvanceTitle(order);
        const recoveredClass = Number(order.recovered_amount) > 0 ? 'amount-positive' : 'amount-neutral';
        const remainingClass = Number(order.remaining_amount) > 0 ? 'amount-danger' : 'amount-positive';
        const participantOptions = repaymentParticipantOptions(order);
        const itemsDisplay = (order.items || []).length
            ? `<div class="order-advance-items-display">
                ${(order.items || []).map(item => {
                    const slug = ingredientSlug(item.ingredient_name);
                    return `
                        <div class="item-line item-line-${slug}">
                            <span class="item-name">${Number(item.quantity || 0).toLocaleString('fr-FR')} ${escapeHtml(item.ingredient_name)}</span>
                            <span class="item-formula"> × ${moneyDisplay(item.unit_price)} = </span>
                            <span class="item-total">${moneyDisplay(item.line_total)}</span>
                        </div>
                    `;
                }).join('')}
            </div>`
            : '';
        const publishedBadge = order.discord_message_id
            ? `<span class="order-advance-published-badge">✅ Publiée${order.published_at ? ` le ${new Date(Number(order.published_at) * 1000).toLocaleDateString('fr-FR')} à ${new Date(Number(order.published_at) * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>`
            : '<span class="order-advance-pub-failed-badge">⚠️ Publication Discord échouée — réédite la commande pour relancer</span>';
        const participants = (order.participants || []).map(p => {
            const participantRemainingClass = Number(p.amount_remaining) > 0 ? 'amount-danger' : 'amount-positive';
            const participantRecoveredClass = Number(p.amount_recovered) > 0 ? 'amount-positive' : 'amount-neutral';
            return `
                <div class="order-advance-participant-chip">
                    <strong>${escapeHtml(p.user_name)}</strong>
                    <span>Mis : <b>${moneyDisplay(p.amount_contributed)}</b></span>
                    <span>Récupéré : <b class="${participantRecoveredClass}">${moneyDisplay(p.amount_recovered)}</b></span>
                    <span>Restant : <b class="${participantRemainingClass}">${moneyDisplay(p.amount_remaining)}</b></span>
                </div>
            `;
        }).join('');
        const repayments = (order.repayments || []).map(repayment => `
            <div class="order-repayment-item order-repayment-positive">
                <div>
                    <strong>${escapeHtml(repayment.user_name || 'Participant')}</strong>
                    <span>${formatEuropeanDate(repayment.repayment_date)} • <b class="amount-positive">+${moneyDisplay(repayment.amount)}</b></span>
                    ${repayment.reason ? `<small>${escapeHtml(repayment.reason)}</small>` : ''}
                    ${repayment.weapon_name ? `<small>Arme : ${escapeHtml(repayment.weapon_name)}</small>` : ''}
                </div>
                <div class="order-repayment-actions">
                    <button class="btn-secondary btn-small" onclick="editOrderRepayment(${order.id}, ${repayment.id})">Modifier</button>
                    <button class="btn-danger btn-small" onclick="deleteOrderRepayment(${order.id}, ${repayment.id})">Supprimer</button>
                </div>
            </div>
        `).join('');
        return `
            <article class="order-advance-card ${meta.className}">
                <div class="order-advance-card-head">
                    <div>
                        <h3>${escapeHtml(orderTitle)}</h3>
                        <p>${formatEuropeanDate(order.order_date)}</p>
                    </div>
                    <span class="order-advance-status">${meta.label}</span>
                </div>
                <div class="order-advance-totals">
                    <span>Total <strong class="order-total-amount">${moneyDisplay(order.total_amount)}</strong></span>
                    <span>Récupéré <strong class="${recoveredClass}">${moneyDisplay(order.recovered_amount)}</strong></span>
                    <span>Restant <strong class="${remainingClass}">${moneyDisplay(order.remaining_amount)}</strong></span>
                    ${!order.has_detailed_repayments && Number(order.legacy_recovered_amount) > 0 ? '<span class="order-advance-legacy">Ancien montant récupéré global</span>' : ''}
                </div>
                ${itemsDisplay}
                <div class="order-advance-participants-list">${participants}</div>
                <div class="order-repayment-section">
                    <div class="order-repayment-head">
                        <h4>Remboursements</h4>
                        <button class="btn-primary btn-small" onclick="toggleOrderRepaymentForm(${order.id})">Ajouter remboursement</button>
                    </div>
                    <div class="order-repayment-form" id="orderRepaymentForm-${order.id}" style="display:none;">
                        <input type="hidden" class="order-repayment-id">
                        <select class="comm-input order-repayment-participant">${participantOptions}</select>
                        <input type="number" min="1" class="comm-input order-repayment-amount" placeholder="Montant récupéré">
                        <input type="text" class="comm-input order-repayment-reason" placeholder="Raison / description">
                        <input type="text" class="comm-input order-repayment-weapon" placeholder="Arme concernée (optionnel)">
                        <input type="date" class="comm-input order-repayment-date" value="${todayDateValue()}">
                        <button class="btn-primary btn-small" onclick="saveOrderRepayment(${order.id})">Enregistrer</button>
                    </div>
                    <div class="order-repayment-list">${repayments || '<p class="empty">Aucun remboursement détaillé.</p>'}</div>
                </div>
                <div class="order-advance-actions">
                    ${publishedBadge}
                    <button class="btn-secondary btn-small" onclick="editOrderAdvance(${order.id})">Modifier</button>
                    <button class="btn-primary btn-small" onclick="settleOrderAdvance(${order.id})" ${meta.className === 'settled' ? 'disabled' : ''}>Solder</button>
                    <button class="btn-danger btn-small" onclick="deleteOrderAdvance(${order.id})">Supprimer</button>
                </div>
            </article>
        `;
    }).join('');
}

// ==========================================
// COMMAND CENTER — particules orange flottantes
// ==========================================
(function injectCommandCenterParticles() {
    if (document.querySelector('.cc-particles')) return;
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) return;

    const container = document.createElement('div');
    container.className = 'cc-particles';
    container.setAttribute('aria-hidden', 'true');

    for (let i = 0; i < 14; i++) {
        const particle = document.createElement('div');
        particle.className = 'cc-particle';
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.animationDelay = `${Math.random() * 9}s`;
        particle.style.animationDuration = `${8 + Math.random() * 6}s`;
        container.appendChild(particle);
    }

    document.body.appendChild(container);
})();

window.loadAdminMembers = loadAdminMembers;
window.loadAdminOrderAdvances = loadAdminOrderAdvances;
window.setOrderAdvanceParticipantCount = setOrderAdvanceParticipantCount;
window.updateOrderAdvanceTotalFromItems = updateOrderAdvanceTotalFromItems;
window.saveOrderAdvance = saveOrderAdvance;
window.editOrderAdvance = editOrderAdvance;
window.resetOrderAdvanceForm = resetOrderAdvanceForm;
window.deleteOrderAdvance = deleteOrderAdvance;
window.settleOrderAdvance = settleOrderAdvance;
window.toggleOrderRepaymentForm = toggleOrderRepaymentForm;
window.saveOrderRepayment = saveOrderRepayment;
window.editOrderRepayment = editOrderRepayment;
window.deleteOrderRepayment = deleteOrderRepayment;
