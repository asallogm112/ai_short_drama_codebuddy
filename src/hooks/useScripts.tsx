import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { SavedScript } from '../types';

interface ScriptsContextValue {
  scripts: SavedScript[];
  loaded: boolean;
  saveScript: (script: SavedScript) => void;
  getScript: (id: string) => SavedScript | undefined;
  deleteScript: (id: string) => void;
  updateScript: (id: string, updatedScript: SavedScript) => void;
}

const ScriptsContext = createContext<ScriptsContextValue | null>(null);

export function ScriptsProvider({ children }: { children: ReactNode }) {
  const [scripts, setScripts] = useState<SavedScript[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/scripts').then(r => r.json()).then((data: SavedScript[]) => {
      setScripts(data || []);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const saveScript = useCallback((script: SavedScript) => {
    setScripts(prev => [script, ...prev]);
    fetch('/api/scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(script) }).catch(() => {});
  }, []);

  const getScript = useCallback((id: string) => scripts.find(s => s.id === id), [scripts]);

  const deleteScript = useCallback((id: string) => {
    setScripts(prev => prev.filter(s => s.id !== id));
    fetch(`/api/scripts/${id}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const updateScript = useCallback((id: string, updatedScript: SavedScript) => {
    setScripts(prev => prev.map(s => s.id === id ? updatedScript : s));
    fetch('/api/scripts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updatedScript) }).catch(() => {});
  }, []);

  return (
    <ScriptsContext.Provider value={{ scripts, loaded, saveScript, getScript, deleteScript, updateScript }}>
      {children}
    </ScriptsContext.Provider>
  );
}

export function useScripts(): ScriptsContextValue {
  const ctx = useContext(ScriptsContext);
  if (!ctx) throw new Error('useScripts must be used within ScriptsProvider');
  return ctx;
}
