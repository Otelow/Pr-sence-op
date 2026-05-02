// ==========================================
// 21 BLOCK SAVAGE — Dashboard JS
// ==========================================

const PAGE_TITLES = {
    presence: { title: 'Présence OP', sub: 'Suivi temps réel' },
    commands: { title: 'Commandes', sub: 'Centre de contrôle' },
    channels: { title: 'Salons Discord', sub: 'Historique et navigation' },
    map: { title: 'Carte du Laboratoire', sub: 'Marquage de zones' },
    stats: { title: 'Statistiques', sub: 'Suivi hebdomadaire' },
    sanctions: { title: 'Sanctions', sub: 'Historique des avertissements' },
};

let currentTab = 'presence';
let refreshTimer = null;
let userPermissions = { canEditMap: false };

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
    await loadUser();
    await loadPermissions();
    setupNav();
    setupChannelSearch();
    setupMap();
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
        document.getElementById('userName').textContent = user.username;
        if (user.avatar) document.getElementById('userAvatar').src = user.avatar;
    } catch {
        window.location = '/';
    }
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

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tab}`));

    const titles = PAGE_TITLES[tab];
    document.getElementById('pageTitle').textContent = titles.title;
    document.getElementById('pageSub').textContent = titles.sub;

    refreshAll();
}

async function refreshAll() {
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
    }
}

let commandsLoaded = false;
async function initCommandsTab() {
    await Promise.all([loadCommands(), loadAnnonceData()]);
    commandsLoaded = true;
}

// ===== STATS GLOBALES =====
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const s = await res.json();
        document.getElementById('statTotal').textContent = s.totalMembers;
        document.getElementById('statInscrits').textContent = s.inscritsOP || 0;
        document.getElementById('statAbsences').textContent = s.totalUnjustified;
        document.getElementById('statConsecutive').textContent = s.membersWithConsecutive;
        document.getElementById('statConsecutiveCard').classList.toggle('stat-warning', s.membersWithConsecutive > 0);
    } catch (e) {
        console.error('Stats:', e);
    }
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

    validList.innerHTML = data.valid.length === 0
        ? '<p class="empty">Aucune</p>'
        : data.valid.map(n => `<div class="item">• ${n}</div>`).join('');

    invalidList.innerHTML = data.invalid.length === 0
        ? '<p class="empty">Aucune</p>'
        : data.invalid.map(n => `<div class="item">• ${n}</div>`).join('');
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
                if (hasJustified && !hasUnjustified) cell = '<span class="calendar-cell justified" title="Absence justifiée">📋</span>';
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
            <div class="calendar-legend-item">📋 <span>Absence justifiée</span></div>
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

            // Mettre en évidence les mentions @user et @role résolues
            const content = escapeHtml(s.content)
                .replace(/(@[^\s]+)/g, '<span class="mention">$1</span>')
                .replace(/—\s+(.+)/, '<strong>— $1</strong>');

            return `
                <div class="sanction">
                    <span class="sanction-time">📅 ${dateStr}</span>
                    <div class="sanction-content">${content}</div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('Sanctions:', e);
    }
}

