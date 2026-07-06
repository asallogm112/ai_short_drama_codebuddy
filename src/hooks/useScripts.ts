import { useState } from 'react';
import { SavedScript } from '../types';

function loadScripts(): SavedScript[] {
  try {
    const stored = localStorage.getItem('drama_scripts');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to parse stored scripts', e);
  }
  return [];
}

export function useScripts() {
  const [scripts, setScripts] = useState<SavedScript[]>(loadScripts);

  const saveScript = (script: SavedScript) => {
    const updated = [script, ...scripts];
    setScripts(updated);
    localStorage.setItem('drama_scripts', JSON.stringify(updated));
  };

  const getScript = (id: string) => {
    return scripts.find(s => s.id === id);
  };

  const deleteScript = (id: string) => {
    const updated = scripts.filter(s => s.id !== id);
    setScripts(updated);
    localStorage.setItem('drama_scripts', JSON.stringify(updated));
  };

  const updateScript = (id: string, updatedScript: SavedScript) => {
    const updated = scripts.map(s => s.id === id ? updatedScript : s);
    setScripts(updated);
    localStorage.setItem('drama_scripts', JSON.stringify(updated));
  };

  return { scripts, saveScript, getScript, deleteScript, updateScript };
}
