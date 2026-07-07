# Integracao com o Session Transfer

Este documento resume as formas de integrar o conector com menor atrito, mantendo a UI whitelabel no SaaS do cliente.

## Fluxos disponiveis

### 1. Link unico recomendado

Use quando voce quer um metodo simples em que o mesmo link resolva instalacao ou migracao.

```text
https://connect.sessiontransfer.com/import/?client=minha-loja&token=00000000-0000-4000-8000-000000000000
```

O que acontece:

1. A pagina le `client` e `token`.
2. A pagina limpa a barra de endereco para remover os parametros visiveis.
3. Se a extensao nao estiver instalada, envia para a Chrome Web Store.
4. Se a extensao estiver instalada, abre ou foca o WhatsApp Web.
5. A extensao abre o painel de confirmacao com as opcoes recebidas.

### 2. Link direto para WhatsApp Web

Use quando voce ja sabe que a extensao esta instalada.

```text
https://web.whatsapp.com/#client=minha-loja&token=00000000-0000-4000-8000-000000000000
```

Preferir parametros no hash (`#`) em vez de query string (`?`). A extensao tambem aceita query string, mas o hash evita interferir em rotas internas do WhatsApp Web.

### 3. SDK core para UI propria

Use quando o SaaS quer verificar a extensao, controlar o botao e decidir o fallback de instalacao.

```html
<script src="https://connect.sessiontransfer.com/sdk.js"></script>
<script>
  async function conectarWhatsApp() {
    const payload = {
      client: "minha-loja",
      token: "00000000-0000-4000-8000-000000000000"
    };

    const status = await SessionTransfer.ping();
    if (!status.installed) {
      window.location.href = "https://chromewebstore.google.com/detail/cdjfbjfolpeenlmanmkoglhhcjfgcbpp";
      return;
    }

    await SessionTransfer.open(payload);
  }
</script>
```

O SDK nao tenta renderizar um componente visual pronto. O cliente cria a propria UI e chama `ping()`, `open()` ou `fallbackUrl()`.

## Parametros de URL

Os parametros abaixo funcionam no link unico do conector e no link direto para WhatsApp Web.

Booleans aceitos: `true`, `false`, `1`, `0`, `sim`, `nao`, `yes`, `no`, `on`, `off`.

| Parametro | Obrigatorio | Padrao | Efeito |
| --- | --- | --- | --- |
| `client` | Sim | - | Nome da assinatura ou host autorizado. Exemplo: `minha-loja`. |
| `token` | Sim | - | Token da instancia que vai receber a sessao. |
| `includeHistory` | Nao | `true` | Inclui historico de mensagens na migracao. Alias: `history`, `historico`. |
| `hideHistoryOption` | Nao | `true` | Esconde a opcao de historico no painel. Alias: `hideHistory`. |
| `lockHistoryOption` | Nao | `true` | Trava a opcao de historico no painel. Alias: `lockHistory`. |
| `showClientField` | Nao | `false` | Mostra o campo `client` no painel. Alternativa tecnica: `hideClientField`. |
| `canEditClient` | Nao | `false` | Permite editar o campo `client`. Alternativa tecnica: `lockClientField`. |
| `showTokenField` | Nao | `false` | Mostra o campo `token` no painel. Alternativa tecnica: `hideTokenField`. |
| `canEditToken` | Nao | `false` | Permite editar o campo `token`. Alternativa tecnica: `lockTokenField`. |
| `panelLayout` | Nao | `center` | Posicao do painel: `center` ou `corner`. Alias: `layout`. |
| `timeoutMs` | Nao | SDK | Tempo maximo de comunicacao com o bridge. Funciona no `/import/` e no SDK; nao tem efeito no link direto do WhatsApp. |

`disconnectLocal` nao e parametro publico do SDK. No modo padrao, a sessao local e sempre desconectada apos a migracao. A desativacao disso fica restrita ao modo tecnico da extensao.

## Exemplos prontos

### Link unico minimo

```text
https://connect.sessiontransfer.com/import/?client=minha-loja&token=00000000-0000-4000-8000-000000000000
```

### Link unico com defaults

```text
https://connect.sessiontransfer.com/import/?client=minha-loja&token=00000000-0000-4000-8000-000000000000
```

### WhatsApp direto com defaults

```text
https://web.whatsapp.com/#client=minha-loja&token=00000000-0000-4000-8000-000000000000
```

### Modo tecnico visivel

Mostra campos e permite edicao antes de migrar:

```text
https://connect.sessiontransfer.com/import/?client=minha-loja&token=00000000-0000-4000-8000-000000000000&hideHistoryOption=false&lockHistoryOption=false&showTokenField=true&canEditToken=true&showClientField=true&canEditClient=true&panelLayout=corner
```

## API do SDK

| Metodo | Uso |
| --- | --- |
| `SessionTransfer.configure({ frameUrl, timeoutMs })` | Ajusta URL do iframe bridge ou timeout padrao. |
| `SessionTransfer.ping({ timeoutMs })` | Retorna `{ installed, version }`. |
| `SessionTransfer.open(payload)` | Abre ou foca o WhatsApp Web e pede para a extensao abrir o painel. |
| `SessionTransfer.fallbackUrl(payload)` | Monta o link direto para `web.whatsapp.com/#...`. |
| `SessionTransfer.buildWhatsAppUrl(payload)` | Alias de `fallbackUrl(payload)`. |
| `SessionTransfer.on(event, handler)` | Observa eventos globais. |
| `SessionTransfer.off(event, handler)` | Remove listener. |

## Eventos simples

```js
SessionTransfer.on("opened", function (result) {
  console.log("WhatsApp aberto", result);
});

SessionTransfer.on("missing", function () {
  console.log("Extensao nao instalada");
});

SessionTransfer.on("error", function (error) {
  console.error("Falha no conector", error);
});
```

Eventos disponiveis:

- `status`: mudancas de estado do SDK;
- `opened`: WhatsApp Web abriu ou foi focado;
- `missing`: extensao nao encontrada;
- `error`: erro no bridge ou abertura.

## Seguranca e responsabilidade

O link com `client` e `token` e o contrato publico atual. O token deve ser entregue apenas por sistemas e operadores autorizados pelo parceiro que controla a instancia.

O `/import/` limpa a barra de endereco depois de carregar, mas o token ainda passa pela URL inicial por alguns instantes. Por isso:

- gere links somente para usuarios autorizados;
- evite enviar esses links para ferramentas de analytics ou logs publicos;
- prefira abrir o link em ambiente autenticado do SaaS;
- trate o token como credencial da instancia.
