# Gerenciador de Gabinete

Aplicação web para gestão de gabinete parlamentar: demandas de eleitores,
contatos, dashboard com métricas e importação/exportação CSV.

## Stack

- **Vite** — build e dev server
- **Tailwind CSS v3** — estilização (modo escuro via classe `dark`)
- **Chart.js** — gráficos do dashboard (CDN pinada com SRI)
- **Supabase** — auth (email/senha) + Postgres (`Contatos`, `Demandas`,
  `Demandas Ativas`, `Regioes`)

## Setup

```bash
npm install
npm run dev       # dev server
npm run build     # build em dist/
npm run preview   # servir o build
npm run lint      # ESLint
npm run format    # Prettier
npm test          # Vitest
```

## Configuração do Supabase

As credenciais ficam em `src/main.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
A anon key é segura para expor no cliente **somente** com Row Level Security
ativa no banco.

Antes de subir para produção, execute a migração de RLS:

```
supabase/migrations/0001_enable_rls.sql
```

(Supabase Dashboard → SQL Editor → colar e executar. As policies atuais
dão acesso total a usuários autenticados; para isolamento por gabinete,
adicione coluna de ownership e refine as policies.)

## Estrutura

```
index.html                  marcação
src/main.js                 lógica da aplicação
src/utils.js                helpers (escapeHtml)
src/styles.css              Tailwind + estilos custom
supabase/migrations/        migrações SQL
```

## Segurança

- Auth real verificada via `supabase.auth.getSession()`; nenhuma flag de
  autenticação é mantida em `sessionStorage`.
- Todo dado exibido via `innerHTML` passa por `escapeHtml()`.
- Dependências de CDN pinadas com versão exata + `integrity` SHA-384.