// ===== COMMANDES =====
async function runCmd(command) {
    if (!confirm(`Lancer la commande "${command}" ?`)) return;

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

// ==========================================
// SALONS
// ==========================================
let channelsLoaded = false;
let channelsData = null;
let currentChannelId = null;
let oldestMessageId = null;
let loadingMore = false;

async function loadChannels() {
    try {
        const res = await fetch('/api/channels');
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

    const renderChannelCard = (ch) => {
        const matches = !f || ch.name.toLowerCase().includes(f);
        if (!matches) return null;

        const icons = { 0: '#', 2: '🔊', 5: '📢', 13: '🎙', 15: '💬' };
        const types = { 0: 'Texte', 2: 'Vocal', 5: 'Annonces', 13: 'Stage', 15: 'Forum' };
        const icon = icons[ch.type] || '#';
        const typeLabel = types[ch.type] || 'Salon';
        const isClickable = ch.type === 0 || ch.type === 5;

        const card = document.createElement('div');
        card.className = 'channel-card';
        card.dataset.type = ch.type;
        card.innerHTML = `
            <div class="channel-card-header">
                <span class="channel-card-icon">${icon}</span>
                <span class="channel-card-name">${escapeHtml(ch.name)}</span>
                <span class="channel-card-type">${typeLabel}</span>
            </div>
            ${ch.topic ? `<div class="channel-card-topic">${escapeHtml(ch.topic)}</div>` : (isClickable ? '<div class="channel-card-empty">Aucune description</div>' : '<div class="channel-card-vocal">Salon non lisible</div>')}
        `;
        if (isClickable) card.onclick = () => selectChannel(ch);
        else card.style.opacity = '0.6';
        return card;
    };

    // Orphans (sans catégorie)
    if (channelsData.orphans?.length) {
        const matchingOrphans = channelsData.orphans.map(renderChannelCard).filter(Boolean);
        if (matchingOrphans.length > 0) {
            const section = document.createElement('div');
            section.className = 'channel-category-section';
            section.innerHTML = `<div class="channel-category-title">▸ Sans catégorie</div>`;
            tree.appendChild(section);
            matchingOrphans.forEach(c => tree.appendChild(c));
        }
    }

    // Catégories
    for (const cat of channelsData.categories) {
        const matchingChannels = cat.channels.map(renderChannelCard).filter(Boolean);
        if (matchingChannels.length === 0) continue;

        const section = document.createElement('div');
        section.className = 'channel-category-section';
        section.innerHTML = `<div class="channel-category-title">▸ ${escapeHtml(cat.name)}</div>`;
        tree.appendChild(section);
        matchingChannels.forEach(c => tree.appendChild(c));
    }

    if (tree.innerHTML === '') {
        tree.innerHTML = '<p class="empty">Aucun salon trouvé</p>';
    }
}

function backToChannels() {
    document.getElementById('channelsGridView').style.display = 'grid';
    document.getElementById('channelMessagesView').style.display = 'none';
    document.getElementById('backToChannelsBtn').style.display = 'none';
    currentChannelId = null;
}

function setupChannelSearch() {
    const input = document.getElementById('channelSearch');
    if (!input) return;
    input.addEventListener('input', e => renderChannelsTree(e.target.value));
}

async function selectChannel(ch) {
    currentChannelId = ch.id;

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

    await loadMessages(ch.id);
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

        if (!before) container.innerHTML = '';

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

function renderMessage(m) {
    const div = document.createElement('div');
    div.className = 'message';
    const date = new Date(m.createdTimestamp);
    const dateStr = date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

    const avatar = m.authorAvatar || `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='36' height='36' fill='%23262626'/></svg>`;

    let content = escapeHtml(m.content)
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>')
        .replace(/<@!?(\d+)>/g, (_, id) => {
            const u = m.mentions.users.find(u => u.id === id);
            return `<span style="color:var(--blue)">@${u?.name || 'inconnu'}</span>`;
        })
        .replace(/<@&(\d+)>/g, (_, id) => {
            const r = m.mentions.roles.find(r => r.id === id);
            return `<span style="color:var(--orange)">@${r?.name || 'rôle'}</span>`;
        })
        .replace(/<#(\d+)>/g, '<span style="color:var(--blue)">#salon</span>')
        .replace(/<a?:(\w+):\d+>/g, ':$1:');

    let attachmentsHtml = '';
    for (const a of m.attachments) {
        if (a.isImage) {
            attachmentsHtml += `<img class="message-attachment-img" src="${a.url}" alt="${a.name}" onclick="window.open('${a.url}', '_blank')">`;
        } else {
            attachmentsHtml += `<a href="${a.url}" target="_blank" class="message-attachment-file">📎 ${a.name}</a>`;
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
        reactionsHtml += `<span class="message-reaction">${r.emojiUrl ? `<img src="${r.emojiUrl}">` : r.emoji} ${r.count}</span>`;
    }

    div.innerHTML = `
        <img class="message-avatar" src="${avatar}" alt="">
        <div class="message-body">
            <div class="message-header">
                <span class="message-author ${m.authorBot ? 'bot' : ''}">${escapeHtml(m.authorName)}</span>
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
    // Boutons mode
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

    // Click sur la carte (mode add)
    canvas.addEventListener('click', async (e) => {
        if (mapMode !== 'add') return;
        if (e.target.closest('.map-point')) return;
        if (isDragging) return;

        const img = document.getElementById('mapImage');
        const rect = img.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        if (x < 0 || x > 100 || y < 0 || y > 100) return;

        pendingPoint = { x, y };
        document.getElementById('pointLabel').value = '';
        document.getElementById('pointType').value = 'weed';
        document.getElementById('pointModal').style.display = 'flex';

        // Charger les rôles dans la modal
        await loadRolesForModal();

        setTimeout(() => document.getElementById('pointLabel').focus(), 100);
    });

    // Zoom à la molette
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        mapZoom(delta);
    }, { passive: false });

    // Drag pour déplacer
    container.addEventListener('mousedown', (e) => {
        if (e.target.closest('.map-point')) return;
        if (mapMode === 'add') return;
        isDragging = false;
        dragStart = {
            x: e.clientX,
            y: e.clientY,
            scrollX: container.scrollLeft,
            scrollY: container.scrollTop,
        };
        const onMove = (ev) => {
            const dx = Math.abs(ev.clientX - dragStart.x);
            const dy = Math.abs(ev.clientY - dragStart.y);
            if (dx > 3 || dy > 3) isDragging = true;
            container.scrollLeft = dragStart.scrollX - (ev.clientX - dragStart.x);
            container.scrollTop = dragStart.scrollY - (ev.clientY - dragStart.y);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            setTimeout(() => { isDragging = false; }, 50);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function mapZoom(delta) {
    const newZoom = Math.max(0.5, Math.min(5, mapZoomLevel + delta * 0.2));
    if (newZoom === mapZoomLevel) return;
    mapZoomLevel = newZoom;
    applyMapZoom();
}

function mapZoomReset() {
    mapZoomLevel = 1;
    applyMapZoom();
}

function applyMapZoom() {
    const canvas = document.getElementById('mapCanvas');
    if (!canvas) return;
    canvas.style.transform = `scale(${mapZoomLevel})`;
    canvas.style.transformOrigin = '0 0';
    document.getElementById('mapZoomLabel').textContent = Math.round(mapZoomLevel * 100) + '%';
}

function setMapMode(mode) {
    mapMode = mode;
    document.querySelectorAll('.map-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const canvas = document.getElementById('mapCanvas');
    canvas.classList.remove('add-mode', 'delete-mode');
    if (mode === 'add') canvas.classList.add('add-mode');
    if (mode === 'delete') canvas.classList.add('delete-mode');

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
        const res = await fetch('/api/map/points');
        const data = await res.json();
        mapPoints = data.points || [];
        renderMapPoints();
    } catch (e) {
        console.error('Map:', e);
    }
}

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
        pin.style.left = p.x + '%';
        pin.style.top = p.y + '%';
        pin.innerHTML = `
            <svg class="map-point-pin" viewBox="0 0 24 32" fill="${color}" stroke="#000" stroke-width="1.5">
                <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"/>
                <text x="12" y="16" text-anchor="middle" font-size="11" fill="#000">${icon}</text>
            </svg>
            <div class="map-point-label">${escapeHtml(p.label)} • ${label}</div>
        `;
        pin.onclick = (e) => {
            e.stopPropagation();
            if (isDragging) return;
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
            <span style="font-size:10px;color:var(--text-muted);">${r.memberCount}</span>
        </label>
    `).join('');
}

function selectAllRoles() {
    document.querySelectorAll('#pointRolesSelector input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function selectNoRoles() {
    document.querySelectorAll('#pointRolesSelector input[type="checkbox"]').forEach(cb => cb.checked = false);
}

async function confirmAddPoint() {
    if (!pendingPoint) return;
    const label = document.getElementById('pointLabel').value.trim() || 'Point sans nom';
    const type = document.getElementById('pointType').value;

    // Récupérer les rôles cochés
    const allowedRoles = [...document.querySelectorAll('#pointRolesSelector input[type="checkbox"]:checked')]
        .map(cb => cb.dataset.roleId);

    try {
        const res = await fetch('/api/map/points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...pendingPoint, label, type, allowedRoles })
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
    if (!confirm('Supprimer ce point ?')) return;
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
    const visibilityText = !p.allowedRoles || p.allowedRoles.length === 0
        ? 'Public (tous)'
        : `${p.allowedRoles.length} rôle(s) autorisé(s)`;

    document.getElementById('detailsTitle').textContent = `${getPointTypeIcon(p.type)} ${p.label}`;
    document.getElementById('detailsContent').innerHTML = `
        <div class="detail-row"><span>Type</span><span>${getPointTypeLabel(p.type)}</span></div>
        <div class="detail-row"><span>Position</span><span>${p.x.toFixed(1)}%, ${p.y.toFixed(1)}%</span></div>
        <div class="detail-row"><span>Visibilité</span><span>${visibilityText}</span></div>
        <div class="detail-row"><span>Placé par</span><span>${escapeHtml(p.createdBy)}</span></div>
        <div class="detail-row"><span>Date</span><span>${date}</span></div>
        ${userPermissions.canEditMap ? `<button class="btn-delete-point" onclick="deletePoint('${p.id}'); closeDetailsModal();">🗑 Supprimer ce point</button>` : ''}
    `;
    document.getElementById('pointDetailsModal').style.display = 'flex';
}

function closeDetailsModal() {
    document.getElementById('pointDetailsModal').style.display = 'none';
}

// Touche Échap pour fermer les modales
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closePointModal();
        closeDetailsModal();
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

async function loadAnnonceData() {
    // Charger rôles
    try {
        const r = await fetch('/api/roles');
        const data = await r.json();
        const select = document.getElementById('annonceRole');
        if (select && data.roles) {
            select.innerHTML = '<option value="">— Choisir un rôle —</option>' +
                data.roles.map(role => `<option value="${role.id}">@${escapeHtml(role.name)} (${role.memberCount})</option>`).join('');
        }
    } catch {}

    // Charger emojis
    try {
        const r = await fetch('/api/emojis');
        const data = await r.json();
        serverEmojis = data.emojis || [];
    } catch {}
}

function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;
    if (picker.style.display === 'none') {
        renderEmojiPicker();
        picker.style.display = 'grid';
    } else {
        picker.style.display = 'none';
    }
}

function renderEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;
    if (serverEmojis.length === 0) {
        picker.innerHTML = '<p class="empty" style="padding:12px;grid-column:1/-1;">Aucun emoji custom sur le serveur</p>';
        return;
    }
    picker.innerHTML = serverEmojis.map(e => `
        <div class="emoji-item" title=":${e.name}:" onclick="insertEmoji('${e.code.replace(/'/g, "\\'")}')">
            <img src="${e.url}" alt=":${e.name}:">
        </div>
    `).join('');
}

function insertEmoji(code) {
    const textarea = document.getElementById('annonceMessage');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.substring(0, start) + code + value.substring(end);
    textarea.focus();
    textarea.setSelectionRange(start + code.length, start + code.length);
}

async function sendAnnonce() {
    const roleId = document.getElementById('annonceRole').value;
    const message = document.getElementById('annonceMessage').value;

    if (!roleId) { toast('❌ Choisis un rôle', 'error'); return; }
    if (!message.trim()) { toast('❌ Tape un message', 'error'); return; }
    if (!confirm('Envoyer cette annonce ?')) return;

    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'annonce', params: { roleId, message } })
        });
        const data = await res.json();
        if (res.ok) {
            toast('📤 Annonce envoyée');
            document.getElementById('annonceMessage').value = '';
        } else {
            toast(`❌ ${data.error}`, 'error');
        }
    } catch (e) {
        toast(`❌ ${e.message}`, 'error');
    }
}
