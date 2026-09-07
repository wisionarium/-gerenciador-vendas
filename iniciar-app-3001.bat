@echo off
TITLE Gerenciador de Vendas - SERVIDOR (NAO FECHAR ESTA JANELA)
cd /d "%~dp0"
set PORT=3001
echo ============================================
echo  Gerenciador de Vendas - Equipe Comercial
echo ============================================
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale em https://nodejs.org
  pause
  exit /b 1
)
if not exist "server.js" (
  echo [ERRO] Arquivo server.js nao encontrado nesta pasta.
  pause
  exit /b 1
)
echo [OK] Node encontrado. Subindo servidor na porta 3001...
echo [AVISO] NAO FECHE esta janela enquanto usar o app.
echo.
timeout /t 3 /nobreak >nul
start http://localhost:3001
node server.js
echo.
echo O servidor parou. Se foi sem querer, feche e abra de novo.
pause
