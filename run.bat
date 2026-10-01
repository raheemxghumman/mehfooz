@echo off
rem Mehfooz - serves the UI at http://localhost:5173 and opens it.
rem Needed for the inline Fastn connect widget: Fastn lets any http(s) page frame it, but not file://.
cd /d "%~dp0ui"
start "" "http://localhost:5173/index.html?demo=1"
python -m http.server 5173 --bind 127.0.0.1
