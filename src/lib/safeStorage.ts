export function safeGetStorageItem(key: string) {
  try {
    return getLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSetStorageItem(key: string, value: string) {
  try {
    getLocalStorage()?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemoveStorageItem(key: string) {
  try {
    getLocalStorage()?.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeReadJson<T>(key: string, fallback: T): T {
  const raw = safeGetStorageItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getLocalStorage() {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
