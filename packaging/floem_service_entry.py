"""PyInstaller giriş noktası: paketlenmiş floem-service.exe bu betikten üretilir.

Paketlenmiş exe, geliştirmedeki `python -m floem_bi.desktop_service` ile aynı
komut satırını kabul eder (--port, --token / FLOEM_TOKEN).
"""

from floem_bi.desktop_service.__main__ import main

if __name__ == "__main__":
    main()
