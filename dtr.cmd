@echo off
REM Convenience wrapper so double-clicking works and cmd.exe users are not stuck.
REM Everything real happens in dtr.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dtr.ps1" %*
