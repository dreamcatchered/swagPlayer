import os
import sqlite3
import base64
import hashlib
import hmac
import json
import urllib.parse
from datetime import datetime
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, url_for, session
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash

try:
    from mutagen.mp3 import MP3
    from mutagen.id3 import ID3NoHeaderError
    from mutagen.id3 import ID3, TIT2, TPE1, APIC
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'your-secret-key-change-in-production')

# Настройки
UPLOAD_FOLDER = 'uploads'
DB_FILE = 'music.db'
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'jpg', 'jpeg', 'png'}
TELEGRAM_BOT_TOKEN = os.environ.get('BOT_TOKEN', '')

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# SSO Configuration
SSO_AUTH_URL = "https://auth.dreampartners.online"
SSO_CLIENT_ID = "mp3_editor"
SSO_CLIENT_SECRET = os.environ.get('SSO_CLIENT_SECRET', '')
SSO_REDIRECT_URI = "https://mp3.dreampartners.online/callback"

# Инициализация БД
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Таблица пользователей
    c.execute('''CREATE TABLE IF NOT EXISTS users
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  telegram_id INTEGER UNIQUE,
                  username TEXT,
                  first_name TEXT,
                  last_name TEXT,
                  avatar_url TEXT,
                  nickname TEXT UNIQUE,
                  display_name TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    
    # Таблица треков
    c.execute('''CREATE TABLE IF NOT EXISTS tracks
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  title TEXT,
                  artist TEXT,
                  filename TEXT,
                  cover_filename TEXT,
                  lyrics TEXT,
                  sort_order INTEGER DEFAULT 0,
                  hidden INTEGER DEFAULT 0,
                  slug TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id))''')
    
    # Таблица альбомов
    c.execute('''CREATE TABLE IF NOT EXISTS albums
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  title TEXT,
                  description TEXT,
                  cover_filename TEXT,
                  slug TEXT UNIQUE,
                  hidden INTEGER DEFAULT 0,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id))''')
    
    # Таблица лайков альбомов
    c.execute('''CREATE TABLE IF NOT EXISTS album_likes
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  album_id INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id),
                  FOREIGN KEY (album_id) REFERENCES albums(id),
                  UNIQUE(user_id, album_id))''')
    
    # Таблица связи альбомов и треков
    c.execute('''CREATE TABLE IF NOT EXISTS album_tracks
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  album_id INTEGER,
                  track_id INTEGER,
                  sort_order INTEGER DEFAULT 0,
                  FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
                  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
                  UNIQUE(album_id, track_id))''')
    
    # Таблица админов
    c.execute('''CREATE TABLE IF NOT EXISTS admins
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  username TEXT UNIQUE,
                  password_hash TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
                  
    # Таблица токенов авторизации (для браузера)
    c.execute('''CREATE TABLE IF NOT EXISTS auth_tokens
                 (token TEXT PRIMARY KEY,
                  telegram_id INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  expires_at TIMESTAMP)''')
    
    # Индексы
    c.execute("CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks(user_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_tracks_slug ON tracks(slug)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_albums_user_id ON albums(user_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_albums_slug ON albums(slug)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)")
    
    # Создаем дефолтного админа если его нет
    c.execute("SELECT COUNT(*) FROM admins")
    if c.fetchone()[0] == 0:
        admin_hash = generate_password_hash('admin123')
        c.execute("INSERT INTO admins (username, password_hash) VALUES (?, ?)", ('admin', admin_hash))
    
    # Таблица лайков
    c.execute('''CREATE TABLE IF NOT EXISTS likes
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  track_id INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id),
                  FOREIGN KEY (track_id) REFERENCES tracks(id),
                  UNIQUE(user_id, track_id))''')
    
    # Таблица прослушиваний (кто, какой трек, сколько раз)
    c.execute('''CREATE TABLE IF NOT EXISTS track_plays
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER,
                  track_id INTEGER,
                  play_count INTEGER DEFAULT 1,
                  last_played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (user_id) REFERENCES users(id),
                  FOREIGN KEY (track_id) REFERENCES tracks(id),
                  UNIQUE(user_id, track_id))''')
    
    # Миграции
    try:
        c.execute("ALTER TABLE tracks ADD COLUMN is_pinned INTEGER DEFAULT 0")
    except:
        pass
    try:
        c.execute("ALTER TABLE albums ADD COLUMN is_pinned INTEGER DEFAULT 0")
    except:
        pass
    try:
        c.execute("ALTER TABLE albums ADD COLUMN plays_count INTEGER DEFAULT 0")
    except:
        pass
    try:
        c.execute("ALTER TABLE albums ADD COLUMN likes_count INTEGER DEFAULT 0")
    except:
        pass
    try:
        c.execute("ALTER TABLE tracks ADD COLUMN plays_count INTEGER DEFAULT 0")
    except:
        pass
    try:
        c.execute("ALTER TABLE tracks ADD COLUMN likes_count INTEGER DEFAULT 0")
    except:
        pass
    
    conn.commit()
    conn.close()

init_db()

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Проверка Telegram Web App hash
def verify_telegram_webapp_data(init_data):
    """Проверяет подлинность данных от Telegram Web App"""
    try:
        if not init_data:
            return None
            
        # Парсим данные используя parse_qsl (как в рабочем проекте)
        from urllib.parse import parse_qsl
        parsed_data = dict(parse_qsl(init_data))
        
        # Извлекаем hash
        if 'hash' not in parsed_data:
            return None
        received_hash = parsed_data.pop('hash')  # Удаляем hash из данных
        
        # Создаем секретный ключ
        secret_key = hmac.new(
            key=b"WebAppData",
            msg=TELEGRAM_BOT_TOKEN.encode(),
            digestmod=hashlib.sha256
        ).digest()
        
        # Формируем data_check_string: сортируем все параметры кроме hash и соединяем через \n
        # ВАЖНО: используем переносы строк (\n), а не &
        data_check_string = '\n'.join(f"{k}={v}" for k, v in sorted(parsed_data.items()))
        
        # Вычисляем hash
        calculated_hash = hmac.new(
            key=secret_key,
            msg=data_check_string.encode('utf-8'),
            digestmod=hashlib.sha256
        ).hexdigest()
        
        # Сравниваем
        if calculated_hash != received_hash:
            print(f"Hash mismatch: calculated={calculated_hash}, received={received_hash}")
            print(f"Data check string: {data_check_string}")
            return None
        
        # Парсим данные пользователя
        user_data = {}
        if 'user' in parsed_data:
            user_json = parsed_data['user']
            user_data = json.loads(user_json)
        
        return user_data
    except Exception as e:
        print(f"Error verifying Telegram data: {e}")
        import traceback
        traceback.print_exc()
        return None

# Декоратор для проверки авторизации
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

# Декоратор для проверки админки
def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'admin' not in session or not session['admin']:
            return redirect('/admin/login')
        return f(*args, **kwargs)
    return decorated_function

# === ROUTES ===

# SPA Navigation - поддержка AJAX-загрузки
@app.before_request
def check_ajax():
    """Проверяем, является ли запрос AJAX для SPA-навигации"""
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        request.is_ajax = True
    else:
        request.is_ajax = False

