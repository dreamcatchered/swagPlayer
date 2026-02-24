// Управление профилем пользователя
// Используем window.currentUser из app.js

async function loadProfile() {
    try {
        const res = await fetch('/api/user/profile');
        if (res.ok) {
            window.currentUser = await res.json();
            return window.currentUser;
        }
    } catch(e) {
        console.error('Error loading profile:', e);
    }
    return null;
}

async function updateProfile(displayName, nickname) {
    try {
        const res = await fetch('/api/user/profile', {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({display_name: displayName, nickname: nickname})
        });
        
        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                window.currentUser = await loadProfile();
                return true;
            }
        }
    } catch(e) {
        console.error('Error updating profile:', e);
    }
    return false;
}

function showProfile() {
    // Создаем модальное окно профиля
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    modal.innerHTML = `
        <div style="background: #1c1c1e; border-radius: 20px; padding: 30px; max-width: 400px; width: 90%;">
            <h2 style="margin: 0 0 20px 0; font-size: 24px;">Профиль</h2>
            <div id="profile-content">Загрузка...</div>
            <button onclick="this.closest('div[style*=\"position: fixed\"]').remove()" 
                    style="margin-top: 20px; width: 100%; padding: 12px; background: #fa2d48; color: white; border: none; border-radius: 10px; cursor: pointer;">
                Закрыть
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    loadProfile().then(user => {
        if (user || window.currentUser) {
            const userData = user || window.currentUser;
            const content = document.getElementById('profile-content');
            content.innerHTML = `
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.6);">Имя</label>
                    <input type="text" id="display-name" value="${userData.display_name || ''}" 
                           style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: white;">
                </div>
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; color: rgba(255,255,255,0.6);">Nickname</label>
                    <input type="text" id="nickname" value="${userData.nickname || ''}" 
                           style="width: 100%; padding: 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: white;">
                    <div style="font-size: 12px; color: rgba(255,255,255,0.5); margin-top: 4px;">
                        Ссылка: swag.dreampartners.online/user/<span id="nickname-preview">${userData.nickname || '...'}</span>
                    </div>
                </div>
                <button onclick="saveProfile()" 
                        style="width: 100%; padding: 12px; background: #fa2d48; color: white; border: none; border-radius: 10px; cursor: pointer;">
                    Сохранить
                </button>
            `;
            
            // Обновление превью nickname
            document.getElementById('nickname').addEventListener('input', (e) => {
                document.getElementById('nickname-preview').textContent = e.target.value || '...';
            });
        }
    });
}

async function saveProfile() {
    const displayName = document.getElementById('display-name').value;
    const nickname = document.getElementById('nickname').value.toLowerCase().trim();
    
    const success = await updateProfile(displayName, nickname);
    if (success) {
        alert('Профиль обновлен!');
        document.querySelector('div[style*="position: fixed"]').remove();
    } else {
        alert('Ошибка обновления профиля');
    }
}

// Делаем функции глобальными
window.showProfile = showProfile;
window.saveProfile = saveProfile;

