import os
import telebot
from telebot import types
import sqlite3
import uuid
import datetime

# Токен бота
BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'YOUR_BOT_TOKEN')
WEB_APP_URL = os.environ.get('WEB_APP_URL', 'https://music.swag.best/')
PUBLIC_BASE_URL = os.environ.get('PUBLIC_BASE_URL', 'https://music.swag.best')
DB_FILE = 'music.db'

bot = telebot.TeleBot(BOT_TOKEN)

@bot.message_handler(commands=['login'])
def login_command(message):
    """Генерация ссылки для входа в браузере"""
    telegram_id = message.from_user.id
    token = str(uuid.uuid4())
    
    # Срок действия 10 минут
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Проверяем, есть ли такой пользователь
    c.execute("SELECT id FROM users WHERE telegram_id = ?", (telegram_id,))
    if not c.fetchone():
        conn.close()
        bot.reply_to(message, "Сначала откройте приложение через кнопку 'Открыть SwagPlayer', чтобы зарегистрироваться.")
        return

    c.execute("INSERT INTO auth_tokens (token, telegram_id, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))",
              (token, telegram_id))
    conn.commit()
    conn.close()
    
    login_url = f"{PUBLIC_BASE_URL}/auth/browser/{token}"
    
    keyboard = types.InlineKeyboardMarkup()
    url_button = types.InlineKeyboardButton(text="🔓 Войти в браузере", url=login_url)
    keyboard.add(url_button)
    
    bot.reply_to(message, 
                 "Ссылка для входа в браузере (действительна 10 минут):\n"
                 "Нажмите на кнопку ниже, чтобы авторизоваться на компьютере или в другом браузере.",
                 reply_markup=keyboard)

@bot.message_handler(commands=['start'])
def start_command(message):
    """Обработчик команды /start"""
    # Получаем параметр из команды (например, /start auth)
    command_args = message.text.split()[1:] if len(message.text.split()) > 1 else []
    start_param = command_args[0] if command_args else None
    
    # Если параметр "auth", отправляем ссылку для авторизации в браузере
    if start_param == 'auth':
        telegram_id = message.from_user.id
        token = str(uuid.uuid4())
        
        # Срок действия 10 минут
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        
        # Проверяем, есть ли такой пользователь
        c.execute("SELECT id FROM users WHERE telegram_id = ?", (telegram_id,))
        if not c.fetchone():
            conn.close()
            bot.reply_to(message, 
                        "❌ Сначала откройте приложение через кнопку 'Открыть SwagPlayer', чтобы зарегистрироваться.")
            return
        
        c.execute("INSERT INTO auth_tokens (token, telegram_id, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))",
                  (token, telegram_id))
        conn.commit()
        conn.close()
        
        login_url = f"{PUBLIC_BASE_URL}/auth/browser/{token}"
        
        keyboard = types.InlineKeyboardMarkup()
        url_button = types.InlineKeyboardButton(text="🔓 Войти в браузере", url=login_url)
        keyboard.add(url_button)
        
        bot.reply_to(message, 
                    "🔐 Ссылка для входа в браузере (действительна 10 минут):\n\n"
                    "Нажмите на кнопку ниже, чтобы авторизоваться на компьютере или в другом браузере.",
                    reply_markup=keyboard)
        return
    
    # Обычный /start - показываем кнопку открытия приложения
    inline_keyboard = types.InlineKeyboardMarkup()
    web_app = types.WebAppInfo(url=WEB_APP_URL)
    button = types.InlineKeyboardButton(text="🎵 Открыть SwagPlayer", web_app=web_app)
    inline_keyboard.add(button)
    
    # Также добавляем ReplyKeyboard для удобства
    reply_keyboard = types.ReplyKeyboardMarkup(resize_keyboard=True)
    reply_button = types.KeyboardButton(text="🎵 Открыть SwagPlayer", web_app=web_app)
    reply_keyboard.add(reply_button)
    
    bot.reply_to(
        message,
        "🎵 Добро пожаловать в SwagPlayer!\n\n"
        "Загружайте свои треки, создавайте альбомы и делитесь музыкой с друзьями.\n\n"
        "Нажмите кнопку ниже, чтобы открыть приложение:",
        reply_markup=inline_keyboard
    )

@bot.message_handler(commands=['help'])
def help_command(message):
    """Обработчик команды /help"""
    help_text = (
        "🎵 SwagPlayer - Платформа для музыкантов\n\n"
        "📋 Команды:\n"
        "/start - Открыть приложение\n"
        "/help - Показать эту справку\n\n"
        "🎯 Возможности:\n"
        "• Загрузка треков\n"
        "• Создание альбомов\n"
        "• Синхронизация текстов (Lyrics Studio)\n"
        "• Публичные ссылки для библиотеки, альбомов и треков\n"
        "• Личная библиотека\n\n"
        "💡 Просто нажмите кнопку 'Открыть SwagPlayer' для начала работы!"
    )
    bot.reply_to(message, help_text)

@bot.message_handler(func=lambda message: True)
def handle_all_messages(message):
    """Обработчик всех остальных сообщений"""
    # Используем inline keyboard для лучшей работы с initData
    inline_keyboard = types.InlineKeyboardMarkup()
    web_app = types.WebAppInfo(url=WEB_APP_URL)
    button = types.InlineKeyboardButton(text="🎵 Открыть SwagPlayer", web_app=web_app)
    inline_keyboard.add(button)
    
    bot.reply_to(
        message,
        "Используйте кнопку ниже, чтобы открыть SwagPlayer:",
        reply_markup=inline_keyboard
    )

if __name__ == '__main__':
    print("🤖 Telegram бот запущен и готов к работе!")
    try:
        bot.infinity_polling()
    except KeyboardInterrupt:
        print("\n🛑 Бот остановлен")
    except Exception as e:
        print(f"❌ Ошибка бота: {e}")

