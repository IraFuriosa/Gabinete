# Gerenciador de Gabinete

Aplicação web para gestão de gabinete parlamentar: demandas de eleitores,
contatos, dashboard com métricas e importação/exportação CSV.

## Stack

- **Vite** — build e dev server
- **Tailwind CSS v3** — estilização (modo escuro via classe `dark`)
- **Chart.js** — gráficos do dashboard (bundle npm)
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

## Deploy no GitHub Pages

A aplicação é 100% estática (bundle Vite em `dist/`), então roda no
GitHub Pages. O `vite.config.js` usa `base: './'` (caminhos relativos)
para funcionar tanto em `usuario.github.io/repo/` quanto em domínio
personalizado.

1. Faça push do código no GitHub (o workflow
   `.github/workflows/deploy.yml` builda e publica o `dist/`).
2. No repositório, vá em **Settings → Pages → Source** e selecione
   **GitHub Actions**.
3. O site fica em `https://<usuario>.github.io/Gabinete/` (ou no
   domínio configurado).

### Supabase

No Dashboard do Supabase, em **Authentication → URL Configuration**:

- **Site URL**: `https://<usuario>.github.io/Gabinete/`
- **Redirect URLs**: adicione a mesma URL (necessário para fluxos de
  auth por redirecionamento; o login por senha já funciona sem isso).

A migração de RLS (`supabase/migrations/0001_enable_rls.sql`) precisa
estar aplicada antes de expor a aplicação publicamente.

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
src/ui/toast.js             notificações
src/ui/attachments.js       anexos no Supabase Storage
src/styles.css              Tailwind + estilos custom
src/*.test.js               testes Vitest
supabase/migrations/        migrações SQL
```

## Segurança

- Auth real verificada via `supabase.auth.getSession()`; nenhuma flag de
  autenticação é mantida em `sessionStorage`.
- Todo dado exibido via `innerHTML` passa por `escapeHtml()`.
- Dependências empacotadas no bundle Vite (sem CDN).
