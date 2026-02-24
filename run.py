#!/usr/bin/env python3
"""
Единый файл для запуска SwagPlayer приложения и Telegram бота
"""
import os
import sys
import threading
import time
import subprocess
from multiprocessing import Process

def run_app():
    """Запуск Flask приложения"""
    print("🚀 Запуск Flask приложения на порту 5024...")
    # Используем sys.executable для использования того же интерпретатора Python
    import subprocess
    subprocess.run([sys.executable, "app.py"])

def run_bot():
    """Запуск Telegram бота"""
    print("🤖 Запуск Telegram бота...")
    # Небольшая задержка, чтобы Flask успел запуститься
    time.sleep(2)
    import subprocess
    subprocess.run([sys.executable, "bot.py"])

if __name__ == '__main__':
    print("=" * 50)
    print("🎵 SwagPlayer - Запуск сервисов")
    print("=" * 50)
    
    # Создаем процессы
    app_process = Process(target=run_app)
    bot_process = Process(target=run_bot)
    
    try:
        # Запускаем Flask приложение
        app_process.start()
        print("✅ Flask приложение запущено (PID: {})".format(app_process.pid))
        
        # Запускаем бота
        bot_process.start()
        print("✅ Telegram бот запущен (PID: {})".format(bot_process.pid))
        
        print("\n" + "=" * 50)
        print("✨ Все сервисы запущены!")
        print("📱 Flask: http://127.0.0.1:5024")
        print("🤖 Telegram бот: работает")
        print("=" * 50)
        print("\nНажмите Ctrl+C для остановки...\n")
        
        # Ждем завершения процессов
        app_process.join()
        bot_process.join()
        
    except KeyboardInterrupt:
        print("\n\n🛑 Остановка сервисов...")
        app_process.terminate()
        bot_process.terminate()
        app_process.join()
        bot_process.join()
        print("✅ Все сервисы остановлены")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Ошибка: {e}")
        app_process.terminate()
        bot_process.terminate()
        sys.exit(1)

