// ==========================================
// 21 BLOCK SAVAGE — Dashboard JS
// ==========================================

const PAGE_TITLES = {
    presence: { title: 'Présence', sub: 'Suivi Présence/Absence' },
    commands: { title: 'Commandes', sub: 'Centre de contrôle' },
    channels: { title: 'Salons Discord', sub: 'Historique et navigation' },
    map: { title: 'Carte du Laboratoire', sub: 'Marquage de zones' },
    stats: { title: 'Statistiques', sub: 'Suivi hebdomadaire' },
    sanctions: { title: 'Sanctions', sub: 'Historique des avertissements' },
    crafts: { title: "Craft d'armes", sub: 'Gestion des demandes & production' },
    myweapons: { title: 'Vos Armes', sub: 'Tes armes à vendre' },
};

let currentTab = 'presence';
let refreshTimer = null;
const SITE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
let idleLogoutTimer = null;
let userPermissions = { canEditMap: false };
let presenceStatsCache = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    // Déplacer uniquement les modals racine (avec ID) au body
    document.querySelectorAll('.modal-backdrop[id]').forEach(modal => {
        if (modal.parentNode !== document.body) {
            document.body.appendChild(modal);
        }
    });

    await loadUser();
    setupIdleLogoutTimer();
    await loadPermissions();
    setupNav();
    setupChannelSearch();
    setupMap();
    updateImpersonateBanner();
    applyPermissionsUI();
    restoreLastTab();
    refreshAll();
    refreshTimer = setInterval(refreshAll, 15_000);
});

async function loadPermissions() {
    try {
        const res = await fetch('/api/me/permissions');
        if (res.ok) userPermissions = await res.json();
    } catch {}
}

async function loadUser() {
    try {
        const res = await fetch('/api/me');
        if (!res.ok) { window.location = '/'; return; }
        const user = await res.json();
        window.currentUser = user;
        window.currentUserId = user.id;
        document.getElementById('userName').textContent = user.username;
        if (user.avatar) document.getElementById('userAvatar').src = user.avatar;
    } catch {
        window.location = '/';
    }
}

function setupIdleLogoutTimer() {
    const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];
    const reset = () => {
        clearTimeout(idleLogoutTimer);
        idleLogoutTimer = setTimeout(() => {
            try { localStorage.setItem('lastTab', 'presence'); } catch {}
            window.location.href = '/auth/logout?timeout=1';
        }, SITE_IDLE_TIMEOUT_MS);
    };
    events.forEach(evt => window.addEventListener(evt, reset, { passive: true }));
    reset();
}

function restoreLastTab() {
    try {
        const hashTab = window.location.hash ? window.location.hash.slice(1) : '';
        if (hashTab && document.getElementById(`tab-${hashTab}`) && PAGE_TITLES[hashTab]) {
            switchTab(hashTab);
            return;
        }
        const last = localStorage.getItem('lastTab');
        if (last && document.getElementById(`tab-${last}`) && PAGE_TITLES[last]) {
            // Rôle non autorisé sur tab verrouillé → reste sur presence (qui sera flouté)
            switchTab(last);
            return;
        }
    } catch {}
    switchTab('presence');
}

function setupNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            const tab = item.dataset.tab;
            switchTab(tab);
        });
    });
}

// Permissions UI
const FULL_ACCESS_ROLES = ['1485279148246175764', '1486744891848654988', '1485279534650494976'];
let userHasFullAccess = false;

function checkUserAccess() {
    if (!window.currentUser) return false;
    const impersonateRole = localStorage.getItem('impersonate_role');
    if (impersonateRole) return FULL_ACCESS_ROLES.includes(impersonateRole);
    if (window.currentUser.id === '952986899667103804') return true;
    const roles = window.currentUser.roles || [];
    return FULL_ACCESS_ROLES.some(r => roles.includes(r));
}

function applyPermissionsUI() {
    userHasFullAccess = checkUserAccess();
    const lockedTabs = ['presence', 'commands'];
    lockedTabs.forEach(tabName => {
        const sec = document.getElementById(`tab-${tabName}`);
        if (!sec) return;
        if (userHasFullAccess) {
            sec.classList.remove('access-locked');
            sec.querySelector('.access-locked-overlay')?.remove();
        } else if (!sec.querySelector('.access-locked-overlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'access-locked-overlay';
            overlay.innerHTML = `
                <div class="danger-lock-panel">
                    <span class="danger-lock-kicker">CONNEXION INTERROMPUE</span>
                    <span class="confidential-text">CONFIDENCIAL</span>
                    <span class="danger-lock-sub">ZONE CHIFFRÉE 21BS • ACCÈS NON AUTORISÉ</span>
                </div>
            `;
            sec.appendChild(overlay);
            sec.classList.add('access-locked');
        }
    });

    ['mapAddBtn', 'mapDeleteBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = userPermissions.canEditMap ? '' : 'none';
    });
    if (!userPermissions.canEditMap && ['add', 'delete'].includes(mapMode)) setMapMode('view');
}
function switchTab(tab) {
    currentTab = tab;
    // Persister dans localStorage pour survivre au refresh
    try { localStorage.setItem('lastTab', tab); } catch {}

    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));

    const titles = PAGE_TITLES[tab];
    if (titles) {
        document.getElementById('pageTitle').textContent = titles.title;
        document.getElementById('pageSub').textContent = titles.sub;
    }

    refreshAll();
}

async function refreshAll() {
    if (!checkUserAccess() && ['presence', 'commands'].includes(currentTab)) {
        applyPermissionsUI();
        return;
    }
    if (currentTab === 'presence') {
        await Promise.all([loadStats(), loadPresence()]);
    } else if (currentTab === 'stats') {
        await loadWeekly();
    } else if (currentTab === 'sanctions') {
        await loadSanctions();
    } else if (currentTab === 'channels') {
        if (!channelsLoaded) await loadChannels();
    } else if (currentTab === 'map') {
        await loadMapPoints();
    } else if (currentTab === 'commands') {
        if (!commandsLoaded) await initCommandsTab();
    } else if (currentTab === 'crafts') {
        await initCraftsTab();
    } else if (currentTab === 'myweapons') {
        await initMyWeaponsTab();
    }
}

let commandsLoaded = false;
async function initCommandsTab() {
    await Promise.all([loadCommands(), loadAnnonceData()]);
    setupSanctionUserPicker();
    commandsLoaded = true;
}

// ===== STATS GLOBALES =====
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const s = await res.json();
        presenceStatsCache = s;
        document.getElementById('statTotal').textContent = s.totalMembers;
        document.getElementById('statInscrits').textContent = s.inscritsOP || 0;
        document.getElementById('statAbsences').textContent = s.totalUnjustified;
        document.getElementById('statConsecutive').textContent = s.membersWithConsecutive;
        document.getElementById('statConsecutiveCard').classList.toggle('stat-warning', s.membersWithConsecutive > 0);
    } catch (e) {
        console.error('Stats:', e);
    }
}

function renderPresenceMemberList(items, emptyText, showAbsences = false) {
    if (!items || items.length === 0) return `<p class="empty">${emptyText}</p>`;
    return `<div class="presence-detail-list">${items.map(m => {
        const avatar = safeImageUrl(m.avatar) || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44'><rect width='44' height='44' fill='%23262626'/></svg>`;
        const color = safeColor(m.color);
        const detail = showAbsences
            ? `<span>${m.count || 0} absence(s)${m.consecutiveDays >= 2 ? ` • ${m.consecutiveDays}j consécutifs` : ''}</span>`
            : `<span>ID ${escapeHtml(m.id || '')}</span>`;
        const dates = showAbsences && m.dates?.length
            ? `<div class="presence-detail-dates">${m.dates.map(d => `<code>${escapeHtml(d)}</code>`).join('')}</div>`
            : '';
        return `
            <div class="presence-detail-member">
                <img src="${avatar}" alt="">
                <div class="presence-detail-body">
                    <strong style="${color ? `color:${color};` : ''}">${escapeHtml(m.username || m.name || '?')}</strong>
                    ${detail}
                    ${dates}
                </div>
            </div>
        `;
    }).join('')}</div>`;
}

async function openPresenceStatDetails(type) {
    if (!presenceStatsCache) await loadStats();
    const modal = document.getElementById('presenceStatDetailsModal');
    const title = document.getElementById('presenceStatDetailsTitle');
    const content = document.getElementById('presenceStatDetailsContent');
    if (!modal || !title || !content) return;

    const s = presenceStatsCache || {};
    if (type === 'members') {
        title.textContent = 'Membres 21BS';
        content.innerHTML = renderPresenceMemberList(s.totalMembersList, 'Aucun membre trouvé');
    } else if (type === 'op') {
        title.textContent = 'Inscrits OP';
        content.innerHTML = renderPresenceMemberList(s.inscritsList, 'Aucun inscrit OP trouvé');
    } else if (type === 'absences') {
        title.textContent = 'Absences semaine';
        content.innerHTML = renderPresenceMemberList(s.absenceMembers, 'Aucune absence cette semaine', true);
    } else {
        title.textContent = 'Alertes KP';
        content.innerHTML = renderPresenceMemberList(s.kpMembers, 'Aucun membre à KP', true);
    }
    modal.style.display = 'flex';
}

function closePresenceStatDetails() {
    const modal = document.getElementById('presenceStatDetailsModal');
    if (modal) modal.style.display = 'none';
}

// ===== PRÉSENCE =====
async function loadPresence() {
    try {
        const res = await fetch('/api/presence');
        const data = await res.json();

        renderOP('op1', data.op1);
        renderOP('op2', data.op2);
        renderAbsencesSalon(data.absencesSalon);
    } catch (e) {
        console.error('Presence:', e);
    }
}

function renderOP(prefix, op) {
    const status = document.getElementById(`${prefix}Status`);
    const cats = document.getElementById(`${prefix}Categories`);

    if (!op.active) {
        status.textContent = 'INACTIVE';
        status.className = 'op-status inactive';
        cats.innerHTML = '<p class="empty-cat">⚠ Pas de présence active</p>';
        return;
    }

    status.textContent = 'EN COURS';
    status.className = 'op-status active';

    const total = op.present.length + op.late.length + op.absentReact.length + op.absentValid.length + op.noReaction.length;

    const categories = [
        { icon: '✅', label: 'Présents', list: op.present },
        { icon: '⏰', label: 'Retards', list: op.late },
        { icon: '❌', label: 'Absents non justifiés', list: op.absentReact },
        { icon: '📋', label: 'Absents justifiés', list: op.absentValid },
        { icon: '⚠️', label: 'Pas de réaction', list: op.noReaction },
    ];

    const renderMember = (m) => {
        const avatar = m.avatar || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><rect width='24' height='24' fill='%23262626'/></svg>`;
        return `<div class="member"><img class="member-avatar-mini" src="${avatar}" alt=""><span class="member-name">${escapeHtml(m.name)}</span></div>`;
    };

    cats.innerHTML = `
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">
            👥 <strong style="color:var(--text);">${total}</strong> membres
        </div>
    ` + categories.map(c => `
        <div class="op-category" onclick="this.classList.toggle('open')">
            <div class="op-cat-header">
                <span><span class="op-cat-icon">${c.icon}</span>${c.label}</span>
                <span class="op-cat-count">${c.list.length}</span>
            </div>
            <div class="op-cat-list">
                ${c.list.length === 0
                    ? '<div class="empty-cat">Aucun</div>'
                    : c.list.map(renderMember).join('')}
            </div>
        </div>
    `).join('');
}

function renderAbsencesSalon(data) {
    const validList = document.getElementById('validList');
    const invalidList = document.getElementById('invalidList');

    document.getElementById('validCount').textContent = data.valid.length;
    document.getElementById('invalidCount').textContent = data.invalid.length;

    const renderChip = (name, isValid) => `
        <div class="absence-chip ${isValid ? 'chip-valid' : 'chip-invalid'}">
            <span class="chip-icon">${isValid ? '✓' : '✗'}</span>
            <span class="chip-name">${escapeHtml(name)}</span>
        </div>
    `;

    validList.innerHTML = data.valid.length === 0
        ? '<p class="empty-list">Aucune absence conforme posée</p>'
        : `<div class="chips-grid">${data.valid.map(n => renderChip(n, true)).join('')}</div>`;

    invalidList.innerHTML = data.invalid.length === 0
        ? '<p class="empty-list">Aucune absence non conforme</p>'
        : `<div class="chips-grid">${data.invalid.map(n => renderChip(n, false)).join('')}</div>`;
}

// ===== WEEKLY (avec calendrier) =====
async function loadWeekly() {
    try {
        const res = await fetch('/api/weekly');
        const data = await res.json();
        const tracking = data.tracking || [];

        const consecutive = tracking.filter(t => t.consecutiveDays >= 2);
        const consecutiveList = document.getElementById('consecutiveList');
        const calendar = document.getElementById('statsCalendar');

        // Section consécutifs
        consecutiveList.innerHTML = consecutive.length === 0
            ? '<p class="empty">Aucune absence consécutive ✨</p>'
            : consecutive.map(m => renderStatsMemberRow(m, true)).join('');

        // Calendrier visuel
        calendar.innerHTML = renderCalendar(tracking);
    } catch (e) {
        console.error('Weekly:', e);
    }
}

function renderStatsMemberRow(m, isAlert) {
    const avatar = m.avatar || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect width='48' height='48' fill='%23262626'/></svg>`;
    const detailsHtml = m.details && m.details.length > 0
        ? `<div class="member-details-list">
            ${m.details.map(d => `<div class="detail">${d.justified ? '✅' : '❌'} ${d.date} • ${d.op}</div>`).join('')}
          </div>`
        : '';

    return `
        <div class="member-row">
            <img class="stats-member-avatar" src="${avatar}" alt="">
            <div class="member-row-info">
                <div class="member-row-name">${escapeHtml(m.username)}</div>
                <div class="member-row-details">
                    ${isAlert ? `<span class="member-row-badge">${m.consecutiveDays} JOURS CONSÉCUTIFS</span> ` : ''}
                    ${m.count} absence(s) cette semaine
                </div>
                ${detailsHtml}
            </div>
            <div class="member-row-count">${m.count}</div>
        </div>
    `;
}

function renderCalendar(tracking) {
    if (tracking.length === 0) return '<p class="empty">Aucune absence cette semaine</p>';

    // Récupérer les 7 derniers jours (du lundi au dimanche)
    const today = new Date();
    const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1; // Lundi = 0
    const monday = new Date(today);
    monday.setDate(today.getDate() - dayOfWeek);

    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        days.push({
            date: d,
            dateStr: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
            label: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'][i],
            isToday: d.toDateString() === today.toDateString(),
        });
    }

    // Construire le tableau
    let html = '<table class="calendar-table"><thead><tr><th>Membre</th>';
    for (const d of days) {
        html += `<th${d.isToday ? ' style="color:var(--accent);"' : ''}>${d.label}<br><small style="font-size:10px;opacity:0.6;">${d.dateStr}</small></th>`;
    }
    html += '<th>Total</th></tr></thead><tbody>';

    for (const m of tracking) {
        const avatar = m.avatar || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='36' height='36' fill='%23262626'/></svg>`;
        html += `<tr><td class="calendar-member">
            <img class="calendar-member-avatar" src="${avatar}" alt="">
            <div class="calendar-member-info">
                <div class="calendar-member-name">${escapeHtml(m.username)}</div>
                <div class="calendar-member-stats">${m.count} absence(s) ${m.consecutiveDays >= 2 ? `• ${m.consecutiveDays}j consécutifs` : ''}</div>
            </div>
        </td>`;

        for (const d of days) {
            const dayDetails = (m.details || []).filter(det => det.date === d.dateStr);
            let cell = '';
            if (dayDetails.length === 0) {
                // Pas d'info pour ce jour → considéré présent (ou pas d'OP)
                cell = '<span class="calendar-cell empty">—</span>';
            } else {
                const hasJustified = dayDetails.some(det => det.justified);
                const hasUnjustified = dayDetails.some(det => !det.justified);
                if (hasJustified && !hasUnjustified) cell = '<span class="calendar-cell justified" title="Absence justifiée">📋✓</span>';
                else if (hasUnjustified) cell = '<span class="calendar-cell absent" title="Absence non justifiée">❌</span>';
            }
            html += `<td>${cell}</td>`;
        }

        html += `<td><strong style="color:var(--accent);font-size:18px;">${m.count}</strong></td>`;
        html += '</tr>';
    }

    html += '</tbody></table>';

    // Légende
    html += `
        <div class="calendar-legend">
            <div class="calendar-legend-item">📋✓ <span>Absence justifiée</span></div>
            <div class="calendar-legend-item">❌ <span>Absence non justifiée</span></div>
            <div class="calendar-legend-item">— <span>Pas d'OP / présent</span></div>
        </div>
    `;

    return html;
}

