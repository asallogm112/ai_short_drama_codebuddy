import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { LibraryMaterial } from '../types';

interface MaterialsContextValue {
  materials: LibraryMaterial[];
  loaded: boolean;
  addMaterial: (m: Omit<LibraryMaterial, 'id' | 'createdAt'>) => { added: boolean; id: string };
  removeMaterial: (id: string) => void;
  clearAll: () => void;
}

const MaterialsContext = createContext<MaterialsContextValue | null>(null);

export function MaterialsProvider({ children }: { children: ReactNode }) {
  const [materials, setMaterials] = useState<LibraryMaterial[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/materials').then(r => r.json()).then((data: LibraryMaterial[]) => {
      setMaterials(data || []);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const persist = useCallback((next: LibraryMaterial[]) => {
    setMaterials(next);
  }, []);

  const addMaterial = useCallback((m: Omit<LibraryMaterial, 'id' | 'createdAt'>): { added: boolean; id: string } => {
    const existing = materials.find(x => x.type === m.type && x.name === m.name);
    if (existing) {
      const next = materials.map(x => x.type === m.type && x.name === m.name ? { ...x, ...m } : x);
      persist(next);
      fetch('/api/materials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ material: { ...existing, ...m } }) }).catch(() => {});
      return { added: false, id: existing.id };
    }
    const full: LibraryMaterial = { ...m, id: 'mat_' + Date.now() + '_' + Math.round(Math.random() * 1e6), createdAt: Date.now() };
    persist([full, ...materials]);
    fetch('/api/materials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ material: full }) }).catch(() => {});
    return { added: true, id: full.id };
  }, [materials, persist]);

  const removeMaterial = useCallback((id: string) => {
    persist(materials.filter(x => x.id !== id));
    fetch(`/api/materials/${id}`, { method: 'DELETE' }).catch(() => {});
  }, [materials, persist]);

  const clearAll = useCallback(() => {
    persist([]);
    fetch('/api/materials', { method: 'DELETE' }).catch(() => {});
  }, [persist]);

  return (
    <MaterialsContext.Provider value={{ materials, loaded, addMaterial, removeMaterial, clearAll }}>
      {children}
    </MaterialsContext.Provider>
  );
}

export function useMaterials(): MaterialsContextValue {
  const ctx = useContext(MaterialsContext);
  if (!ctx) throw new Error('useMaterials must be used within MaterialsProvider');
  return ctx;
}
