export interface Character {
  name: string;
  description: string;
  prompt: string;
  imageUrl?: string;
}

export interface Scene {
  name: string;
  description: string;
  prompt: string;
  imageUrl?: string;
}

export interface Prop {
  name: string;
  description: string;
  prompt: string;
  imageUrl?: string;
}

export interface Shot {
  shotNumber: number;
  duration?: string;
  camera: string;
  action: string;
  dialogue: string;
  sfx: string;
  materials: string;
  prompt: string;
  episodeIndex?: number;
  videoUrl?: string;
  keyframes?: string[]; // 4 keyframe images
}

export interface ScriptData {
  title: string;
  logline: string;
  story: string;
  elements: {
    characters: Character[];
    scenes: Scene[];
    props: Prop[];
  };
  shots: Shot[];
}

export interface SavedScript extends ScriptData {
  id: string;
  createdAt: number;
  originalPrompt?: string;
}

// 全局「素材库」：跨剧本保存的素材（角色/场景/道具）图片与提示词
export interface LibraryMaterial {
  id: string;
  type: 'characters' | 'scenes' | 'props';
  name: string;
  description: string;
  prompt: string;
  imageUrl?: string;
  sourceScriptId?: string;
  sourceScriptTitle?: string;
  createdAt: number;
}
