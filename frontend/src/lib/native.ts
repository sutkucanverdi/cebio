/**
 * Capacitor (iOS/Android) ile web arasındaki farkları tek yerde toplar.
 * Web'de tüm fonksiyonlar sessizce hiçbir şey yapmaz.
 */
import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = (): boolean => Capacitor.isNativePlatform();

/** Durum çubuğu ikonlarını temaya göre aç/koyu yapar. */
export async function syncStatusBar(darkMode: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: darkMode ? Style.Dark : Style.Light });
  } catch {
    /* eski cihaz / desteklenmiyor */
  }
}

/**
 * Android geri tuşu: `active` iken basılınca handler çalışır (örn. açık pencereyi kapat).
 * Hiç dinleyici yokken Capacitor varsayılanı geçerlidir (geri git / uygulamadan çık).
 */
export function useAndroidBack(handler: () => void, active = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active || Capacitor.getPlatform() !== 'android') return;
    let listener: PluginListenerHandle | null = null;
    let cancelled = false;
    App.addListener('backButton', () => handlerRef.current()).then((l) => {
      if (cancelled) void l.remove();
      else listener = l;
    });
    return () => {
      cancelled = true;
      void listener?.remove();
    };
  }, [active]);
}