// ===== SANCTIONS =====
async function loadSanctions() {
    try {
        const res = await fetch('/api/sanctions');
        const data = await res.json();
        const list = document.getElementById('sanctionsList');

        if (!data.sanctions || data.sanctions.length === 0) {
            list.innerHTML = '<p class="empty">Aucune sanction récente</p>';
            return;
        }

        list.innerHTML = data.sanctions.map(s => {
            const date = new Date(s.timestamp);
            const dateStr = date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

            const mainUser = s.mentionedUsers && s.mentionedUsers[0];
            const avatar = mainUser?.avatar || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='%23262626'/></svg>`;

            // Parser le contenu
            let content = escapeHtml(s.content);
            // @@USER@id@name@color@@
            content = content.replace(/@@USER@(\d+)@([^@]+)@([^@]*)@@/g, (_, id, name, color) => {
                const style = color ? `style="color:${color};background:${color}22;"` : '';
                return `<span class="mention mention-user" ${style}>@${escapeHtml(name)}</span>`;
            });
            // @@ROLE@name@color@@
            content = content.replace(/@@ROLE@([^@]+)@([^@]*)@@/g, (_, name, color) => {
                const style = color ? `style="color:${color};background:${color}22;"` : '';
                return `<span class="mention mention-role" ${style}>@${escapeHtml(name)}</span>`;
            });
            // Emojis customs
            content = content.replace(/@@EMOJI@(\d+)@([^@]+)@(a?)@@/g, (_, id, name, animated) => {
                const ext = animated === 'a' ? 'gif' : 'png';
                return `<img class="inline-emoji" src="https://cdn.discordapp.com/emojis/${id}.${ext}" alt=":${name}:" title=":${name}:">`;
            });
            // Markdown gras
            content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

            return `
                <div class="sanction">
                    <img class="sanction-avatar" src="${avatar}" alt="">
                    <div class="sanction-body">
                        <span class="sanction-time">📅 ${dateStr}</span>
                        <div class="sanction-content">${content}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('Sanctions:', e);
    }
}

// ===== COMMANDES =====
async function runCmd(command) {
    if (!await confirmAction({
        title: 'Lancer la commande',
        message: `Lancer la commande "${command}" ?`,
        confirmText: 'Lancer',
    })) return;

    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });
        const data = await res.json();

        if (res.ok) {
            toast(data.frequency
                ? `📻 Radio envoyée : ${data.frequency}`
                : `✅ Commande "${command}" lancée`);
        } else {
            toast(`❌ ${data.error || 'Erreur'}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

// ===== TOAST =====
function toast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateX(100%)';
        setTimeout(() => t.remove(), 300);
    }, 4000);
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

        const titleNode = modal.querySelector('.confirm-action-title');
        const messageNode = modal.querySelector('.confirm-action-message');
        const okButton = modal.querySelector('[data-confirm-ok]');
        const cancelButtons = modal.querySelectorAll('[data-confirm-cancel]');
        const cancelButton = modal.querySelector('.confirm-action-buttons [data-confirm-cancel]');

        titleNode.textContent = title;
        messageNode.textContent = message;
        okButton.textContent = confirmText;
        cancelButton.textContent = cancelText;
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

// ==========================================
// SALONS
// ==========================================
let channelsLoaded = false;
let channelsData = null;
let currentChannelId = null;
let oldestMessageId = null;
let newestMessageId = null;
let channelPollTimer = null;
let isUserScrolledUp = false;
let loadingMore = false;

async function loadChannels() {
    try {
        const impersonateRole = localStorage.getItem('impersonate_role');
        const res = await fetch(impersonateRole ? `/api/channels?impersonate=${encodeURIComponent(impersonateRole)}` : '/api/channels');
        const data = await res.json();
        channelsData = data;
        channelsLoaded = true;
        renderChannelsTree();
    } catch (e) {
        console.error('Channels:', e);
    }
}

function renderChannelsTree(filter = '') {
    if (!channelsData) return;
    const tree = document.getElementById('channelsGridView');
    tree.innerHTML = '';
    const f = filter.toLowerCase();

    const renderChannelRow = (ch) => {
        const matches = !f || ch.name.toLowerCase().includes(f);
        if (!matches) return null;

        const icons = { 0: '#', 2: '🔊', 5: '📢', 13: '🎙', 15: '💬' };
        const types = { 0: 'Texte', 2: 'Vocal', 5: 'Annonces', 13: 'Stage', 15: 'Forum' };
        const icon = icons[ch.type] || '#';
        const typeLabel = types[ch.type] || 'Salon';
        const isClickable = ch.type === 0 || ch.type === 5 || ch.type === 15;

        const row = document.createElement('div');
        row.className = 'channel-row';
        row.dataset.type = ch.type;
        row.innerHTML = `
            <span class="channel-row-icon">${icon}</span>
            <div class="channel-row-info">
                <div class="channel-row-name">${escapeHtml(ch.name)}</div>
                ${ch.topic ? `<div class="channel-row-topic">${escapeHtml(ch.topic)}</div>` : ''}
            </div>
            <span class="channel-row-type">${typeLabel}</span>
            ${isClickable ? '<span class="channel-row-arrow">→</span>' : ''}
        `;
        if (isClickable) row.onclick = () => selectChannel(ch);
        else row.classList.add('channel-row-disabled');
        return row;
    };

    if (channelsData.orphans?.length) {
        const matchingOrphans = channelsData.orphans.map(renderChannelRow).filter(Boolean);
        if (matchingOrphans.length > 0) {
            const section = document.createElement('div');
            section.className = 'channel-category-section';
            section.innerHTML = `<div class="channel-category-title">▸ Sans catégorie</div>`;
            const list = document.createElement('div');
            list.className = 'channel-rows-list';
            matchingOrphans.forEach(c => list.appendChild(c));
            tree.appendChild(section);
            tree.appendChild(list);
        }
    }

    for (const cat of channelsData.categories) {
        const matchingChannels = cat.channels.map(renderChannelRow).filter(Boolean);
        if (matchingChannels.length === 0) continue;

        const section = document.createElement('div');
        section.className = 'channel-category-section';
        section.innerHTML = `<div class="channel-category-title">▸ ${escapeHtml(cat.name)}</div>`;
        const list = document.createElement('div');
        list.className = 'channel-rows-list';
        matchingChannels.forEach(c => list.appendChild(c));
        tree.appendChild(section);
        tree.appendChild(list);
    }

    if (tree.innerHTML === '') {
        tree.innerHTML = '<p class="empty">Aucun salon trouvé</p>';
    }
}

function backToChannels() {
    stopChannelPolling();
    document.getElementById('channelsGridView').style.display = 'block';
    document.getElementById('channelMessagesView').style.display = 'none';
    document.getElementById('backToChannelsBtn').style.display = 'none';
    const inputArea = document.getElementById('messageInputArea');
    if (inputArea) inputArea.style.display = 'none';
    closeMentionDropdown();
    currentChannelId = null;
}

function setupChannelSearch() {
    const input = document.getElementById('channelSearch');
    if (!input) return;
    input.addEventListener('input', e => renderChannelsTree(e.target.value));
}

async function selectChannel(ch) {
    currentChannelId = ch.id;
    stopChannelPolling();

    // Cacher la grille, montrer la vue messages
    document.getElementById('channelsGridView').style.display = 'none';
    document.getElementById('channelMessagesView').style.display = 'flex';
    document.getElementById('backToChannelsBtn').style.display = 'inline-block';

    document.getElementById('viewerName').textContent = '#' + ch.name;
    document.getElementById('viewerTopic').textContent = ch.topic || '';
    document.getElementById('viewerOpenDiscord').href = ch.url;

    document.getElementById('channelTimeline').innerHTML = '<p class="empty">Chargement...</p>';
    document.getElementById('loadMoreBtn').style.display = 'none';
    oldestMessageId = null;
    newestMessageId = null;

    // Afficher la zone d'envoi sur les salons texte/announcement
    const inputArea = document.getElementById('messageInputArea');
    if (inputArea) {
        if (ch.type === 0 || ch.type === 5) {
            inputArea.style.display = 'block';
            const input = document.getElementById('messageInput');
            if (input) {
                input.value = '';
                input.placeholder = `Écris un message dans #${ch.name}...`;
                input.style.height = 'auto';
            }
            document.getElementById('charCount').textContent = '0/2000';
        } else {
            inputArea.style.display = 'none';
        }
    }

    await loadMessages(ch.id);

    // Démarrer le polling si c'est un salon texte
    if (ch.type === 0 || ch.type === 5 || [10, 11, 12].includes(ch.type)) {
        startChannelPolling();
    }
}

async function loadMessages(channelId, before = null) {
    try {
        const url = before ? `/api/channel/${channelId}/messages?before=${before}` : `/api/channel/${channelId}/messages`;
        const res = await fetch(url);
        const data = await res.json();

        const container = document.getElementById('channelTimeline');
        if (data.error) {
            container.innerHTML = `<p class="empty">❌ ${data.error}</p>`;
            return;
        }

        // Forum : afficher les threads
        if (data.type === 'forum') {
            container.style.flexDirection = 'column'; // Pas reverse pour forums
            container.innerHTML = '';
            if (data.threads.length === 0) {
                container.innerHTML = '<p class="empty">Aucun fil dans ce forum</p>';
            } else {
                for (const t of data.threads) {
                    container.appendChild(renderThread(t, channelId));
                }
            }
            document.getElementById('loadMoreBtn').style.display = 'none';
            return;
        }

        // Salon texte normal
        container.style.flexDirection = 'column-reverse';
        if (!before) {
            container.innerHTML = '';
            // Reset newest pour la première charge
            if (data.messages.length > 0) {
                newestMessageId = data.messages[0].id; // [0] = plus récent (Discord renvoie en ordre desc)
            }
        }

        for (const m of data.messages) {
            container.appendChild(renderMessage(m));
            oldestMessageId = m.id;
        }

        const loadBtn = document.getElementById('loadMoreBtn');
        if (data.hasMore) {
            loadBtn.style.display = 'inline-block';
            loadBtn.disabled = false;
            loadBtn.textContent = '↑ Charger plus de messages';
        } else {
            loadBtn.style.display = 'none';
        }
    } catch (e) {
        console.error('Messages:', e);
    }
}

