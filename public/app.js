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
    }
}

// ===== STATS GLOBALES =====
async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        const s = await res.json();
        document.getElementById('statTotal').textContent = s.totalMembers;
        document.getElementById('statAbsences').textContent = s.totalUnjustified;
        document.getElementById('statConsecutive').textContent = s.membersWithConsecutive;
        document.getElementById('statOPs').textContent = `${s.op1Active ? 1 : 0}/${s.op2Active ? 1 : 0}`;

        // Highlight si alertes KP
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
        { icon: '✅', label: 'Présents', list: op.present, color: 'green' },
        { icon: '⏰', label: 'Retards', list: op.late, color: 'orange' },
        { icon: '❌', label: 'Absents non justifiés', list: op.absentReact, color: 'red' },
        { icon: '📋', label: 'Absents justifiés', list: op.absentValid, color: 'blue' },
        { icon: '⚠️', label: 'Pas de réaction', list: op.noReaction, color: 'gray' },
    ];

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
                    : c.list.map(m => `<div class="member"><span class="member-dot"></span>${m.name}</div>`).join('')}
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

// ===== WEEKLY =====
async function loadWeekly() {
    try {
        const res = await fetch('/api/weekly');
        const data = await res.json();

        const consecutive = data.tracking.filter(t => t.consecutiveDays >= 2);
        const classic = data.tracking.filter(t => t.consecutiveDays < 2);

        const consecutiveList = document.getElementById('consecutiveList');
        const classicList = document.getElementById('classicList');

        consecutiveList.innerHTML = consecutive.length === 0
            ? '<p class="empty">Aucune absence consécutive ✨</p>'
            : consecutive.map(m => renderMemberRow(m, true)).join('');

        classicList.innerHTML = classic.length === 0
            ? '<p class="empty">Aucune absence cette semaine</p>'
            : classic.map(m => renderMemberRow(m, false)).join('');
    } catch (e) {
        console.error('Weekly:', e);
    }
}

