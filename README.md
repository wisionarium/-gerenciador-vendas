# SellDay — PWA Controle de Vendas

PWA simples para controle de chamadas, vendas e desempenho de equipe de vendedoras.

## Stack
- Backend: Node 24 + Express + `node:sqlite` (zero dependência nativa) + JWT + bcrypt
- Frontend: SPA vanilla (HTML/CSS/JS), mobile-first, sem build
- PWA: manifest + service worker + ícones + instalável

## Rodar local (PC)
```bash
npm install
npm start
# abra http://localhost:3000
```
Sem variáveis de ambiente, usa `./data.db` (SQLite local).

## Deploy na Vercel + Turso
1. Crie o banco no [Turso](https://turso.tech) e anote `TURSO_URL` + `TURSO_AUTH_TOKEN`
2. Suba o repo no GitHub e importe na Vercel
3. Na Vercel, em Settings → Environment Variables, adicione:
   - `TURSO_URL` (ex.: `libsql://...turso.io`)
   - `TURSO_AUTH_TOKEN`
   - `JWT_SECRET` (uma frase longa aleatória)
4. Deploy — com as variáveis presentes, o app usa o Turso automaticamente.

## Acessos iniciais (seed)
- Admin: `admin@equipe.com` / `admin123`
- Vendedoras: `ana@equipe.com` / `ana123`, `brenda@equipe.com` / `brenda123`, `carla@equipe.com` / `carla123`

## Regra de vendas compartilhadas (central em `db.js` + `server.js`)
- 1 participante = `1.0`
- 2 ou 3 participantes = `0.5` para cada (registro único, sem rateio matemático)

## Principais rotas API
- `POST /api/auth/login`, `GET /api/me`
- `GET /api/sellers`, `GET/POST/PUT/PATCH /api/users` (admin)
- `GET/POST /api/calls`, `DELETE /api/calls/:id`
- `GET/POST /api/sales`, `DELETE /api/sales/:id`
- `GET /api/stats/summary`, `GET /api/stats/ranking`, `GET /api/stats/seller/:id`
- `GET /api/report/daily`

## WhatsApp
Relatório gera mensagem e abre `https://wa.me/<numero>?text=<encodeURIComponent(msg)>`. Sem API externa.