// ==========================================
// AUTO-REFRESH des salons (polling 5s)
// ==========================================
function startChannelPolling() {
    stopChannelPolling();
    channelPollTimer = setInterval(async () => {
        if (!currentChannelId) return;
        // Skip si l'onglet n'est pas Salons
        if (currentTab !== 'channels') return;
        // Skip si la vue messages n'est pas affichée
        const view = document.getElementById('channelMessagesView');
        if (!view || view.style.display === 'none') return;

        try {
            const res = await fetch(`/api/channel/${currentChannelId}/messages?after=${newestMessageId || 0}`);
            const data = await res.json();
            if (data.error || !data.messages || data.messages.length === 0) return;

            // Vérifier si on doit auto-scroll (l'utilisateur est en bas)
            const container = document.getElementById('channelTimeline');
            // Avec column-reverse, scrollTop = 0 signifie qu'on est en bas
            const wasAtBottom = Math.abs(container.scrollTop) < 100;

            // Ajouter les nouveaux messages au début (column-reverse)
            // Discord renvoie [récent, ..., ancien], on les ajoute du plus ancien au plus récent
            const sorted = [...data.messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            for (const m of sorted) {
                // Vérifier qu'il n'existe pas déjà
                if (container.querySelector(`[data-msg-id="${m.id}"]`)) continue;
                const el = renderMessage(m);
                container.insertBefore(el, container.firstChild);
                if (BigInt(m.id) > BigInt(newestMessageId || '0')) {
                    newestMessageId = m.id;
                }
            }

            if (wasAtBottom) {
                container.scrollTop = 0;
            }
        } catch (e) {
            // Silencieux : on est en polling, pas grave si une requête échoue
        }
    }, 5000);
}

function stopChannelPolling() {
    if (channelPollTimer) {
        clearInterval(channelPollTimer);
        channelPollTimer = null;
    }
}

function renderThread(t, parentId) {
    const div = document.createElement('div');
    div.className = 'forum-thread';
    const date = new Date(t.createdTimestamp).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

    let preview = '';
    if (t.firstMessage) {
        const fm = t.firstMessage;
        const avatar = fm.authorAvatar || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><rect width='24' height='24' fill='%23262626'/></svg>`;

        // Détecter le type de média (image, vidéo, lien externe)
        let mediaPreview = '';
        if (fm.attachments && fm.attachments.length > 0) {
            const firstImg = fm.attachments.find(a => a.isImage);
            const firstVid = fm.attachments.find(a => a.isVideo);
            if (firstImg) {
                mediaPreview = `<img class="thread-thumbnail" src="${firstImg.url}" alt="">`;
            } else if (firstVid) {
                mediaPreview = `<div class="thread-thumbnail thread-video-icon">🎥<br><small>VIDÉO</small></div>`;
            }
        }

        // Si pas d'attachment mais un embed avec image (ex: lien YouTube)
        if (!mediaPreview && fm.embeds && fm.embeds.length > 0) {
            const embedImg = fm.embeds.find(e => e.thumbnail || e.image);
            if (embedImg) {
                mediaPreview = `<img class="thread-thumbnail" src="${embedImg.thumbnail || embedImg.image}" alt="">`;
            } else {
                mediaPreview = `<div class="thread-thumbnail thread-link-icon">🔗<br><small>LIEN</small></div>`;
            }
        }

        // Détecter les liens vidéo dans le contenu
        if (!mediaPreview && fm.content) {
            const videoMatch = fm.content.match(/https?:\/\/[^\s]+\.(mp4|mov|avi|webm|mkv)|https?:\/\/(www\.)?(youtube\.com|youtu\.be|twitch\.tv|clips\.twitch\.tv|streamable\.com|medal\.tv|tiktok\.com|x\.com|twitter\.com)/i);
            if (videoMatch) {
                mediaPreview = `<div class="thread-thumbnail thread-link-icon">🎥<br><small>CLIP</small></div>`;
            }
        }

        // Contenu texte (avec liens cliquables)
        let textContent = '';
        if (fm.content) {
            const truncated = fm.content.length > 200 ? fm.content.substring(0, 200) + '…' : fm.content;
            textContent = escapeHtml(truncated).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" onclick="event.stopPropagation()">$1</a>');
        }

        preview = `
            <div class="thread-preview">
                ${mediaPreview}
                <div class="thread-preview-content">
                    <div class="thread-preview-author">
                        <img class="thread-preview-avatar" src="${avatar}" alt="">
                        <span>${escapeHtml(fm.authorName)}</span>
                    </div>
                    ${textContent ? `<div class="thread-preview-text">${textContent}</div>` : ''}
                </div>
            </div>
        `;
    }

    div.innerHTML = `
        <div class="forum-thread-header">
            <h4 class="forum-thread-name">${escapeHtml(t.name)}</h4>
            <div class="forum-thread-meta">
                ${t.archived ? '<span class="thread-tag">📦 Archivé</span>' : '<span class="thread-tag thread-active">● Actif</span>'}
                <span>💬 ${t.messageCount} messages</span>
                <span>👥 ${t.memberCount} membres</span>
                <span>🕐 ${date}</span>
            </div>
        </div>
        ${preview}
        <button class="btn-thread-open" onclick="openThread('${t.id}', '${escapeHtml(t.name).replace(/'/g, "\\'")}')">Voir le fil →</button>
    `;
    return div;
}

async function openThread(threadId, threadName) {
    currentChannelId = threadId;
    document.getElementById('viewerName').textContent = '🧵 ' + threadName;
    document.getElementById('channelTimeline').innerHTML = '<p class="empty">Chargement...</p>';
    oldestMessageId = null;

    // Afficher la zone d'envoi pour les threads aussi
    const inputArea = document.getElementById('messageInputArea');
    if (inputArea) {
        inputArea.style.display = 'block';
        const input = document.getElementById('messageInput');
        if (input) {
            input.value = '';
            input.placeholder = `Écris dans le fil "${threadName}"...`;
            input.style.height = 'auto';
        }
        document.getElementById('charCount').textContent = '0/2000';
    }

    await loadMessages(threadId);
}

function renderMessage(m) {
    const div = document.createElement('div');
    div.className = 'message';
    div.dataset.msgId = m.id;
    const date = new Date(m.createdTimestamp);
    const dateStr = date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

    const avatar = m.authorAvatar || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='%23262626'/></svg>`;

    let content = escapeHtml(m.content)
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>')
        .replace(/<@!?(\d+)>/g, (_, id) => {
            const u = m.mentions.users.find(u => u.id === id);
            const color = u?.color ? `style="color:${u.color};background:${u.color}22;"` : '';
            return `<span class="mention mention-user" ${color}>@${escapeHtml(u?.name || 'inconnu')}</span>`;
        })
        .replace(/<@&(\d+)>/g, (_, id) => {
            const r = m.mentions.roles.find(r => r.id === id);
            const color = r?.color ? `#${r.color.toString(16).padStart(6, '0')}` : null;
            const style = color ? `style="color:${color};background:${color}22;"` : '';
            return `<span class="mention mention-role" ${style}>@${escapeHtml(r?.name || 'rôle')}</span>`;
        })
        .replace(/<#(\d+)>/g, '<span class="mention mention-channel">#salon</span>')
        // Emojis customs → vraie image
        .replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, animated, name, id) => {
            const ext = animated === 'a' ? 'gif' : 'png';
            return `<img class="inline-emoji" src="https://cdn.discordapp.com/emojis/${id}.${ext}" alt=":${name}:" title=":${name}:">`;
        })
        // Markdown gras
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Markdown italique
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    let attachmentsHtml = '';
    for (const a of m.attachments) {
        if (a.isImage) {
            attachmentsHtml += `<img class="message-attachment-img" src="${a.url}" alt="${escapeHtml(a.name)}" onclick="window.open('${a.url}', '_blank')">`;
        } else if (a.isVideo) {
            attachmentsHtml += `<video class="message-attachment-video" src="${a.url}" controls></video>`;
        } else {
            attachmentsHtml += `<a href="${a.url}" target="_blank" class="message-attachment-file">📎 ${escapeHtml(a.name)}</a>`;
        }
    }

    let embedsHtml = '';
    for (const e of m.embeds) {
        embedsHtml += `
            <div class="message-embed" style="${e.color ? `border-left-color:#${e.color.toString(16).padStart(6,'0')};` : ''}">
                ${e.title ? `<div class="message-embed-title">${escapeHtml(e.title)}</div>` : ''}
                ${e.description ? `<div class="message-embed-desc">${escapeHtml(e.description).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>')}</div>` : ''}
                ${e.image ? `<img class="message-embed-image" src="${e.image}" alt="">` : ''}
                ${(e.fields || []).map(f => `<div style="margin-top:8px;"><strong style="font-size:12px;">${escapeHtml(f.name)}</strong><div style="font-size:12px;color:var(--text-dim);white-space:pre-wrap;">${escapeHtml(f.value)}</div></div>`).join('')}
            </div>
        `;
    }

    let reactionsHtml = '';
    for (const r of m.reactions) {
        reactionsHtml += `<span class="message-reaction">${r.emojiUrl ? `<img src="${r.emojiUrl}" alt=":${r.emojiName}:">` : r.emoji} ${r.count}</span>`;
    }

    div.innerHTML = `
        <img class="message-avatar" src="${avatar}" alt="">
        <div class="message-body">
            <div class="message-header">
                <span class="message-author ${m.authorBot ? 'bot' : ''}" ${m.authorColor ? `style="color:${m.authorColor};"` : ''}>${escapeHtml(m.authorName)}</span>
                ${m.authorBot ? '<span class="message-bot-tag">BOT</span>' : ''}
                ${m.pinned ? '<span class="message-pinned-tag">📌 ÉPINGLÉ</span>' : ''}
                <span class="message-time">${dateStr}</span>
            </div>
            ${content ? `<div class="message-content">${content}</div>` : ''}
            ${attachmentsHtml ? `<div class="message-attachments">${attachmentsHtml}</div>` : ''}
            ${embedsHtml ? `<div class="message-embeds">${embedsHtml}</div>` : ''}
            ${reactionsHtml ? `<div class="message-reactions">${reactionsHtml}</div>` : ''}
        </div>
    `;
    return div;
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
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

function safeColor(color) {
    const value = String(color || '').trim();
    return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '';
}

// Bouton "Charger plus"
document.addEventListener('click', async (e) => {
    if (e.target.id === 'loadMoreBtn' && !loadingMore) {
        loadingMore = true;
        e.target.disabled = true;
        e.target.textContent = 'Chargement...';
        await loadMessages(currentChannelId, oldestMessageId);
        loadingMore = false;
    }
});

// ==========================================
// CARTE INTERACTIVE — V2 avec zoom & rôles
// ==========================================
let mapPoints = [];
let mapMode = 'view';
let pendingPoint = null;
let mapZoomLevel = 1;
let mapTranslateX = 0;
let mapTranslateY = 0;
let mapDragMoved = false;
let isDragging = false;
let dragStart = { x: 0, y: 0, tx: 0, ty: 0 };
let allRoles = []; // Cache des rôles pour la modal

const POINT_TYPES = {
    weed: { icon: '🌿', label: 'Champ Weed', color: '#7CFC00' },
    'weed-treatment': { icon: '⚗', label: 'Traitement Weed', color: '#9ACD32' },
    opium: { icon: '🌺', label: 'Champ Opium', color: '#DA70D6' },
    coke: { icon: '❄', label: 'Champ Coke', color: '#87CEEB' },
    lab: { icon: '🧪', label: 'Laboratoire', color: '#00CED1' },
    'weapon-lab': { icon: '🔫', label: 'Laboratoire d\'armes', color: '#FFD700' },
    hood: { icon: '🏘', label: 'Hood', color: '#FFA500' },
    danger: { icon: '⚠', label: 'Danger', color: '#FF0000' },
};

function getPointTypeIcon(type) {
    return POINT_TYPES[type]?.icon || '📍';
}

function getPointTypeColor(type) {
    return POINT_TYPES[type]?.color || '#ff3333';
}

function getPointTypeLabel(type) {
    return POINT_TYPES[type]?.label || 'Point';
}

function setupMap() {
    document.querySelectorAll('.map-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if ((mode === 'add' || mode === 'delete') && !userPermissions.canEditMap) {
                toast('❌ Tu n\'as pas les permissions pour modifier la carte', 'error');
                return;
            }
            setMapMode(mode);
        });
    });

    const container = document.getElementById('mapContainer');
    const canvas = document.getElementById('mapCanvas');
    if (!container || !canvas) return;

    // Click sur la carte (mode add) — détection click vs drag
    canvas.addEventListener('click', async (e) => {
        if (mapMode !== 'add') return;
        if (e.target.closest('.map-point')) return;
        if (mapDragMoved) return;

        const img = document.getElementById('mapImage');
        const rect = img.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        if (x < 0 || x > 100 || y < 0 || y > 100) return;

        pendingPoint = { x, y };
        document.getElementById('pointLabel').value = '';
        document.getElementById('pointType').value = 'weed';
        document.getElementById('pointCode').value = '';
        onPointTypeChange();
        document.getElementById('pointModal').style.display = 'flex';

        await loadRolesForModal();
        setTimeout(() => document.getElementById('pointLabel').focus(), 100);
    });

    // ====== ZOOM/PAN LOGIC avec transform ======
    // mapTranslateX/Y = position du canvas (en px)
    // mapZoomLevel = échelle

    // Zoom à la molette — centré sur le curseur
    container.addEventListener('wheel', (e) => {
        e.preventDefault();

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Position dans la carte avant zoom
        const cartX = (mouseX - mapTranslateX) / mapZoomLevel;
        const cartY = (mouseY - mapTranslateY) / mapZoomLevel;

        const oldZoom = mapZoomLevel;
        const delta = e.deltaY > 0 ? 0.85 : 1.15;
        const newZoom = Math.max(0.1, Math.min(8, oldZoom * delta));
        if (newZoom === oldZoom) return;

        mapZoomLevel = newZoom;
        // Repositionner pour que le point sous le curseur reste sous le curseur
        mapTranslateX = mouseX - cartX * mapZoomLevel;
        mapTranslateY = mouseY - cartY * mapZoomLevel;

        applyMapTransform();
    }, { passive: false });

    // Drag pour déplacer
    let isMouseDown = false;
    let dragStartX, dragStartY, startTranslateX, startTranslateY;

    container.addEventListener('mousedown', (e) => {
        if (e.target.closest('.map-point')) return;
        if (mapMode === 'add') return;
        isMouseDown = true;
        mapDragMoved = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        startTranslateX = mapTranslateX;
        startTranslateY = mapTranslateY;
        container.classList.add('dragging');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mapDragMoved = true;
        mapTranslateX = startTranslateX + dx;
        mapTranslateY = startTranslateY + dy;
        applyMapTransform();
    });

    document.addEventListener('mouseup', () => {
        if (isMouseDown) {
            isMouseDown = false;
            container.classList.remove('dragging');
            setTimeout(() => { mapDragMoved = false; }, 50);
        }
    });

    // Touch support pour mobile/tablette
    let lastTouchDist = 0;
    container.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1 && mapMode !== 'add') {
            isMouseDown = true;
            mapDragMoved = false;
            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;
            startTranslateX = mapTranslateX;
            startTranslateY = mapTranslateY;
        } else if (e.touches.length === 2) {
            const t1 = e.touches[0], t2 = e.touches[1];
            lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        }
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1 && isMouseDown) {
            const dx = e.touches[0].clientX - dragStartX;
            const dy = e.touches[0].clientY - dragStartY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mapDragMoved = true;
            mapTranslateX = startTranslateX + dx;
            mapTranslateY = startTranslateY + dy;
            applyMapTransform();
        } else if (e.touches.length === 2) {
            e.preventDefault();
            const t1 = e.touches[0], t2 = e.touches[1];
            const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            if (lastTouchDist > 0) {
                const factor = newDist / lastTouchDist;
                const rect = container.getBoundingClientRect();
                const cx = (t1.clientX + t2.clientX) / 2 - rect.left;
                const cy = (t1.clientY + t2.clientY) / 2 - rect.top;
                const cartX = (cx - mapTranslateX) / mapZoomLevel;
                const cartY = (cy - mapTranslateY) / mapZoomLevel;
                mapZoomLevel = Math.max(0.1, Math.min(8, mapZoomLevel * factor));
                mapTranslateX = cx - cartX * mapZoomLevel;
                mapTranslateY = cy - cartY * mapZoomLevel;
                applyMapTransform();
            }
            lastTouchDist = newDist;
        }
    }, { passive: false });

    container.addEventListener('touchend', () => {
        isMouseDown = false;
        lastTouchDist = 0;
        setTimeout(() => { mapDragMoved = false; }, 50);
    });
}

function applyMapTransform() {
    const canvas = document.getElementById('mapCanvas');
    if (!canvas) return;
    canvas.style.transform = `translate(${mapTranslateX}px, ${mapTranslateY}px) scale(${mapZoomLevel})`;

    // Inverser l'échelle des points pour qu'ils gardent leur taille visible
    const layer = document.getElementById('mapPointsLayer');
    if (layer) {
        const points = layer.querySelectorAll('.map-point');
        const inverseScale = 1 / mapZoomLevel;
        points.forEach(p => {
            // On combine : translate -50% -100% (ancrage) + scale inverse
            p.style.transform = `scale(${inverseScale})`;
        });
    }

    document.getElementById('mapZoomLabel').textContent = Math.round(mapZoomLevel * 100) + '%';
}

function mapZoom(delta) {
    const container = document.getElementById('mapContainer');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const cartX = (cx - mapTranslateX) / mapZoomLevel;
    const cartY = (cy - mapTranslateY) / mapZoomLevel;

    const factor = delta > 0 ? 1.25 : 0.8;
    const newZoom = Math.max(0.1, Math.min(8, mapZoomLevel * factor));
    if (newZoom === mapZoomLevel) return;

    mapZoomLevel = newZoom;
    mapTranslateX = cx - cartX * mapZoomLevel;
    mapTranslateY = cy - cartY * mapZoomLevel;

    const canvas = document.getElementById('mapCanvas');
    if (canvas) canvas.classList.add('smooth-zoom');
    applyMapTransform();
    setTimeout(() => { if (canvas) canvas.classList.remove('smooth-zoom'); }, 200);
}

function mapZoomReset() {
    autoFitMap();
}

function setMapMode(mode) {
    mapMode = mode;
    document.querySelectorAll('.map-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const container = document.getElementById('mapContainer');
    container.classList.remove('add-mode', 'delete-mode');
    if (mode === 'add') container.classList.add('add-mode');
    if (mode === 'delete') container.classList.add('delete-mode');

    const info = document.getElementById('mapInfo');
    const messages = {
        view: 'Mode <strong>Voir</strong> — Clique sur un point pour voir les détails • Molette pour zoomer • Drag pour déplacer',
        add: 'Mode <strong>Ajouter</strong> — Clique sur la carte pour placer un nouveau point',
        delete: 'Mode <strong>Supprimer</strong> — Clique sur un point pour le supprimer',
    };
    info.innerHTML = `<span class="info-text">${messages[mode]}</span>`;
}

async function loadMapPoints() {
    try {
        // Si en mode impersonate (admin), passer le rôle
        const impersonateRole = localStorage.getItem('impersonate_role');
        const url = impersonateRole ? `/api/map/points?impersonate=${impersonateRole}` : '/api/map/points';
        const res = await fetch(url);
        const data = await res.json();
        mapPoints = data.points || [];
        renderMapPoints();

        // Bandeau impersonate
        updateImpersonateBanner();

        // Auto-fit initial : ajuster zoom pour que la carte rentre dans le container
        if (!mapInitialized) {
            mapInitialized = true;
            setTimeout(() => autoFitMap(), 100);
        }
    } catch (e) {
        console.error('Map:', e);
    }
}

function updateImpersonateBanner() {
    const role = localStorage.getItem('impersonate_role');
    let banner = document.getElementById('impersonateBanner');

    if (role) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'impersonateBanner';
            banner.className = 'impersonate-banner';
            document.body.prepend(banner);
        }
        banner.innerHTML = `
            <span>👁 Vous êtes en mode <strong>impersonate</strong> du rôle ${role}</span>
            <button onclick="exitImpersonate()" class="btn-impersonate-exit">✗ Quitter</button>
        `;
        banner.style.display = 'flex';
    } else if (banner) {
        banner.style.display = 'none';
    }
}

function exitImpersonate() {
    localStorage.removeItem('impersonate_role');
    location.reload();
}
window.exitImpersonate = exitImpersonate;

let mapInitialized = false;

function autoFitMap() {
    const container = document.getElementById('mapContainer');
    const img = document.getElementById('mapImage');
    if (!container || !img) return;

    if (!img.complete || img.naturalWidth === 0) {
        img.onload = () => autoFitMap();
        return;
    }

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;

    const scaleX = containerWidth / imgWidth;
    const scaleY = containerHeight / imgHeight;
    const fitScale = Math.min(scaleX, scaleY) * 0.95;

    mapZoomLevel = fitScale;

    // Centrer la carte dans le container
    mapTranslateX = (containerWidth - imgWidth * mapZoomLevel) / 2;
    mapTranslateY = (containerHeight - imgHeight * mapZoomLevel) / 2;

    const canvas = document.getElementById('mapCanvas');
    if (canvas) canvas.classList.add('smooth-zoom');
    applyMapTransform();
    setTimeout(() => { if (canvas) canvas.classList.remove('smooth-zoom'); }, 200);
}

// Re-fitter la carte automatiquement quand la fenêtre est redimensionnée
let mapResizeTimer = null;
window.addEventListener('resize', () => {
    if (currentTab !== 'map') return;
    clearTimeout(mapResizeTimer);
    mapResizeTimer = setTimeout(() => autoFitMap(), 150);
});

// Aussi quand on entre/sort du plein écran
document.addEventListener('fullscreenchange', () => {
    if (currentTab !== 'map') return;
    setTimeout(() => autoFitMap(), 200);
});

function renderMapPoints() {
    const layer = document.getElementById('mapPointsLayer');
    if (!layer) return;
    layer.innerHTML = '';

    for (const p of mapPoints) {
        const color = getPointTypeColor(p.type);
        const icon = getPointTypeIcon(p.type);
        const label = getPointTypeLabel(p.type);

        const pin = document.createElement('div');
        pin.className = 'map-point';
        pin.dataset.type = p.type;
        // Position en % de l'image (recalculée au render)
        pin.style.left = p.x + '%';
        pin.style.top = p.y + '%';
        // Scale inverse pour rester de taille fixe à l'écran
        pin.style.transform = `scale(${1 / mapZoomLevel})`;

        pin.innerHTML = `
            <svg class="map-point-pin" viewBox="0 0 24 32" fill="${color}" stroke="#000" stroke-width="1.5">
                <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"/>
                <text x="12" y="17" text-anchor="middle" font-size="13" fill="#fff" stroke="none" style="font-family: Arial, sans-serif;">${icon}</text>
            </svg>
            <div class="map-point-label">${escapeHtml(p.label)} • ${label}</div>
        `;
        pin.onclick = (e) => {
            e.stopPropagation();
            if (mapDragMoved) return;
            if (mapMode === 'delete') {
                deletePoint(p.id);
            } else {
                showPointDetails(p);
            }
        };
        layer.appendChild(pin);
    }

    document.getElementById('mapPointCount').textContent = mapPoints.length;
}

async function loadRolesForModal() {
    if (allRoles.length === 0) {
        try {
            const res = await fetch('/api/roles');
            const data = await res.json();
            allRoles = data.roles || [];
        } catch {}
    }

    const container = document.getElementById('pointRolesSelector');
    if (!container) return;

    if (allRoles.length === 0) {
        container.innerHTML = '<p class="empty" style="padding:12px;">Aucun rôle disponible</p>';
        return;
    }

    container.innerHTML = allRoles.map(r => `
        <label class="role-checkbox">
            <input type="checkbox" value="${r.id}" data-role-id="${r.id}">
            <span class="role-color-dot" style="background:${r.color || 'var(--text-muted)'};"></span>
            <span class="role-checkbox-name" style="color:${r.color || 'var(--text)'};">${escapeHtml(r.name)}</span>
            <span class="role-checkbox-count">${r.memberCount || 0}</span>
        </label>
    `).join('');
}

function selectAllRoles() {
    document.querySelectorAll('#pointRolesSelector input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function selectNoRoles() {
    document.querySelectorAll('#pointRolesSelector input[type="checkbox"]').forEach(cb => cb.checked = false);
}

function onPointTypeChange() {
    const type = document.getElementById('pointType').value;
    const codeField = document.getElementById('pointCodeField');
    if (codeField) {
        codeField.style.display = (type === 'lab' || type === 'weapon-lab') ? 'block' : 'none';
    }
}

async function confirmAddPoint() {
    if (!pendingPoint) return;
    const label = document.getElementById('pointLabel').value.trim() || 'Point sans nom';
    const type = document.getElementById('pointType').value;
    const code = document.getElementById('pointCode').value.trim();

    const allowedRoles = [...document.querySelectorAll('#pointRolesSelector input[type="checkbox"]:checked')]
        .map(cb => cb.dataset.roleId);

    try {
        const res = await fetch('/api/map/points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...pendingPoint, label, type, allowedRoles, code })
        });
        if (res.ok) {
            const data = await res.json();
            mapPoints.push(data.point);
            renderMapPoints();
            toast('📍 Point ajouté');
        } else {
            const err = await res.json();
            toast(`❌ ${err.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }

    closePointModal();
}

function closePointModal() {
    document.getElementById('pointModal').style.display = 'none';
    pendingPoint = null;
}

async function deletePoint(id) {
    if (!await confirmAction({
        title: 'Supprimer le point',
        message: 'Supprimer ce point de la carte ?',
        confirmText: 'Supprimer',
        danger: true,
    })) return;
    try {
        const res = await fetch(`/api/map/points/${id}`, { method: 'DELETE' });
        if (res.ok) {
            mapPoints = mapPoints.filter(p => p.id !== id);
            renderMapPoints();
            toast('🗑 Point supprimé');
        } else {
            const err = await res.json();
            toast(`❌ ${err.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

function showPointDetails(p) {
    const date = new Date(p.createdAt).toLocaleString('fr-FR');

    let codeHtml = '';
    if (p.code && (p.type === 'lab' || p.type === 'weapon-lab')) {
        codeHtml = `
            <div class="point-code-box">
                <div class="point-code-label">🔐 CODE D'ACCÈS</div>
                <div class="point-code-value" onclick="copyCodeToClipboard('${escapeHtml(p.code).replace(/'/g, "\\'")}')">${escapeHtml(p.code)}</div>
                <div class="point-code-hint">Clique pour copier</div>
            </div>
        `;
    }

    document.getElementById('detailsTitle').textContent = `${getPointTypeIcon(p.type)} ${p.label}`;
    document.getElementById('detailsContent').innerHTML = `
        ${codeHtml}
        <div class="detail-row"><span>Type</span><span>${getPointTypeLabel(p.type)}</span></div>
        <div class="detail-row"><span>Placé par</span><span>${escapeHtml(displayName(p.createdBy))}</span></div>
        <div class="detail-row"><span>Date</span><span>${date}</span></div>
        ${userPermissions.canEditMap ? `<button class="btn-delete-point" onclick="deletePoint('${p.id}'); closeDetailsModal();">🗑 Supprimer ce point</button>` : ''}
    `;
    document.getElementById('pointDetailsModal').style.display = 'flex';
}

function copyCodeToClipboard(code) {
    navigator.clipboard.writeText(code).then(() => {
        toast('📋 Code copié dans le presse-papier');
    }).catch(() => {
        toast('❌ Impossible de copier', 'error');
    });
}

function closeDetailsModal() {
    document.getElementById('pointDetailsModal').style.display = 'none';
}

// Touche Échap pour fermer les modales
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closePointModal();
        closeDetailsModal();
        closeCraftWeaponDetails();
        closePresenceStatDetails();
    }
});

// ==========================================
// COMMANDES dynamiques
// ==========================================
async function loadCommands() {
    try {
        const res = await fetch('/api/commands');
        const data = await res.json();
        const cmdSection = document.querySelector('#tab-commands');
        if (!cmdSection) return;

        const alerts = data.commands.filter(c => c.category === 'alert');
        const comms = data.commands.filter(c => c.category === 'comm');

        const renderBtn = (c) => `
            <button class="cmd-btn ${c.danger ? 'cmd-danger' : ''} ${c.info ? 'cmd-info' : ''}" onclick="runCmd('${c.id}')">
                <span class="cmd-icon">${c.icon}</span>
                <span class="cmd-name">${escapeHtml(c.name)}</span>
                <span class="cmd-desc">${escapeHtml(c.desc)}</span>
            </button>
        `;

        // Remplacer dynamiquement les sections "Alertes terrain" et "Communications"
        const sections = cmdSection.querySelectorAll('.cmd-section');
        if (sections.length >= 2) {
            sections[0].querySelector('.cmd-grid').innerHTML = alerts.map(renderBtn).join('');
            sections[1].querySelector('.cmd-grid').innerHTML = comms.map(renderBtn).join('');
        }
    } catch (e) {
        console.error('Commands:', e);
    }
}

// ==========================================
// ANNONCE
// ==========================================
let serverEmojis = [];

let allRolesCache = [];

async function loadAnnonceData() {
    // Charger rôles
    try {
        const r = await fetch('/api/roles');
        const data = await r.json();
        if (data.roles) {
            allRolesCache = data.roles;
            renderRoleDropdown('annonce');
            renderRoleDropdown('rappel');
        }
    } catch {}

    // Charger emojis
    try {
        const r = await fetch('/api/emojis');
        const data = await r.json();
        serverEmojis = data.emojis || [];
    } catch {}

    // Initialiser les compteurs de caractères
    setupCharCounters();

    // Setup search dans les dropdowns
    ['annonceRole', 'rappelRole'].forEach(prefix => {
        const search = document.getElementById(`${prefix}Search`);
        if (search) {
            search.addEventListener('input', () => filterRoleDropdown(prefix.replace('Role', '')));
        }
    });
}

function renderRoleDropdown(type) {
    const list = document.getElementById(`${type}RoleList`);
    if (!list) return;

    list.innerHTML = allRolesCache.map(role => {
        const color = safeColor(role.color);
        const colorDot = color
            ? `<span class="role-color-dot" style="background:${color};"></span>`
            : `<span class="role-color-dot" style="background:#888;"></span>`;
        return `
            <div class="custom-dropdown-item" data-role-id="${escapeHtml(role.id)}" data-role-name="${escapeHtml(role.name)}" data-role-color="${color}" onclick="selectRole('${type}', '${escapeJsArg(role.id)}', '${escapeJsArg(role.name)}', '${color}', ${role.memberCount})">
                ${colorDot}
                <span class="custom-dropdown-item-label" style="${color ? `color:${color};` : ''}">@${escapeHtml(role.name)}</span>
                <span class="custom-dropdown-item-count">${role.memberCount}</span>
            </div>
        `;
    }).join('');
}

function filterRoleDropdown(type) {
    const query = document.getElementById(`${type}RoleSearch`).value.toLowerCase().trim();
    const items = document.querySelectorAll(`#${type}RoleList .custom-dropdown-item`);
    items.forEach(item => {
        const name = item.dataset.roleName.toLowerCase();
        item.style.display = !query || name.includes(query) ? 'flex' : 'none';
    });
}

function toggleRoleDropdown(type, event) {
    if (event) event.stopPropagation();
    smartToggleDropdown(`${type}RoleMenu`, () => {
        const search = document.getElementById(`${type}RoleSearch`);
        if (search) {
            search.value = '';
            filterRoleDropdown(type);
            setTimeout(() => search.focus(), 50);
        }
    });
}

function selectRole(type, id, name, color, count) {
    document.getElementById(`${type}Role`).value = id;
    const label = document.getElementById(`${type}RoleLabel`);
    const safe = safeColor(color);
    if (label) {
        label.innerHTML = `<span class="role-color-dot" style="background:${safe || '#888'};"></span> @${escapeHtml(name)} <span style="opacity:0.6;font-size:11px;">(${count})</span>`;
        label.classList.remove('custom-dropdown-placeholder');
        if (safe) label.style.color = safe;
    }
    document.getElementById(`${type}RoleMenu`).style.display = 'none';
}

function closeAllDropdowns() {
    document.querySelectorAll('.custom-dropdown-menu').forEach(m => m.style.display = 'none');
}

// Helper : toggle un dropdown intelligemment
// Si le menu était ouvert → ferme tout (y compris lui)
// Sinon → ferme tout puis ouvre celui-là
function smartToggleDropdown(menuId, beforeOpen) {
    const menu = document.getElementById(menuId);
    if (!menu) return false;
    const wasOpen = menu.style.display !== 'none' && menu.style.display !== '';
    closeAllDropdowns();
    if (!wasOpen) {
        menu.style.display = 'block';
        if (typeof beforeOpen === 'function') beforeOpen(menu);
        return true;
    }
    return false;
}
window.smartToggleDropdown = smartToggleDropdown;

// Click extérieur ferme tous les dropdowns
document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-dropdown')) {
        closeAllDropdowns();
    }
});

