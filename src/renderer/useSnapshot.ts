import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../shared/types';

export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    let received = false;
    const unsubscribe = window.desktopPet.onSnapshot(value => { received = true; if (live) setSnapshot(value); });
    window.desktopPet.getSnapshot().then(value => { if (live && !received) setSnapshot(value); }).catch(error => { if (live) setError(String(error)); });
    return () => { live = false; unsubscribe(); };
  }, []);
  return { snapshot, error };
}
