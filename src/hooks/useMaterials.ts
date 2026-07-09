import { useState } from 'react';
import { LibraryMaterial } from '../types';

const STORAGE_KEY = 'drama_materials';

function loadMaterials(): LibraryMaterial[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to parse stored materials', e);
  }
  return [];
}

export function useMaterials() {
  const [materials, setMaterials] = useState<LibraryMaterial[]>(loadMaterials);

  const persist = (next: LibraryMaterial[]) => {
    setMaterials(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  // 按 type+name 去重：已存在则就地更新，不存在则新增
  const addMaterial = (
    m: Omit<LibraryMaterial, 'id' | 'createdAt'>
  ): { added: boolean; id: string } => {
    const existing = materials.find(x => x.type === m.type && x.name === m.name);
    if (existing) {
      const next = materials.map(x =>
        x.type === m.type && x.name === m.name ? { ...x, ...m } : x
      );
      persist(next);
      return { added: false, id: existing.id };
    }
    const full: LibraryMaterial = {
      ...m,
      id: 'mat_' + Date.now() + '_' + Math.round(Math.random() * 1e6),
      createdAt: Date.now(),
    };
    persist([full, ...materials]);
    return { added: true, id: full.id };
  };

  const removeMaterial = (id: string) => {
    persist(materials.filter(x => x.id !== id));
  };

  const clearAll = () => {
    persist([]);
  };

  return { materials, addMaterial, removeMaterial, clearAll };
}
