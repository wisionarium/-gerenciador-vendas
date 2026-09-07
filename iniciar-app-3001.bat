@echo off
TITLE Gerenciador de Vendas - SERVIDOR (NAO FECHAR ESTA JANELA)
cd /d "%~dp0"
set PORT=3001
echo ============================================
echo  Gerenciador de Vendas - Equipe Comercial
echo  Servidor iniciando na porta 3001...
echo  NAO FECHE esta janela enquanto usar o app.
echo ============================================
timeout /t 3 /nobreak >nul
start http://localhost:3001
node server.js
echo.
echo O servidor foi encerrado. Pressione qualquer tecla para fechar.
pause >nul
