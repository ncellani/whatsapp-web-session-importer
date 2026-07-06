// @ts-nocheck
import { IMPORT_HISTORY_CHAT_LIMIT, WHATSAPP_LOGGED_IN_SELECTORS } from "../shared/config";
import { clearWhatsAppWebLocalSessionData } from "./page-scripts/clear-local-session";
import { extractWhatsAppWebSidecarDump } from "./page-scripts/extract-history";
import { extractWhatsAppWebMainDump } from "./page-scripts/extract-session";
import { extractWhatsAppWebStorageInventory } from "./page-scripts/storage-inventory";

export async function executeScriptInPage(tabId, func, args = []) {
  try {
    return await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func,
      args
    });
  } catch (error) {
    if (!String((error && error.message) || "").includes("world")) {
      throw error;
    }
    return await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args
    });
  }
}

export async function isWhatsAppWebLoggedInTab(tabId) {
  const [result] = await executeScriptInPage(tabId, (selectors) => {
    const isVisibleElement = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    return selectors.some((selector) => {
      try {
        const element = document.querySelector(selector);
        return Boolean(element && isVisibleElement(element));
      } catch {
        return false;
      }
    });
  }, [WHATSAPP_LOGGED_IN_SELECTORS]);
  return result?.result === true;
}

export async function extractInventoryFromTab(tabId) {
  const [result] = await executeScriptInPage(tabId, extractWhatsAppWebStorageInventory);
  if (!result || !result.result) {
    throw new Error("Não foi possível diagnosticar o armazenamento");
  }
  if (result.result.error) {
    throw new Error(result.result.error);
  }
  return result.result.inventory;
}

export async function extractSidecarFromTab(tabId, options = {}) {
  const [result] = await executeScriptInPage(tabId, extractWhatsAppWebSidecarDump, [{
    historyChatLimit: IMPORT_HISTORY_CHAT_LIMIT,
    ...options
  }]);
  if (!result || !result.result) {
    throw new Error("Não foi possível capturar o histórico");
  }
  if (result.result.error) {
    throw new Error(result.result.error);
  }
  return result.result.dump;
}

export async function extractMainDumpFromTab(tabId, options = {}) {
  const [result] = await executeScriptInPage(tabId, extractWhatsAppWebMainDump, [options]);
  if (!result || !result.result) {
    throw new Error("Não foi possível capturar a sessão");
  }
  if (result.result.error) {
    throw new Error(result.result.error);
  }
  if (options.includeDump && result.result.dump && result.result.dump.dump) {
    return result.result.dump.dump;
  }
  return result.result.dump;
}

export async function clearWhatsAppWebLocalSessionFromTab(tab) {
  if (!tab || !tab.id) {
    throw new Error("Aba do WhatsApp Web indisponível para limpeza local");
  }
  const [result] = await executeScriptInPage(tab.id, clearWhatsAppWebLocalSessionData);
  if (!result || !result.result) {
    throw new Error("Não foi possível limpar os dados locais do WhatsApp Web");
  }
  if (result.result.error) {
    throw new Error(result.result.error);
  }
  return result.result.summary || { method: "page" };
}
