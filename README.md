# Site Maxzz Diesel

HTML estático e três funções serverless da Vercel. Não precisa de build.

## Publicar na Vercel
1. Suba esta pasta para um repositório no GitHub.
2. Na Vercel, clique em **Add New → Project** e importe o repositório. Framework: **Other**. Deixe o build e o output vazios.
3. Em **Settings → Environment Variables**, cadastre as variáveis abaixo e clique em **Redeploy**.
4. Em **Settings → Domains**, aponte `maxzzdiesel.com`.

## Variáveis de ambiente (nunca coloque no código)
| Variável | Para que serve |
|---|---|
| `UNLEASHED_API_ID` | Catálogo ao vivo. Fica em Unleashed → Integration → API Access. |
| `UNLEASHED_API_KEY` | A chave que acompanha o ID acima. |
| `HUBSPOT_TOKEN` | Token de um Private App do HubSpot com os escopos `crm.objects.contacts.write`, `crm.objects.deals.write` e `crm.objects.contacts.read`. |
| `HUBSPOT_PIPELINE` | Opcional. ID do pipeline de negócios (padrão: `default`). |
| `HUBSPOT_DEALSTAGE` | Opcional. ID da etapa inicial do negócio (padrão: `appointmentscheduled`). |

Sem as chaves do Unleashed, a busca usa o catálogo salvo em `data/catalog.json` (5.807 itens). Sem o token do HubSpot, os formulários respondem com erro e mostram o telefone.

## O que cada função faz
- `GET /api/catalog`: lê os produtos do Unleashed e devolve só código, descrição, categoria, marca, mercado e motor. Custo e estoque nunca saem do servidor. Fica em cache por 30 minutos.
- `POST /api/quote`: cria ou atualiza o contato, abre um negócio "Quote request QR-..." e anexa a lista de peças como nota.
- `POST /api/account`: pedido de conta atacado do rodapé. Cria ou atualiza o contato e adiciona uma nota.

## Estrutura
- `*.html`: páginas (URLs limpas: `/quote`, `/injection-parts`...).
- `js/petite-vue.iife.js`, `js/dc.js`: runtime das partes interativas.
- `js/forms.js`: formulário de conta atacado.
- `assets/`: imagens, logos e fontes BDO Grotesk (licença OFL).
- `downloads/`: catálogo Robiel Electronic Line (PDF comprimido, 68 MB). O GitHub avisa em arquivos acima de 50 MB, mas aceita até 100 MB.
- `api/`, `lib/`: funções da Vercel.
