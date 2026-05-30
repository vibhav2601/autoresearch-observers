import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSignals } from "../api/query-api";

const QUERY_KEY_STORAGE_KEY = "rd_query_key";

function subscribeQueryApiKey(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === QUERY_KEY_STORAGE_KEY) listener();
  };
  const onKeyChange = () => listener();
  window.addEventListener("storage", onStorage);
  window.addEventListener("workshop:api-key-change", onKeyChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("workshop:api-key-change", onKeyChange);
  };
}

function getQueryApiKeySnapshot(): string {
  return localStorage.getItem(QUERY_KEY_STORAGE_KEY) ?? "";
}

function getServerSnapshot(): string {
  return "";
}

export function useQueryApiKey(): string {
  return useSyncExternalStore(subscribeQueryApiKey, getQueryApiKeySnapshot, getServerSnapshot);
}

export function useQuerySignals(enabled: boolean) {
  return useQuery({
    queryKey: ["query-api", "signals"],
    queryFn: fetchSignals,
    enabled,
  });
}
