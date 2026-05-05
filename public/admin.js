// ============================================================
// ADMIN PANEL — JS
// ============================================================
let adminWeapons = [];
let adminOrgs = [];
let adminRoles = [];
let editingIngredients = [];

document.addEventListener('DOMContentLoaded', async () => {
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

    initSlideToUnlock();
    loadAdminWeapons();
    loadAdminOrgs();
    loadAdminRoles();
});

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, type) {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ─── SLIDE TO UNLOCK ────────────────────────────────
function initSlideToUnlock() {
    const handle = document.getElementById('slideHandle');
    const track = handle?.parentElement;
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

        // Si glissé à plus de 80% → unlock
        if (currentX >= trackWidth * 0.85) {
            unlockImpersonate();
            isDragging = false;
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

function unlockImpersonate() {
    const handle = document.getElementById('slideHandle');
    if (handle) {
        handle.innerHTML = '✓';
        handle.style.background = 'var(--green)';
    }
    document.getElementById('impersonatePanel').style.display = 'block';
    toast('🔓 Vue impersonate déverrouillée');
}

async function loadAdminRoles() {
    try {
        const r = await fetch('/api/roles');
        const d = await r.json();
        adminRoles = d.roles || [];
        const select = document.getElementById('impersonateRole');
        if (select) {
            select.innerHTML = '<option value="">— Choisir un rôle —</option>' +
                adminRoles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
        }
    } catch {}
}

function applyImpersonate() {
    const roleId = document.getElementById('impersonateRole').value;
    if (!roleId) { toast('❌ Choisis un rôle', 'error'); return; }
    // Stocker en localStorage pour le dashboard
    localStorage.setItem('impersonate_role', roleId);
    toast('✅ Vue impersonate active. Retourne au dashboard pour voir.');
}

function resetImpersonate() {
    localStorage.removeItem('impersonate_role');
    toast('↩ Vue impersonate désactivée');
}

// ─── ARMES ─────────────────────────────────────────
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
    list.innerHTML = adminWeapons.map(w => `
        <div class="admin-weapon-row">
            ${w.image_url ? `<img class="admin-weapon-img" src="${w.image_url}">` : '<span class="admin-weapon-placeholder">🔫</span>'}
            <div class="admin-weapon-info">
                <strong>${escapeHtml(w.name)}</strong>
                <small>${w.craft_time ? formatTime(w.craft_time) : ''} ${w.craft_price ? '· ' + w.craft_price.toLocaleString('fr-FR') + '$' : ''} · ${(w.ingredients || []).length} ingrédients</small>
            </div>
            <div class="admin-weapon-actions">
                <button class="btn-secondary btn-small" onclick="openWeaponEditor(${w.id})">✏ Modifier</button>
                <button class="btn-danger btn-small" onclick="deleteWeapon(${w.id})">🗑</button>
            </div>
        </div>
    `).join('');
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
    editingIngredients = [];

    if (id) {
        const w = adminWeapons.find(w => w.id === id);
        if (!w) return;
        title.textContent = `Modifier : ${w.name}`;
        document.getElementById('weaponId').value = w.id;
        document.getElementById('weaponName').value = w.name;
        document.getElementById('weaponCraftTime').value = w.craft_time || 0;
        document.getElementById('weaponCraftPrice').value = w.craft_price || 0;
        if (w.image_url) {
            document.getElementById('weaponImagePreview').innerHTML = `<img src="${w.image_url}">`;
        }
        editingIngredients = [...(w.ingredients || [])];
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

function addIngredient() {
    editingIngredients.push({ name: '', amount: 0 });
    renderIngredientsEditor();
}

function renderIngredientsEditor() {
    const list = document.getElementById('ingredientsList');
    if (!editingIngredients.length) {
        list.innerHTML = '<p class="empty-small">Aucun ingrédient</p>';
        return;
    }
    list.innerHTML = editingIngredients.map((ing, i) => `
        <div class="ingredient-row">
            <input type="text" placeholder="Nom" value="${escapeHtml(ing.name || '')}" oninput="updateIngredient(${i}, 'name', this.value)">
            <input type="number" placeholder="Quantité" value="${ing.amount || 0}" oninput="updateIngredient(${i}, 'amount', this.value)" min="0">
            <button type="button" class="btn-danger btn-small" onclick="removeIngredient(${i})">×</button>
        </div>
    `).join('');
}

function updateIngredient(index, field, value) {
    if (!editingIngredients[index]) return;
    editingIngredients[index][field] = field === 'amount' ? parseInt(value) || 0 : value;
}

function removeIngredient(index) {
    editingIngredients.splice(index, 1);
    renderIngredientsEditor();
}

// Preview image
document.addEventListener('change', (e) => {
    if (e.target.id === 'weaponImage') {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.getElementById('weaponImagePreview').innerHTML = `<img src="${ev.target.result}">`;
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
    formData.append('ingredients', JSON.stringify(editingIngredients));

    const file = document.getElementById('weaponImage').files[0];
    if (file) formData.append('image', file);

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
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}

async function deleteWeapon(id) {
    if (!confirm('Supprimer cette arme ?')) return;
    try {
        const res = await fetch(`/api/crafts/weapons/${id}`, { method: 'DELETE' });
        if (res.ok) {
            toast('🗑 Supprimée');
            await loadAdminWeapons();
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}

// ─── ORGANISATIONS ─────────────────────────────────
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
    if (!confirm('Supprimer cette organisation ?')) return;
    try {
        const res = await fetch(`/api/crafts/organizations/${id}`, { method: 'DELETE' });
        if (res.ok) {
            await loadAdminOrgs();
        }
    } catch (e) { toast(`❌ ${e.message}`, 'error'); }
}