@app.route('/')
def index():
    """Главная страница - unified версия"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    search_query = request.args.get('q', '').strip()
    current_user_id = session.get('user_id')
    
    # Получаем текущего пользователя
    current_user = None
    if current_user_id:
        c.execute("SELECT * FROM users WHERE id = ?", (current_user_id,))
        user_row = c.fetchone()
        if user_row:
            current_user = dict(user_row)
    
    # Получаем все публичные треки
    tracks_query = """SELECT t.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(t.plays_count, 0) as plays_count,
                        COALESCE(t.likes_count, 0) as likes_count
                 FROM tracks t 
                 JOIN users u ON t.user_id = u.id 
                 WHERE t.hidden = 0"""
    tracks_params = []
    
    if search_query:
        tracks_query += " AND (t.title LIKE ? OR t.artist LIKE ?)"
        search_term = f"%{search_query}%"
        tracks_params.extend([search_term, search_term])
        
    tracks_query += " ORDER BY t.is_pinned DESC, t.created_at DESC LIMIT 50"
    
    c.execute(tracks_query, tracks_params)
    tracks_rows = c.fetchall()
    
    # Проверяем лайки для треков
    tracks = []
    for row in tracks_rows:
        track = dict(row)
        if current_user_id:
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track['id']))
            track['is_liked'] = c.fetchone() is not None
        else:
            track['is_liked'] = False
        tracks.append(track)
    
    # Получаем все публичные альбомы
    albums_query = """SELECT a.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(a.plays_count, 0) as plays_count,
                        COALESCE(a.likes_count, 0) as likes_count
                 FROM albums a 
                 JOIN users u ON a.user_id = u.id 
                 WHERE a.hidden = 0"""
    albums_params = []
    
    if search_query:
        albums_query += " AND (a.title LIKE ? OR a.description LIKE ?)"
        search_term = f"%{search_query}%"
        albums_params.extend([search_term, search_term])
        
    albums_query += " ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 50"
    
    c.execute(albums_query, albums_params)
    albums_rows = c.fetchall()
    
    # Проверяем лайки для альбомов
    albums = []
    for row in albums_rows:
        album = dict(row)
        if current_user_id:
            c.execute("SELECT id FROM album_likes WHERE user_id = ? AND album_id = ?", (current_user_id, album['id']))
            album['is_liked'] = c.fetchone() is not None
        else:
            album['is_liked'] = False
        albums.append(album)
    
    conn.close()
    return render_template('unified.html', 
                          tracks=tracks, 
                          albums=albums, 
                          current_user=current_user,
                          search_query=search_query,
                          mode='library')

@app.route('/app')
def app_page():
    """Telegram Web App - главная страница приложения"""
    # Проверяем, есть ли initData в query параметрах (для авторизации через кнопку бота)
    init_data = request.args.get('tgWebAppData', '')
    return render_template('app.html', shared_track=None, shared_mode=False, init_data=init_data)

@app.route('/track/<track_identifier>')
def share_track(track_identifier):
    """Публичная страница трека - unified версия"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    current_user_id = session.get('user_id')
    
    # Получаем текущего пользователя
    current_user = None
    if current_user_id:
        c.execute("SELECT * FROM users WHERE id = ?", (current_user_id,))
        user_row = c.fetchone()
        if user_row:
            current_user = dict(user_row)
    
    if track_identifier.isdigit():
        c.execute("""SELECT t.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(t.plays_count, 0) as plays_count,
                        COALESCE(t.likes_count, 0) as likes_count
                     FROM tracks t 
                     JOIN users u ON t.user_id = u.id 
                     WHERE t.id = ? AND t.hidden = 0""", (int(track_identifier),))
    else:
        c.execute("""SELECT t.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(t.plays_count, 0) as plays_count,
                        COALESCE(t.likes_count, 0) as likes_count
                     FROM tracks t 
                     JOIN users u ON t.user_id = u.id 
                     WHERE t.slug = ? AND t.hidden = 0""", (track_identifier,))
        
    row = c.fetchone()
    
    if not row:
        conn.close()
        return "Track not found", 404
        
    track = dict(row)
    
    # Проверяем лайк текущего пользователя
    if current_user_id:
        c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track['id']))
        track['is_liked'] = c.fetchone() is not None
    else:
        track['is_liked'] = False
    
    conn.close()
    title = f"{track['artist']} - {track['title']}"
    return render_template('unified.html', 
                          shared_track=track, 
                          current_user=current_user,
                          page_title=title,
                          mode='player')

@app.route('/album/<album_identifier>')
def share_album(album_identifier):
    """Публичная страница альбома - unified версия"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    current_user_id = session.get('user_id')
    
    # Получаем текущего пользователя
    current_user = None
    if current_user_id:
        c.execute("SELECT * FROM users WHERE id = ?", (current_user_id,))
        user_row = c.fetchone()
        if user_row:
            current_user = dict(user_row)
    
    if album_identifier.isdigit():
        c.execute("""SELECT a.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(a.plays_count, 0) as plays_count,
                        COALESCE(a.likes_count, 0) as likes_count
                     FROM albums a 
                     JOIN users u ON a.user_id = u.id 
                     WHERE a.id = ? AND a.hidden = 0""", (int(album_identifier),))
    else:
        c.execute("""SELECT a.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(a.plays_count, 0) as plays_count,
                        COALESCE(a.likes_count, 0) as likes_count
                     FROM albums a 
                     JOIN users u ON a.user_id = u.id 
                     WHERE a.slug = ? AND a.hidden = 0""", (album_identifier,))
    
    album = c.fetchone()
    if not album:
        conn.close()
        return "Album not found", 404
    
    album = dict(album)
    
    # Проверяем лайк текущего пользователя
    if current_user_id:
        c.execute("SELECT id FROM album_likes WHERE user_id = ? AND album_id = ?", (current_user_id, album['id']))
        album['is_liked'] = c.fetchone() is not None
    else:
        album['is_liked'] = False
    
    # Получаем треки альбома с информацией о пользователе
    c.execute("""SELECT t.*, at.sort_order, u.nickname,
                    COALESCE(t.plays_count, 0) as plays_count,
                    COALESCE(t.likes_count, 0) as likes_count
                 FROM tracks t 
                 JOIN album_tracks at ON t.id = at.track_id 
                 JOIN users u ON t.user_id = u.id
                 WHERE at.album_id = ? AND t.hidden = 0 
                 ORDER BY at.sort_order ASC, t.id ASC""", (album['id'],))
    tracks = [dict(row) for row in c.fetchall()]
    
    # Проверяем лайки для треков
    for track in tracks:
        if current_user_id:
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track['id']))
            track['is_liked'] = c.fetchone() is not None
        else:
            track['is_liked'] = False
    
    conn.close()
    
    return render_template('unified.html', 
                          shared_album=album, 
                          album_tracks=tracks,
                          current_user=current_user,
                          page_title=album['title'],
                          mode='player')

@app.route('/user/<nickname>')
def user_library(nickname):
    """Публичная библиотека пользователя"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    c.execute("SELECT * FROM users WHERE nickname = ?", (nickname,))
    user = c.fetchone()
    if not user:
        return "User not found", 404
    
    user = dict(user)
    
    # Получаем треки пользователя
    c.execute("""SELECT * FROM tracks 
                 WHERE user_id = ? AND hidden = 0 
                 ORDER BY sort_order ASC, created_at DESC""", (user['id'],))
    tracks = [dict(row) for row in c.fetchall()]
    
    # Получаем альбомы пользователя
    c.execute("""SELECT * FROM albums 
                 WHERE user_id = ? AND hidden = 0 
                 ORDER BY created_at DESC""", (user['id'],))
    albums = [dict(row) for row in c.fetchall()]
    
    conn.close()
    return render_template('library.html', user=user, tracks=tracks, albums=albums)

