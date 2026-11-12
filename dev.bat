@echo off
rem Cebio: cift tikla, backend + frontend birlikte acilsin
cd /d "%~dp0"
node scripts\dev.mjs
if errorlevel 1 pause
