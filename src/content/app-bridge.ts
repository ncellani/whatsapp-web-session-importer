import { APP_BRIDGE_MESSAGE_TYPES, APP_BRIDGE_SOURCE } from "../shared/config";

type PageCommand = {
  target?: string;
  type?: string;
  client?: string;
  token?: string;
};

const guard = window as Window & { __whatsAppSessionConnectorBridge?: boolean };

if (!guard.__whatsAppSessionConnectorBridge) {
  guard.__whatsAppSessionConnectorBridge = true;

  const announce = () => {
    window.postMessage({
      source: APP_BRIDGE_SOURCE,
      type: APP_BRIDGE_MESSAGE_TYPES.ready,
      version: chrome.runtime?.getManifest?.().version || ""
    }, "*");
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data as PageCommand | undefined;
    if (!data || data.target !== APP_BRIDGE_SOURCE) {
      return;
    }

    if (data.type === APP_BRIDGE_MESSAGE_TYPES.ping) {
      announce();
      return;
    }

    if (data.type === APP_BRIDGE_MESSAGE_TYPES.startImport || data.type === APP_BRIDGE_MESSAGE_TYPES.openWhatsApp) {
      void chrome.runtime.sendMessage({
        type: APP_BRIDGE_MESSAGE_TYPES.startImport,
        client: data.client || "",
        token: data.token || ""
      })
        .then((response) => {
          window.postMessage({
            source: APP_BRIDGE_SOURCE,
            type: response?.ok ? APP_BRIDGE_MESSAGE_TYPES.started : APP_BRIDGE_MESSAGE_TYPES.error,
            error: response?.error || ""
          }, "*");
        })
        .catch((error) => {
          window.postMessage({
            source: APP_BRIDGE_SOURCE,
            type: APP_BRIDGE_MESSAGE_TYPES.error,
            error: error?.message || "Falha ao abrir WhatsApp Web"
          }, "*");
        });
    }
  });

  announce();
}