window.toggleRoleDropdown = toggleRoleDropdown;
window.selectRole = selectRole;

function setupCharCounters() {
    const fields = [
        ['annonceMessage', 'annonceCharCount'],
        ['rappelMessage', 'rappelCharCount'],
        ['sanctionRaison', 'sanctionCharCount'],
    ];
    for (const [textareaId, counterId] of fields) {
        const ta = document.getElementById(textareaId);
        const counter = document.getElementById(counterId);
        if (ta && counter) {
            const update = () => {
                counter.textContent = `${ta.value.length} / 2000`;
                counter.classList.toggle('comm-charcount-warn', ta.value.length > 1800);
            };
            ta.addEventListener('input', update);
            update();
        }
    }
}

let activeCommTab = 'annonce';
let activeEmojiTarget = 'annonceMessage';

function switchCommTab(name) {
    activeCommTab = name;
    document.querySelectorAll('.comm-tab').forEach(b => b.classList.toggle('active', b.dataset.comm === name));
    document.querySelectorAll('.comm-panel').forEach(p => {
        if (p.id === `commPanel-${name}`) {
            p.classList.add('active');
            p.style.display = 'block';
        } else {
            p.classList.remove('active');
            p.style.display = 'none';
        }
    });
    // Cacher le picker emoji quand on change d'onglet
    const picker = document.getElementById('emojiPicker');
    if (picker) picker.style.display = 'none';
}

// Exposer les fonctions globalement pour les onclick inline
window.switchCommTab = switchCommTab;

let emojiPickerCategory = 'server'; // 'server' ou 'discord'

const DISCORD_EMOJIS = {
    'Visages': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'],
    'Gestes': ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋'],
    'Cœurs & Symboles': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️'],
    'Objets': ['💎', '💍', '🔫', '🔪', '⚔️', '🛡️', '🚬', '⚰️', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪒', '🧽', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🖼️', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🎊', '🎉', '🎎', '🏮', '🎐', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷️', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '📇', '🗃️', '🗳️', '🗄️', '📋', '📁', '📂', '🗂️', '🗞️', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇️', '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍', '🔎', '🔏', '🔐', '🔒', '🔓'],
    'Drapeaux & Statut': ['🚩', '🏁', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '✅', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❓', '❕', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✳️', '❇️', '🔵', '🟣', '🟢', '🟡', '🟠', '🔴', '⚫', '⚪', '🟤'],
};

function toggleEmojiPicker(targetId) {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;
    activeEmojiTarget = targetId || 'annonceMessage';
    if (picker.style.display === 'none' || !picker.style.display) {
        renderEmojiPicker();
        picker.style.display = 'block';
    } else {
        picker.style.display = 'none';
    }
}

function switchEmojiCategory(cat) {
    emojiPickerCategory = cat;
    renderEmojiPicker();
}

function renderEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;

    const tabsHTML = `
        <div class="emoji-picker-tabs">
            <button type="button" class="emoji-picker-tab ${emojiPickerCategory === 'server' ? 'active' : ''}" onclick="switchEmojiCategory('server')">🎨 Serveur</button>
            <button type="button" class="emoji-picker-tab ${emojiPickerCategory === 'discord' ? 'active' : ''}" onclick="switchEmojiCategory('discord')">😀 Discord</button>
        </div>
    `;

    let contentHTML = '';

    if (emojiPickerCategory === 'server') {
        if (serverEmojis.length === 0) {
            contentHTML = '<p class="empty" style="padding:24px;text-align:center;">Aucun emoji custom sur le serveur</p>';
        } else {
            contentHTML = `<div class="emoji-picker-grid">` + serverEmojis.map(e => `
                <div class="emoji-item" title=":${e.name}:" onclick="insertEmoji('${e.code.replace(/'/g, "\\'")}')">
                    <img src="${e.url}" alt=":${e.name}:">
                </div>
            `).join('') + `</div>`;
        }
    } else {
        // Emojis Discord par catégorie
        contentHTML = '<div class="emoji-picker-content">';
        for (const [catName, emojis] of Object.entries(DISCORD_EMOJIS)) {
            contentHTML += `<div class="emoji-category-title">${catName}</div>`;
            contentHTML += '<div class="emoji-picker-grid">';
            for (const emoji of emojis) {
                contentHTML += `<div class="emoji-item emoji-item-unicode" title="${emoji}" onclick="insertEmoji('${emoji}')">${emoji}</div>`;
            }
            contentHTML += '</div>';
        }
        contentHTML += '</div>';
    }

    picker.innerHTML = tabsHTML + contentHTML;
}

window.switchEmojiCategory = switchEmojiCategory;

function insertEmoji(code) {
    const textarea = document.getElementById(activeEmojiTarget);
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.substring(0, start) + code + value.substring(end);
    textarea.focus();
    textarea.setSelectionRange(start + code.length, start + code.length);
    // Trigger input event pour mettre à jour le compteur
    textarea.dispatchEvent(new Event('input'));
}

async function sendAnnonce() {
    const roleId = document.getElementById('annonceRole').value;
    const message = document.getElementById('annonceMessage').value;

    if (!roleId) { toast('❌ Choisis un rôle', 'error'); return; }
    if (!message.trim()) { toast('❌ Tape un message', 'error'); return; }
    if (!await confirmAction({ title: 'Envoyer l’annonce', message: 'Envoyer cette annonce sur Discord ?', confirmText: 'Envoyer' })) return;

    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'annonce', params: { roleId, message } })
        });
        const data = await res.json();
        if (res.ok) {
            toast('📤 Annonce envoyée');
            const ta = document.getElementById('annonceMessage');
            ta.value = '';
            ta.dispatchEvent(new Event('input'));
            document.getElementById('annonceRole').value = '';
            const label = document.getElementById('annonceRoleLabel');
            if (label) { label.innerHTML = '— Choisir un rôle —'; label.style.color = ''; }
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

async function sendRappel() {
    const roleId = document.getElementById('rappelRole').value;
    const message = document.getElementById('rappelMessage').value;

    if (!roleId) { toast('❌ Choisis un rôle', 'error'); return; }
    if (!message.trim()) { toast('❌ Tape un message', 'error'); return; }
    if (!await confirmAction({ title: 'Envoyer le rappel', message: 'Envoyer ce rappel sur Discord ?', confirmText: 'Envoyer' })) return;

    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'rappel', params: { roleId, message } })
        });
        const data = await res.json();
        if (res.ok) {
            toast('📌 Rappel envoyé');
            const ta = document.getElementById('rappelMessage');
            ta.value = '';
            ta.dispatchEvent(new Event('input'));
            document.getElementById('rappelRole').value = '';
            const label = document.getElementById('rappelRoleLabel');
            if (label) { label.innerHTML = '— Choisir un rôle —'; label.style.color = ''; }
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

async function sendSanction() {
    const userId = document.getElementById('sanctionUser').value.trim();
    const raison = document.getElementById('sanctionRaison').value;

    if (!userId) { toast('❌ Sélectionne un utilisateur', 'error'); return; }
    if (!raison.trim()) { toast('❌ Indique une raison', 'error'); return; }
    if (!await confirmAction({ title: 'Envoyer l’avertissement', message: 'Envoyer cet avertissement sur Discord ?', confirmText: 'Envoyer', danger: true })) return;

    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'sanction', params: { userId, raison } })
        });
        const data = await res.json();
        if (res.ok) {
            toast('⚠️ Sanction envoyée');
            // Reset dropdown custom
            document.getElementById('sanctionUser').value = '';
            document.getElementById('sanctionUserPreview').style.display = 'none';
            const label = document.getElementById('sanctionDropdownLabel');
            if (label) {
                label.classList.add('custom-dropdown-placeholder');
                label.innerHTML = '— Sélectionne un membre —';
            }
            const ta = document.getElementById('sanctionRaison');
            ta.value = '';
            ta.dispatchEvent(new Event('input'));
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

// Exposer toutes les fonctions de communications globalement
window.sendAnnonce = sendAnnonce;
window.sendRappel = sendRappel;
window.sendSanction = sendSanction;
window.toggleEmojiPicker = toggleEmojiPicker;
window.insertEmoji = insertEmoji;

// ==========================================
// ENVOI DE MESSAGES DANS LES SALONS
// ==========================================
let mentionDropdownActive = false;
let mentionStartIndex = -1;
let mentionSearchQuery = '';
let mentionSelectedIndex = 0;
let mentionResults = [];

function setupMessageInput() {
    const input = document.getElementById('messageInput');
    if (!input) return;

    // Auto-resize textarea
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 150) + 'px';
        document.getElementById('charCount').textContent = `${input.value.length}/2000`;

        // Détecter si on est en train de taper une mention
        handleMentionInput();
    });

    // Envoi avec Entrée (sans Maj)
    input.addEventListener('keydown', (e) => {
        // Si dropdown mention ouverte
        if (mentionDropdownActive) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                mentionSelectedIndex = Math.min(mentionSelectedIndex + 1, mentionResults.length - 1);
                renderMentionDropdown();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                mentionSelectedIndex = Math.max(mentionSelectedIndex - 1, 0);
                renderMentionDropdown();
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                if (mentionResults[mentionSelectedIndex]) {
                    e.preventDefault();
                    selectMention(mentionResults[mentionSelectedIndex]);
                    return;
                }
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeMentionDropdown();
                return;
            }
        }

        // Envoi normal
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChannelMessage();
        }
    });
}

