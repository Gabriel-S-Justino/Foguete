import { useEffect, useState } from 'react';
import { sceneManager, type SceneController, type SceneFactory } from '../engine/core/SceneManager';

/** Mostra uma cena Babylon para a tela atual; a troca descarta a cena anterior. */
export function useScene<T extends SceneController>(key: string, factory: SceneFactory<T>): T | null {
  const [ctrl, setCtrl] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    void sceneManager.show(key, factory).then((c) => { if (alive) setCtrl(c); });
    return () => { alive = false; };
    // a fábrica é estável por chave
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ctrl;
}
