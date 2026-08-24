import os
import sqlite3
import base64
import hashlib
import hmac
import json
import mimetypes
import re
import time
import urllib.parse
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, render_template, request, jsonify, send_from_directory, redirect, url_for, session, Response
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.middleware.proxy_fix import ProxyFix

try:
    from mutagen.mp3 import MP3
    from mutagen.id3 import ID3NoHeaderError
    from mutagen.id3 import ID3, TIT2, TPE1, APIC
    from mutagen import File as MutagenFile
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'change-me-in-production')

# nginx → flask: trust X-Forwarded-* so request.is_secure works correctly
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Eternal sessions + secure cookies
app.config.update(
    PERMANENT_SESSION_LIFETIME=timedelta(days=3650),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=True,
    SESSION_REFRESH_EACH_REQUEST=True,
)

# Whitelist of Telegram user IDs who can access /app (track management).
# Set ADMIN_TELEGRAM_IDS as a comma-separated list of numeric IDs.
ADMIN_TELEGRAM_IDS = {int(x) for x in os.environ.get('ADMIN_TELEGRAM_IDS', '').split(',') if x.strip().isdigit()}

def is_admin_session():
    """True if current session is the artist/admin (Telegram or panel admin)."""
    return session.get('telegram_id') in ADMIN_TELEGRAM_IDS or bool(session.get('admin'))

# Настройки
UPLOAD_FOLDER = 'uploads'
DB_FILE = 'music.db'
ALLOWED_EXTENSIONS = {'mp3', 'wav', 'ogg', 'jpg', 'jpeg', 'png'}
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'YOUR_BOT_TOKEN')

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
AVATAR_FOLDER = os.path.join(UPLOAD_FOLDER, 'avatars')
os.makedirs(AVATAR_FOLDER, exist_ok=True)

NICKNAME_RE = re.compile(r'^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$')

# ============= RATE LIMITING (защита от перебора/парсинга/накрутки) =============
# In-memory sliding-window лимитер по IP. Лимиты подобраны так, чтобы обычный
# пользователь их никогда не замечал (страница делает ~5-10 запросов), но
# скрипт-переборщик упирался в потолок за секунды.
import threading
_RL_LOCK = threading.Lock()
_RL_BUCKETS = {}

def _rl_ip():
    return request.headers.get('X-Forwarded-For', request.remote_addr or '').split(',')[0].strip() or 'unknown'

def _rl_check(key, limit, window):
    """True если запрос разрешён, False если лимит превышен."""
    now = time.time()
    ip = _rl_ip()
    bucket_key = f"{key}:{ip}"
    with _RL_LOCK:
        times = _RL_BUCKETS.get(bucket_key, [])
        times = [t for t in times if now - t < window]
        if len(times) >= limit:
            _RL_BUCKETS[bucket_key] = times
            return False
        times.append(now)
        _RL_BUCKETS[bucket_key] = times
        # периодическая чистка старых ключей, чтобы память не росла
        if len(_RL_BUCKETS) > 5000:
            for k in [k for k, v in _RL_BUCKETS.items() if not v or now - max(v) > window]:
                _RL_BUCKETS.pop(k, None)
        return True

@app.before_request
def _global_rate_limit():
    p = request.path
    # мутирующие/чувствительные эндпоинты — жёсткие лимиты
    if p == '/api/auth/telegram' and request.method == 'POST':
        if not _rl_check('auth', 20, 60):
            return jsonify({'error': 'Too many requests'}), 429
    elif p.startswith('/api/tracks/') and p.endswith('/play') and request.method == 'POST':
        if not _rl_check('play', 30, 60):
            return jsonify({'error': 'Too many requests'}), 429
    elif p.endswith('/like') and request.method == 'POST':
        if not _rl_check('like', 30, 60):
            return jsonify({'error': 'Too many requests'}), 429
    elif p == '/admin/login' and request.method == 'POST':
        if not _rl_check('adminlogin', 5, 600):
            return jsonify({'error': 'Too many attempts, try again later'}), 429
    elif p.startswith('/api/') or p.startswith('/admin/api/'):
        # общий потолок на чтение API — 120 запросов/мин с IP (с запасом)
        if not _rl_check('api', 120, 60):
            return jsonify({'error': 'Too many requests'}), 429

@app.after_request
def _security_headers(resp):
    resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
    resp.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    resp.headers.setdefault('X-Frame-Options', 'DENY')
    return resp

@app.errorhandler(429)
def _too_many(e):
    return jsonify({'error': 'Too many requests'}), 429

@app.errorhandler(500)
def _server_error(e):
    # не раскрываем детали ошибки наружу — защита от разведки
    return jsonify({'error': 'Internal error'}), 500

# ============= СЖАТИЕ ОБЛОЖЕК =============
COVER_MAX_SIZE = 1000   # px по длинной стороне
COVER_QUALITY = 82      # JPEG/WebP quality

def _compress_image(path):
    """Конвертирует изображение в оптимизированный JPEG (square-friendly),
    уменьшая до COVER_MAX_SIZE. Возвращает новый путь или исходный при ошибке."""
    if not PIL_AVAILABLE:
        return path
    try:
        with Image.open(path) as im:
            im = im.convert('RGB')
            im.thumbnail((COVER_MAX_SIZE, COVER_MAX_SIZE), Image.LANCZOS)
            out = os.path.splitext(path)[0] + '.jpg'
            im.save(out, 'JPEG', quality=COVER_QUALITY, optimize=True, progressive=True)
        if os.path.abspath(out) != os.path.abspath(path):
            try: os.remove(path)
            except OSError: pass
        return out
    except Exception as e:
        print(f"image compress failed: {e}")
        return path

def _save_cover(file_storage, prefix):
    """Сохраняет обложку, сжимает и дедуплицирует по содержимому.
    Имя файла — content-hash: одинаковые картинки дают один файл."""
    import uuid
    ext = file_storage.filename.rsplit('.', 1)[1].lower() if '.' in file_storage.filename else 'jpg'
    if ext not in ('jpg', 'jpeg', 'png', 'webp'):
        ext = 'jpg'
    tmp_name = f"{prefix}_{uuid.uuid4().hex}.{ext}"
    tmp_path = os.path.join(app.config['UPLOAD_FOLDER'], tmp_name)
    file_storage.save(tmp_path)
    new_path = _compress_image(tmp_path)
    try:
        with open(new_path, 'rb') as f:
            h = hashlib.md5(f.read()).hexdigest()[:16]
    except OSError:
        return os.path.basename(new_path)
    final_ext = os.path.splitext(new_path)[1].lstrip('.') or 'jpg'
    final_name = f"{prefix}_{h}.{final_ext}"
    final_path = os.path.join(app.config['UPLOAD_FOLDER'], final_name)
    if os.path.abspath(new_path) != os.path.abspath(final_path):
        if os.path.isfile(final_path):
            try:
                os.remove(new_path)
            except OSError:
                pass
        else:
            os.rename(new_path, final_path)
    return os.path.basename(final_path)


def _cover_key(cover_filename):
    """Короткий стабильный ключ обложки — одинаковые файлы = одинаковый ключ,
    поэтому одинаковые URL в браузере грузятся один раз."""
    if not cover_filename:
        return None
    return hashlib.md5(cover_filename.encode('utf-8')).hexdigest()[:16]