async function handleMentionInput() {
    const input = document.getElementById('messageInput');
    if (!input) return;

    const value = input.value;
    const cursorPos = input.selectionStart;
    const beforeCursor = value.substring(0, cursorPos);

    // Trouver le dernier @ avant le curseur
    const lastAtIndex = beforeCursor.lastIndexOf('@');
    if (lastAtIndex === -1) {
        closeMentionDropdown();
        return;
    }

    // Vérifier qu'il n'y a pas d'espace entre @ et le curseur
    const afterAt = beforeCursor.substring(lastAtIndex + 1);
    if (afterAt.includes(' ') || afterAt.includes('\n')) {
        closeMentionDropdown();
        return;
    }

    // Vérifier qu'il y a un espace ou début de ligne avant @
    if (lastAtIndex > 0) {
        const charBefore = beforeCursor[lastAtIndex - 1];
        if (charBefore !== ' ' && charBefore !== '\n') {
            closeMentionDropdown();
            return;
        }
    }

    mentionStartIndex = lastAtIndex;
    mentionSearchQuery = afterAt;

    if (mentionSearchQuery.length >= 1) {
        await searchMentions(mentionSearchQuery);
    } else {
        closeMentionDropdown();
    }
}

async function searchMentions(query) {
    try {
        const res = await fetch(`/api/members/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        mentionResults = data.members || [];
        mentionSelectedIndex = 0;
        if (mentionResults.length > 0) {
            mentionDropdownActive = true;
            renderMentionDropdown();
        } else {
            closeMentionDropdown();
        }
    } catch {
        closeMentionDropdown();
    }
}

function renderMentionDropdown() {
    const dropdown = document.getElementById('msgMentionSuggest');
    if (!dropdown) return;

    dropdown.innerHTML = mentionResults.map((m, i) => `
        <div class="mention-item ${i === mentionSelectedIndex ? 'selected' : ''}" onclick="selectMention(${JSON.stringify(m).replace(/"/g, '&quot;')})">
            ${m.avatar ? `<img class="mention-avatar" src="${m.avatar}" alt="">` : '<div class="mention-avatar-placeholder"></div>'}
            <span class="mention-name">${escapeHtml(m.name)}</span>
        </div>
    `).join('');
    dropdown.style.display = 'block';
}

function selectMention(member) {
    const input = document.getElementById('messageInput');
    if (!input) return;
    const value = input.value;
    const before = value.substring(0, mentionStartIndex);
    const after = value.substring(input.selectionStart);

    // Insérer la mention au format Discord <@id>
    input.value = before + `<@${member.id}> ` + after;
    input.focus();
    const newCursorPos = before.length + `<@${member.id}> `.length;
    input.setSelectionRange(newCursorPos, newCursorPos);

    closeMentionDropdown();
}

function closeMentionDropdown() {
    mentionDropdownActive = false;
    mentionResults = [];
    mentionStartIndex = -1;
    const dropdown = document.getElementById('msgMentionSuggest');
    if (dropdown) dropdown.style.display = 'none';
}

function insertMention() {
    const input = document.getElementById('messageInput');
    if (!input) return;
    const cursorPos = input.selectionStart;
    const value = input.value;
    input.value = value.substring(0, cursorPos) + '@' + value.substring(cursorPos);
    input.focus();
    input.setSelectionRange(cursorPos + 1, cursorPos + 1);
    handleMentionInput();
}

// ==========================================
// EMOJIS dans le message
// ==========================================
function toggleMessageEmojiPicker() {
    const picker = document.getElementById('msgEmojiPicker');
    if (!picker) return;
    if (picker.style.display === 'none' || !picker.style.display) {
        renderMessageEmojiPicker();
        picker.style.display = 'grid';
    } else {
        picker.style.display = 'none';
    }
}

function renderMessageEmojiPicker() {
    const picker = document.getElementById('msgEmojiPicker');
    if (!picker) return;
    if (serverEmojis.length === 0) {
        picker.innerHTML = '<p class="empty" style="padding:12px;grid-column:1/-1;">Aucun emoji custom sur le serveur</p>';
        return;
    }
    picker.innerHTML = serverEmojis.map(e => `
        <div class="emoji-item" title=":${e.name}:" onclick="insertMessageEmoji('${e.code.replace(/'/g, "\\'")}')">
            <img src="${e.url}" alt=":${e.name}:">
        </div>
    `).join('');
}

function insertMessageEmoji(code) {
    const input = document.getElementById('messageInput');
    if (!input) return;
    const cursorPos = input.selectionStart;
    const value = input.value;
    input.value = value.substring(0, cursorPos) + code + value.substring(cursorPos);
    input.focus();
    input.setSelectionRange(cursorPos + code.length, cursorPos + code.length);
    document.getElementById('msgEmojiPicker').style.display = 'none';
    document.getElementById('charCount').textContent = `${input.value.length}/2000`;
}

// ==========================================
// ENVOI DU MESSAGE
// ==========================================
async function sendChannelMessage() {
    if (!currentChannelId) return;
    const input = document.getElementById('messageInput');
    const btn = document.getElementById('sendMessageBtn');
    if (!input || !btn) return;

    const content = input.value.trim();
    if (!content) return;

    btn.disabled = true;
    btn.textContent = 'Envoi...';

    try {
        const res = await fetch(`/api/channel/${currentChannelId}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const data = await res.json();
        if (res.ok) {
            input.value = '';
            input.style.height = 'auto';
            document.getElementById('charCount').textContent = '0/2000';
            // Rafraîchir les messages
            setTimeout(() => loadMessages(currentChannelId), 500);
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Envoyer ↗';
    }
}

// Charger les emojis serveur au boot pour le picker (réutilise serverEmojis)
async function ensureServerEmojisLoaded() {
    if (serverEmojis.length === 0) {
        try {
            const r = await fetch('/api/emojis');
            const data = await r.json();
            serverEmojis = data.emojis || [];
        } catch {}
    }
}

// Setup au chargement
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupMessageInput, 500);
    ensureServerEmojisLoaded();
});

// ==========================================
// USER DROPDOWN (Sanction)
// ==========================================
let allMembersCache = [];

async function loadAllMembers() {
    if (allMembersCache.length > 0) return allMembersCache;
    try {
        const res = await fetch('/api/members/all');
        const data = await res.json();
        allMembersCache = data.members || [];
        return allMembersCache;
    } catch {
        return [];
    }
}

