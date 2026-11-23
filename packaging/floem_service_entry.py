"""PyInstaller giriş noktası: paketlenmiş floem-service.exe bu betikten üretilir.

Paketlenmiş exe, geliştirmedeki `python -m floem_bi.desktop_service` ile aynı
komut satırını kabul eder (--port, --token / FLOEM_TOKEN).
"""

import sys

if __name__ == "__main__":
    if "--powerbi-worker" in sys.argv:
        from floem_bi.powerbi_worker import main
        main()
    else:
        from floem_bi.desktop_service.__main__ import main
        main()