# === API ROUTES ===

@app.route('/auth/browser/<token>')
def auth_browser(token):
    """Авторизация в браузере по токену"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Ищем токен и проверяем срок действия (10 минут)
    c.execute("SELECT telegram_id FROM auth_tokens WHERE token = ? AND expires_at > datetime('now')", (token,))
    row = c.fetchone()
    
    if not row:
        conn.close()
        return "Ссылка недействительна или устарела. Запросите новую в боте /login", 400
        
    telegram_id = row[0]
    
    # Ищем пользователя
    c.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
    user = c.fetchone()
    
    if not user:
        conn.close()
        return "Пользователь не найден. Сначала зайдите через Telegram Web App.", 404
        
    # Авторизуем
    session['user_id'] = user['id']
    session['telegram_id'] = telegram_id
    
    # Удаляем использованный токен
    c.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
    conn.commit()
    conn.close()
    
    return redirect('/app') # Перенаправляем в приложение

@app.route('/api/auth/telegram', methods=['POST'])
def auth_telegram():
    """Авторизация через Telegram Web App"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        init_data = data.get('initData', '')
        if not init_data:
            return jsonify({'error': 'No initData provided'}), 400
        
        print(f"Received initData length: {len(init_data)}")
        print(f"Received initData preview: {init_data[:100]}...")
        
        user_data = verify_telegram_webapp_data(init_data)
        if not user_data:
            print("Hash verification failed")
            return jsonify({'error': 'Invalid Telegram data hash'}), 401
        
        telegram_id = user_data.get('id')
        username = user_data.get('username', '')
        first_name = user_data.get('first_name', '')
        last_name = user_data.get('last_name', '')
        avatar_url = None
        if 'photo_url' in user_data:
            avatar_url = user_data['photo_url']
        
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        
        # Проверяем существующего пользователя
        c.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
        user = c.fetchone()
        
        if user:
            # Обновляем данные, включая nickname если его еще нет
            # Если у пользователя нет nickname, но есть username из Telegram - используем его
            current_nickname = user['nickname'] if user['nickname'] else ''
            if not current_nickname and username:
                current_nickname = username
            
            c.execute("""UPDATE users 
                         SET username = ?, first_name = ?, last_name = ?, avatar_url = ?, nickname = ?
                         WHERE telegram_id = ?""",
                      (username, first_name, last_name, avatar_url, current_nickname, telegram_id))
            user_id = user['id']
        else:
            # Создаем нового пользователя
            display_name = first_name
            if last_name:
                display_name += f" {last_name}"
            
            # Используем username как nickname по умолчанию
            nickname = username if username else None
            
            c.execute("""INSERT INTO users (telegram_id, username, first_name, last_name, avatar_url, display_name, nickname)
                         VALUES (?, ?, ?, ?, ?, ?, ?)""",
                      (telegram_id, username, first_name, last_name, avatar_url, display_name, nickname))
            user_id = c.lastrowid
        
        conn.commit()
        
        # Получаем обновленные данные
        c.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        user = dict(c.fetchone())
        conn.close()
        
        # Сохраняем в сессию
        session['user_id'] = user_id
        session['telegram_id'] = telegram_id
        
        print(f"User authenticated: {user_id}, telegram_id: {telegram_id}")
        return jsonify({'success': True, 'user': user})
    except Exception as e:
        print(f"Auth error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/auth/logout', methods=['POST'])
def logout():
    """Выход из системы"""
    session.clear()
    return jsonify({'success': True})

@app.route('/api/user/profile', methods=['GET'])
@login_required
def get_profile():
    """Получить профиль текущего пользователя"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id = ?", (session['user_id'],))
    user = c.fetchone()
    conn.close()
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    return jsonify(dict(user))

@app.route('/api/user/profile', methods=['PUT'])
@login_required
def update_profile():
    """Обновить профиль пользователя"""
    # Поддерживаем как JSON, так и FormData
    if request.content_type and 'application/json' in request.content_type:
        data = request.get_json()
        display_name = data.get('display_name', '').strip()
        nickname = data.get('nickname', '').strip().lower()
    else:
        display_name = request.form.get('display_name', '').strip()
        nickname = request.form.get('nickname', '').strip().lower()
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Проверяем уникальность nickname
    if nickname:
        c.execute("SELECT id FROM users WHERE nickname = ? AND id != ?", (nickname, session['user_id']))
        if c.fetchone():
            conn.close()
            return jsonify({'error': 'Nickname already taken'}), 400
    
    # Обработка аватара
    avatar_url = None
    if 'avatar' in request.files and request.files['avatar'].filename:
        avatar = request.files['avatar']
        if allowed_file(avatar.filename):
            avatar_filename = secure_filename(avatar.filename)
            avatar_filename = f"avatar_{session['user_id']}_{int(datetime.now().timestamp())}_{avatar_filename}"
            avatar.save(os.path.join(app.config['UPLOAD_FOLDER'], avatar_filename))
            avatar_url = f"/uploads/{avatar_filename}"
            
            # Удаляем старый аватар если был локальный (начинается с /uploads/)
            c.execute("SELECT avatar_url FROM users WHERE id = ?", (session['user_id'],))
            old_avatar = c.fetchone()[0]
            if old_avatar and old_avatar.startswith('/uploads/'):
                try:
                    old_path = os.path.join(app.config['UPLOAD_FOLDER'], old_avatar.split('/')[-1])
                    if os.path.exists(old_path):
                        os.remove(old_path)
                except Exception as e:
                    print(f"Error deleting old avatar: {e}")

    # Обновляем профиль
    query = "UPDATE users SET display_name = ?"
    params = [display_name]
    
    if nickname:
        query += ", nickname = ?"
        params.append(nickname)
    
    if avatar_url:
        query += ", avatar_url = ?"
        params.append(avatar_url)
        
    query += " WHERE id = ?"
    params.append(session['user_id'])
    
    c.execute(query, params)
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/tracks', methods=['GET'])
def get_tracks():
    """Получить треки"""
    show_hidden = request.args.get('show_hidden', 'false').lower() == 'true'
    user_id = request.args.get('user_id', type=int)
    track_id = request.args.get('id', type=int)  # Поддержка фильтрации по ID
    current_user_id = session.get('user_id')
    
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    # Если запрашивается конкретный трек по ID
    if track_id:
        if show_hidden and 'user_id' in session and user_id and user_id == session['user_id']:
            c.execute("""SELECT t.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(t.plays_count, 0) as plays_count,
                        COALESCE(t.likes_count, 0) as likes_count
                         FROM tracks t 
                         JOIN users u ON t.user_id = u.id 
                         WHERE t.id = ? AND t.user_id = ?""", (track_id, user_id))
        else:
            c.execute("""SELECT t.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(t.plays_count, 0) as plays_count,
                        COALESCE(t.likes_count, 0) as likes_count
                         FROM tracks t 
                         JOIN users u ON t.user_id = u.id 
                         WHERE t.id = ? AND t.hidden = 0""", (track_id,))
        
        track = c.fetchone()
        conn.close()
        
        if not track:
            return jsonify([]), 200
        
        track_dict = dict(track)
        
        # Проверяем лайк текущего пользователя
        if current_user_id:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track_id))
            track_dict['is_liked'] = c.fetchone() is not None
            conn.close()
        else:
            track_dict['is_liked'] = False
        
        return jsonify([track_dict])
    
    if show_hidden and 'user_id' in session:
        # Показываем скрытые только свои треки
        if user_id and user_id == session['user_id']:
            c.execute("""SELECT t.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(t.plays_count, 0) as plays_count,
                        COALESCE(t.likes_count, 0) as likes_count
                         FROM tracks t 
                         JOIN users u ON t.user_id = u.id 
                         WHERE t.user_id = ? 
                         ORDER BY COALESCE(t.sort_order, 999999) ASC, t.id ASC""", (user_id,))
        else:
            c.execute("""SELECT t.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(t.plays_count, 0) as plays_count,
                        COALESCE(t.likes_count, 0) as likes_count
                         FROM tracks t 
                         JOIN users u ON t.user_id = u.id 
                         WHERE t.hidden = 0 
                         ORDER BY COALESCE(t.sort_order, 999999) ASC, t.id ASC""")
    else:
        query = """SELECT t.*, u.nickname, u.display_name, u.avatar_url,
                  COALESCE(t.plays_count, 0) as plays_count,
                  COALESCE(t.likes_count, 0) as likes_count
                   FROM tracks t 
                   JOIN users u ON t.user_id = u.id 
                   WHERE t.hidden = 0"""
        params = []
        if user_id:
            query += " AND t.user_id = ?"
            params.append(user_id)
        query += " ORDER BY COALESCE(t.sort_order, 999999) ASC, t.id ASC"
        c.execute(query, params)
    
    tracks = []
    for row in c.fetchall():
        track = dict(row)
        # Проверяем лайкнул ли текущий пользователь
        if current_user_id:
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track['id']))
            track['is_liked'] = c.fetchone() is not None
        else:
            track['is_liked'] = False
        tracks.append(track)
    
    conn.close()
    return jsonify(tracks)

@app.route('/api/tracks', methods=['POST'])
@login_required
def upload_track():
    """Загрузить новый трек"""
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file'}), 400
    
    audio = request.files['audio']
    cover = request.files.get('cover')
    title = request.form.get('title', '')
    artist = request.form.get('artist', '')
    lyrics = request.form.get('lyrics', '')
    slug = request.form.get('slug', '').strip() or None

    if audio and allowed_file(audio.filename):
        import uuid
        ext = audio.filename.rsplit('.', 1)[1].lower()
        # Генерируем UUID имя файла чтобы избежать проблем с кодировкой
        audio_filename = f"{session['user_id']}_{int(datetime.now().timestamp())}_{uuid.uuid4().hex}.{ext}"
        audio_path = os.path.join(app.config['UPLOAD_FOLDER'], audio_filename)
        audio.save(audio_path)
        
        cover_filename = None
        if cover and allowed_file(cover.filename):
            cover_ext = cover.filename.rsplit('.', 1)[1].lower()
            cover_filename = f"{session['user_id']}_{int(datetime.now().timestamp())}_{uuid.uuid4().hex}.{cover_ext}"
            cover.save(os.path.join(app.config['UPLOAD_FOLDER'], cover_filename))
        elif MUTAGEN_AVAILABLE and audio_filename.lower().endswith('.mp3'):
            # Пробуем извлечь обложку из MP3
            try:
                try:
                    audio_meta = MP3(audio_path, ID3=ID3)
                except ID3NoHeaderError:
                    audio_meta = MP3(audio_path)
                
                if audio_meta.tags:
                    apic = None
                    if 'APIC:' in audio_meta.tags:
                        apic = audio_meta.tags['APIC:']
                    elif 'APIC' in audio_meta.tags:
                        apic = audio_meta.tags['APIC']
                    else:
                        for key in audio_meta.tags.keys():
                            if key.startswith('APIC'):
                                apic = audio_meta.tags[key]
                                break
                    
                    if apic:
                        apic_data = None
                        if hasattr(apic, 'data'):
                            apic_data = apic.data
                        elif isinstance(apic, list) and len(apic) > 0:
                            apic_data = apic[0].data if hasattr(apic[0], 'data') else None
                        
                        if apic_data:
                            mime = getattr(apic, 'mime', 'image/jpeg') if hasattr(apic, 'mime') else 'image/jpeg'
                            if isinstance(apic, list) and len(apic) > 0 and hasattr(apic[0], 'mime'):
                                mime = apic[0].mime
                            
                            ext = '.jpg'
                            if 'png' in mime.lower():
                                ext = '.png'
                            elif 'gif' in mime.lower():
                                ext = '.gif'
                            elif 'webp' in mime.lower():
                                ext = '.webp'
                            
                            cover_filename = audio_filename.rsplit('.', 1)[0] + ext
                            cover_path = os.path.join(app.config['UPLOAD_FOLDER'], cover_filename)
                            with open(cover_path, 'wb') as f:
                                f.write(apic_data)
            except Exception as e:
                print(f"Error extracting cover from MP3: {e}")
        
        if not title:
            title = audio_filename.rsplit('.', 1)[0]

        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        try:
            c.execute("SELECT MAX(sort_order) FROM tracks WHERE user_id = ?", (session['user_id'],))
            max_order = c.fetchone()[0] or 0
            c.execute("""INSERT INTO tracks (user_id, title, artist, filename, cover_filename, lyrics, sort_order, hidden, slug) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)""",
                      (session['user_id'], title, artist, audio_filename, cover_filename or '', lyrics, max_order + 1, slug))
            conn.commit()
            track_id = c.lastrowid
            conn.close()
            return jsonify({'success': True, 'id': track_id})
        except sqlite3.IntegrityError:
            conn.close()
            return jsonify({'error': 'Slug already exists'}), 400
    
    return jsonify({'error': 'Invalid files'}), 400

@app.route('/api/tracks/<int:track_id>', methods=['PUT'])
@login_required
def update_track(track_id):
    """Обновить трек"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Проверяем владельца
    c.execute("SELECT * FROM tracks WHERE id = ?", (track_id,))
    track = c.fetchone()
    if not track:
        conn.close()
        return jsonify({'error': 'Track not found'}), 404
    
    if track[1] != session['user_id']:  # user_id в индексе 1
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    title = request.form.get('title')
    artist = request.form.get('artist')
    lyrics = request.form.get('lyrics')
    slug = request.form.get('slug', '').strip() or None
    
    audio_filename = None
    if 'audio' in request.files and request.files['audio'].filename:
        audio = request.files['audio']
        if allowed_file(audio.filename):
            import uuid
            ext = audio.filename.rsplit('.', 1)[1].lower()
            audio_filename = f"{session['user_id']}_{int(datetime.now().timestamp())}_{uuid.uuid4().hex}.{ext}"
            audio.save(os.path.join(app.config['UPLOAD_FOLDER'], audio_filename))
            # Cleanup old
            if track[3]:  # filename в индексе 3
                old_path = os.path.join(app.config['UPLOAD_FOLDER'], track[3])
                if os.path.exists(old_path):
                    os.remove(old_path)
    
    cover_filename = None
    if 'cover' in request.files and request.files['cover'].filename:
        cover = request.files['cover']
        if allowed_file(cover.filename):
            import uuid
            cover_ext = cover.filename.rsplit('.', 1)[1].lower()
            cover_filename = f"{session['user_id']}_{int(datetime.now().timestamp())}_{uuid.uuid4().hex}.{cover_ext}"
            cover.save(os.path.join(app.config['UPLOAD_FOLDER'], cover_filename))
            # Cleanup old
            if track[4]:  # cover_filename в индексе 4
                old_path = os.path.join(app.config['UPLOAD_FOLDER'], track[4])
                if os.path.exists(old_path):
                    os.remove(old_path)
    
    query = "UPDATE tracks SET title=?, artist=?, lyrics=?, slug=?"
    params = [title, artist, lyrics, slug]
    
    if audio_filename:
        query += ", filename=?"
        params.append(audio_filename)
    if cover_filename:
        query += ", cover_filename=?"
        params.append(cover_filename)
        
    query += " WHERE id=?"
    params.append(track_id)
    
    try:
        c.execute(query, params)
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Slug already exists'}), 400

