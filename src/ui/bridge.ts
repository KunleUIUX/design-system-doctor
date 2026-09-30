import { useEffect } from 'preact/hooks';
import type { MainToUi, UiToMain } from '../shared/messages';

export function send(msg: UiToMain) {
  parent.postMessage({ pluginMessage: msg }, '*');
}

export function useMainMessages(handler: (msg: MainToUi) => void) {
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      const msg = e.data?.pluginMessage as MainToUi | undefined;
      if (msg && typeof msg === 'object' && 'type' in msg) handler(msg);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [handler]);
}
