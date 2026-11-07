/**
 * localStorage erişimi gizli sekmede veya engellenmiş site verilerinde hata fırlatabilir;
 * tüm okuma/yazmalar güvenli sarmalayıcıdan geçer.
 * (Capacitor'a geçişte bu dosya @capacitor/preferences ile değiştirilecek tek nokta.)
 */
export function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    /* depolama kullanılamıyor: sessizce yoksay */
  }
}