@app.route('/api/tracks/<int:track_id>', methods=['DELETE'])
@login_required
def delete_track(track_id):
    """Удалить трек"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT user_id, filename, cover_filename FROM tracks WHERE id = ?", (track_id,))
    track = c.fetchone()
    
    if not track:
        conn.close()
        return jsonify({'error': 'Track not found'}), 404
    
    if track[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    # Удаляем файлы
    if track[1] and os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], track[1])):
        os.remove(os.path.join(app.config['UPLOAD_FOLDER'], track[1]))
    if track[2] and os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], track[2])):
        os.remove(os.path.join(app.config['UPLOAD_FOLDER'], track[2]))
    
    c.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/tracks/<int:track_id>/toggle-visibility', methods=['POST'])
@login_required
def toggle_track_visibility(track_id):
    """Переключить видимость трека"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT user_id FROM tracks WHERE id = ?", (track_id,))
    track = c.fetchone()
    
    if not track or track[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.get_json() or {}
    hidden = 1 if data.get('hidden') else 0
    c.execute("UPDATE tracks SET hidden = ? WHERE id = ?", (hidden, track_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/tracks/<int:track_id>/play', methods=['POST'])
def count_play(track_id):
    """Увеличить счетчик прослушиваний"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Обновляем общий счетчик трека
    c.execute("UPDATE tracks SET plays_count = COALESCE(plays_count, 0) + 1 WHERE id = ?", (track_id,))
    
    # Записываем прослушивание пользователем (если авторизован)
    current_user_id = session.get('user_id')
    if current_user_id:
        c.execute("""INSERT INTO track_plays (user_id, track_id, play_count, last_played_at) 
                     VALUES (?, ?, 1, datetime('now'))
                     ON CONFLICT(user_id, track_id) DO UPDATE SET 
                     play_count = play_count + 1,
                     last_played_at = datetime('now')""", (current_user_id, track_id))
    
    conn.commit()
    c.execute("SELECT COALESCE(plays_count, 0) as plays_count FROM tracks WHERE id = ?", (track_id,))
    count = c.fetchone()[0] or 0
    conn.close()
    return jsonify({'success': True, 'plays_count': count})

@app.route('/api/tracks/<int:track_id>/like', methods=['GET', 'POST'])
def toggle_like(track_id):
    """Получить или изменить статус лайка трека"""
    if request.method == 'GET':
        # Получить статус лайка
        current_user_id = session.get('user_id')
        liked = False
        if current_user_id:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track_id))
            liked = c.fetchone() is not None
            conn.close()
        
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT COALESCE(likes_count, 0) as likes_count FROM tracks WHERE id = ?", (track_id,))
        count = c.fetchone()[0] or 0
        conn.close()
        
        return jsonify({'success': True, 'liked': liked, 'likes_count': count})
    
    # POST - переключить лайк
    if 'user_id' not in session:
        # Возвращаем более информативную ошибку с ссылкой на бота
        bot_username = 'swagplayerobot'  # Username бота
        bot_url = f'https://t.me/{bot_username}?start=auth'
        return jsonify({
            'error': 'Unauthorized',
            'message': 'Для того чтобы ставить лайки, пожалуйста, авторизуйтесь.',
            'auth_url': bot_url
        }), 401
    
    user_id = session.get('user_id')
    if not user_id:
        bot_username = 'swagplayerobot'  # Username бота
        bot_url = f'https://t.me/{bot_username}?start=auth'
        return jsonify({
            'error': 'Auth required',
            'message': 'Для того чтобы ставить лайки, пожалуйста, авторизуйтесь.',
            'auth_url': bot_url
        }), 401
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Проверяем лайк пользователя
    c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (user_id, track_id))
    like = c.fetchone()
    
    if like:
        # Удаляем лайк
        c.execute("DELETE FROM likes WHERE id = ?", (like[0],))
        c.execute("UPDATE tracks SET likes_count = COALESCE(likes_count, 0) - 1 WHERE id = ?", (track_id,))
        liked = False
    else:
        # Добавляем лайк
        c.execute("INSERT INTO likes (user_id, track_id) VALUES (?, ?)", (user_id, track_id))
        c.execute("UPDATE tracks SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = ?", (track_id,))
        liked = True
    
    conn.commit()
    
    # Получаем актуальное количество
    c.execute("SELECT COALESCE(likes_count, 0) as likes_count FROM tracks WHERE id = ?", (track_id,))
    count = c.fetchone()[0] or 0
    
    conn.close()
    return jsonify({'success': True, 'liked': liked, 'likes_count': count})

@app.route('/api/albums/<int:album_id>/play', methods=['POST'])
def count_album_play(album_id):
    """Увеличить счетчик прослушиваний альбома"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("UPDATE albums SET plays_count = COALESCE(plays_count, 0) + 1 WHERE id = ?", (album_id,))
    conn.commit()
    c.execute("SELECT COALESCE(plays_count, 0) as plays_count FROM albums WHERE id = ?", (album_id,))
    count = c.fetchone()[0] or 0
    conn.close()
    return jsonify({'success': True, 'plays_count': count})

@app.route('/api/albums/<int:album_id>/like', methods=['POST'])
@login_required
def toggle_album_like(album_id):
    """Лайк/дизлайк альбома"""
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Auth required'}), 401
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    try:
        # Проверяем существование альбома
        c.execute("SELECT id FROM albums WHERE id = ?", (album_id,))
        if not c.fetchone():
            conn.close()
            return jsonify({'error': 'Album not found'}), 404
        
        # Проверяем лайк пользователя
        c.execute("SELECT id FROM album_likes WHERE user_id = ? AND album_id = ?", (user_id, album_id))
        like = c.fetchone()
        
        if like:
            # Удаляем лайк
            c.execute("DELETE FROM album_likes WHERE id = ?", (like[0],))
            # Обновляем счетчик с защитой от отрицательных значений
            c.execute("UPDATE albums SET likes_count = CASE WHEN COALESCE(likes_count, 0) > 0 THEN likes_count - 1 ELSE 0 END WHERE id = ?", (album_id,))
            liked = False
        else:
            # Добавляем лайк (с защитой от дубликатов)
            try:
                c.execute("INSERT INTO album_likes (user_id, album_id) VALUES (?, ?)", (user_id, album_id))
                c.execute("UPDATE albums SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = ?", (album_id,))
                liked = True
            except sqlite3.IntegrityError:
                # Если дубликат (не должно произойти, но на всякий случай)
                conn.rollback()
                conn.close()
                return jsonify({'error': 'Like already exists'}), 400
        
        conn.commit()
        
        # Получаем актуальное количество (пересчитываем из таблицы лайков для надежности)
        c.execute("SELECT COUNT(*) FROM album_likes WHERE album_id = ?", (album_id,))
        actual_count = c.fetchone()[0] or 0
        
        # Синхронизируем счетчик в таблице альбомов
        c.execute("UPDATE albums SET likes_count = ? WHERE id = ?", (actual_count, album_id))
        conn.commit()
        
        conn.close()
        return jsonify({'success': True, 'liked': liked, 'likes_count': actual_count})
    except Exception as e:
        conn.rollback()
        conn.close()
        print(f"Error toggling album like: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# Альбомы API
@app.route('/api/albums', methods=['GET'])
def get_albums():
    """Получить альбомы"""
    user_id = request.args.get('user_id', type=int)
    current_user_id = session.get('user_id')
    
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    query = """SELECT a.*, u.nickname, u.display_name, u.avatar_url,
              COALESCE(a.plays_count, 0) as plays_count,
              COALESCE(a.likes_count, 0) as likes_count
               FROM albums a 
               JOIN users u ON a.user_id = u.id 
               WHERE a.hidden = 0"""
    params = []
    if user_id:
        query += " AND a.user_id = ?"
        params.append(user_id)
    query += " ORDER BY a.is_pinned DESC, a.created_at DESC"
    c.execute(query, params)
    
    albums = []
    for row in c.fetchall():
        album = dict(row)
        # Проверяем лайкнул ли текущий пользователь
        if current_user_id:
            c.execute("SELECT id FROM album_likes WHERE user_id = ? AND album_id = ?", (current_user_id, album['id']))
            album['is_liked'] = c.fetchone() is not None
        else:
            album['is_liked'] = False
        albums.append(album)
    
    conn.close()
    return jsonify(albums)
    """Получить альбомы"""
    user_id = request.args.get('user_id', type=int)
    
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    query = """SELECT a.*, u.nickname, u.display_name, u.avatar_url 
               FROM albums a 
               JOIN users u ON a.user_id = u.id 
               WHERE a.hidden = 0"""
    params = []
    if user_id:
        query += " AND a.user_id = ?"
        params.append(user_id)
    query += " ORDER BY a.created_at DESC"
    c.execute(query, params)
    
    albums = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify(albums)

@app.route('/api/albums', methods=['POST'])
@login_required
def create_album():
    """Создать альбом"""
    # Поддерживаем как JSON, так и FormData
    if request.content_type and 'application/json' in request.content_type:
        data = request.get_json()
        title = data.get('title', '').strip()
        description = data.get('description', '').strip()
        slug = data.get('slug', '').strip() or None
    else:
        title = request.form.get('title', '').strip()
        description = request.form.get('description', '').strip()
        slug = request.form.get('slug', '').strip() or None
    
    if not title:
        return jsonify({'error': 'Title is required'}), 400
    
    cover_filename = None
    if 'cover' in request.files and request.files['cover'].filename:
        cover = request.files['cover']
        if allowed_file(cover.filename):
            cover_filename = secure_filename(cover.filename)
            cover_filename = f"{session['user_id']}_{int(datetime.now().timestamp())}_{cover_filename}"
            cover.save(os.path.join(app.config['UPLOAD_FOLDER'], cover_filename))
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    try:
        c.execute("""INSERT INTO albums (user_id, title, description, slug, cover_filename) 
                     VALUES (?, ?, ?, ?, ?)""",
                  (session['user_id'], title, description, slug, cover_filename))
        conn.commit()
        album_id = c.lastrowid
        conn.close()
        return jsonify({'success': True, 'id': album_id, 'album_id': album_id})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Slug already exists'}), 400

@app.route('/api/albums/<int:album_id>', methods=['PUT'])
@login_required
def update_album(album_id):
    """Обновить альбом"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT user_id FROM albums WHERE id = ?", (album_id,))
    album = c.fetchone()
    
    if not album or album[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    # Поддерживаем как JSON, так и FormData
    if request.content_type and 'application/json' in request.content_type:
        data = request.get_json()
        title = data.get('title', '').strip()
        description = data.get('description', '').strip()
        slug = data.get('slug', '').strip() or None
    else:
        title = request.form.get('title', '').strip()
        description = request.form.get('description', '').strip()
        slug = request.form.get('slug', '').strip() or None
    
    cover_filename = None
    if 'cover' in request.files and request.files['cover'].filename:
        cover = request.files['cover']
        if allowed_file(cover.filename):
            import uuid
            cover_ext = cover.filename.rsplit('.', 1)[1].lower()
            cover_filename = f"{session['user_id']}_{int(datetime.now().timestamp())}_{uuid.uuid4().hex}.{cover_ext}"
            cover.save(os.path.join(app.config['UPLOAD_FOLDER'], cover_filename))
            # Удаляем старую обложку
            c.execute("SELECT cover_filename FROM albums WHERE id = ?", (album_id,))
            old_cover = c.fetchone()
            if old_cover and old_cover[0]:
                old_path = os.path.join(app.config['UPLOAD_FOLDER'], old_cover[0])
                if os.path.exists(old_path):
                    os.remove(old_path)
    
    try:
        if cover_filename:
            c.execute("UPDATE albums SET title=?, description=?, slug=?, cover_filename=? WHERE id=?",
                      (title, description, slug, cover_filename, album_id))
        else:
            c.execute("UPDATE albums SET title=?, description=?, slug=? WHERE id=?",
                      (title, description, slug, album_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Slug already exists'}), 400

@app.route('/api/albums/<int:album_id>', methods=['DELETE'])
@login_required
def delete_album(album_id):
    """Удалить альбом"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT user_id FROM albums WHERE id = ?", (album_id,))
    album = c.fetchone()
    
    if not album or album[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    c.execute("DELETE FROM albums WHERE id = ?", (album_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/albums/<int:album_id>/tracks', methods=['POST'])
@login_required
def add_track_to_album(album_id):
    """Добавить трек в альбом"""
    data = request.get_json()
    track_id = data.get('track_id')
    
    if not track_id:
        return jsonify({'error': 'track_id is required'}), 400
    
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Проверяем владельца альбома
    c.execute("SELECT user_id FROM albums WHERE id = ?", (album_id,))
    album = c.fetchone()
    if not album or album[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    # Проверяем владельца трека
    c.execute("SELECT user_id FROM tracks WHERE id = ?", (track_id,))
    track = c.fetchone()
    if not track or track[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    try:
        c.execute("SELECT MAX(sort_order) FROM album_tracks WHERE album_id = ?", (album_id,))
        max_order = c.fetchone()[0] or 0
        c.execute("INSERT INTO album_tracks (album_id, track_id, sort_order) VALUES (?, ?, ?)",
                  (album_id, track_id, max_order + 1))
        conn.commit()
        conn.close()
        return jsonify({'success': True})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Track already in album'}), 400

@app.route('/api/albums/<int:album_id>/tracks/<int:track_id>', methods=['DELETE'])
@login_required
def remove_track_from_album(album_id, track_id):
    """Удалить трек из альбома"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT user_id FROM albums WHERE id = ?", (album_id,))
    album = c.fetchone()
    
    if not album or album[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    c.execute("DELETE FROM album_tracks WHERE album_id = ? AND track_id = ?", (album_id, track_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/albums/<int:album_id>/tracks/<int:track_id>/move', methods=['POST'])
@login_required
def move_track_in_album(album_id, track_id):
    """Переместить трек в альбоме (вверх/вниз)"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT user_id FROM albums WHERE id = ?", (album_id,))
    album = c.fetchone()
    
    if not album or album[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    data = request.get_json() or {}
    direction = data.get('direction', 'down')  # 'up' or 'down'
    
    # Получаем текущий sort_order
    c.execute("SELECT sort_order FROM album_tracks WHERE album_id = ? AND track_id = ?", (album_id, track_id))
    current = c.fetchone()
    if not current:
        conn.close()
        return jsonify({'error': 'Track not in album'}), 404
    
    current_order = current[0]
    
    if direction == 'up':
        # Находим трек с меньшим sort_order
        c.execute("""SELECT track_id, sort_order FROM album_tracks 
                     WHERE album_id = ? AND sort_order < ? 
                     ORDER BY sort_order DESC LIMIT 1""", (album_id, current_order))
        prev_track = c.fetchone()
        if prev_track:
            # Меняем местами
            c.execute("UPDATE album_tracks SET sort_order = ? WHERE album_id = ? AND track_id = ?", 
                     (prev_track[1], album_id, track_id))
            c.execute("UPDATE album_tracks SET sort_order = ? WHERE album_id = ? AND track_id = ?", 
                     (current_order, album_id, prev_track[0]))
    else:  # down
        # Находим трек с большим sort_order
        c.execute("""SELECT track_id, sort_order FROM album_tracks 
                     WHERE album_id = ? AND sort_order > ? 
                     ORDER BY sort_order ASC LIMIT 1""", (album_id, current_order))
        next_track = c.fetchone()
        if next_track:
            # Меняем местами
            c.execute("UPDATE album_tracks SET sort_order = ? WHERE album_id = ? AND track_id = ?", 
                     (next_track[1], album_id, track_id))
            c.execute("UPDATE album_tracks SET sort_order = ? WHERE album_id = ? AND track_id = ?", 
                     (current_order, album_id, next_track[0]))
    
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/albums/<int:album_id>/tracks', methods=['GET'])
def get_album_tracks(album_id):
    """Получить треки альбома"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""SELECT t.*, at.sort_order 
                 FROM tracks t 
                 JOIN album_tracks at ON t.id = at.track_id 
                 WHERE at.album_id = ? AND t.hidden = 0 
                 ORDER BY at.sort_order ASC, t.id ASC""", (album_id,))
    tracks = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify(tracks)

@app.route('/api/album/<album_identifier>')
def api_get_album(album_identifier):
    """API: Получить альбом с треками"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    if album_identifier.isdigit():
        c.execute("""SELECT a.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(a.plays_count, 0) as plays_count,
                        COALESCE(a.likes_count, 0) as likes_count
                     FROM albums a 
                     JOIN users u ON a.user_id = u.id 
                     WHERE a.id = ? AND a.hidden = 0""", (int(album_identifier),))
    else:
        c.execute("""SELECT a.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(a.plays_count, 0) as plays_count,
                        COALESCE(a.likes_count, 0) as likes_count
                     FROM albums a 
                     JOIN users u ON a.user_id = u.id 
                     WHERE a.slug = ? AND a.hidden = 0""", (album_identifier,))
    
    album = c.fetchone()
    if not album:
        conn.close()
        return jsonify({'error': 'Album not found'}), 404
    
    album = dict(album)
    
    # Проверяем лайк текущего пользователя
    current_user_id = session.get('user_id')
    if current_user_id:
        c.execute("SELECT id FROM album_likes WHERE user_id = ? AND album_id = ?", (current_user_id, album['id']))
        album['is_liked'] = c.fetchone() is not None
    else:
        album['is_liked'] = False
    
    # Получаем треки альбома
    c.execute("""SELECT t.*, at.sort_order, u.nickname,
                    COALESCE(t.plays_count, 0) as plays_count,
                    COALESCE(t.likes_count, 0) as likes_count
                 FROM tracks t 
                 JOIN album_tracks at ON t.id = at.track_id 
                 JOIN users u ON t.user_id = u.id
                 WHERE at.album_id = ? AND t.hidden = 0 
                 ORDER BY at.sort_order ASC, t.id ASC""", (album['id'],))
    tracks = [dict(row) for row in c.fetchall()]
    
    # Проверяем лайки для треков
    for track in tracks:
        if current_user_id:
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track['id']))
            track['is_liked'] = c.fetchone() is not None
        else:
            track['is_liked'] = False
    
    conn.close()
    return jsonify({'album': album, 'tracks': tracks})

# Админка
@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    """Страница входа в админку"""
    if request.method == 'POST':
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT * FROM admins WHERE username = ?", (username,))
        admin = c.fetchone()
        conn.close()
        
        if admin and check_password_hash(admin[2], password):
            session['admin'] = True
            session['admin_username'] = username
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Invalid credentials'}), 401
    
    return render_template('admin_login.html')

@app.route('/admin')
@admin_required
def admin():
    """Админ панель"""
    return render_template('admin_new.html')

@app.route('/admin/logout', methods=['POST'])
def admin_logout():
    """Выход из админки"""
    session.pop('admin', None)
    session.pop('admin_username', None)
    return jsonify({'success': True})

@app.route('/admin/api/tracks', methods=['GET'])
@admin_required
def admin_get_tracks():
    """Получить все треки для админки"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""SELECT t.*, u.nickname, u.display_name,
                 GROUP_CONCAT(a.title, ', ') as album_names
                 FROM tracks t 
                 JOIN users u ON t.user_id = u.id 
                 LEFT JOIN album_tracks at ON t.id = at.track_id
                 LEFT JOIN albums a ON at.album_id = a.id
                 GROUP BY t.id
                 ORDER BY t.is_pinned DESC, t.created_at DESC""")
    tracks = []
    for row in c.fetchall():
        track = dict(row)
        track['is_pinned'] = bool(track.get('is_pinned', 0))
        tracks.append(track)
    conn.close()
    return jsonify(tracks)

@app.route('/admin/api/albums', methods=['GET'])
@admin_required
def admin_get_albums():
    """Получить все альбомы для админки"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""SELECT a.*, u.nickname, u.display_name 
                 FROM albums a 
                 JOIN users u ON a.user_id = u.id 
                 ORDER BY a.is_pinned DESC, a.created_at DESC""")
    albums = []
    for row in c.fetchall():
        album = dict(row)
        album['is_pinned'] = bool(album.get('is_pinned', 0))
        albums.append(album)
    conn.close()
    return jsonify(albums)

@app.route('/admin/api/albums/<int:album_id>/toggle-visibility', methods=['POST'])
@admin_required
def admin_toggle_album_visibility(album_id):
    """Скрыть/показать альбом (админ)"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    data = request.get_json() or {}
    hidden = 1 if data.get('hidden') else 0
    c.execute("UPDATE albums SET hidden = ? WHERE id = ?", (hidden, album_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/api/users', methods=['GET'])
@admin_required
def admin_get_users():
    """Получить всех пользователей для админки"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("""SELECT * FROM users ORDER BY created_at DESC""")
    users = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify(users)

@app.route('/admin/api/albums/<int:album_id>', methods=['DELETE'])
@admin_required
def admin_delete_album(album_id):
    """Удалить альбом (админ)"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT cover_filename FROM albums WHERE id = ?", (album_id,))
    album = c.fetchone()
    
    if not album:
        conn.close()
        return jsonify({'error': 'Album not found'}), 404
    
    # Удаляем обложку если есть
    if album[0] and os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], album[0])):
        os.remove(os.path.join(app.config['UPLOAD_FOLDER'], album[0]))
    
    c.execute("DELETE FROM albums WHERE id = ?", (album_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/api/tracks/<int:track_id>/toggle-visibility', methods=['POST'])
@admin_required
def admin_toggle_track_visibility(track_id):
    """Скрыть/показать трек (админ)"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    data = request.get_json() or {}
    hidden = 1 if data.get('hidden') else 0
    c.execute("UPDATE tracks SET hidden = ? WHERE id = ?", (hidden, track_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/api/tracks/<int:track_id>', methods=['DELETE'])
@admin_required
def admin_delete_track(track_id):
    """Удалить трек (админ)"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT filename, cover_filename FROM tracks WHERE id = ?", (track_id,))
    track = c.fetchone()
    
    if not track:
        conn.close()
        return jsonify({'error': 'Track not found'}), 404
    
    # Удаляем файлы
    if track[0] and os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], track[0])):
        os.remove(os.path.join(app.config['UPLOAD_FOLDER'], track[0]))
    if track[1] and os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], track[1])):
        os.remove(os.path.join(app.config['UPLOAD_FOLDER'], track[1]))
    
    c.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/tracks/<int:track_id>/pin', methods=['POST'])
