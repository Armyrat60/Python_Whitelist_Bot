/* ── Utility ──────────────────────────────────────────────────────────────── */

function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
}

/* ── Flash Messages ──────────────────────────────────────────────────────── */

function showFlash(message, type) {
    type = type || 'info';
    var container = document.getElementById('flash-container');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'flash flash-' + type;
    el.textContent = message;
    el.addEventListener('click', function() { el.remove(); });
    container.appendChild(el);
    setTimeout(function() {
        if (el.parentNode) el.remove();
    }, 5000);
}

/* ── Dashboard: Edit Form Toggle & Submit ────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function() {
    // Toggle edit forms
    document.querySelectorAll('.edit-toggle-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var type = this.getAttribute('data-type');
            var form = document.getElementById('edit-form-' + type);
            if (form) {
                var visible = form.style.display !== 'none';
                form.style.display = visible ? 'none' : 'block';
                this.textContent = visible ? 'Edit IDs' : 'Cancel';
            }
        });
    });

    // Cancel buttons
    document.querySelectorAll('.cancel-edit-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var type = this.getAttribute('data-type');
            var form = document.getElementById('edit-form-' + type);
            if (form) form.style.display = 'none';
            var toggleBtn = document.querySelector('.edit-toggle-btn[data-type="' + type + '"]');
            if (toggleBtn) toggleBtn.textContent = 'Edit IDs';
        });
    });

    // Save buttons
    document.querySelectorAll('.save-ids-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var type = this.getAttribute('data-type');
            saveWhitelist(type);
        });
    });
});

function saveWhitelist(type) {
    var steamTextarea = document.getElementById('steam-' + type);
    var eosTextarea = document.getElementById('eos-' + type);
    if (!steamTextarea || !eosTextarea) return;

    var steamIds = steamTextarea.value.trim().split('\n').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
    var eosIds = eosTextarea.value.trim().split('\n').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });

    var saveBtn = document.querySelector('.save-ids-btn[data-type="' + type + '"]');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    fetch('/api/my-whitelist/' + type, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steam_ids: steamIds, eos_ids: eosIds })
    })
    .then(function(resp) { return resp.json().then(function(data) { return { ok: resp.ok, data: data }; }); })
    .then(function(result) {
        if (result.ok) {
            showFlash('Whitelist updated successfully!', 'success');
            setTimeout(function() { window.location.reload(); }, 1200);
        } else {
            var msg = result.data.error || 'Failed to save.';
            if (result.data.details) {
                msg += ' ' + result.data.details.join(', ');
            }
            showFlash(msg, 'error');
        }
    })
    .catch(function() {
        showFlash('Network error. Please try again.', 'error');
    })
    .finally(function() {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    });
}

/* ── Admin: Auto-refresh Stats ───────────────────────────────────────────── */

(function() {
    if (document.getElementById('admin-stats')) {
        setInterval(function() {
            if (typeof loadAdminStats === 'function') {
                loadAdminStats();
            }
        }, 60000);
    }
})();
