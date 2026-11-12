import { useEffect, useState } from 'react';
import type { ChatSnapshot, ProviderState } from '../shared/chat';

function useRemote<T>(get: () => Promise<T>, subscribe: (callback: (state: T) => void) => () => void) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true; let received = false;
    const off = subscribe(state => { received = true; if (live) setValue(state); });
    get().then(state => { if (live && !received) setValue(state); }).catch(error => { if (live) setError(String(error)); });
    return () => { live = false; off(); };
  }, [get, subscribe]);
  return { value, error };
}
export const useProvider = () => useRemote<ProviderState>(window.desktopPet.getProviderState, window.desktopPet.onProviderState);
export const useChat = () => useRemote<ChatSnapshot>(window.desktopPet.getChatSnapshot, window.desktopPet.onChatSnapshot);