@admin_required
def toggle_track_pin(track_id):
    """Закрепить/открепить трек (админ)"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    data = request.get_json() or {}
    is_pinned = 1 if data.get('is_pinned') else 0
    
    c.execute("UPDATE tracks SET is_pinned = ? WHERE id = ?", (is_pinned, track_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'is_pinned': bool(is_pinned)})

@app.route('/api/albums/<int:album_id>/pin', methods=['POST'])
@admin_required
def toggle_album_pin(album_id):
    """Закрепить/открепить альбом (админ)"""
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    data = request.get_json() or {}
    is_pinned = 1 if data.get('is_pinned') else 0
    
    c.execute("UPDATE albums SET is_pinned = ? WHERE id = ?", (is_pinned, album_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'is_pinned': bool(is_pinned)})

# Статические файлы
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    """Отдача загруженных файлов"""
    try:
        upload_folder = app.config['UPLOAD_FOLDER']
        file_path = os.path.join(upload_folder, filename)
        
        # Проверяем существование файла
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            return "File not found", 404
        
        # Определяем MIME тип
        mime_type = None
        if filename.lower().endswith(('.jpg', '.jpeg')):
            mime_type = 'image/jpeg'
        elif filename.lower().endswith('.png'):
            mime_type = 'image/png'
        elif filename.lower().endswith('.mp3'):
            mime_type = 'audio/mpeg'
        elif filename.lower().endswith('.wav'):
            mime_type = 'audio/wav'
        elif filename.lower().endswith('.ogg'):
            mime_type = 'audio/ogg'
        
        response = send_from_directory(upload_folder, filename)
        if mime_type:
            response.headers['Content-Type'] = mime_type
        
        # CORS headers
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        
        return response
    except Exception as e:
        print(f"Error serving file {filename}: {e}")
        import traceback
        traceback.print_exc()
        return f"Error serving file: {str(e)}", 500

@app.route('/static/<path:filename>')
def static_file(filename):
    return send_from_directory('static', filename)

@app.route('/favicon.ico')
def favicon():
    return '', 204

@app.route('/api/extract-metadata', methods=['POST'])
def extract_metadata():
    """Извлечь метаданные из аудио файла"""
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file'}), 400
    
    audio_file = request.files['audio']
    if not audio_file or not allowed_file(audio_file.filename):
        return jsonify({'error': 'Invalid file'}), 400
    
    result = {'title': '', 'artist': '', 'cover': ''}
    
    if MUTAGEN_AVAILABLE and audio_file.filename.lower().endswith('.mp3'):
        try:
            temp_path = os.path.join(app.config['UPLOAD_FOLDER'], 'temp_' + secure_filename(audio_file.filename))
            audio_file.save(temp_path)
            
            try:
                try:
                    audio = MP3(temp_path, ID3=ID3)
                except ID3NoHeaderError:
                    audio = MP3(temp_path)
                
                if audio.tags:
                    if 'TIT2' in audio.tags:
                        result['title'] = str(audio.tags['TIT2'][0])
                    if 'TPE1' in audio.tags:
                        result['artist'] = str(audio.tags['TPE1'][0])
                    
                    apic = None
                    if 'APIC:' in audio.tags:
                        apic = audio.tags['APIC:']
                    elif 'APIC' in audio.tags:
                        apic = audio.tags['APIC']
                    else:
                        for key in audio.tags.keys():
                            if key.startswith('APIC'):
                                apic = audio.tags[key]
                                break
                    
                    if apic:
                        apic_data = None
                        if hasattr(apic, 'data'):
                            apic_data = apic.data
                            mime = getattr(apic, 'mime', 'image/jpeg')
                        elif isinstance(apic, list) and len(apic) > 0:
                            apic_data = apic[0].data if hasattr(apic[0], 'data') else None
                            mime = getattr(apic[0], 'mime', 'image/jpeg') if hasattr(apic[0], 'mime') else 'image/jpeg'
                        
                        if apic_data:
                            cover_base64 = base64.b64encode(apic_data).decode('utf-8')
                            result['cover'] = f'data:{mime};base64,{cover_base64}'
            except Exception as e:
                print(f"Error extracting metadata: {e}")
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        except Exception as e:
            print(f"Error processing file: {e}")
            pass
    
    return jsonify(result)

if __name__ == '__main__':
    # Для production используйте: app.run(debug=False, port=5024, host='127.0.0.1')
    # Для разработки: app.run(debug=True, port=5024, host='127.0.0.1')
    debug_mode = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'
    app.run(debug=debug_mode, port=5024, host='127.0.0.1')