def _find_cover_file(key):
    """Ищет файл обложки по ключу среди треков и альбомов."""
    try:
        conn = db()
        c = conn.cursor()
        names = []
        for row in c.execute("SELECT DISTINCT cover_filename FROM tracks WHERE cover_filename IS NOT NULL AND cover_filename != ''"):
            names.append(row[0])
        for row in c.execute("SELECT DISTINCT cover_filename FROM albums WHERE cover_filename IS NOT NULL AND cover_filename != ''"):
            names.append(row[0])
        conn.close()
    except Exception:
        return None
    for f in names:
        if _cover_key(f) == key:
            return f
    return None


def _serve_cover(filename):
    """Отдача обложки с ETag и публичным кэшем (трафик-экономия)."""
    folder = app.config['UPLOAD_FOLDER']
    safe_name = os.path.basename(filename)
    path = os.path.join(folder, safe_name)
    if not os.path.isfile(path):
        return "Not found", 404
    response = send_from_directory(folder, safe_name, conditional=True)
    response.headers['Cache-Control'] = 'public, max-age=86400, immutable'
    return response



def _cache_telegram_avatar(telegram_id, photo_url):
    """Скачивает TG-аватар и кладёт в /uploads/avatars/<id>.<ext>.

    Telegram временно хранит фото по ссылке (https://t.me/i/userpic/...),
    она часто перестаёт работать через несколько часов. Чтобы аватар
    жил вечно — копируем себе. Возвращаем относительный путь для отдачи
    через /uploads/avatars/<file> или None при ошибке."""
    if not photo_url or not telegram_id:
        return None
    try:
        import urllib.request
        req = urllib.request.Request(photo_url, headers={'User-Agent': 'SwagPlayer/1.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            ctype = (resp.headers.get('Content-Type') or '').lower()
            data = resp.read(2 * 1024 * 1024)  # cap 2MB
        ext = 'jpg'
        if 'png' in ctype:
            ext = 'png'
        elif 'webp' in ctype:
            ext = 'webp'
        elif 'svg' in ctype:
            ext = 'svg'
        # Обновляем каждый логин — затираем старый, чтобы при смене аватарки в TG
        # у нас тоже она менялась. Версия добавляется через ?v=ts на клиенте.
        for old_ext in ('jpg', 'png', 'webp', 'svg'):
            old = os.path.join(AVATAR_FOLDER, f'{telegram_id}.{old_ext}')
            if old_ext != ext and os.path.isfile(old):
                try: os.remove(old)
                except OSError: pass
        filename = f'{telegram_id}.{ext}'
        with open(os.path.join(AVATAR_FOLDER, filename), 'wb') as f:
            f.write(data)
        # Cache-bust по времени модификации файла → клиент всегда тянет свежий.
        ts = int(datetime.now().timestamp())
        return f'/uploads/avatars/{filename}?v={ts}'
    except Exception as e:
        print(f'avatar cache failed for {telegram_id}: {e}')
        return None

# SSO Configuration
SSO_AUTH_URL = "https://auth.dreampartners.online"
SSO_CLIENT_ID = "mp3_editor"
SSO_CLIENT_SECRET = os.environ.get('SSO_CLIENT_SECRET', 'YOUR_SSO_CLIENT_SECRET')
SSO_REDIRECT_URI = "https://mp3.dreampartners.online/callback"

# Инициализация БД
def db(with_rows=False):
    """Единая точка подключения к БД: включает foreign_keys (иначе
    ON DELETE CASCADE не работает и плодятся «сиротские» записи)."""
    conn = sqlite3.connect(DB_FILE)
    conn.execute("PRAGMA foreign_keys = ON")
    if with_rows:
        conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
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
        admin_hash = generate_password_hash(os.environ.get('ADMIN_PASSWORD', 'change-me-in-production'))
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

    # События прослушиваний для анти-накрутки (как в Spotify/Яндекс.Музыке):
    # прослушка засчитывается только если реально слушали >= 30 секунд,
    # повторные события того же юзера по тому же треку в окне 60с игнорятся.
    c.execute('''CREATE TABLE IF NOT EXISTS play_events
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  track_id INTEGER NOT NULL,
                  user_id INTEGER,
                  fingerprint TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  FOREIGN KEY (track_id) REFERENCES tracks(id))''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_play_events_track_user ON play_events(track_id, user_id, created_at)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_play_events_fp ON play_events(track_id, fingerprint, created_at)")
    
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

# Кеш-бастер для статики: версия = mtime файла. В шаблонах используем
# {{ asset('css/unified.css') }} — это даст /static/css/unified.css?v=<ts>.
# При каждом deploy mtime новых файлов меняется, у юзера автоматически
# подтягивается свежая версия без хардкода ?v= в HTML.
_ASSET_VERSION_CACHE = {}
def _asset_version(relpath):
    if relpath in _ASSET_VERSION_CACHE:
        return _ASSET_VERSION_CACHE[relpath]
    abs_path = os.path.join('static', relpath)
    try:
        v = str(int(os.path.getmtime(abs_path)))
    except OSError:
        v = '1'
    _ASSET_VERSION_CACHE[relpath] = v
    return v

@app.context_processor
def _inject_asset_helper():
    def asset(relpath):
        return f"/static/{relpath}?v={_asset_version(relpath)}"
    return {'asset': asset}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def upload_path(filename):
    if not filename:
        return None
    return os.path.join(app.config['UPLOAD_FOLDER'], filename)


def upload_exists(filename):
    path = upload_path(filename)
    return bool(path and os.path.isfile(path))


def enrich_track(track):
    if not track:
        return None

    normalized = dict(track)
    normalized['audio_available'] = upload_exists(normalized.get('filename'))
    normalized['cover_available'] = upload_exists(normalized.get('cover_filename'))
    return normalized


def public_track(track, is_owner=False):
    """Сериализатор трека для публичного API.

    Убирает чувствительные поля (filename, cover_filename, user_id, hidden)
    и заменяет их непрозрачными подписанными URL /api/tracks/<id>/stream и /cover.
    Владелец/админ получает поле hidden для управления видимостью."""
    if not track:
        return None
    t = dict(track)
    tid = t.get('id')
    t['audio_url'] = _sign_media(f'/api/tracks/{tid}/stream')
    _ck = _cover_key(t.get('cover_filename'))
    t['cover_url'] = f'/api/cover/{_ck}' if _ck else None
    if is_owner:
        t['hidden'] = bool(t.get('hidden', 0))
    else:
        t.pop('hidden', None)
    for field in ('filename', 'cover_filename', 'user_id', 'is_pinned', 'sort_order', 'created_at'):
        t.pop(field, None)
    return t


def public_album(album, is_owner=False):
    """Сериализатор альбома для публичного API."""
    if not album:
        return None
    a = dict(album)
    aid = a.get('id')
    _ack = _cover_key(a.get('cover_filename'))
    a['cover_url'] = f'/api/cover/{_ack}' if _ack else None
    if is_owner:
        a['hidden'] = bool(a.get('hidden', 0))
    else:
        a.pop('hidden', None)
    for field in ('cover_filename', 'user_id', 'is_pinned', 'created_at'):
        a.pop(field, None)
    return a


MEDIA_TTL = 6 * 3600


def _media_fingerprint():
    """Стабильный идентификатор браузера: хранится в session-cookie.
    Подписанная ссылка работает только в том браузере, которому выдана."""
    fp = session.get('media_fp')
    if not fp:
        import secrets
        fp = secrets.token_hex(8)
        session['media_fp'] = fp
    return fp


def _sign_media(path, ttl=MEDIA_TTL):
    """Подписанный URL: путь + срок жизни + отпечаток браузера + HMAC."""
    exp = int(time.time()) + ttl
    fp = _media_fingerprint()
    msg = f"{path}|{exp}|{fp}".encode()
    sig = hmac.new(app.secret_key.encode() if isinstance(app.secret_key, str) else app.secret_key,
                   msg, hashlib.sha256).hexdigest()[:24]
    return f"{path}?e={exp}&fp={fp}&s={sig}"


def _verify_media(path):
    """Проверка подписи медиа-URL. Возвращает True если запрос легитимен."""
    try:
        exp = int(request.args.get('e', 0))
        fp = request.args.get('fp', '')
        sig = request.args.get('s', '')
    except (TypeError, ValueError):
        return False
    if not exp or not fp or not sig:
        return False
    if exp < time.time():
        return False
    if fp != session.get('media_fp'):
        return False
    msg = f"{path}|{exp}|{fp}".encode()
    expected = hmac.new(app.secret_key.encode() if isinstance(app.secret_key, str) else app.secret_key,
                        msg, hashlib.sha256).hexdigest()[:24]
    return hmac.compare_digest(expected, sig)


def _media_referer_ok():
    """Referer должен быть с нашего сайта. Прямое открытие ссылки во вкладке
    или хотлинк с чужого сайта не шлёт Referer → отказ."""
    ref = request.headers.get('Referer', '')
    if not ref:
        return False
    try:
        ref_host = urllib.parse.urlparse(ref).netloc.lower().split(':')[0]
    except Exception:
        return False
    req_host = (request.headers.get('Host') or '').lower().split(':')[0]
    return bool(ref_host) and ref_host == req_host


def _check_media_access(path):
    """Единая проверка доступа к медиа: подпись + Referer."""
    if not _verify_media(path):
        return False
    if not _media_referer_ok():
        return False
    return True


def filter_public_tracks(rows):
    tracks = []
    for row in rows:
        track = enrich_track(row)
        if track and track.get('audio_available'):
            tracks.append(track)
    return tracks


def normalize_nickname(raw_value):
    value = (raw_value or '').strip().lower()
    if not value:
        return ''
    if not NICKNAME_RE.fullmatch(value):
        return None
    return value

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
        
        # Сравниваем константным временем — защита от timing-атак
        if not hmac.compare_digest(calculated_hash, received_hash):
            print(f"Hash mismatch: calculated={calculated_hash}, received={received_hash}")
            print(f"Data check string: {data_check_string}")
            return None
        
        # Защита от replay-атак: подпись initData не должна быть старше 24 часов
        try:
            auth_date = int(parsed_data.get('auth_date', 0))
            if auth_date and (datetime.now().timestamp() - auth_date) > 86400:
                print("initData too old (auth_date expired)")
                return None
        except (ValueError, TypeError):
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

# Декоратор: разрешён только artist (telegram_id из ADMIN_TELEGRAM_IDS) или admin из панели.
# Используется для всех write-операций над треками/альбомами — рядовые пользователи
# могут только слушать, лайкать и видеть статистику.
def artist_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_admin_session():
            return jsonify({'error': 'Forbidden — admin only'}), 403
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
    conn = db(True)
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
            current_user['is_admin'] = current_user.get('telegram_id') in ADMIN_TELEGRAM_IDS
    
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
        
    tracks_query += " ORDER BY COALESCE(t.sort_order, 999999) ASC, t.id ASC LIMIT 50"
    
    c.execute(tracks_query, tracks_params)
    tracks_rows = c.fetchall()
    
    # Проверяем лайки для треков
    tracks = []
    for row in tracks_rows:
        track = enrich_track(row)
        if not track or not track.get('audio_available'):
            continue
        if current_user_id:
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track['id']))
            track['is_liked'] = c.fetchone() is not None
        else:
            track['is_liked'] = False
        tracks.append(public_track(track))
    
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
        albums.append(public_album(album))
    
    conn.close()
    return render_template('unified.html', 
                          tracks=tracks, 
                          albums=albums, 
                          current_user=current_user,
                          search_query=search_query,
                          mode='library')

@app.route('/app')
def app_page():
    """Telegram Web App — теперь admin-only (управление треками)."""
    if not is_admin_session():
        # Non-admins are funnelled to the public homepage. Telegram WebApp boot
        # JS on `/` will run /api/auth/telegram; the response carries is_admin so
        # the client can navigate back to /app when applicable.
        return redirect('/')
    init_data = request.args.get('tgWebAppData', '')
    return render_template('app.html', shared_track=None, shared_mode=False, init_data=init_data)

@app.route('/track/<track_identifier>')
def share_track(track_identifier):
    """Публичная страница трека - unified версия"""
    conn = db(True)
    c = conn.cursor()
    
    current_user_id = session.get('user_id')
    
    # Получаем текущего пользователя
    current_user = None
    if current_user_id:
        c.execute("SELECT * FROM users WHERE id = ?", (current_user_id,))
        user_row = c.fetchone()
        if user_row:
            current_user = dict(user_row)
            current_user['is_admin'] = current_user.get('telegram_id') in ADMIN_TELEGRAM_IDS
    
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
        
    track = enrich_track(row)
    if not track or not track.get('audio_available'):
        conn.close()
        return "Track file not found", 404
    
    # Проверяем лайк текущего пользователя
    if current_user_id:
        c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track['id']))
        track['is_liked'] = c.fetchone() is not None
    else:
        track['is_liked'] = False
    
    conn.close()
    title = f"{track['artist']} - {track['title']}"
    return render_template('unified.html', 
                          shared_track=public_track(track), 
                          current_user=current_user,
                          page_title=title,
                          mode='player')

@app.route('/album/<album_identifier>')
def share_album(album_identifier):
    """Публичная страница альбома - unified версия"""
    conn = db(True)
    c = conn.cursor()
    
    current_user_id = session.get('user_id')
    
    # Получаем текущего пользователя
    current_user = None
    if current_user_id:
        c.execute("SELECT * FROM users WHERE id = ?", (current_user_id,))
        user_row = c.fetchone()
        if user_row:
            current_user = dict(user_row)
            current_user['is_admin'] = current_user.get('telegram_id') in ADMIN_TELEGRAM_IDS
    
    if album_identifier.isdigit():
        c.execute("""SELECT a.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(a.plays_count, 0) as plays_count,
                        COALESCE(a.likes_count, 0) as likes_count
                     FROM albums a 
                     JOIN users u ON a.user_id = u.id 
                     WHERE a.id = ?""", (int(album_identifier),))
    else:
        c.execute("""SELECT a.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(a.plays_count, 0) as plays_count,
                        COALESCE(a.likes_count, 0) as likes_count
                     FROM albums a 
                     JOIN users u ON a.user_id = u.id 
                     WHERE a.slug = ?""", (album_identifier,))
    
    album = c.fetchone()
    if not album:
        conn.close()
        return "Album not found", 404
    
    album = dict(album)
    if album.get('hidden'):
        uid = session.get('user_id')
        if not uid or (uid != album.get('user_id') and not is_admin_session()):
            conn.close()
            return "Album not found", 404
    
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
    tracks = []
    for row in c.fetchall():
        track = enrich_track(row)
        if not track or not track.get('audio_available'):
            continue
        tracks.append(track)
    
    # Проверяем лайки для треков
    for track in tracks:
        if current_user_id:
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track['id']))
            track['is_liked'] = c.fetchone() is not None
        else:
            track['is_liked'] = False
    
    conn.close()
    
    return render_template('unified.html', 
                          shared_album=public_album(album), 
                          album_tracks=[public_track(t) for t in tracks],
                          current_user=current_user,
                          page_title=album['title'],
                          mode='player')

@app.route('/user/<nickname>')
def user_library(nickname):
    """Публичная библиотека пользователя"""
    conn = db(True)
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
    tracks = [public_track(t) for t in filter_public_tracks(c.fetchall())]
    
    # Получаем альбомы пользователя
    c.execute("""SELECT * FROM albums 
                 WHERE user_id = ? AND hidden = 0 
                 ORDER BY created_at DESC""", (user['id'],))
    albums = [public_album(dict(row)) for row in c.fetchall()]
    
    conn.close()
    return render_template('library.html', user=user, tracks=tracks, albums=albums)

# === API ROUTES ===

@app.route('/auth/browser/<token>')
def auth_browser(token):
    """Авторизация в браузере по одноразовому токену из бота."""
    conn = db(True)
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

    # Авторизуем (вечная сессия)
    session.permanent = True
    session['user_id'] = user['id']
    session['telegram_id'] = telegram_id

    # Удаляем использованный токен
    c.execute("DELETE FROM auth_tokens WHERE token = ?", (token,))
    conn.commit()
    conn.close()

    # Куда возвращать пользователя после авторизации:
    #   1. ?next=<абсолютный путь> в URL,
    #   2. иначе — всегда в плеер (главную), чтобы человек не потерялся.
    #      В кабинет /app админ заходит сам через кнопку в профиле.
    next_url = request.args.get('next', '').strip()
    if next_url.startswith('/') and not next_url.startswith('//'):
        return redirect(next_url)
    return redirect('/')

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
            # Качаем сразу — TG-ссылка временная.
            cached = _cache_telegram_avatar(telegram_id, user_data['photo_url'])
            avatar_url = cached or user_data['photo_url']
        
        conn = db()
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

            # Если TG в этот раз не прислал photo_url — сохраняем то что было
            # (могла поменяться сторона входа, не повод стирать локальный кеш).
            effective_avatar = avatar_url if avatar_url else user['avatar_url']

            c.execute("""UPDATE users
                         SET username = ?, first_name = ?, last_name = ?, avatar_url = ?, nickname = ?
                         WHERE telegram_id = ?""",
                      (username, first_name, last_name, effective_avatar, current_nickname, telegram_id))
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

        # Сохраняем в сессию (вечная)
        session.permanent = True
        session['user_id'] = user_id
        session['telegram_id'] = telegram_id

        # Сообщаем клиенту, является ли пользователь админом — чтобы JS
        # мог перенаправить артиста на /app, а остальных — на /.
        user['is_admin'] = telegram_id in ADMIN_TELEGRAM_IDS

        print(f"User authenticated: {user_id}, telegram_id: {telegram_id}, is_admin: {user['is_admin']}")
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
    conn = db(True)
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE id = ?", (session['user_id'],))
    user = c.fetchone()
    conn.close()

    if not user:
        return jsonify({'error': 'User not found'}), 404

    user = dict(user)
    user['is_admin'] = session.get('telegram_id') in ADMIN_TELEGRAM_IDS
    return jsonify(user)

@app.route('/api/user/profile', methods=['PUT'])
@login_required
def update_profile():
    """Обновить профиль пользователя"""
    # Поддерживаем как JSON, так и FormData
    if request.content_type and 'application/json' in request.content_type:
        data = request.get_json()
        display_name = data.get('display_name', '').strip()
        nickname = normalize_nickname(data.get('nickname', ''))
    else:
        display_name = request.form.get('display_name', '').strip()
        nickname = normalize_nickname(request.form.get('nickname', ''))

    if nickname is None:
        return jsonify({
            'error': 'Nickname can only contain lowercase latin letters, digits, dot, dash and underscore'
        }), 400
    
    conn = db()
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
    
    conn = db(True)
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
        
        track_dict = enrich_track(track)
        if not track_dict or (not show_hidden and not track_dict.get('audio_available')):
            return jsonify([]), 200
        
        # Проверяем лайк текущего пользователя
        if current_user_id:
            conn = db()
            c = conn.cursor()
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track_id))
            track_dict['is_liked'] = c.fetchone() is not None
            conn.close()
        else:
            track_dict['is_liked'] = False
        
        is_owner = 'user_id' in session and track_dict.get('user_id') == session['user_id']
        return jsonify([public_track(track_dict, is_owner=is_owner or is_admin_session())])
    
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
        track = enrich_track(row)
        if not track:
            continue
        if not show_hidden and not track.get('audio_available'):
            continue
        # Проверяем лайкнул ли текущий пользователь
        if current_user_id:
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track['id']))
            track['is_liked'] = c.fetchone() is not None
        else:
            track['is_liked'] = False
        is_owner = 'user_id' in session and track.get('user_id') == session['user_id']
        tracks.append(public_track(track, is_owner=is_owner or is_admin_session()))
    
    conn.close()
    return jsonify(tracks)

@app.route('/api/tracks', methods=['POST'])
@artist_required
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
            cover_filename = _save_cover(cover, session['user_id'])
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

        conn = db()
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
@artist_required
def update_track(track_id):
    """Обновить трек"""
    conn = db()
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
            if track[4]:  # filename в индексе 4
                old_path = os.path.join(app.config['UPLOAD_FOLDER'], track[4])
                if os.path.exists(old_path):
                    os.remove(old_path)
    
    cover_filename = None
    cover_key = request.form.get('cover_key') or (request.get_json(silent=True) or {}).get('cover_key') or ''
    if cover_key:
        cover_filename = _find_cover_file(cover_key)
    if 'cover' in request.files and request.files['cover'].filename:
        cover = request.files['cover']
        if allowed_file(cover.filename):
            cover_filename = _save_cover(cover, session['user_id'])
    if cover_filename and track[5] and track[5] != cover_filename:
        # Cleanup old, если она больше нигде не используется
        c.execute("SELECT 1 FROM tracks WHERE cover_filename = ? AND id != ? LIMIT 1",
                  (track[5], track_id))
        if not c.fetchone():
            old_path = os.path.join(app.config['UPLOAD_FOLDER'], track[5])
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
@artist_required
def delete_track(track_id):
    """Удалить трек"""
    conn = db()
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
    
    # Удаляем связанные записи (foreign_keys=ON — без этого удаление упадёт
    # на FK-констрейнтах likes/track_plays/album_tracks)
    c.execute("DELETE FROM likes WHERE track_id = ?", (track_id,))
    c.execute("DELETE FROM track_plays WHERE track_id = ?", (track_id,))
    c.execute("DELETE FROM album_tracks WHERE track_id = ?", (track_id,))
    c.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/tracks/<int:track_id>/toggle-visibility', methods=['POST'])
@artist_required
def toggle_track_visibility(track_id):
    """Переключить видимость трека"""
    conn = db()
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


@app.route('/api/tracks/<int:track_id>/move', methods=['POST'])
@artist_required
def move_track(track_id):
    """Сдвинуть трек вверх/вниз по порядку показа на главной (sort_order)."""
    direction = (request.get_json(silent=True) or {}).get('direction', 'up')
    conn = db()
    c = conn.cursor()
    c.execute("SELECT id FROM tracks WHERE user_id = ? ORDER BY COALESCE(sort_order, 999999) ASC, id ASC",
              (session['user_id'],))
    ids = [r[0] for r in c.fetchall()]
    if track_id not in ids:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    idx = ids.index(track_id)
    if direction == 'up' and idx > 0:
        ids[idx], ids[idx - 1] = ids[idx - 1], ids[idx]
    elif direction == 'down' and idx < len(ids) - 1:
        ids[idx], ids[idx + 1] = ids[idx + 1], ids[idx]
    else:
        conn.close()
        return jsonify({'success': True, 'moved': False})
    for pos, tid in enumerate(ids, 1):
        c.execute("UPDATE tracks SET sort_order = ? WHERE id = ?", (pos, tid))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'moved': True})


@app.route('/api/albums/<int:album_id>/toggle-visibility', methods=['POST'])
@artist_required
def toggle_album_visibility(album_id):
    """Скрыть/показать альбом (владелец)."""
    conn = db()
    c = conn.cursor()
    c.execute("SELECT user_id, hidden FROM albums WHERE id = ?", (album_id,))
    row = c.fetchone()
    if not row or row[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    data = request.get_json(silent=True) or {}
    if 'hidden' in data:
        hidden = 1 if data['hidden'] else 0
    else:
        hidden = 0 if row[1] else 1
    c.execute("UPDATE albums SET hidden = ? WHERE id = ?", (hidden, album_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'hidden': bool(hidden)})


@app.route('/api/covers/library', methods=['GET'])
@artist_required
def covers_library():
    """Список уникальных обложек пользователя (для выбора существующей)."""
    conn = db()
    c = conn.cursor()
    covers = {}
    for row in c.execute("""SELECT cover_filename, COUNT(*) FROM tracks
                            WHERE user_id = ? AND cover_filename IS NOT NULL AND cover_filename != ''
                            GROUP BY cover_filename""", (session['user_id'],)):
        covers[row[0]] = covers.get(row[0], 0) + row[1]
    for row in c.execute("""SELECT cover_filename, COUNT(*) FROM albums
                            WHERE user_id = ? AND cover_filename IS NOT NULL AND cover_filename != ''
                            GROUP BY cover_filename""", (session['user_id'],)):
        covers[row[0]] = covers.get(row[0], 0) + row[1]
    conn.close()
    items = []
    for filename, count in covers.items():
        key = _cover_key(filename)
        if not key:
            continue
        items.append({
            'key': key,
            'url': f'/api/cover/{key}',
            'used_by': count
        })
    items.sort(key=lambda x: -x['used_by'])
    return jsonify(items)

@app.route('/api/tracks/bulk', methods=['POST'])
@artist_required
def bulk_tracks_action():
    """Массовые действия над треками (для кабинета /app).

    Действия (action):
    - cover: одна обложка на все выбранные треки (multipart: cover + track_ids[])
    - hide / show: скрыть/показать выбранные
    - artist: поставить одного исполнителя (form/json: artist)
    - delete: удалить выбранные треки
    track_ids передаются как JSON-массив (поле track_ids) или как track_ids[]."""
    action = request.form.get('action') or (request.get_json(silent=True) or {}).get('action')
    if not action:
        return jsonify({'error': 'No action'}), 400

    raw_ids = request.form.getlist('track_ids[]') or request.form.getlist('track_ids')
    if not raw_ids:
        data = request.get_json(silent=True) or {}
        raw_ids = data.get('track_ids') or []
    try:
        track_ids = [int(x) for x in raw_ids]
    except (TypeError, ValueError):
        return jsonify({'error': 'Invalid track_ids'}), 400
    if not track_ids or len(track_ids) > 100:
        return jsonify({'error': 'Invalid track_ids'}), 400

    conn = db()
    c = conn.cursor()

    # работаем только со своими треками
    placeholders = ','.join('?' * len(track_ids))
    c.execute(f"SELECT id, filename, cover_filename FROM tracks WHERE id IN ({placeholders}) AND user_id = ?",
              track_ids + [session['user_id']])
    owned = c.fetchall()
    if not owned:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    owned_ids = [r[0] for r in owned]
    ph = ','.join('?' * len(owned_ids))

    if action == 'cover':
        cover = request.files.get('cover')
        if not cover or not allowed_file(cover.filename):
            conn.close()
            return jsonify({'error': 'No cover file'}), 400
        cover_filename = _save_cover(cover, session['user_id'])
        # старую общую обложку удаляем, если она не используется другими треками
        old_covers = {r[2] for r in owned if r[2]}
        c.execute(f"UPDATE tracks SET cover_filename = ? WHERE id IN ({ph})",
                  [cover_filename] + owned_ids)
        for old in old_covers:
            c.execute("SELECT 1 FROM tracks WHERE cover_filename = ? LIMIT 1", (old,))
            if not c.fetchone():
                old_path = os.path.join(app.config['UPLOAD_FOLDER'], old)
                if os.path.isfile(old_path):
                    try: os.remove(old_path)
                    except OSError: pass
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'updated': len(owned_ids), 'cover_filename': cover_filename})

    if action == 'cover_existing':
        key = request.form.get('cover_key') or (request.get_json(silent=True) or {}).get('cover_key') or ''
        filename = _find_cover_file(key)
        if not filename:
            conn.close()
            return jsonify({'error': 'Cover not found'}), 404
        old_covers = {r[2] for r in owned if r[2]}
        c.execute(f"UPDATE tracks SET cover_filename = ? WHERE id IN ({ph})",
                  [filename] + owned_ids)
        for old in old_covers:
            if old == filename:
                continue
            c.execute("SELECT 1 FROM tracks WHERE cover_filename = ? LIMIT 1", (old,))
            if not c.fetchone():
                old_path = os.path.join(app.config['UPLOAD_FOLDER'], old)
                if os.path.isfile(old_path):
                    try: os.remove(old_path)
                    except OSError: pass
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'updated': len(owned_ids)})

    if action in ('hide', 'show'):
        hidden = 1 if action == 'hide' else 0
        c.execute(f"UPDATE tracks SET hidden = ? WHERE id IN ({ph})", [hidden] + owned_ids)
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'updated': len(owned_ids)})

    if action == 'artist':
        artist = (request.form.get('artist')
                  or (request.get_json(silent=True) or {}).get('artist') or '').strip()
        if not artist:
            conn.close()
            return jsonify({'error': 'No artist'}), 400
        c.execute(f"UPDATE tracks SET artist = ? WHERE id IN ({ph})", [artist] + owned_ids)
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'updated': len(owned_ids)})

    if action == 'delete':
        for tid, filename, cover in owned:
            c.execute("DELETE FROM likes WHERE track_id = ?", (tid,))
            c.execute("DELETE FROM track_plays WHERE track_id = ?", (tid,))
            c.execute("DELETE FROM play_events WHERE track_id = ?", (tid,))
            c.execute("DELETE FROM album_tracks WHERE track_id = ?", (tid,))
            c.execute("DELETE FROM tracks WHERE id = ?", (tid,))
            for f in (filename, cover):
                if f:
                    c.execute("SELECT 1 FROM tracks WHERE filename = ? OR cover_filename = ? LIMIT 1", (f, f))
                    if not c.fetchone():
                        p = os.path.join(app.config['UPLOAD_FOLDER'], f)
                        if os.path.isfile(p):
                            try: os.remove(p)
                            except OSError: pass
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'deleted': len(owned_ids)})

    conn.close()
    return jsonify({'error': 'Unknown action'}), 400

@app.route('/api/tracks/<int:track_id>/play', methods=['POST'])
def count_play(track_id):
    """Засчитать прослушивание (модель Spotify/Яндекс.Музыки).

    Правила анти-накрутки:
    - прослушка засчитывается только при фактическом прослушивании
      >= 30 секунд (или >= 90% длительности для коротких треков);
    - повторное событие того же юзера/отпечатка по тому же треку
      в окне 60 секунд игнорируется;
    - клиент шлёт listened_seconds — сервер не верит «пустым» вызовам.
    Ответ всегда одинаковый по форме, чтобы нельзя было прощупать логику."""
    conn = db()
    c = conn.cursor()
    c.execute("SELECT id, hidden FROM tracks WHERE id = ?", (track_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        return jsonify({'success': True})

    data = request.get_json(silent=True) or {}
    try:
        listened = float(data.get('listened_seconds', 0))
    except (TypeError, ValueError):
        listened = 0
    try:
        duration = float(data.get('duration', 0))
    except (TypeError, ValueError):
        duration = 0

    # порог: 30 секунд либо 90% короткого трека
    threshold = 30.0
    if 0 < duration < 33:
        threshold = max(10.0, duration * 0.9)
    if listened < threshold:
        conn.close()
        return jsonify({'success': True})

    current_user_id = session.get('user_id')
    fingerprint = None
    if not current_user_id:
        ua = request.headers.get('User-Agent', '')
        fingerprint = hashlib.sha256(f"{_rl_ip()}|{ua}".encode()).hexdigest()[:32]

    # дедупликация: то же юзер/отпечаток + трек в последние 60 секунд
    if current_user_id:
        c.execute("""SELECT 1 FROM play_events
                     WHERE track_id = ? AND user_id = ?
                       AND created_at > datetime('now', '-60 seconds') LIMIT 1""",
                  (track_id, current_user_id))
    else:
        c.execute("""SELECT 1 FROM play_events
                     WHERE track_id = ? AND fingerprint = ?
                       AND created_at > datetime('now', '-60 seconds') LIMIT 1""",
                  (track_id, fingerprint))
    if c.fetchone():
        conn.close()
        return jsonify({'success': True})

    c.execute("INSERT INTO play_events (track_id, user_id, fingerprint) VALUES (?, ?, ?)",
              (track_id, current_user_id, fingerprint))
    c.execute("UPDATE tracks SET plays_count = COALESCE(plays_count, 0) + 1 WHERE id = ?", (track_id,))
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
            conn = db()
            c = conn.cursor()
            c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (current_user_id, track_id))
            liked = c.fetchone() is not None
            conn.close()
        
        conn = db()
        c = conn.cursor()
        c.execute("SELECT COALESCE(likes_count, 0) as likes_count FROM tracks WHERE id = ?", (track_id,))
        count = c.fetchone()[0] or 0
        conn.close()
        
        return jsonify({'success': True, 'liked': liked, 'likes_count': count})
    
    # POST - идемпотентная установка состояния лайка (как в Spotify):
    # клиент присылает {"like": true|false}, сервер приводит БД к этому
    # состоянию. Повторный одинаковый запрос ничего не меняет — накрутка
    # повторными POST невозможна, рассинхронизация клиент/сервер лечится сама.
    if 'user_id' not in session:
        bot_url = 'https://tg.swag.best/swagplayerobot?start=auth'
        return jsonify({
            'error': 'Unauthorized',
            'message': 'Для того чтобы ставить лайки, пожалуйста, авторизуйтесь.',
            'auth_url': bot_url
        }), 401

    user_id = session.get('user_id')
    if not user_id:
        bot_url = 'https://tg.swag.best/swagplayerobot?start=auth'
        return jsonify({
            'error': 'Auth required',
            'message': 'Для того чтобы ставить лайки, пожалуйста, авторизуйтесь.',
            'auth_url': bot_url
        }), 401

    data = request.get_json(silent=True) or {}
    want_like = bool(data.get('like', True))

    conn = db()
    c = conn.cursor()

    c.execute("SELECT id FROM tracks WHERE id = ?", (track_id,))
    if not c.fetchone():
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    c.execute("SELECT id FROM likes WHERE user_id = ? AND track_id = ?", (user_id, track_id))
    like = c.fetchone()

    if want_like and not like:
        c.execute("INSERT INTO likes (user_id, track_id) VALUES (?, ?)", (user_id, track_id))
    elif not want_like and like:
        c.execute("DELETE FROM likes WHERE id = ?", (like[0],))

    # счётчик всегда пересчитываем из таблицы лайков — никаких дрейфов
    c.execute("SELECT COUNT(*) FROM likes WHERE track_id = ?", (track_id,))
    count = c.fetchone()[0] or 0
    c.execute("UPDATE tracks SET likes_count = ? WHERE id = ?", (count, track_id))

    conn.commit()
    conn.close()
    return jsonify({'success': True, 'liked': want_like, 'likes_count': count})

@app.route('/api/albums/<int:album_id>/play', methods=['POST'])
def count_album_play(album_id):
    """Прослушивание альбома. Засчитывается только если клиент реально
    слушал (listened_seconds >= 30) — та же модель что и у треков."""
    conn = db()
    c = conn.cursor()
    c.execute("SELECT id FROM albums WHERE id = ?", (album_id,))
    if not c.fetchone():
        conn.close()
        return jsonify({'success': True})

    data = request.get_json(silent=True) or {}
    try:
        listened = float(data.get('listened_seconds', 0))
    except (TypeError, ValueError):
        listened = 0
    if listened < 30.0:
        conn.close()
        return jsonify({'success': True})

    c.execute("UPDATE albums SET plays_count = COALESCE(plays_count, 0) + 1 WHERE id = ?", (album_id,))
    conn.commit()
    c.execute("SELECT COALESCE(plays_count, 0) as plays_count FROM albums WHERE id = ?", (album_id,))
    count = c.fetchone()[0] or 0
    conn.close()
    return jsonify({'success': True, 'plays_count': count})

@app.route('/api/albums/<int:album_id>/like', methods=['POST'])
@login_required
def toggle_album_like(album_id):
    """Идемпотентная установка лайка альбома (клиент шлёт {"like": bool})."""
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'error': 'Auth required'}), 401

    data = request.get_json(silent=True) or {}
    want_like = bool(data.get('like', True))

    conn = db()
    c = conn.cursor()

    c.execute("SELECT id FROM albums WHERE id = ?", (album_id,))
    if not c.fetchone():
        conn.close()
        return jsonify({'error': 'Not found'}), 404

    c.execute("SELECT id FROM album_likes WHERE user_id = ? AND album_id = ?", (user_id, album_id))
    like = c.fetchone()

    if want_like and not like:
        try:
            c.execute("INSERT INTO album_likes (user_id, album_id) VALUES (?, ?)", (user_id, album_id))
        except sqlite3.IntegrityError:
            pass
    elif not want_like and like:
        c.execute("DELETE FROM album_likes WHERE id = ?", (like[0],))

    c.execute("SELECT COUNT(*) FROM album_likes WHERE album_id = ?", (album_id,))
    actual_count = c.fetchone()[0] or 0
    c.execute("UPDATE albums SET likes_count = ? WHERE id = ?", (actual_count, album_id))
    conn.commit()

    conn.close()
    return jsonify({'success': True, 'liked': want_like, 'likes_count': actual_count})

# Альбомы API
@app.route('/api/albums', methods=['GET'])
def get_albums():
    """Получить альбомы"""
    user_id = request.args.get('user_id', type=int)
    show_hidden = request.args.get('show_hidden', 'false').lower() == 'true'
    current_user_id = session.get('user_id')
    
    conn = db(True)
    c = conn.cursor()
    
    query = """SELECT a.*, u.nickname, u.display_name, u.avatar_url,
              COALESCE(a.plays_count, 0) as plays_count,
              COALESCE(a.likes_count, 0) as likes_count
               FROM albums a 
               JOIN users u ON a.user_id = u.id"""
    params = []
    conditions = []
    if not (show_hidden and user_id and user_id == session.get('user_id')):
        conditions.append("a.hidden = 0")
    if user_id:
        conditions.append("a.user_id = ?")
        params.append(user_id)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
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
        is_owner = 'user_id' in session and album.get('user_id') == session['user_id']
        albums.append(public_album(album, is_owner=is_owner or is_admin_session()))
    
    conn.close()
    return jsonify(albums)

@app.route('/api/albums', methods=['POST'])
@artist_required
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
            cover_filename = _save_cover(cover, session['user_id'])
    
    conn = db()
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
@artist_required
def update_album(album_id):
    """Обновить альбом"""
    conn = db()
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
            cover_filename = _save_cover(cover, session['user_id'])
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
@artist_required
def delete_album(album_id):
    """Удалить альбом"""
    conn = db()
    c = conn.cursor()
    c.execute("SELECT user_id FROM albums WHERE id = ?", (album_id,))
    album = c.fetchone()
    
    if not album or album[0] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Forbidden'}), 403
    
    c.execute("DELETE FROM album_likes WHERE album_id = ?", (album_id,))
    c.execute("DELETE FROM album_tracks WHERE album_id = ?", (album_id,))
    c.execute("DELETE FROM albums WHERE id = ?", (album_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/albums/<int:album_id>/tracks', methods=['POST'])
@artist_required
def add_track_to_album(album_id):
    """Добавить трек в альбом"""
    data = request.get_json()
    track_id = data.get('track_id')
    
    if not track_id:
        return jsonify({'error': 'track_id is required'}), 400
    
    conn = db()
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
@artist_required
def remove_track_from_album(album_id, track_id):
    """Удалить трек из альбома"""
    conn = db()
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
@artist_required
def move_track_in_album(album_id, track_id):
    """Переместить трек в альбоме (вверх/вниз)"""
    conn = db()
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
    conn = db(True)
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
    conn = db(True)
    c = conn.cursor()
    
    if album_identifier.isdigit():
        c.execute("""SELECT a.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(a.plays_count, 0) as plays_count,
                        COALESCE(a.likes_count, 0) as likes_count
                     FROM albums a 
                     JOIN users u ON a.user_id = u.id 
                     WHERE a.id = ?""", (int(album_identifier),))
    else:
        c.execute("""SELECT a.*, u.nickname, u.display_name, u.avatar_url,
                        COALESCE(a.plays_count, 0) as plays_count,
                        COALESCE(a.likes_count, 0) as likes_count
                     FROM albums a 
                     JOIN users u ON a.user_id = u.id 
                     WHERE a.slug = ?""", (album_identifier,))
    
    album = c.fetchone()
    if not album:
        conn.close()
        return jsonify({'error': 'Album not found'}), 404
    
    album = dict(album)
    if album.get('hidden'):
        uid = session.get('user_id')
        if not uid or (uid != album.get('user_id') and not is_admin_session()):
            conn.close()
            return jsonify({'error': 'Album not found'}), 404
    
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
    is_owner = 'user_id' in session and album.get('user_id') == session['user_id']
    owner = is_owner or is_admin_session()
    return jsonify({
        'album': public_album(album, is_owner=owner),
        'tracks': [public_track(t, is_owner=owner) for t in tracks]
    })

# Админка
@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    """Страница входа в админку"""
    if request.method == 'POST':
        data = request.get_json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        conn = db()
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
    conn = db(True)
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
    conn = db(True)
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
    conn = db()
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
    conn = db(True)
    c = conn.cursor()
    c.execute("""SELECT * FROM users ORDER BY created_at DESC""")
    users = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify(users)

@app.route('/admin/api/albums/<int:album_id>', methods=['DELETE'])
@admin_required
def admin_delete_album(album_id):
    """Удалить альбом (админ)"""
    conn = db()
    c = conn.cursor()
    c.execute("SELECT cover_filename FROM albums WHERE id = ?", (album_id,))
    album = c.fetchone()
    
    if not album:
        conn.close()
        return jsonify({'error': 'Album not found'}), 404
    
    # Удаляем обложку если есть
    if album[0] and os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], album[0])):
        os.remove(os.path.join(app.config['UPLOAD_FOLDER'], album[0]))
    
    c.execute("DELETE FROM album_likes WHERE album_id = ?", (album_id,))
    c.execute("DELETE FROM album_tracks WHERE album_id = ?", (album_id,))
    c.execute("DELETE FROM albums WHERE id = ?", (album_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/admin/api/tracks/<int:track_id>/toggle-visibility', methods=['POST'])
@admin_required
def admin_toggle_track_visibility(track_id):
    """Скрыть/показать трек (админ)"""
    conn = db()
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
    conn = db()
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
    
    c.execute("DELETE FROM likes WHERE track_id = ?", (track_id,))
    c.execute("DELETE FROM track_plays WHERE track_id = ?", (track_id,))
    c.execute("DELETE FROM album_tracks WHERE track_id = ?", (track_id,))
    c.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/tracks/<int:track_id>/pin', methods=['POST'])
@admin_required
def toggle_track_pin(track_id):
    """Закрепить/открепить трек (админ)"""
    conn = db()
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
    conn = db()
    c = conn.cursor()
    data = request.get_json() or {}
    is_pinned = 1 if data.get('is_pinned') else 0
    
    c.execute("UPDATE albums SET is_pinned = ? WHERE id = ?", (is_pinned, album_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'is_pinned': bool(is_pinned)})

# Статические файлы
@app.route('/uploads/avatars/<filename>')
def uploaded_avatar(filename):
    """Отдельная отдача аватарок — поддиректория /uploads/avatars/."""
    folder = os.path.join(app.config['UPLOAD_FOLDER'], 'avatars')
    path = os.path.join(folder, filename)
    if not os.path.exists(path):
        return "Avatar not found", 404
    response = send_from_directory(folder, filename, conditional=True)
    response.headers['Cache-Control'] = 'public, max-age=86400'  # 1 day, версия в ?v=
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response

def _parse_range_header(range_header, file_size):
    """Парсит заголовок Range (RFC 7233). Поддерживает один диапазон:
    'bytes=0-499', 'bytes=500-', 'bytes=-500' (последние 500 байт).
    Возвращает (start, end) включительно или None если Range нет/некорректен."""
    if not range_header or not range_header.startswith('bytes='):
        return None
    spec = range_header[6:].strip()
    if ',' in spec:
        spec = spec.split(',', 1)[0].strip()
    try:
        if spec.startswith('-'):
            suffix = int(spec[1:])
            if suffix <= 0:
                return None
            start = max(0, file_size - suffix)
            end = file_size - 1
        elif spec.endswith('-'):
            start = int(spec[:-1])
            end = file_size - 1
        else:
            start_s, end_s = spec.split('-', 1)
            start = int(start_s)
            end = int(end_s)
        if start < 0 or end < start or start >= file_size:
            return None
        end = min(end, file_size - 1)
        return start, end
    except (ValueError, IndexError):
        return None


def _stream_file_range(file_path, start, end, chunk_size=65536):
    """Генератор: отдаёт байты [start..end] включительно кусками по chunk_size.
    Файловый дескриптор закрывается гарантированно (context manager)."""
    remaining = end - start + 1
    with open(file_path, 'rb') as f:
        f.seek(start)
        while remaining > 0:
            chunk = f.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _serve_upload(filename, download_name=None):
    """Общая отдача файла из uploads/ с поддержкой HTTP Range Requests (RFC 7233)."""
    upload_folder = app.config['UPLOAD_FOLDER']
    safe_name = os.path.basename(filename)
    if safe_name != filename or '..' in filename:
        return "Invalid filename", 400
    file_path = os.path.join(upload_folder, safe_name)

    if not os.path.isfile(file_path):
        return "File not found", 404

    file_size = os.path.getsize(file_path)
    mime_type, _ = mimetypes.guess_type(file_path)
    if filename.lower().endswith('.wav'):
        mime_type = 'audio/wav'
    mime_type = mime_type or 'application/octet-stream'

    headers = {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-cache',
    }
    if download_name:
        headers['Content-Disposition'] = f'attachment; filename="{urllib.parse.quote(download_name)}"'

    if request.method == 'HEAD':
        resp = Response('', status=200, mimetype=mime_type)
        resp.headers.update(headers)
        resp.headers['Content-Length'] = str(file_size)
        return resp

    rng = _parse_range_header(request.headers.get('Range'), file_size)

    if request.headers.get('Range') and rng is None:
        resp = Response('', status=416, mimetype=mime_type)
        resp.headers['Content-Range'] = f'bytes */{file_size}'
        resp.headers.update(headers)
        return resp

    if rng:
        start, end = rng
        length = end - start + 1
        resp = Response(
            _stream_file_range(file_path, start, end),
            status=206,
            mimetype=mime_type,
            direct_passthrough=True,
        )
        resp.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
        resp.headers['Content-Length'] = str(length)
    else:
        resp = Response(
            _stream_file_range(file_path, 0, file_size - 1),
            status=200,
            mimetype=mime_type,
            direct_passthrough=True,
        )
        resp.headers['Content-Length'] = str(file_size)

    resp.headers.update(headers)
    return resp


@app.route('/api/tracks/<int:track_id>/stream')
def stream_track(track_id):
    """Стриминг трека по ID — имя файла наружу не раскрывается.
    Доступ только по подписанной ссылке с сайта (Referer-проверка).
    Скрытые треки отдаются только владельцу/админу."""
    path = f'/api/tracks/{track_id}/stream'
    if not _check_media_access(path):
        return "Forbidden", 403
    conn = db()
    c = conn.cursor()
    c.execute("SELECT filename, hidden, user_id, artist, title FROM tracks WHERE id = ?", (track_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        return "Not found", 404
    filename, hidden, owner_id, artist, title = row
    if hidden:
        uid = session.get('user_id')
        if not uid or (uid != owner_id and not is_admin_session()):
            return "Not found", 404
    if not filename:
        return "Not found", 404
    download_name = None
    if request.args.get('download') in ('1', 'true', 'yes'):
        uid = session.get('user_id')
        if uid != owner_id and not is_admin_session():
            return "Forbidden", 403
        ext = filename.rsplit('.', 1)[-1] if '.' in filename else ''
        safe = lambda s: re.sub(r'[\\/:*?"<>|\r\n]+', '', (s or '').strip()) or 'track'
        download_name = f"{safe(artist)} - {safe(title)}.{ext}" if artist else f"{safe(title)}.{ext}"
    return _serve_upload(filename, download_name)


@app.route('/api/cover/<cover_key>')
def cover_by_key(cover_key):
    """Обложка по стабильному ключу. Одинаковые обложки у разных треков
    имеют один URL — браузер скачивает картинку один раз."""
    filename = _find_cover_file(cover_key)
    if not filename:
        return "Not found", 404
    return _serve_cover(filename)


@app.route('/api/tracks/<int:track_id>/cover')
def track_cover(track_id):
    """Обложка трека по ID. Публичная (нужна для og:image и MediaSession)."""
    conn = db()
    c = conn.cursor()
    c.execute("SELECT cover_filename, hidden, user_id FROM tracks WHERE id = ?", (track_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        return "Not found", 404
    cover, hidden, owner_id = row
    if hidden:
        uid = session.get('user_id')
        if not uid or (uid != owner_id and not is_admin_session()):
            return "Not found", 404
    if not cover:
        return "Not found", 404
    return _serve_cover(cover)


@app.route('/api/albums/<int:album_id>/cover')
def album_cover(album_id):
    """Обложка альбома по ID. Публичная (нужна для og:image и MediaSession)."""
    conn = db()
    c = conn.cursor()
    c.execute("SELECT cover_filename, hidden, user_id FROM albums WHERE id = ?", (album_id,))
    row = c.fetchone()
    conn.close()
    if not row:
        return "Not found", 404
    cover, hidden, owner_id = row
    if hidden:
        uid = session.get('user_id')
        if not uid or (uid != owner_id and not is_admin_session()):
            return "Not found", 404
    if not cover:
        return "Not found", 404
    return _serve_cover(cover)


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    """Отдача загруженных файлов с поддержкой HTTP Range Requests (RFC 7233).

    Браузерный <audio> запрашивает диапазоны байтов — это даёт мгновенный
    старт воспроизведения и перемотку без скачивания всего файла.
    ?download=1 → форсим Save As с человекочитаемым именем (для админ-модалки).

    Доступ только для админа/владельца — обычные юзеры получают аудио
    через подписанные /api/tracks/<id>/stream, а прямой путь закрыт."""
    uid = session.get('user_id')
    is_owner = False
    if uid:
        try:
            conn = db()
            c = conn.cursor()
            c.execute("SELECT user_id FROM tracks WHERE filename = ?", (filename,))
            row = c.fetchone()
            conn.close()
            if row and row[0] == uid:
                is_owner = True
        except Exception:
            pass
    if not is_owner and not is_admin_session():
        return "Forbidden", 403
    try:
        want_download = request.args.get('download') in ('1', 'true', 'yes')
        download_name = None
        if want_download:
            download_name = filename
            try:
                conn = db()
                c = conn.cursor()
                c.execute("SELECT artist, title FROM tracks WHERE filename = ?", (filename,))
                row = c.fetchone()
                conn.close()
                if row:
                    artist, title = row
                    ext = filename.rsplit('.', 1)[-1] if '.' in filename else ''
                    safe = lambda s: re.sub(r'[\\/:*?"<>|\r\n]+', '', (s or '').strip()) or 'track'
                    download_name = f"{safe(artist)} - {safe(title)}.{ext}" if artist else f"{safe(title)}.{ext}"
            except Exception:
                pass
        return _serve_upload(filename, download_name)
    except Exception as e:
        print(f"Error serving file {filename}: {e}")
        return "Error serving file", 500

@app.route('/static/<path:filename>')
def static_file(filename):
    return send_from_directory('static', filename)

@app.route('/favicon.ico')
def favicon():
    return send_from_directory('static/img', 'favicon.ico')

@app.route('/manifest.webmanifest')
@app.route('/manifest.json')
def manifest():
    """PWA-манифест: standalone-режим, чёрный фон, иконки."""
    return jsonify({
        "name": "SwagPlayer",
        "short_name": "SwagPlayer",
        "description": "Музыкальная платформа SwagPlayer",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "orientation": "portrait",
        "background_color": "#000000",
        "theme_color": "#000000",
        "lang": "ru",
        "icons": [
            {"src": "/static/img/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}
        ]
    })

@app.route('/apple-touch-icon.png')
@app.route('/apple-touch-icon-precomposed.png')
def apple_touch_icon():
    return send_from_directory('static/img', 'apple-touch-icon.png')

@app.route('/api/extract-metadata', methods=['POST'])
@artist_required
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