async function setupSanctionUserPicker() {
    const members = await loadAllMembers();
    const list = document.getElementById('sanctionDropdownList');
    if (!list) return;

    list.innerHTML = members.map(m => {
        const avatar = safeImageUrl(m.avatar) || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><rect width='28' height='28' fill='%23262626'/></svg>`;
        const color = safeColor(m.color);
        const colorStyle = color ? `color:${color};` : '';
        return `
            <div class="custom-dropdown-item user-item" data-name="${escapeHtml(m.name).toLowerCase()}" onclick="selectSanctionUserCustom('${escapeJsArg(m.id)}', '${escapeJsArg(m.name)}', '${escapeJsArg(avatar)}', '${color}')">
                <img class="user-item-avatar" src="${avatar}" alt="">
                <div class="user-item-info">
                    <div class="user-item-name" style="${colorStyle}">${escapeHtml(m.name)}</div>
                    <div class="user-item-id">${m.id}</div>
                </div>
            </div>
        `;
    }).join('');

    const search = document.getElementById('sanctionDropdownSearch');
    if (search) {
        search.addEventListener('input', () => {
            const query = search.value.toLowerCase().trim();
            list.querySelectorAll('.custom-dropdown-item').forEach(item => {
                const name = item.dataset.name;
                item.style.display = !query || name.includes(query) ? 'flex' : 'none';
            });
        });
    }
}

function toggleSanctionDropdown(event) {
    if (event) event.stopPropagation();
    smartToggleDropdown('sanctionDropdownMenu', () => {
        const search = document.getElementById('sanctionDropdownSearch');
        if (search) {
            search.value = '';
            document.querySelectorAll('#sanctionDropdownList .custom-dropdown-item').forEach(i => i.style.display = 'flex');
            setTimeout(() => search.focus(), 50);
        }
    });
}

function selectSanctionUserCustom(id, name, avatar, color) {
    document.getElementById('sanctionUser').value = id;

    const label = document.getElementById('sanctionDropdownLabel');
    if (label) {
        label.classList.remove('custom-dropdown-placeholder');
        const avatarUrl = safeImageUrl(avatar);
        const safe = safeColor(color);
        const avatarHtml = avatarUrl ? `<img class="dropdown-trigger-avatar" src="${avatarUrl}" alt="">` : '';
        const colorStyle = safe ? `color:${safe};` : '';
        label.innerHTML = `${avatarHtml}<span style="${colorStyle}">${escapeHtml(name)}</span>`;
    }

    // Afficher la preview
    const preview = document.getElementById('sanctionUserPreview');
    if (preview) {
        document.getElementById('sanctionPreviewName').textContent = name;
        document.getElementById('sanctionPreviewName').style.color = color || '';
        document.getElementById('sanctionPreviewId').textContent = `ID : ${id}`;
        document.getElementById('sanctionPreviewAvatar').src = avatar || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='%23262626'/></svg>`;
        preview.style.display = 'flex';
    }

    document.getElementById('sanctionDropdownMenu').style.display = 'none';
}

window.toggleSanctionDropdown = toggleSanctionDropdown;
window.selectSanctionUserCustom = selectSanctionUserCustom;

// ============================================================
// SECTION CRAFT D'ARMES
// ============================================================
let craftsLoaded = false;
let weaponsCache = [];
let organizationsCache = [];
let craftRequestsCache = [];
let isAdminUser = false;
let craftCatalogFilters = {
    search: '',
};
let craftBoardState = {
    page: 1,
    pageSize: 28,
    sortBy: 'created',
    sortDir: 'asc',
};
let craftRequestsListState = {
    page: 1,
    pageSize: 10,
};
const MY_WEAPONS_DELETE_ROLE = '1490361524408291459';

function compareWeaponsBySalePrice(a, b) {
    const saleDiff = (Number(b.sale_price) || 0) - (Number(a.sale_price) || 0);
    if (saleDiff !== 0) return saleDiff;
    const craftDiff = (Number(b.craft_price) || 0) - (Number(a.craft_price) || 0);
    if (craftDiff !== 0) return craftDiff;
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
}

function displayName(name) {
    return String(name || '')
        .trim()
        .split(/\s+/)
        .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
        .join(' ');
}
let craftCatalogFiltersReady = false;

async function initCraftsTab() {
    setupCraftCatalogFilters();
    // Afficher tout de suite un état d'attente cohérent
    renderCraftCatalog();
    renderCraftRequestsList();
    renderCraftBoard();
    renderCraftHistory();

    // Charger les données en arrière-plan
    try {
        await Promise.all([
            loadWeaponsCatalog(),
            loadOrganizations(),
            loadCraftRequests(),
        ]);
    } catch (e) {
        console.error('Init crafts:', e);
    }

    craftsLoaded = true;

    // Re-render avec les vraies données
    renderCraftCatalog();
    renderCraftRequestsList();
    renderCraftBoard();
    renderCraftHistory();
    renderCraftWeaponDropdown();
}

async function loadWeaponsCatalog() {
    try {
        const r = await fetch('/api/crafts/weapons');
        if (!r.ok) {
            console.error('Weapons fetch failed:', r.status);
            weaponsCache = [];
            return;
        }
        const d = await r.json();
        weaponsCache = d.weapons || [];
    } catch (e) {
        console.error('Weapons catalog:', e);
        weaponsCache = [];
    }
}

async function loadOrganizations() {
    try {
        const r = await fetch('/api/crafts/organizations');
        const d = await r.json();
        organizationsCache = d.organizations || [];
    } catch {
        organizationsCache = [];
    }
}

async function loadCraftRequests() {
    try {
        const r = await fetch('/api/crafts/requests');
        const d = await r.json();
        craftRequestsCache = d.requests || [];
    } catch {
        craftRequestsCache = [];
    }
}

function switchCraftSubtab(subtab) {
    document.querySelectorAll('.crafts-subtab').forEach(b => b.classList.toggle('active', b.dataset.subtab === subtab));
    document.querySelectorAll('.crafts-section').forEach(s => {
        s.style.display = (s.id === `craftSection-${subtab}`) ? 'block' : 'none';
    });

    if (subtab === 'catalog') renderCraftCatalog();
    else if (subtab === 'request') renderCraftRequestsList();
    else if (subtab === 'board') renderCraftBoard();
    else if (subtab === 'history') renderCraftHistory();
}

function setupCraftCatalogFilters() {
    if (craftCatalogFiltersReady) return;
    const search = document.getElementById('craftCatalogSearch');
    if (!search) return;

    craftCatalogFiltersReady = true;
    search?.addEventListener('input', e => {
        craftCatalogFilters.search = e.target.value.trim().toLowerCase();
        renderCraftCatalog();
    });
}

function renderCraftCatalog() {
    const grid = document.getElementById('craftsCatalogGrid');
    const count = document.getElementById('craftCatalogCount');
    if (!grid) return;

    if (weaponsCache.length === 0) {
        if (count) count.textContent = '';
        grid.innerHTML = `<p class="empty">Aucune arme dans le catalogue.${isAdminUser ? ' <a href="/admin">Ajouter depuis le panneau admin</a>' : ''}</p>`;
        return;
    }

    const q = craftCatalogFilters.search;
    let items = weaponsCache.filter(w => {
        if (!q) return true;
        const haystack = [
            w.name,
            w.craft_price,
            w.sale_price,
            ...(w.ingredients || []).map(ing => ing.name),
        ].join(' ').toLowerCase();
        return haystack.includes(q);
    });

    items = [...items].sort(compareWeaponsBySalePrice);

    if (count) count.textContent = `${items.length} / ${weaponsCache.length} armes`;

    if (!items.length) {
        grid.innerHTML = '<p class="empty">Aucune arme ne correspond aux filtres.</p>';
        return;
    }

    grid.innerHTML = items.map(w => {
        const ingredientsHTML = (w.ingredients || []).map(ing => {
            const ingImageUrl = safeImageUrl(ing.image_url);
            return `
            <div class="craft-ingredient">
                ${ingImageUrl ? `<img src="${ingImageUrl}" alt="${escapeHtml(ing.name)}" class="craft-ingredient-img">` : '<div class="craft-ingredient-placeholder">Ingredient</div>'}
                <div class="craft-ingredient-amount">${ing.amount || 0}</div>
                <div class="craft-ingredient-name">${escapeHtml(ing.name || '?')}</div>
            </div>
        `;
        }).join('');

        const imageUrl = safeImageUrl(w.image_url);
        const timeStr = w.craft_time > 0 ? formatCraftTime(w.craft_time) : 'N/A';
        const priceStr = w.craft_price > 0 ? w.craft_price.toLocaleString('fr-FR') + '$' : 'Gratuit';
        const saleStr = w.sale_price > 0 ? `<span class="craft-weapon-saleprice">Vente : ${w.sale_price.toLocaleString('fr-FR')}$</span>` : '';

        return `
            <button type="button" class="craft-weapon-card craft-weapon-card-button" onclick="openCraftWeaponDetails(${w.id})">
                <div class="craft-weapon-image">
                    ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(w.name)}">` : '<span class="craft-weapon-placeholder">Arme</span>'}
                </div>
                <div class="craft-weapon-body">
                    <div class="craft-weapon-name">${escapeHtml(w.name)}</div>
                    <div class="craft-weapon-meta">
                        <span class="craft-weapon-time">&#9201; ${timeStr}</span>
                        <span class="craft-weapon-price">Craft : ${priceStr}</span>
                        ${saleStr}
                    </div>
                    ${ingredientsHTML ? `<div class="craft-ingredients-grid">${ingredientsHTML}</div>` : ''}
                </div>
            </button>
        `;
    }).join('');
}

function openCraftWeaponDetails(id) {
    const weapon = weaponsCache.find(w => Number(w.id) === Number(id));
    const modal = document.getElementById('craftWeaponDetailsModal');
    const title = document.getElementById('craftWeaponDetailsTitle');
    const content = document.getElementById('craftWeaponDetailsContent');
    if (!weapon || !modal || !title || !content) return;

    const imageUrl = safeImageUrl(weapon.image_url);
    const planUrl = safeImageUrl(weapon.plan_image_url);
    const timeStr = weapon.craft_time > 0 ? formatCraftTime(weapon.craft_time) : 'N/A';
    const craftPrice = weapon.craft_price > 0 ? weapon.craft_price.toLocaleString('fr-FR') + '$' : 'Gratuit';
    const salePrice = weapon.sale_price > 0 ? weapon.sale_price.toLocaleString('fr-FR') + '$' : 'N/A';
    const ingredients = weapon.ingredients || [];

    title.textContent = weapon.name || 'Arme';
    content.innerHTML = `
        <div class="craft-detail-layout">
            <div class="craft-detail-media">
                ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(weapon.name)}">` : '<span class="craft-weapon-placeholder">Arme</span>'}
            </div>
            <div class="craft-detail-summary">
                <div class="craft-detail-stat craft-detail-time">
                    <span>Temps craft</span>
                    <strong>${escapeHtml(timeStr)}</strong>
                </div>
                <div class="craft-detail-stat craft-detail-craft-price">
                    <span>Prix craft</span>
                    <strong>${escapeHtml(craftPrice)}</strong>
                </div>
                <div class="craft-detail-stat craft-detail-sale-price">
                    <span>Prix vente</span>
                    <strong>${escapeHtml(salePrice)}</strong>
                </div>
            </div>
        </div>
        <h4 class="craft-detail-section-title">Plan</h4>
        <div class="craft-detail-plan-grid">
            <div class="craft-detail-ingredient craft-detail-plan-card">
                ${planUrl ? `<img src="${planUrl}" alt="Plan ${escapeHtml(weapon.name)}">` : '<div class="craft-ingredient-placeholder">Plan</div>'}
                <span>Plan d'arme</span>
            </div>
        </div>
        <h4 class="craft-detail-section-title">Composants</h4>
        <div class="craft-detail-ingredients">
            ${ingredients.length ? ingredients.map(ing => {
                const ingImageUrl = safeImageUrl(ing.image_url);
                return `
                    <div class="craft-detail-ingredient">
                        ${ingImageUrl ? `<img src="${ingImageUrl}" alt="${escapeHtml(ing.name)}">` : '<div class="craft-ingredient-placeholder">Ingredient</div>'}
                        <strong>${ing.amount || 0}</strong>
                        <span>${escapeHtml(ing.name || '?')}</span>
                    </div>
                `;
            }).join('') : '<p class="empty">Aucun composant renseigné</p>'}
        </div>
    `;
    modal.style.display = 'flex';
}

function closeCraftWeaponDetails() {
    const modal = document.getElementById('craftWeaponDetailsModal');
    if (modal) modal.style.display = 'none';
}

function formatCraftTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h}h ${mm}m` : `${h}h`;
}

function renderCraftWeaponDropdown() {
    const list = document.getElementById('craftWeaponList');
    if (!list) return;
    list.innerHTML = [...weaponsCache].sort(compareWeaponsBySalePrice).map(w => {
        const imageUrl = safeImageUrl(w.image_url);
        return `
        <div class="custom-dropdown-item" data-name="${escapeHtml(w.name).toLowerCase()}" onclick="selectCraftWeapon(${w.id}, '${escapeJsArg(w.name)}', '${escapeJsArg(imageUrl)}')">
            ${imageUrl ? `<img class="craft-dropdown-image" src="${imageUrl}" alt="">` : '<span class="craft-weapon-placeholder">Arme</span>'}
            <span class="custom-dropdown-item-label">${escapeHtml(w.name)}</span>
        </div>
    `;
    }).join('');
}

function toggleCraftWeaponDropdown(event) {
    if (event) event.stopPropagation();
    smartToggleDropdown('craftWeaponMenu', () => {
        renderCraftWeaponDropdown();
        const search = document.getElementById('craftWeaponSearch');
        if (search) {
            search.value = '';
            document.querySelectorAll('#craftWeaponList .custom-dropdown-item').forEach(i => i.style.display = 'flex');
            search.oninput = () => {
                const q = search.value.toLowerCase().trim();
                document.querySelectorAll('#craftWeaponList .custom-dropdown-item').forEach(item => {
                    const name = item.dataset.name || '';
                    item.style.display = !q || name.includes(q) ? 'flex' : 'none';
                });
            };
            setTimeout(() => search.focus(), 50);
        }
    });
}

function selectCraftWeapon(id, name, imageUrl) {
    document.getElementById('craftWeaponId').value = id;
    const label = document.getElementById('craftWeaponLabel');
    if (label) {
        label.classList.remove('custom-dropdown-placeholder');
        label.innerHTML = imageUrl ? `<img class="dropdown-trigger-avatar" src="${imageUrl}"> ${escapeHtml(name)}` : escapeHtml(name);
    }
    document.getElementById('craftWeaponMenu').style.display = 'none';
}

async function submitCraftRequest() {
    const weaponId = document.getElementById('craftWeaponId').value;
    const hasPlan = document.getElementById('craftHasPlan').checked;
    const hasMoney = document.getElementById('craftHasMoney').checked;

    if (!weaponId) { toast('❌ Choisis une arme', 'error'); return; }

    try {
        const res = await fetch('/api/crafts/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weapon_id: parseInt(weaponId), has_plan: hasPlan, has_money: hasMoney })
        });
        const data = await res.json();
        if (res.ok) {
            toast('✅ Demande soumise');
            // Reset form
            document.getElementById('craftWeaponId').value = '';
            document.getElementById('craftHasPlan').checked = false;
            document.getElementById('craftHasMoney').checked = false;
            const label = document.getElementById('craftWeaponLabel');
            if (label) {
                label.classList.add('custom-dropdown-placeholder');
                label.innerHTML = '— Choisir une arme —';
            }
            await loadCraftRequests();
            renderCraftRequestsList();
            renderCraftBoard();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

function goToCraftBoard() {
    switchCraftSubtab('board');
}

function getVisibleCraftRequests() {
    const u = window.currentUser || {};
    const hasFullAccess = canValidateCraftClient();
    let requests = craftRequestsCache.filter(r => r.status !== 'completed' && r.status !== 'rejected');

    if (!hasFullAccess) {
        requests = requests.filter(r => r.user_id === u.id);
    }

    return requests.sort((a, b) => Number(b.created_at || b.id || 0) - Number(a.created_at || a.id || 0));
}

function renderCraftRequestsPagination(total, totalPages, start, end) {
    const pagination = document.getElementById('craftRequestsPagination');
    if (!pagination) return;

    if (total <= craftRequestsListState.pageSize) {
        pagination.innerHTML = total ? `<span class="craft-board-page-info">${total} demande${total > 1 ? 's' : ''}</span>` : '';
        return;
    }

    const displayStart = total ? start + 1 : 0;
    pagination.innerHTML = `
        <span class="craft-board-page-info">${displayStart}-${end} / ${total} demandes</span>
        <button type="button" class="craft-board-page-btn" onclick="changeCraftRequestsPage(-1)" ${craftRequestsListState.page <= 1 ? 'disabled' : ''}>Precedent</button>
        <span class="craft-board-page-current">Page ${craftRequestsListState.page} / ${totalPages}</span>
        <button type="button" class="craft-board-page-btn" onclick="changeCraftRequestsPage(1)" ${craftRequestsListState.page >= totalPages ? 'disabled' : ''}>Suivant</button>
    `;
}

function changeCraftRequestsPage(delta) {
    craftRequestsListState.page += Number(delta) || 0;
    renderCraftRequestsList();
}

function renderCraftRequestsList() {
    const list = document.getElementById('craftRequestsList');
    if (!list) return;

    const u = window.currentUser || {};
    const hasFullAccess = canValidateCraftClient();
    const myUserId = u.id;

    // Hauts gradés voient tout, les autres voient uniquement leurs propres demandes
    const allRequests = getVisibleCraftRequests();
    const total = allRequests.length;
    const pageSize = craftRequestsListState.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    craftRequestsListState.page = Math.min(Math.max(1, craftRequestsListState.page), totalPages);
    const start = (craftRequestsListState.page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    const recent = allRequests.slice(start, end);
    renderCraftRequestsPagination(total, totalPages, start, end);

    if (recent.length === 0) {
        list.innerHTML = '<p class="empty">Aucune demande en cours</p>';
        return;
    }

    list.innerHTML = recent.map(r => {
        const date = new Date(r.created_at * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
        const status = getCraftStatusBadge(r);
        const canChangeStatus = hasFullAccess;
        const isSuperAdmin = canDeleteRequestsClient();
        const isMine = r.user_id === myUserId;
        const rejectedClass = r.status === 'rejected' ? ' craft-request-rejected' : '';
        const weaponImageUrl = safeImageUrl(r.weapon_image_url);

        // Hauts gradés : peuvent changer statut + supprimer
        // User normal : peut juste annuler/supprimer SA demande tant que pas craftée
        let statusActions = '';
        if (canChangeStatus) {
            statusActions = `
                <div class="craft-status-actions">
                    ${r.status !== 'waiting_materials' && r.status !== 'crafted' ? `<button class="btn-status-materials" onclick="updateRequestStatus(${r.id}, 'waiting_materials')">📦 Matières</button>` : ''}
                    ${r.status !== 'in_progress' ? `<button class="btn-status-progress" onclick="updateRequestStatus(${r.id}, 'in_progress')">⏳ En cours</button>` : ''}
                    ${r.status !== 'rejected' ? `<button class="btn-status-reject" onclick="updateRequestStatus(${r.id}, 'rejected')">✗ Refuser</button>` : ''}
                    ${r.status !== 'pending' && r.status !== 'crafted' ? `<button class="btn-status-pending" onclick="updateRequestStatus(${r.id}, 'pending')">↩ En attente</button>` : ''}
                    ${isSuperAdmin ? `<button class="btn-status-delete" onclick="deleteCraftRequest(${r.id})">🗑</button>` : ''}
                </div>
            `;
        } else if (isMine && r.status !== 'crafted' && r.status !== 'completed') {
            statusActions = `
                <div class="craft-status-actions">
                    <button class="btn-status-delete" onclick="cancelMyCraftRequest(${r.id})">🗑 Annuler ma demande</button>
                </div>
            `;
        }

        return `
            <div class="craft-request-item${rejectedClass}">
                ${weaponImageUrl ? `<img class="craft-request-image" src="${weaponImageUrl}" alt="">` : '<span class="craft-weapon-placeholder">🔫</span>'}
                <div class="craft-request-body">
                    <div class="craft-request-name">${escapeHtml(r.weapon_name)}</div>
                    <div class="craft-request-meta">
                        <span>👤 ${escapeHtml(r.user_name)}</span>
                        <span>📅 ${date}</span>
                        ${r.has_plan ? '<span class="craft-tag">📋 Plan</span>' : ''}
                        ${r.has_money ? '<span class="craft-tag">💰 Argent</span>' : ''}
                    </div>
                    ${statusActions}
                </div>
                <div class="craft-request-status">${status}</div>
            </div>
        `;
    }).join('');
}

async function cancelMyCraftRequest(id) {
    if (!await confirmAction({ title: 'Annuler la demande', message: 'Annuler ta demande de craft ?', confirmText: 'Annuler la demande', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/requests/${id}/cancel`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            toast('🗑 Demande annulée');
            await loadCraftRequests();
            renderCraftRequestsList();
            renderCraftBoard();
        } else { toast(`❌ ${data.error}`, 'error'); }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}
window.cancelMyCraftRequest = cancelMyCraftRequest;

function canValidateCraftClient() {
    const u = window.currentUser || {};
    if (u.id === '952986899667103804') return true;
    const userRoles = u.roles || [];
    return ['1485279148246175764', '1486744891848654988', '1485279534650494976'].some(r => userRoles.includes(r));
}

function canDeleteRequestsClient() {
    const u = window.currentUser || {};
    if (u.id === '952986899667103804') return true;
    return (u.roles || []).includes('1485279148246175764');
}

function canDeleteMyWeaponsClient() {
    const u = window.currentUser || {};
    if (u.id === '952986899667103804') return true;
    const roles = u.roles || [];
    return roles.includes(MY_WEAPONS_DELETE_ROLE) || canDeleteRequestsClient();
}

async function updateRequestStatus(requestId, status) {
    const labels = {
        waiting_materials: 'En attente des matières premières',
        in_progress: 'En cours',
        rejected: 'Refusé',
        pending: 'En attente'
    };
    if (!await confirmAction({ title: 'Changer le statut', message: `Passer cette demande en "${labels[status]}" ?`, confirmText: 'Changer le statut', danger: status === 'rejected' })) return;
    try {
        const res = await fetch(`/api/crafts/requests/${requestId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        const data = await res.json();
        if (res.ok) {
            toast(`✅ Statut → ${labels[status]}`);
            await loadCraftRequests();
            renderCraftRequestsList();
            renderCraftBoard();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}

async function deleteCraftRequest(requestId) {
    if (!await confirmAction({ title: 'Supprimer la demande', message: 'Supprimer définitivement cette demande ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/requests/${requestId}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            toast('🗑 Supprimée');
            await loadCraftRequests();
            renderCraftRequestsList();
            renderCraftBoard();
            renderCraftHistory();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}

window.updateRequestStatus = updateRequestStatus;
window.deleteCraftRequest = deleteCraftRequest;
window.changeCraftRequestsPage = changeCraftRequestsPage;

function getCraftStatusBadge(r) {
    if (r.status === 'completed') return '<span class="craft-status-badge craft-status-done">✓ Finalisé</span>';
    if (r.status === 'rejected') return '<span class="craft-status-badge craft-status-rejected">✗ Refusé</span>';
    if (r.crafted) return '<span class="craft-status-badge craft-status-crafted">⚒ Crafté</span>';
    if (r.status === 'waiting_materials') return '<span class="craft-status-badge craft-status-materials">📦 En attente des matières premières</span>';
    if (r.status === 'in_progress') return '<span class="craft-status-badge craft-status-progress">⏳ En cours</span>';
    return '<span class="craft-status-badge craft-status-pending">📋 En attente</span>';
}

function getCraftBoardActiveRequests() {
    const u = window.currentUser || {};
    const hasFullAccess = canValidateCraftClient();
    let active = craftRequestsCache.filter(r => r.status !== 'completed' && r.status !== 'rejected');
    if (!hasFullAccess) active = active.filter(r => r.user_id === u.id);
    return active;
}

function getCraftBoardSortValue(r, key) {
    if (key === 'user') return String(r.user_name || '').toLocaleLowerCase('fr-FR');
    if (key === 'weapon') return String(r.weapon_name || '').toLocaleLowerCase('fr-FR');
    return Number(r.created_at || r.id || 0);
}

function sortCraftBoardRequests(items) {
    const sortBy = craftBoardState.sortBy;
    const dir = craftBoardState.sortDir === 'desc' ? -1 : 1;
    return [...items].sort((a, b) => {
        const av = getCraftBoardSortValue(a, sortBy);
        const bv = getCraftBoardSortValue(b, sortBy);
        let result = 0;
        if (typeof av === 'number' && typeof bv === 'number') {
            result = av - bv;
        } else {
            result = String(av).localeCompare(String(bv), 'fr', { numeric: true, sensitivity: 'base' });
        }
        if (result === 0) result = Number(a.created_at || a.id || 0) - Number(b.created_at || b.id || 0);
        return result * dir;
    });
}

function renderCraftBoardPagination(total, totalPages, start, end) {
    const sortBy = document.getElementById('craftBoardSortBy');
    const sortDir = document.getElementById('craftBoardSortDir');
    const pagination = document.getElementById('craftBoardPagination');
    if (sortBy) sortBy.value = craftBoardState.sortBy;
    if (sortDir) sortDir.value = craftBoardState.sortDir;
    if (!pagination) return;

    const displayStart = total ? start + 1 : 0;
    pagination.innerHTML = `
        <span class="craft-board-page-info">${displayStart}-${end} / ${total} demandes</span>
        <button type="button" class="craft-board-page-btn" onclick="changeCraftBoardPage(-1)" ${craftBoardState.page <= 1 ? 'disabled' : ''}>Precedent</button>
        <span class="craft-board-page-current">Page ${craftBoardState.page} / ${totalPages}</span>
        <button type="button" class="craft-board-page-btn" onclick="changeCraftBoardPage(1)" ${craftBoardState.page >= totalPages ? 'disabled' : ''}>Suivant</button>
    `;
}

function updateCraftBoardSort() {
    const sortBy = document.getElementById('craftBoardSortBy');
    const sortDir = document.getElementById('craftBoardSortDir');
    craftBoardState.sortBy = sortBy?.value || 'created';
    craftBoardState.sortDir = sortDir?.value || 'asc';
    craftBoardState.page = 1;
    renderCraftBoard();
}

function changeCraftBoardPage(delta) {
    craftBoardState.page += Number(delta) || 0;
    renderCraftBoard();
}

function renderCraftBoard() {
    const tbody = document.getElementById('craftBoardBody');
    if (!tbody) return;

    const active = sortCraftBoardRequests(getCraftBoardActiveRequests());
    const total = active.length;
    const pageSize = craftBoardState.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    craftBoardState.page = Math.min(Math.max(1, craftBoardState.page), totalPages);
    const start = (craftBoardState.page - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    const pageItems = active.slice(start, end);

    // Filtrer : exclure rejected et completed

    // Hauts gradés voient toutes les demandes, les autres seulement les leurs

    // Compter les "En cours" pour le bandeau de notification
    const inProgressCount = active.filter(r => r.status === 'in_progress').length;
    const wrapper = document.querySelector('#craftSection-board .craft-board-wrapper');
    let banner = document.getElementById('craftBoardInProgressBanner');
    if (inProgressCount > 0) {
        if (!banner && wrapper) {
            banner = document.createElement('div');
            banner.id = 'craftBoardInProgressBanner';
            banner.className = 'craft-board-banner';
            wrapper.parentNode.insertBefore(banner, wrapper);
        }
        if (banner) {
            banner.innerHTML = `⏳ <strong>${inProgressCount}</strong> demande${inProgressCount > 1 ? 's' : ''} actuellement <strong>en cours de craft</strong>`;
            banner.style.display = 'flex';
        }
    } else if (banner) {
        banner.style.display = 'none';
    }

    renderCraftBoardPagination(total, totalPages, start, end);
    if (!pageItems.length) {
        tbody.innerHTML = '<tr class="craft-board-empty"><td colspan="9"><em>Aucune demande a afficher</em></td></tr>';
        return;
    }

    const lines = [];
    for (let i = 0; i < pageItems.length; i++) {
        const r = pageItems[i];
        if (r) {
            lines.push(renderCraftBoardLine(start + i + 1, r));
        } else {
            lines.push(`<tr class="craft-board-empty"><td>${i + 1}</td><td colspan="8"><em>— Emplacement libre —</em></td></tr>`);
        }
    }

    tbody.innerHTML = lines.join('');

    // Charger les organisations dans les selects
    document.querySelectorAll('.craft-org-select').forEach(select => {
        const currentValue = select.dataset.currentValue || select.value || '';
        select.innerHTML = '<option value="">— Choisir —</option>' +
            organizationsCache.map(o => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)}</option>`).join('') +
            '<option value="__add__">+ Ajouter une organisation</option>';
        select.value = currentValue;
    });
}

function renderCraftBoardLine(num, r) {
    const craftDate = r.craft_date ? new Date(r.craft_date * 1000).toLocaleDateString('fr-FR') : '—';
    const saleDate = r.sale_date ? new Date(r.sale_date * 1000).toLocaleDateString('fr-FR') : '—';
    const isMine = r.user_id === window.currentUserId;
    const canEditCraft = isAdminUser; // Hauts gradés peuvent cocher crafté + remplir N°série
    const canEditSale = isMine || isAdminUser;
    const completed = r.status === 'completed';

    return `
        <tr data-request-id="${r.id}" class="${completed ? 'craft-board-completed' : ''}">
            <td>${num}</td>
            <td>
                <div class="craft-board-request">
                    ${safeImageUrl(r.weapon_image_url) ? `<img class="craft-board-img" src="${safeImageUrl(r.weapon_image_url)}" alt="">` : '🔫'}
                    <div>
                        <strong>${escapeHtml(r.weapon_name)}</strong>
                        <small>par ${escapeHtml(r.user_name)}</small>
                    </div>
                </div>
            </td>
            <td>
                <input type="checkbox" class="craft-checkbox-crafted" ${r.crafted ? 'checked' : ''} ${canEditCraft ? '' : 'disabled'} onchange="toggleCraftCrafted(${r.id}, this.checked)">
            </td>
            <td>
                <input type="text" class="craft-input-serial" placeholder="N°Série" value="${r.serial_number || ''}" ${canEditCraft ? '' : 'disabled'} onblur="updateCraftSerial(${r.id}, this.value)">
            </td>
            <td>
                <select class="craft-org-select" data-current-value="${escapeHtml(r.buyer_org || '')}" ${canEditSale && r.crafted ? '' : 'disabled'} onchange="handleOrgChange(${r.id}, this)">
                    <option value="${escapeHtml(r.buyer_org || '')}">${escapeHtml(r.buyer_org || '— Choisir —')}</option>
                </select>
            </td>
            <td>
                <input type="number" class="craft-input-price" placeholder="Prix" value="${r.sale_price || ''}" ${canEditSale && r.crafted ? '' : 'disabled'} onblur="updateCraftSalePrice(${r.id}, this.value)">
            </td>
            <td>${craftDate}</td>
            <td>${saleDate}</td>
            <td>
                ${canEditSale && r.crafted && !completed ? `<button class="btn-craft-validate" onclick="validateCraftSale(${r.id})">✓ Valider</button>` : ''}
            </td>
        </tr>
    `;
}

async function toggleCraftCrafted(requestId, crafted) {
    if (crafted) {
        const serial = prompt('N° de série de l\'arme craftée :');
        if (!serial) {
            // Annule si pas de N°série
            const checkbox = document.querySelector(`tr[data-request-id="${requestId}"] .craft-checkbox-crafted`);
            if (checkbox) checkbox.checked = false;
            return;
        }
        await updateCraftRequestCraft(requestId, true, serial);
    } else {
        await updateCraftRequestCraft(requestId, false, null);
    }
}

async function updateCraftSerial(requestId, value) {
    if (!value) return;
    await updateCraftRequestCraft(requestId, true, value);
}

async function updateCraftRequestCraft(requestId, crafted, serial) {
    try {
        const res = await fetch(`/api/crafts/requests/${requestId}/craft`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ crafted, serial_number: serial })
        });
        const data = await res.json();
        if (res.ok) {
            toast(crafted ? '⚒ Craft validé, demandeur ping' : '↩ Annulé');
            await loadCraftRequests();
            renderCraftBoard();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

function handleOrgChange(requestId, select) {
    const value = select.value;
    if (value === '__add__') {
        const newOrg = prompt('Nom de la nouvelle organisation :');
        if (newOrg && newOrg.trim()) {
            addOrganization(newOrg.trim()).then(() => {
                renderCraftBoard();
            });
        } else {
            select.value = '';
        }
        return;
    }
    // Stocker temporairement, sera envoyé à la validation
    select.dataset.value = value;
}

async function addOrganization(name) {
    try {
        const res = await fetch('/api/crafts/organizations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            await loadOrganizations();
            toast('✅ Organisation ajoutée');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

function updateCraftSalePrice(requestId, value) {
    // Stocké en local, sera envoyé à la validation finale
    const tr = document.querySelector(`tr[data-request-id="${requestId}"]`);
    if (tr) tr.dataset.salePrice = value;
}

async function validateCraftSale(requestId) {
    const tr = document.querySelector(`tr[data-request-id="${requestId}"]`);
    if (!tr) return;

    const select = tr.querySelector('.craft-org-select');
    const priceInput = tr.querySelector('.craft-input-price');

    const buyerOrg = select.value;
    const salePrice = priceInput.value;

    if (!buyerOrg || buyerOrg === '__add__') { toast('❌ Choisis une organisation', 'error'); return; }
    if (!salePrice) { toast('❌ Entre un prix de vente', 'error'); return; }

    if (!await confirmAction({ title: 'Valider la vente', message: 'Valider cette vente ? Un récap sera posté dans le salon.', confirmText: 'Valider la vente' })) return;

    try {
        const res = await fetch(`/api/crafts/requests/${requestId}/sale`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                buyer_org: buyerOrg,
                sale_price: parseInt(salePrice),
                sale_date: new Date().toISOString(),
            })
        });
        const data = await res.json();
        if (res.ok) {
            toast('✅ Vente validée, récap posté');
            await loadCraftRequests();
            renderCraftBoard();
            renderCraftHistory();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

function renderCraftHistory() {
    const list = document.getElementById('craftHistoryList');
    if (!list) return;
    renderManualCraftForm();

    const completed = craftRequestsCache.filter(r => r.status === 'completed');
    const isSuperAdmin = canDeleteRequestsClient();

    if (completed.length === 0) {
        list.innerHTML = '<p class="empty">Aucun craft finalisé</p>';
        return;
    }

    list.innerHTML = completed.map(r => {
        const craftDate = r.craft_date ? new Date(r.craft_date * 1000).toLocaleDateString('fr-FR') : 'N/A';
        const saleDate = r.sale_date ? new Date(r.sale_date * 1000).toLocaleDateString('fr-FR') : 'N/A';
        const deleteBtn = isSuperAdmin
            ? `<button class="btn-history-delete" onclick="deleteHistoryEntry(${r.id})" title="Supprimer">🗑</button>`
            : '';
        return `
            <div class="craft-history-item">
                ${safeImageUrl(r.weapon_image_url) ? `<img class="craft-history-image" src="${safeImageUrl(r.weapon_image_url)}" alt="">` : '<span class="craft-weapon-placeholder">🔫</span>'}
                <div class="craft-history-body">
                    <div class="craft-history-name">${escapeHtml(r.weapon_name)} <span class="craft-history-serial">[${r.serial_number || 'N/A'}]</span></div>
                    <div class="craft-history-meta">
                        <span>👤 ${escapeHtml(r.user_name)}</span>
                        <span>🏢 ${escapeHtml(r.buyer_org || 'N/A')}</span>
                        <span>💰 ${(r.sale_price || 0).toLocaleString('fr-FR')}$</span>
                    </div>
                    <div class="craft-history-dates">
                        <span>⚒ Craft : ${craftDate}</span>
                        <span>📅 Vente : ${saleDate}</span>
                    </div>
                </div>
                ${deleteBtn}
            </div>
        `;
    }).join('');
}

function renderManualCraftForm() {
    const weaponSelect = document.getElementById('manualCraftWeapon');
    const buyerSelect = document.getElementById('manualCraftBuyer');
    const craftDate = document.getElementById('manualCraftDate');
    if (!weaponSelect) return;

    const labelMap = {
        manualCraftWeapon: "Modèle de l'arme *",
        manualCraftSerial: 'N° série *',
        manualCraftDate: 'Date craft *',
        manualCraftSold: 'Statut vente',
        manualCraftBuyer: 'Vendu à qui',
        manualCraftSalePrice: 'Prix vente ($)',
    };
    Object.entries(labelMap).forEach(([id, text]) => {
        const field = document.getElementById(id)?.closest('.comm-field');
        const label = field?.querySelector('.comm-label');
        if (label) label.textContent = text;
    });

    weaponSelect.innerHTML = '<option value="">-- Choisir une arme --</option>' +
        [...weaponsCache].sort(compareWeaponsBySalePrice)
            .map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`)
            .join('');

    if (buyerSelect) {
        buyerSelect.innerHTML = '<option value="">-- Choisir une organisation --</option>' +
            organizationsCache.map(o => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.name)}</option>`).join('');
    }

    if (craftDate && !craftDate.value) {
        craftDate.value = new Date().toISOString().slice(0, 10);
    }
    toggleManualCraftSaleFields();
}
function toggleManualCraftSaleFields() {
    const sold = document.getElementById('manualCraftSold')?.value === '1';
    document.querySelectorAll('.manual-craft-sale-field').forEach(el => {
        el.style.display = sold ? 'block' : 'none';
    });
}

async function submitManualCraft() {
    const weapon_id = document.getElementById('manualCraftWeapon')?.value;
    const serial_number = document.getElementById('manualCraftSerial')?.value.trim();
    const craft_date = document.getElementById('manualCraftDate')?.value;
    const is_sold = document.getElementById('manualCraftSold')?.value === '1';
    const buyer_org = document.getElementById('manualCraftBuyer')?.value;
    const sale_price = document.getElementById('manualCraftSalePrice')?.value;

    if (!weapon_id) { toast('Choisis un modèle d’arme', 'error'); return; }
    if (!serial_number) { toast('N° série obligatoire', 'error'); return; }
    if (!craft_date) { toast('Date craft obligatoire', 'error'); return; }
    if (is_sold && !buyer_org) { toast('Choisis l’organisation acheteuse', 'error'); return; }

    const message = is_sold
        ? 'Ajouter cette arme directement dans l’historique comme vendue ?'
        : 'Ajouter cette arme au suivi et dans Vos Armes comme non vendue ?';
    if (!await confirmAction({ title: 'Ajouter un craft manuel', message, confirmText: 'Ajouter' })) return;

    try {
        const res = await fetch('/api/crafts/requests/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weapon_id, serial_number, craft_date, is_sold, buyer_org, sale_price })
        });
        const data = await res.json();
        if (!res.ok) {
            toast(`❌ ${data.error || 'Erreur ajout manuel'}`, 'error');
            return;
        }

        toast(is_sold ? '✅ Craft manuel ajouté à l’historique' : '✅ Craft manuel ajouté dans Vos Armes');
        document.getElementById('manualCraftSerial').value = '';
        document.getElementById('manualCraftSalePrice').value = '';
        document.getElementById('manualCraftSold').value = '0';
        await Promise.all([loadCraftRequests(), loadMyWeapons?.()]);
        renderCraftHistory();
        renderCraftBoard();
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}

async function deleteHistoryEntry(id) {
    if (!await confirmAction({ title: 'Supprimer l’historique', message: 'Supprimer définitivement cette entrée de l’historique ? Le craft restera tracé dans Discord mais sera retiré du dashboard.', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/requests/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            toast('🗑 Entrée supprimée');
            await loadCraftRequests();
            renderCraftHistory();
            renderCraftBoard();
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}
window.deleteHistoryEntry = deleteHistoryEntry;

window.switchCraftSubtab = switchCraftSubtab;
window.openCraftWeaponDetails = openCraftWeaponDetails;
window.closeCraftWeaponDetails = closeCraftWeaponDetails;
window.openPresenceStatDetails = openPresenceStatDetails;
window.closePresenceStatDetails = closePresenceStatDetails;
window.toggleCraftWeaponDropdown = toggleCraftWeaponDropdown;
window.selectCraftWeapon = selectCraftWeapon;
window.submitCraftRequest = submitCraftRequest;
window.goToCraftBoard = goToCraftBoard;
window.updateCraftBoardSort = updateCraftBoardSort;
window.changeCraftBoardPage = changeCraftBoardPage;
window.toggleCraftCrafted = toggleCraftCrafted;
window.updateCraftSerial = updateCraftSerial;
window.handleOrgChange = handleOrgChange;
window.updateCraftSalePrice = updateCraftSalePrice;
window.validateCraftSale = validateCraftSale;
window.toggleManualCraftSaleFields = toggleManualCraftSaleFields;
window.submitManualCraft = submitManualCraft;

// ============================================================
// EMBED MODE TOGGLE (annonce/rappel)
// ============================================================
function toggleEmbedMode(type) {
    const checkbox = document.getElementById(`${type}UseEmbed`);
    const textarea = document.getElementById(`${type}Message`);
    const counter = document.getElementById(`${type}CharCount`);
    if (!checkbox || !textarea) return;

    const useEmbed = checkbox.checked;
    const limit = useEmbed ? 4000 : 2000;
    textarea.maxLength = limit;
    if (counter) counter.textContent = `${textarea.value.length} / ${limit}`;
}

window.toggleEmbedMode = toggleEmbedMode;

// Patch sendAnnonce et sendRappel pour passer useEmbed
(function patchSendAnnonce() {
    if (typeof window.sendAnnonce === 'function') {
        const orig = window.sendAnnonce;
        window.sendAnnonce = async function() {
            const useEmbed = document.getElementById('annonceUseEmbed')?.checked;
            const roleId = document.getElementById('annonceRole').value;
            const message = document.getElementById('annonceMessage').value;
            if (!roleId) { toast('❌ Choisis un rôle', 'error'); return; }
            if (!message.trim()) { toast('❌ Tape un message', 'error'); return; }
            if (!await confirmAction({ title: 'Envoyer l’annonce', message: 'Envoyer cette annonce sur Discord ?', confirmText: 'Envoyer' })) return;

            try {
                const res = await fetch('/api/command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: 'annonce', params: { roleId, message, useEmbed } })
                });
                const data = await res.json();
                if (res.ok) {
                    toast('📤 Annonce envoyée');
                    const ta = document.getElementById('annonceMessage');
                    ta.value = '';
                    ta.dispatchEvent(new Event('input'));
                    document.getElementById('annonceRole').value = '';
                    const label = document.getElementById('annonceRoleLabel');
                    if (label) { label.innerHTML = '— Choisir un rôle —'; label.style.color = ''; }
                } else {
                    toast(`❌ ${data.error}`, 'error');
                }
            } catch (e) { toast(`❌ ${e.message}`, 'error'); }
        };
    }
})();

(function patchSendRappel() {
    if (typeof window.sendRappel === 'function') {
        window.sendRappel = async function() {
            const useEmbed = document.getElementById('rappelUseEmbed')?.checked;
            const roleId = document.getElementById('rappelRole').value;
            const message = document.getElementById('rappelMessage').value;
            if (!roleId) { toast('❌ Choisis un rôle', 'error'); return; }
            if (!message.trim()) { toast('❌ Tape un message', 'error'); return; }
            if (!await confirmAction({ title: 'Envoyer le rappel', message: 'Envoyer ce rappel sur Discord ?', confirmText: 'Envoyer' })) return;
            try {
                const res = await fetch('/api/command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: 'rappel', params: { roleId, message, useEmbed } })
                });
                const data = await res.json();
                if (res.ok) {
                    toast('📌 Rappel envoyé');
                    const ta = document.getElementById('rappelMessage');
                    ta.value = '';
                    ta.dispatchEvent(new Event('input'));
                    document.getElementById('rappelRole').value = '';
                    const label = document.getElementById('rappelRoleLabel');
                    if (label) { label.innerHTML = '— Choisir un rôle —'; label.style.color = ''; }
                } else { toast(`❌ ${data.error}`, 'error'); }
            } catch (e) { toast(`❌ ${e.message}`, 'error'); }
        };
    }
})();

// ============================================================
// AFFICHER LE SLIDE ADMIN + STOCKAGE USER
// ============================================================
(async function checkAdminAndShowLink() {
    for (let i = 0; i < 5; i++) {
        try {
            const r = await fetch('/api/me');
            if (r.ok) {
                const me = await r.json();
                window.currentUserId = me.id;
                window.currentUserRoles = me.roles || [];

                if (me.id === '952986899667103804' ||
                    (me.roles && me.roles.includes('1485279148246175764')) ||
                    me.isAdmin) {
                    const wrapper = document.getElementById('adminSlideWrapper');
                    if (wrapper) {
                        wrapper.style.display = 'block';
                        setupAdminSlide();
                    }
                    isAdminUser = true;
                }
                return;
            }
        } catch {}
        await new Promise(r => setTimeout(r, 500));
    }
})();

function setupAdminSlide() {
    const handle = document.getElementById('adminSlideHandle');
    const track = document.getElementById('adminSlideTrack');
    if (!handle || !track) return;

    let isDragging = false;
    let startX = 0;
    let currentX = 0;

    const startDrag = (clientX) => {
        isDragging = true;
        startX = clientX;
        handle.style.transition = 'none';
    };
    const moveDrag = (clientX) => {
        if (!isDragging) return;
        const trackWidth = track.offsetWidth - handle.offsetWidth - 8;
        currentX = Math.max(0, Math.min(clientX - startX, trackWidth));
        handle.style.left = currentX + 'px';
        if (currentX >= trackWidth * 0.85) {
            isDragging = false;
            handle.innerHTML = '✓';
            handle.style.background = 'linear-gradient(135deg, #4ade80, #16a34a)';
            setTimeout(() => { window.location.href = '/admin'; }, 300);
        }
    };
    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        handle.style.transition = 'left 0.3s';
        const trackWidth = track.offsetWidth - handle.offsetWidth - 8;
        if (currentX < trackWidth * 0.85) {
            handle.style.left = '0';
            currentX = 0;
        }
    };

    handle.addEventListener('mousedown', e => { e.preventDefault(); startDrag(e.clientX); });
    window.addEventListener('mousemove', e => moveDrag(e.clientX));
    window.addEventListener('mouseup', endDrag);
    handle.addEventListener('touchstart', e => { e.preventDefault(); startDrag(e.touches[0].clientX); }, { passive: false });
    window.addEventListener('touchmove', e => moveDrag(e.touches[0].clientX), { passive: true });
    window.addEventListener('touchend', endDrag);
}

// ============================================================
// VOS ARMES (myweapons)
// ============================================================
let myWeaponsCache = [];
let myWeaponNamesCache = [];
let myWeaponsFormHydrated = false;
const myWeaponsAuthorizedCrafters = [
    { id: 'otelow', name: 'Otelow' },
    { id: 'ney', name: 'Ney' },
    { id: 'le-h', name: 'Le H' },
];

async function initMyWeaponsTab() {
    if (!organizationsCache || organizationsCache.length === 0) {
        await loadOrganizations();
    }
    await loadMyWeaponNames();
    await loadAllMembers();
    if (!myWeaponsFormHydrated || !isMyWeaponsFormActive()) {
        populateMyWeaponNameSelect();
        populateMyWeaponsMemberSelects();
        toggleMwCrafted();
        renderMarkSoldBuyerDropdown();
        myWeaponsFormHydrated = true;
    }
    await loadMyWeapons();
    renderMyWeapons();
}

function isMyWeaponsFormActive() {
    const activeId = document.activeElement?.id || '';
    return ['mwName', 'mwCraftedBy', 'mwSerial', 'mwAskingPrice', 'mwMinPrice'].includes(activeId);
}

async function loadMyWeapons() {
    try {
        const r = await fetch('/api/crafts/myweapons');
        const d = await r.json();
        myWeaponsCache = d.myweapons || [];
    } catch { myWeaponsCache = []; }
}

async function loadMyWeaponNames() {
    try {
        const r = await fetch('/api/crafts/myweapon-names');
        const d = await r.json();
        myWeaponNamesCache = d.names || [];
    } catch {
        myWeaponNamesCache = [];
    }
}

function populateMyWeaponNameSelect() {
    const select = document.getElementById('mwName');
    if (!select) return;
    const previousValue = select.value;
    if (!myWeaponNamesCache.length) {
        select.innerHTML = '<option value="">Aucune arme configurée</option>';
        return;
    }
    select.innerHTML = '<option value="">— Choisir une arme —</option>' +
        myWeaponNamesCache
            .map(w => `<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)}</option>`)
            .join('');
    if (previousValue && myWeaponNamesCache.some(w => String(w.name) === previousValue)) {
        select.value = previousValue;
    }
}

function toggleMwCrafted() {
    const origin = document.querySelector('input[name="mwOrigin"]:checked')?.value;
    const field = document.getElementById('mwCraftedByField');
    const select = document.getElementById('mwCraftedBy');
    const serial = document.getElementById('mwSerial');
    const serialLabel = document.querySelector('#mwSerialField .comm-label');
    const crafted = origin === 'crafted';
    if (field) field.style.display = crafted ? 'block' : 'none';
    if (select) {
        select.required = crafted;
        if (!crafted) select.value = '';
    }
    if (serial) {
        serial.required = crafted;
        serial.placeholder = crafted ? 'Ex: ABC123XYZ\nDEF456UVW\nGHI789RST' : 'Optionnel pour une arme externe';
    }
    if (serialLabel) serialLabel.textContent = crafted ? 'N° de série *' : 'N° de série (optionnel)';
}

function populateMyWeaponsMemberSelects() {
    const members = allMembersCache || [];
    const currentId = window.currentUser?.id || window.currentUserId || '';
    const options = '<option value="">— Choisir un membre —</option>' + members.map(m => (
        `<option value="${escapeHtml(m.id)}" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`
    )).join('');

    const craftedBySelect = document.getElementById('mwCraftedBy');
    if (craftedBySelect) {
        craftedBySelect.innerHTML = '<option value="">— Choisir un armurier —</option>' + myWeaponsAuthorizedCrafters.map(c => (
            `<option value="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`
        )).join('');
    }

    const soldBySelect = document.getElementById('markSoldBy');
    if (soldBySelect) {
        soldBySelect.innerHTML = options;
        if (currentId && members.some(m => m.id === currentId)) soldBySelect.value = currentId;
    }
}

function getSelectedMember(selectId) {
    const select = document.getElementById(selectId);
    if (!select || !select.value) return { id: '', name: '' };
    const opt = select.options[select.selectedIndex];
    return { id: select.value, name: opt?.dataset?.name || opt?.textContent || '' };
}

async function submitMyWeapon() {
    const weapon_name = document.getElementById('mwName').value.trim();
    const origin = document.querySelector('input[name="mwOrigin"]:checked')?.value;
    const is_crafted = origin === 'crafted';
    const serial_numbers = document.getElementById('mwSerial').value
        .split(/[\n,;]+/)
        .map(s => s.trim())
        .filter(Boolean);
    const asking_price = document.getElementById('mwAskingPrice').value;
    const min_price = document.getElementById('mwMinPrice').value;
    const craftedBy = getSelectedMember('mwCraftedBy');

    if (!weapon_name) { toast('❌ Nom de l\'arme requis', 'error'); return; }
    if (!origin) { toast('❌ Origine de l\'arme requise', 'error'); return; }
    if (is_crafted && !craftedBy.id) { toast('❌ Choisis qui a crafté l\'arme', 'error'); return; }
    if (is_crafted && !serial_numbers.length) { toast('❌ N° de série obligatoire pour une arme 21BS', 'error'); return; }

    try {
        const res = await fetch('/api/crafts/myweapons', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                weapon_name,
                is_crafted,
                serial_numbers,
                asking_price,
                min_price,
                crafted_by_id: craftedBy.id,
                crafted_by_name: craftedBy.name
            })
        });
        const data = await res.json();
        if (res.ok) {
            toast(`✅ ${data.quantity || serial_numbers.length || 1} arme(s) mise(s) en vente — 1 annonce Discord`);
            document.getElementById('mwName').value = '';
            document.getElementById('mwSerial').value = '';
            document.getElementById('mwAskingPrice').value = '';
            document.getElementById('mwMinPrice').value = '';
            const defaultOrigin = document.querySelector('input[name="mwOrigin"][value="crafted"]');
            if (defaultOrigin) defaultOrigin.checked = true;
            toggleMwCrafted();
            await loadMyWeapons();
            renderMyWeapons();
        } else { toast(`❌ ${data.error}`, 'error'); }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}

function renderMyWeapons() {
    const list = document.getElementById('myWeaponsList');
    if (!list) return;
    if (myWeaponsCache.length === 0) {
        list.innerHTML = '<p class="empty">Aucune arme en vente</p>';
        return;
    }
    list.innerHTML = myWeaponsCache.map(w => {
        const date = new Date(w.created_at * 1000).toLocaleDateString('fr-FR');
        const avatarUrl = safeImageUrl(w.user_avatar);
        const avatar = avatarUrl
            ? `<img class="mw-avatar" src="${avatarUrl}" alt="${escapeHtml(w.user_name)}">`
            : `<div class="mw-avatar mw-avatar-fallback">${(w.user_name || '?').substring(0, 1).toUpperCase()}</div>`;

        const isMine = w.is_mine;
        const totalQty = w.quantity_total || 1;
        const availableQty = typeof w.quantity_available === 'number' ? w.quantity_available : (w.is_sold ? 0 : 1);
        const serials = Array.isArray(w.serials) ? w.serials : [];
        const isSold = availableQty <= 0;
        const serialPreview = serials.length
            ? serials.slice(0, 6).map(s => `${s.is_sold ? 'Vendu' : 'Dispo'}: ${escapeHtml(s.serial_number || 'Non renseigne')}${s.sold_by_name ? ` par ${escapeHtml(s.sold_by_name)}` : ''}`).join(' • ')
            : (w.serial_number ? escapeHtml(w.serial_number) : '');
        const moreSerials = serials.length > 6 ? ` +${serials.length - 6}` : '';
        const craftedByLine = w.is_crafted && w.crafted_by_name
            ? `<span>⚒ ${escapeHtml(w.crafted_by_name)}</span>`
            : '';

        const priceBlock = isSold
            ? `<span class="mw-sold-price">✅ Vendu : ${(w.sold_price || 0).toLocaleString('fr-FR')}$ ${w.sold_to ? '→ ' + escapeHtml(w.sold_to) : ''}</span>`
            : `
                <span class="mw-asking-price">💰 Souhaité : ${(w.asking_price || 0).toLocaleString('fr-FR')}$</span>
                ${w.min_price ? `<span class="mw-min-price">📉 Min : ${w.min_price.toLocaleString('fr-FR')}$</span>` : ''}
            `;

        const canDeleteWeapon = isMine || canDeleteMyWeaponsClient();
        let actions = isMine && !isSold ? `
            <div class="mw-actions">
                <button class="btn-mw-sold" onclick="openMarkSoldModal(${w.id})">✅ Marquer vendu</button>
                <button class="btn-status-delete" onclick="deleteMyWeapon(${w.id})">🗑</button>
            </div>
        ` : (isMine && isSold ? `<button class="btn-status-delete" onclick="deleteMyWeapon(${w.id})">🗑</button>` : '');

        if (!isMine && canDeleteWeapon) {
            actions = `<button class="btn-status-delete" onclick="deleteMyWeapon(${w.id})">🗑</button>`;
        }

        return `
            <div class="myweapons-item ${isSold ? 'mw-sold-row' : ''} ${isMine ? 'mw-mine' : ''}">
                ${avatar}
                <div class="myweapons-item-body">
                    <div class="myweapons-item-name">
                        ${escapeHtml(w.weapon_name)}
                        ${w.is_crafted ? '<span class="myweapons-tag-crafted">⚒ Craft 21BS</span>' : ''}
                        <span class="myweapons-tag-stock">${availableQty}/${totalQty}</span>
                        ${isSold ? '<span class="myweapons-tag-sold">VENDU</span>' : ''}
                    </div>
                    <div class="myweapons-item-meta">
                        <span class="mw-username">👤 ${escapeHtml(w.user_name)}</span>
                        ${craftedByLine}
                        ${serialPreview ? `<span>N°: ${serialPreview}${moreSerials}</span>` : ''}
                        ${priceBlock}
                        <span>📅 ${date}</span>
                    </div>
                </div>
                ${actions}
            </div>
        `;
    }).join('');
}

// ─── Modal "Marquer comme vendu" ───
function openMarkSoldModal(id) {
    const item = myWeaponsCache.find(w => Number(w.id) === Number(id));
    const availableSerials = item && Array.isArray(item.serials)
        ? item.serials.filter(s => !s.is_sold)
        : [];
    const soldIdInput = document.getElementById('markSoldId');
    soldIdInput.value = availableSerials[0]?.id || id;
    document.getElementById('markSoldPrice').value = '';
    const label = document.getElementById('markSoldBuyerLabel');
    if (label) { label.classList.add('custom-dropdown-placeholder'); label.innerHTML = '— Choisir —'; }
    document.getElementById('markSoldBuyer').value = '';
    const serialField = document.getElementById('markSoldSerialField');
    const serialSelect = document.getElementById('markSoldSerial');
    if (serialSelect && serialField) {
        serialSelect.innerHTML = availableSerials.map(s => `<option value="${s.id}">${escapeHtml(s.serial_number || 'Arme sans N° série')}</option>`).join('');
        serialField.style.display = availableSerials.length > 1 ? 'block' : 'none';
        serialSelect.onchange = () => { soldIdInput.value = serialSelect.value; };
    }
    document.getElementById('markSoldModal').style.display = 'flex';
    const soldBySelect = document.getElementById('markSoldBy');
    if (soldBySelect) {
        const currentId = window.currentUser?.id || window.currentUserId || '';
        soldBySelect.value = currentId || '';
    }
}

function closeMarkSoldModal() {
    document.getElementById('markSoldModal').style.display = 'none';
}

function renderMarkSoldBuyerDropdown() {
    const list = document.getElementById('markSoldBuyerList');
    if (!list) return;
    list.innerHTML = (organizationsCache || []).map(o => `
        <div class="custom-dropdown-item" data-name="${escapeHtml(o.name).toLowerCase()}" onclick="selectMarkSoldBuyer('${escapeJsArg(o.name)}')">
            <span class="custom-dropdown-item-label">🏢 ${escapeHtml(o.name)}</span>
        </div>
    `).join('');
    const search = document.getElementById('markSoldBuyerSearch');
    if (search) {
        search.oninput = () => {
            const q = search.value.toLowerCase().trim();
            list.querySelectorAll('.custom-dropdown-item').forEach(item => {
                const name = item.dataset.name || '';
                item.style.display = !q || name.includes(q) ? 'flex' : 'none';
            });
        };
    }
}

function toggleMarkSoldBuyerDropdown(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('markSoldBuyerMenu');
    if (!menu) return;
    const wasOpen = menu.style.display !== 'none';
    closeAllDropdowns();
    if (!wasOpen) {
        menu.style.display = 'block';
    }
}

function selectMarkSoldBuyer(name) {
    document.getElementById('markSoldBuyer').value = name;
    const label = document.getElementById('markSoldBuyerLabel');
    if (label) {
        label.classList.remove('custom-dropdown-placeholder');
        label.innerHTML = `🏢 ${escapeHtml(name)}`;
    }
    document.getElementById('markSoldBuyerMenu').style.display = 'none';
}

async function confirmMarkSold(e) {
    e.preventDefault();
    const id = document.getElementById('markSoldId').value;
    const sold_to = document.getElementById('markSoldBuyer').value;
    const sold_price = document.getElementById('markSoldPrice').value;
    const soldBy = getSelectedMember('markSoldBy');
    if (!sold_price) { toast('❌ Prix de vente requis', 'error'); return; }
    if (!soldBy.id) { toast('❌ Choisis qui a vendu l\'arme', 'error'); return; }

    try {
        const res = await fetch(`/api/crafts/myweapons/${id}/sold`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sold_to, sold_price, sold_by_id: soldBy.id, sold_by_name: soldBy.name })
        });
        const data = await res.json();
        if (res.ok) {
            if (data.auto_completed_craft) {
                toast('✅ Vente confirmée — Tableau de craft auto-rempli !');
            } else {
                toast('✅ Vente confirmée');
            }
            closeMarkSoldModal();
            await loadMyWeapons();
            renderMyWeapons();
            // Recharger aussi les crafts en cache pour cohérence
            if (typeof loadCraftRequests === 'function') {
                await loadCraftRequests();
            }
        } else { toast(`❌ ${data.error}`, 'error'); }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}

async function deleteMyWeapon(id) {
    if (!await confirmAction({ title: 'Supprimer l’annonce', message: 'Supprimer cette annonce de vente ?', confirmText: 'Supprimer', danger: true })) return;
    try {
        const res = await fetch(`/api/crafts/myweapons/${id}`, { method: 'DELETE' });
        if (res.ok) {
            toast('🗑 Supprimée');
            await loadMyWeapons();
            renderMyWeapons();
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}

window.toggleMwCrafted = toggleMwCrafted;
window.submitMyWeapon = submitMyWeapon;
window.openMarkSoldModal = openMarkSoldModal;
window.closeMarkSoldModal = closeMarkSoldModal;
window.toggleMarkSoldBuyerDropdown = toggleMarkSoldBuyerDropdown;
window.selectMarkSoldBuyer = selectMarkSoldBuyer;
window.confirmMarkSold = confirmMarkSold;
window.deleteMyWeapon = deleteMyWeapon;