function renderMemberRow(m, isAlert) {
    const detailsHtml = m.details && m.details.length > 0
        ? `<div class="member-details-list">
            ${m.details.map(d => `<div class="detail">${d.justified ? '✅' : '❌'} ${d.date} • ${d.op}</div>`).join('')}
          </div>`
        : '';

    return `
        <div class="member-row">
            <div class="member-row-info">
                <div class="member-row-name">${m.username}</div>
                <div class="member-row-details">
                    ${isAlert ? `<span class="member-row-badge">${m.consecutiveDays} JOURS</span> ` : ''}
                    ${m.count} absence(s) • cette semaine
                </div>
                ${detailsHtml}
            </div>
            <div class="member-row-count">${m.count}</div>
        </div>
    `;
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
            return `
                <div class="sanction">
                    <span class="sanction-time">${dateStr}</span>
                    ${s.content}
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
    const tree = document.getElementById('channelsTree');
    tree.innerHTML = '';
    const f = filter.toLowerCase();

    const renderChannel = (ch) => {
        const matches = !f || ch.name.toLowerCase().includes(f);
        if (!matches) return null;
        const icon = ch.type === 2 ? '🔊' : ch.type === 5 ? '📢' : ch.type === 15 ? '💬' : '#';
        const div = document.createElement('div');
        div.className = 'channel-item' + (ch.id === currentChannelId ? ' active' : '');
        div.dataset.id = ch.id;
        div.innerHTML = `<span class="channel-icon">${icon}</span><span>${ch.name}</span>`;
        if (ch.type === 0 || ch.type === 5) {
            div.onclick = () => selectChannel(ch);
        } else {
            div.style.cursor = 'default';
            div.style.opacity = '0.6';
        }
        return div;
    };

    // Orphans
    if (channelsData.orphans?.length) {
        for (const ch of channelsData.orphans) {
            const item = renderChannel(ch);
            if (item) tree.appendChild(item);
        }
    }

    // Catégories
    for (const cat of channelsData.categories) {
        const matchingChannels = cat.channels.map(renderChannel).filter(Boolean);
        if (matchingChannels.length === 0 && f) continue;

        const catDiv = document.createElement('div');
        catDiv.className = 'channel-category';
        catDiv.innerHTML = `
            <div class="channel-category-header">
                <span class="channel-category-arrow">▼</span>
                <span>${cat.name}</span>
            </div>
            <div class="channel-list"></div>
        `;
        const list = catDiv.querySelector('.channel-list');
        matchingChannels.forEach(c => list.appendChild(c));

        catDiv.querySelector('.channel-category-header').onclick = () => {
            catDiv.classList.toggle('collapsed');
        };

        tree.appendChild(catDiv);
    }
}

function setupChannelSearch() {
    const input = document.getElementById('channelSearch');
    if (!input) return;
    input.addEventListener('input', e => renderChannelsTree(e.target.value));
}

async function selectChannel(ch) {
    currentChannelId = ch.id;
    renderChannelsTree(document.getElementById('channelSearch')?.value || '');

    document.getElementById('channelsEmpty').style.display = 'none';
    document.getElementById('channelsViewer').style.display = 'flex';
    document.getElementById('viewerName').textContent = '#' + ch.name;
    document.getElementById('viewerTopic').textContent = ch.topic || '';
    document.getElementById('viewerOpenDiscord').href = ch.url;

    document.getElementById('channelsMessages').innerHTML = '<p class="empty">Chargement...</p>';
    document.getElementById('loadMoreBtn').style.display = 'none';
    oldestMessageId = null;

    await loadMessages(ch.id);
}

async function loadMessages(channelId, before = null) {
    try {
        const url = before ? `/api/channel/${channelId}/messages?before=${before}` : `/api/channel/${channelId}/messages`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
            document.getElementById('channelsMessages').innerHTML = `<p class="empty">❌ ${data.error}</p>`;
            return;
        }

        const container = document.getElementById('channelsMessages');
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
// CARTE INTERACTIVE
// ==========================================
let mapPoints = [];
let mapMode = 'view'; // 'view', 'add', 'delete'
let pendingPoint = null;

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

    // Click sur la carte
    const canvas = document.getElementById('mapCanvas');
    if (canvas) {
        canvas.addEventListener('click', (e) => {
            if (mapMode !== 'add') return;
            if (e.target.closest('.map-point')) return;

            const img = document.getElementById('mapImage');
            const rect = img.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;

            if (x < 0 || x > 100 || y < 0 || y > 100) return;

            pendingPoint = { x, y };
            document.getElementById('pointLabel').value = '';
            document.getElementById('pointType').value = 'default';
            document.getElementById('pointModal').style.display = 'flex';
            setTimeout(() => document.getElementById('pointLabel').focus(), 100);
        });
    }
}

function setMapMode(mode) {
    mapMode = mode;
    document.querySelectorAll('.map-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    const canvas = document.getElementById('mapCanvas');
    canvas.classList.remove('add-mode', 'delete-mode');
    if (mode === 'add') canvas.classList.add('add-mode');
    if (mode === 'delete') canvas.classList.add('delete-mode');

    const info = document.getElementById('mapInfo').querySelector('.info-text') || document.getElementById('mapInfo');
    const messages = {
        view: 'Mode <strong>Voir</strong> — Clique sur un point pour voir les détails',
        add: 'Mode <strong>Ajouter</strong> — Clique sur la carte pour placer un nouveau point',
        delete: 'Mode <strong>Supprimer</strong> — Clique sur un point pour le supprimer',
    };
    info.innerHTML = messages[mode];
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
    layer.innerHTML = '';

    for (const p of mapPoints) {
        const pin = document.createElement('div');
        pin.className = 'map-point';
        pin.style.left = p.x + '%';
        pin.style.top = p.y + '%';
        pin.innerHTML = `
            <svg class="map-point-pin" viewBox="0 0 24 32" fill="${p.color || '#ff3333'}" stroke="#000" stroke-width="1">
                <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"/>
                <circle cx="12" cy="12" r="5" fill="#fff"/>
            </svg>
            <div class="map-point-label">${escapeHtml(p.label)}${p.type !== 'default' ? ` (${getPointTypeIcon(p.type)})` : ''}</div>
        `;
        pin.onclick = (e) => {
            e.stopPropagation();
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

function getPointTypeIcon(type) {
    const icons = {
        lab: '⚗', stash: '📦', vehicle: '🚗', entry: '🚪',
        danger: '⚠', meeting: '📌', default: '📍'
    };
    return icons[type] || '📍';
}

async function confirmAddPoint() {
    if (!pendingPoint) return;
    const label = document.getElementById('pointLabel').value.trim() || 'Point sans nom';
    const type = document.getElementById('pointType').value;
    const color = document.getElementById('mapColor').value;

    try {
        const res = await fetch('/api/map/points', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...pendingPoint, label, type, color })
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
    document.getElementById('detailsTitle').textContent = `${getPointTypeIcon(p.type)} ${p.label}`;
    document.getElementById('detailsContent').innerHTML = `
        <div class="detail-row"><span>Type</span><span>${p.type}</span></div>
        <div class="detail-row"><span>Position</span><span>${p.x.toFixed(1)}%, ${p.y.toFixed(1)}%</span></div>
        <div class="detail-row"><span>Couleur</span><span style="color:${p.color}">●</span></div>
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
