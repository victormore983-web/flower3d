@echo off
chcp 65001 >nul
title Flores 20/10 - Sitio local
cd /d "%~dp0"
echo Abriendo el sitio en tu navegador (cierra esta ventana para detenerlo)...
start "" "http://127.0.0.1:8765/"
python -m http.server 8765 --bind 127.0.0.1
pause
