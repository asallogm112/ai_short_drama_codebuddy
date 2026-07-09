import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useScripts } from '../hooks/useScripts';
import { useMaterials } from '../hooks/useMaterials';
import { 
  ArrowLeft, 
  BookOpen, 
  Users, 
  Video, 
  Camera,
  Image as ImageIcon,
  Box,
  MapPin,
  Copy,
  ChevronDown,
  ChevronUp,
  Upload,
  Plus,
  X,
  Sparkles,
  Film,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  Download,
  Play,
  BookmarkPlus,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// 压缩图片 data URL：限制最长边为 maxSize px，保存到 localStorage 防超限
const compressDataUrl = (dataUrl: string, maxSize = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        const ratio = Math.min(maxSize / w, maxSize / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

// 将 prompt 中的绝对时间戳（如 00:10-00:12）转为相对时间（如 0-2秒），基于 shot.duration 计算偏移
const convertToRelativeTime = (text: string, durationStartSec: number): string => {
  if (!text || durationStartSec === 0) return text;
  return text.replace(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/g, (match, h1, m1, h2, m2) => {
    const startSec = parseInt(h1) * 60 + parseInt(m1);
    const endSec = parseInt(h2) * 60 + parseInt(m2);
    const relStart = startSec - durationStartSec;
    const relEnd = endSec - durationStartSec;
    if (relStart < 0 || relEnd < 0) return match;
    return `${relStart}-${relEnd}秒`;
  });
};

const formatPromptWithPrefix = (name: string, prompt: string, type: 'characters' | 'scenes' | 'props') => {
  if (!name || !prompt) return prompt;
  const cleanName = name.trim();
  
  // Remove any existing prefix like "R1_林薇 :  ", "R1_林薇: ", "R1_林薇 ：", etc.
  const escapedName = cleanName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const prefixRegex = new RegExp(`^${escapedName}\\s*[:：]\\s*`, 'i');
  let cleanPrompt = prompt.trim().replace(prefixRegex, '');
  
  // Also remove generic asset ID patterns just in case (e.g. ^R\d+_[^:]+:\s*)
  const genericPrefixRegex = /^[RSP]\d+_[^:：]+[:：]\s*/i;
  cleanPrompt = cleanPrompt.replace(genericPrefixRegex, '');

  if (type === 'characters') {
    const targetKeywords = "全身像，角色三视图设定图";
    if (!cleanPrompt.includes("全身像") || !cleanPrompt.includes("角色三视图")) {
      cleanPrompt = `${targetKeywords}，${cleanPrompt}`;
    }
    // Remove "比例 3:1", "比例3:1", "3:1", "比例为3:1", etc.
    cleanPrompt = cleanPrompt.replace(/比例\s*为?\s*3\s*:\s*1/gi, '');
    cleanPrompt = cleanPrompt.replace(/3\s*:\s*1/g, '');
    
    // Remove any existing "16:9" variations to prevent duplication
    cleanPrompt = cleanPrompt.replace(/(图片|比例)?\s*比例?\s*为?\s*16\s*:\s*9/gi, '');
    cleanPrompt = cleanPrompt.replace(/16\s*:\s*9/g, '');

    // Ensure "图片比例 : 16:9" is present
    cleanPrompt = `${cleanPrompt}，图片比例 : 16:9`;
  }

  // Clean any existing suffix to prevent duplication
  const suffixPattern = /[，,、]?\s*(生成|只生成)\s*1\s*张(图片)?\s*,\s*如果\s*生成过\s*,\s*就不要再生成了\s*\.?\s*(切记\s*切记\s*,\s*因为要\s*保证\s*一致性\s*!)?/gi;
  cleanPrompt = cleanPrompt.replace(suffixPattern, '');
  cleanPrompt = cleanPrompt.replace(/[，,、]?\s*切记\s*切记\s*,\s*因为要\s*保证\s*一致性\s*!/gi, '');

  // Clean trailing punctuation and spaces
  cleanPrompt = cleanPrompt.trim().replace(/[，。,\.\s]+$/, '');

  // Append the sentence
  cleanPrompt = `${cleanPrompt}，只生成 1 张图片 , 如果 生成过 , 就不要再生成了 . 切记 切记 , 因为要 保证 一致性  !`;

  // Exactly 2 spaces before, and exactly 2 spaces after the colon to satisfy "前后隔空数量也必须一样"
  return `${cleanName}  :  ${cleanPrompt.trim()}`;
};

// 规范化 @xx 标签：去掉 @ 后多余空格、修正连续 @@
const normalizePromptTags = (text: string): string => {
  if (!text) return text;
  return text.replace(/@\s+/g, '@').replace(/@{2,}/g, '@')
    .replace(/@([RSP]\d+)\s+_/g, '@$1_')
    .replace(/@([RSP]\d+(?:_[^\s@，。！？、：；""''（）()【】\[\]…—~·]+)?)\s+_/g, '@$1_');
};

// 从提示词提取唯一 @R/@S/@P 标签
const extractMaterialTags = (text: string): string[] => {
  if (!text) return [];
  const re = /@[RSP]\d+(?:_[^\s@，。！？、：；""''（）()【】\[\]…—~·]+)?/g;
  const found = text.match(re) || [];
  return Array.from(new Set(found.map(t => t.trim()).filter(Boolean)));
};

// 清洗音效：移除老数据尾巴块 [音效/背景音乐: xxx] 以及音效前面的时间前缀（如"0-3秒 音效："→"音效："）
const stripAudioTail = (text: string): string => text
  .replace(/\[音效\s*\/\s*背景音乐[^\]]*\]/g, '')
  .replace(/\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\s+音效：/g, '音效：')
  .replace(/\d+-\d+\s*秒\s*音效：/g, '音效：')
  .trim();

const cleanDuplicateDurations = (duration: string, text: string): string => {
  if (!text) return '';
  let result = text.trim();
  if (!duration) return result;

  const durationClean = duration.replace(/[\[\]]/g, '').trim();
  const durationNoSpaces = durationClean.replace(/\s+/g, '');

  const escapedClean = durationClean.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const escapedNoSpaces = durationNoSpaces.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

  const regex = new RegExp(
    `^(?:\\[?(?:${escapedClean}|${escapedNoSpaces})\\]?)[\\s,，:：、]*`,
    'gi'
  );

  let previousResult = '';
  while (result !== previousResult) {
    previousResult = result;
    result = result.replace(regex, '').trim();
  }

  return result;
};

const formatPromptTags = (text: string, elementNames: string[] = [], elementsList: any[] = []): string => {
  if (!text) return text;
  
  interface ParsedElement {
    fullName: string;
    code: string;
    cleanName: string;
    synonyms?: string[];
  }

  const parsedElements: ParsedElement[] = [];

  const femaleCharsCount = elementsList.filter((c: any) => {
    if (c.elementType !== 'characters') return false;
    const cName = (c.name || '').split('_').slice(1).join('_');
    const cDesc = c.description || "";
    return /女|妈|妻|姐|妹|婆|女|薇|雪|雅|颖|馨|倩|娜|婷|莉/i.test(cName) || /女|女性|女孩|女子|少女|女人/i.test(cDesc);
  }).length;

  const maleCharsCount = elementsList.filter((c: any) => {
    if (c.elementType !== 'characters') return false;
    const cName = (c.name || '').split('_').slice(1).join('_');
    const cDesc = c.description || "";
    return /男|爸|夫|哥|弟|爷|公|峰|强|超|军|平|明|刚|杰|涛|波|辉|健/i.test(cName) || /男|男性|男孩|男子|男人/i.test(cDesc);
  }).length;

  elementNames.forEach(fullName => {
    const parts = fullName.trim().split('_');
    const code = parts[0];
    const cleanName = parts.slice(1).join('_');
    if (fullName && code) {
      parsedElements.push({
        fullName,
        code,
        cleanName,
        synonyms: [cleanName]
      });
    }
  });

  const tagNames: string[] = [];
  elementNames.forEach(name => {
    tagNames.push(name);
    const prefix = name.split('_')[0];
    if (prefix && prefix !== name) {
      tagNames.push(prefix);
    }
  });
  
  const uniqueTags = Array.from(new Set(tagNames)).filter(Boolean);
  uniqueTags.sort((a, b) => b.length - a.length);
  
  let tagRegex: RegExp;
  if (uniqueTags.length > 0) {
    const escapedTags = uniqueTags.map(t => t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    tagRegex = new RegExp('(@(?:' + escapedTags.join('|') + '))', 'g');
  } else {
    tagRegex = /(@[RSP]\d+(?:_[A-Za-z0-9_\u4e00-\u9fa5]+)?)/g;
  }
  
  // 1. Initial split
  const parts = text.split(tagRegex);
  
  // 2. Expand short tags (e.g. @R1 -> @R1_林薇)
  for (let i = 1; i < parts.length; i += 2) {
    const tag = parts[i];
    if (tag.startsWith('@')) {
      const tagContent = tag.substring(1);
      if (/^[RSP]\d+$/.test(tagContent)) {
        const matchedEl = parsedElements.find(el => el.code === tagContent);
        if (matchedEl) {
          parts[i] = `@${matchedEl.fullName}`;
        }
      }
    }
  }
  
  // 3. Process non-tag segments to auto-tag clean names and synonyms
  interface Replacement {
    term: string;
    fullName: string;
  }
  const replacements: Replacement[] = [];
  
  parsedElements.forEach(el => {
    if (el.cleanName) {
      replacements.push({ term: el.cleanName, fullName: el.fullName });
    }
    if (el.synonyms) {
      el.synonyms.forEach(syn => {
        replacements.push({ term: syn, fullName: el.fullName });
      });
    }
  });
  
  // Sort replacements by term length descending
  replacements.sort((a, b) => b.term.length - a.term.length);

  const tagCleanNames = (segmentText: string): string => {
    if (!segmentText) return '';
    let segments = [segmentText];
    
    for (const r of replacements) {
      const nextSegments: string[] = [];
      for (const seg of segments) {
        // 跳过已包含 @ 的片段，避免已存在的 @R2_阿秀 被"阿秀"再次拆分
        if (seg.includes('@')) {
          nextSegments.push(seg);
        } else {
          const subParts = seg.split(r.term);
          for (let k = 0; k < subParts.length; k++) {
            nextSegments.push(subParts[k]);
            if (k < subParts.length - 1) {
              nextSegments.push(`@${r.fullName}`);
            }
          }
        }
      }
      segments = nextSegments;
    }
    return segments.join('');
  };

  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = tagCleanNames(parts[i]);
  }

  // 4. Re-split and normalize space format
  const finalJoined = parts.join('');
  const finalParts = finalJoined.split(tagRegex);
  
  let result = '';
  for (let i = 0; i < finalParts.length; i++) {
    let part = finalParts[i];
    if (i % 2 === 1) {
      result += part;
    } else {
      if (i < finalParts.length - 1) {
        part = part.trimEnd() + "  ";
      }
      if (i > 0) {
        part = "  " + part.trimStart();
      }
      result += part;
    }
  }
  return result;
};

const InteractiveTag = ({
  part,
  colorClass,
  matchedEl,
  script,
  updateScript,
  copyToClipboard,
}: {
  part: string;
  colorClass: string;
  matchedEl: any;
  script: any;
  updateScript: any;
  copyToClipboard: (text: string, label?: string) => void;
  key?: any;
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const hideTimeoutRef = React.useRef<any>(null);

  React.useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnter = (e: React.MouseEvent) => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setCoords({
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
    });
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 150);
  };

  const handleTooltipMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setShowTooltip(true);
  };

  const handleTooltipMouseLeave = () => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 150);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && script && matchedEl) {
      const { elementType, elementIndex } = matchedEl;
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          const newElements = [...script.elements[elementType]];
          newElements[elementIndex] = {
            ...newElements[elementIndex],
            imageUrl: dataUrl
          };
          const newScript = {
            ...script,
            elements: {
              ...script.elements,
              [elementType]: newElements
            }
          };
          updateScript(script.id, newScript);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  const hasImage = !!(matchedEl && matchedEl.imageUrl);
  const promptToCopy = matchedEl && matchedEl.prompt
    ? formatPromptWithPrefix(matchedEl.name, matchedEl.prompt, matchedEl.elementType)
    : part;

  return (
    <>
      <span 
        className={cn(
          "inline-block font-black text-sm tracking-wide px-2 py-0.5 rounded border-2 shadow transition-all duration-150 select-all relative cursor-help hover:scale-105 hover:z-[60]",
          colorClass
        )}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {part}
        
        {/* Hidden File Input */}
        {matchedEl && (
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleFileChange}
          />
        )}
      </span>

      {/* Hover Popup Card Portal */}
      {showTooltip && createPortal(
        <div 
          style={{
            position: 'absolute',
            top: `${coords.top - 8}px`,
            left: `${coords.left + coords.width / 2}px`,
            transform: 'translateX(-50%) translateY(-100%)',
            zIndex: 9999,
            pointerEvents: 'auto',
          }}
          className="w-52 cursor-default select-text animate-in fade-in zoom-in-95 duration-150"
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <span className="block bg-white border border-neutral-200 rounded-xl shadow-2xl overflow-hidden text-neutral-800 font-sans text-left">
            {/* Image Header Area */}
            <div className="relative aspect-square w-full bg-neutral-100 border-b border-neutral-100 group/image overflow-hidden">
              {hasImage ? (
                <>
                  <img 
                    src={matchedEl.imageUrl} 
                    alt={part} 
                    className="w-full h-full object-cover animate-in fade-in duration-200" 
                    referrerPolicy="no-referrer"
                  />
                  {matchedEl && (
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        triggerUpload();
                      }}
                      className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/image:opacity-100 transition-opacity duration-200 cursor-pointer"
                    >
                      <span className="text-white text-xs bg-black/60 px-2.5 py-1.5 rounded-full border border-white/20 hover:bg-black/80 font-semibold flex items-center space-x-1 shadow">
                        <Upload className="w-3.5 h-3.5" />
                        <span>更换图片</span>
                      </span>
                    </button>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
                  <ImageIcon className="w-8 h-8 text-neutral-300 mb-2" />
                  <span className="text-xs text-neutral-400">暂无参考图</span>
                  {matchedEl && (
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        triggerUpload();
                      }}
                      className="mt-3 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-lg font-bold flex items-center space-x-1 shadow-sm transition-all cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>上传参考图</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Details Area */}
            <div className="p-3 bg-neutral-50/95 border-t border-neutral-100">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-black text-neutral-800 truncate select-all">{part}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    copyToClipboard?.(promptToCopy, '提示词');
                  }}
                  className="text-neutral-400 hover:text-indigo-600 p-1 rounded hover:bg-neutral-200/60 transition-colors cursor-pointer"
                  title="复制提示词"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              {matchedEl && matchedEl.description ? (
                <p className="text-[11px] text-neutral-500 leading-normal whitespace-normal line-clamp-3 font-normal">
                  {matchedEl.description}
                </p>
              ) : (
                <p className="text-[10px] text-neutral-400 italic">暂无描述</p>
              )}
            </div>
          </span>
        </div>,
        document.body
      )}
    </>
  );
};

const InteractiveMaterialCard = ({
  m,
  script,
  updateScript,
  copyToClipboard,
}: {
  m: any;
  script: any;
  updateScript: any;
  copyToClipboard: (text: string, label?: string) => void;
  key?: any;
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const hasImage = !!(m.item && (m.item as any).imageUrl);

  const promptToCopy = m.item && (m.item as any).prompt
    ? formatPromptWithPrefix((m.item as any).name, (m.item as any).prompt, (m.item as any).elementType)
    : m.name;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && script && m.item) {
      const { elementType, elementIndex } = m.item;
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          const newElements = [...script.elements[elementType]];
          newElements[elementIndex] = {
            ...newElements[elementIndex],
            imageUrl: dataUrl
          };
          const newScript = {
            ...script,
            elements: {
              ...script.elements,
              [elementType]: newElements
            }
          };
          updateScript(script.id, newScript);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  return (
    <div 
      className={cn(
        "flex items-center space-x-2 border rounded-md p-1 pr-3 shadow-sm transition-all duration-150 relative group cursor-help hover:scale-105 hover:z-[60]",
        m.colorClass
      )}
    >
      {/* Hidden File Input */}
      {m.item && (
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*" 
          onChange={handleFileChange}
        />
      )}

      {hasImage ? (
        <img src={(m.item as any).imageUrl} alt={m.name} className="w-7 h-7 rounded object-cover bg-white" />
      ) : (
        <div className="w-7 h-7 rounded bg-white/60 flex items-center justify-center">
          <ImageIcon className="w-3.5 h-3.5 opacity-50" />
        </div>
      )}
      <div className="flex flex-col">
        <span className="text-[9px] font-bold opacity-70 leading-none mb-0.5">{m.typeLabel}</span>
        <span className="text-xs font-medium leading-none">{m.name}</span>
      </div>

      {/* Hover Popup Card Wrapper */}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 w-52 hidden group-hover:block z-50 cursor-default select-text animate-in fade-in zoom-in-95 duration-150">
        <span className="block bg-white border border-neutral-200 rounded-xl shadow-2xl overflow-hidden text-neutral-800 font-sans text-left">
          {/* Image Header Area */}
          <div className="relative aspect-square w-full bg-neutral-100 border-b border-neutral-100 group/image overflow-hidden">
            {hasImage ? (
              <>
                <img 
                  src={(m.item as any).imageUrl} 
                  alt={m.name} 
                  className="w-full h-full object-cover animate-in fade-in duration-200" 
                  referrerPolicy="no-referrer"
                />
                {m.item && (
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      triggerUpload();
                    }}
                    className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/image:opacity-100 transition-opacity duration-200 cursor-pointer"
                  >
                    <span className="text-white text-xs bg-black/60 px-2.5 py-1.5 rounded-full border border-white/20 hover:bg-black/80 font-semibold flex items-center space-x-1 shadow">
                      <Upload className="w-3.5 h-3.5" />
                      <span>更换图片</span>
                    </span>
                  </button>
                )}
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
                <ImageIcon className="w-8 h-8 text-neutral-300 mb-2" />
                <span className="text-xs text-neutral-400">暂无参考图</span>
                {m.item && (
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      triggerUpload();
                    }}
                    className="mt-3 text-xs text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-3 py-1.5 rounded-lg font-bold flex items-center space-x-1 shadow-sm transition-all cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>上传参考图</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Details Area */}
          <div className="p-3 bg-neutral-50/95 border-t border-neutral-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-black text-neutral-800 truncate select-all">{m.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard?.(promptToCopy, '提示词');
                }}
                className="text-neutral-400 hover:text-indigo-600 p-1 rounded hover:bg-neutral-200/60 transition-colors cursor-pointer"
                title="复制提示词"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
            {m.item && (m.item as any).description ? (
              <p className="text-[11px] text-neutral-500 leading-normal whitespace-normal line-clamp-3 font-normal">
                {(m.item as any).description}
              </p>
            ) : (
              <p className="text-[10px] text-neutral-400 italic">暂无描述</p>
            )}
          </div>
        </span>
      </span>
    </div>
  );
};

const renderEnhancedPrompt = (
  promptText: string,
  elementNames: string[] = [],
  elements: any[] = [],
  script?: any,
  updateScript?: any,
  copyToClipboard?: any
) => {
  if (!promptText) return null;
  
  // 显示时清洗残留的音效/背景音乐尾巴块（已存的旧数据也可能有）
  const cleanText = stripAudioTail(promptText)
    .replace(/\s{2,}/g, ' ')
    .trim();
  const formattedText = formatPromptTags(cleanText, elementNames, elements);
  
  const tagNames: string[] = [];
  elementNames.forEach(name => {
    tagNames.push(name);
    const prefix = name.split('_')[0];
    if (prefix && prefix !== name) {
      tagNames.push(prefix);
    }
  });
  
  const uniqueTags = Array.from(new Set(tagNames)).filter(Boolean);
  uniqueTags.sort((a, b) => b.length - a.length);
  
  let tagRegex: RegExp;
  if (uniqueTags.length > 0) {
    const escapedTags = uniqueTags.map(t => t.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    tagRegex = new RegExp('(@(?:' + escapedTags.join('|') + '))', 'g');
  } else {
    tagRegex = /(@[RSP]\d+(?:_[A-Za-z0-9_\u4e00-\u9fa5]+)?)/g;
  }
  
  const parts = formattedText.split(tagRegex);
  const formattedElements: React.ReactNode[] = [];
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      // This is a tag match (e.g. "@R2_姜逸")
      const typeMatch = part.match(/@([RSP])/);
      const type = typeMatch ? typeMatch[1] : '';
      
      let colorClass = "text-neutral-900 bg-neutral-100 border-neutral-300";
      if (type === 'R') {
        colorClass = "text-blue-800 bg-blue-100/80 border-blue-300";
      } else if (type === 'S') {
        colorClass = "text-emerald-800 bg-emerald-100/80 border-emerald-300";
      } else if (type === 'P') {
        colorClass = "text-amber-800 bg-amber-100/80 border-amber-300";
      }
      
      const cleanPart = part.trim().replace(/^@/, '');
      const matchedEl = elements.find(el => {
        if (!el.name) return false;
        return el.name.trim().replace(/^@/, '') === cleanPart;
      });
      
      formattedElements.push(
        <InteractiveTag
          key={`tag-${i}`}
          part={part}
          colorClass={colorClass}
          matchedEl={matchedEl}
          script={script}
          updateScript={updateScript}
          copyToClipboard={copyToClipboard}
        />
      );
    } else {
      formattedElements.push(<span key={`text-${i}`}>{part}</span>);
    }
  }
  
  return <>{formattedElements}</>;
};

const CollapsiblePrompt = ({ 
  title, 
  prompt, 
  hoverClass, 
  onCopy,
  onSave,
  onRegenerate,
  onSaveToLibrary,
  regenerating
}: { 
  title: string, 
  prompt: string, 
  hoverClass: string, 
  onCopy: () => void,
  onSave?: (newPrompt: string) => void,
  onRegenerate?: () => Promise<void>,
  onSaveToLibrary?: () => void,
  regenerating?: boolean
}) => {
  const [expanded, setExpanded] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(prompt);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Sync editedText with prompt if prompt changes
  React.useEffect(() => {
    setEditedText(prompt);
  }, [prompt]);

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSave) {
      onSave(editedText);
    }
    setIsEditing(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditedText(prompt);
    setIsEditing(false);
  };

  const handleRegenerateClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRegenerate) return;
    setIsRegenerating(true);
    try {
      await onRegenerate();
    } catch (err) {
      console.error(err);
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="pl-3 pr-3 py-4 bg-neutral-50 relative group/prompt border-t border-neutral-100 text-left">
      <div 
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center space-x-2 text-neutral-500 hover:text-indigo-600 transition-colors">
          <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
        
        <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
          <button 
            type="button"
            onClick={onCopy}
            className={`p-1.5 bg-white border border-neutral-200 shadow-sm rounded text-neutral-500 transition-all flex items-center justify-center hover:shadow-sm ${hoverClass}`}
          >
            <Copy className="w-3 h-3 text-current" />
          </button>

          {onSaveToLibrary && (
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); onSaveToLibrary(); }}
              title="保存到素材库"
              className="p-1.5 bg-white border border-neutral-200 shadow-sm rounded text-neutral-500 hover:bg-indigo-50 hover:text-indigo-600 transition-all flex items-center justify-center"
            >
              <BookmarkPlus className="w-3 h-3 text-current" />
            </button>
          )}

          {onSave && !isEditing && (
            <button 
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded(true); setIsEditing(true); }}
              className="p-1.5 bg-white border border-neutral-200 shadow-sm rounded text-neutral-500 hover:bg-neutral-50 hover:text-indigo-600 transition-all flex items-center justify-center"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}

          {onRegenerate && (
            <button 
              type="button"
              onClick={handleRegenerateClick}
              disabled={isRegenerating || regenerating}
              className="p-1.5 bg-white border border-neutral-200 shadow-sm rounded text-neutral-500 hover:bg-neutral-50 hover:text-indigo-600 transition-all flex items-center justify-center disabled:opacity-50"
            >
              {isRegenerating || regenerating ? (
                <Loader2 className="w-3 h-3 animate-spin text-current" />
              ) : (
                <Sparkles className="w-3 h-3 text-current" />
              )}
            </button>
          )}
        </div>
      </div>
      
      {expanded && (
        <div className="mt-3">
          {isEditing ? (
            <div className="space-y-2 bg-white p-3.5 rounded-lg border border-neutral-200" onClick={(e) => e.stopPropagation()}>
              <textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={4}
                className="w-full text-xs font-mono text-neutral-800 leading-relaxed p-2.5 border border-neutral-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <div className="flex justify-end space-x-1.5">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-2.5 py-1 text-[11px] border border-neutral-200 bg-white hover:bg-neutral-50 rounded font-semibold text-neutral-600 transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="px-2.5 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-700 rounded font-semibold text-white transition-colors"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs font-mono text-neutral-600 leading-relaxed break-words bg-white p-3.5 rounded-lg border border-neutral-200 max-h-[187px] overflow-y-auto">
              {prompt.replace(/\\_/g, '')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export function Detail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getScript, deleteScript, updateScript } = useScripts();
  const { addMaterial } = useMaterials();
  
  const script = getScript(id || '');
  const elements = script ? [
    ...(script.elements?.characters || []).map((char: any, index: number) => ({ ...char, elementType: 'characters', elementIndex: index })),
    ...(script.elements?.scenes || []).map((scene: any, index: number) => ({ ...scene, elementType: 'scenes', elementIndex: index })),
    ...(script.elements?.props || []).map((prop: any, index: number) => ({ ...prop, elementType: 'props', elementIndex: index }))
  ] : [];
  const elementNames = elements.map((el: any) => el.name).filter(Boolean);
  const [activeTab, setActiveTab] = useState<'story' | 'elements' | 'shots'>('story');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);

  const [isFullStoryCollapsed, setIsFullStoryCollapsed] = useState<boolean>(false);
  const [isEpisodeListCollapsed, setIsEpisodeListCollapsed] = useState<boolean>(true);
  const [collapsedEpisodes, setCollapsedEpisodes] = useState<Record<number, boolean>>({});
  const [collapsedShotsEpisodes, setCollapsedShotsEpisodes] = useState<Record<number, boolean>>({});

  // Synchronize all folding states when script ID loads or changes
  useEffect(() => {
    if (!script?.id) return;

    // 1. Full story outline collapse state (Default: expanded, false)
    const savedFullStory = localStorage.getItem(`script_full_story_collapsed_${script.id}`);
    setIsFullStoryCollapsed(savedFullStory === 'true');

    // 2. Episode list container collapse state (Default: collapsed, true)
    const savedEpisodeList = localStorage.getItem(`script_episode_list_collapsed_${script.id}`);
    setIsEpisodeListCollapsed(savedEpisodeList !== null ? savedEpisodeList === 'true' : true);

    // 3. Individual episode summary cards collapse state (Default: collapsed, true)
    const savedEpisodes = localStorage.getItem(`script_episodes_collapsed_map_${script.id}`);
    if (savedEpisodes) {
      try {
        setCollapsedEpisodes(JSON.parse(savedEpisodes));
      } catch (e) {
        setCollapsedEpisodes({});
      }
    } else {
      setCollapsedEpisodes({});
    }

    // 4. Video shot episode list collapse state (Default: collapsed, true)
    const savedShots = localStorage.getItem(`script_shots_episodes_collapsed_map_${script.id}`);
    if (savedShots) {
      try {
        setCollapsedShotsEpisodes(JSON.parse(savedShots));
      } catch (e) {
        setCollapsedShotsEpisodes({});
      }
    } else {
      setCollapsedShotsEpisodes({});
    }

    // 5. Load merged videos from script data
    const savedMerged = (script as any).mergedVideos;
    if (savedMerged && typeof savedMerged === 'object') {
      setMergedVideos(savedMerged);
    }
  }, [script?.id]);

  const toggleFullStory = () => {
    if (!script?.id) return;
    const newVal = !isFullStoryCollapsed;
    setIsFullStoryCollapsed(newVal);
    localStorage.setItem(`script_full_story_collapsed_${script.id}`, newVal.toString());
  };

  const toggleEpisodeList = () => {
    if (!script?.id) return;
    const newVal = !isEpisodeListCollapsed;
    setIsEpisodeListCollapsed(newVal);
    localStorage.setItem(`script_episode_list_collapsed_${script.id}`, newVal.toString());
  };

  const toggleEpisode = (index: number) => {
    if (!script?.id) return;
    const isCurrentlyCollapsed = collapsedEpisodes[index] ?? true;
    const newVal = !isCurrentlyCollapsed;
    const next = { ...collapsedEpisodes, [index]: newVal };
    setCollapsedEpisodes(next);
    localStorage.setItem(`script_episodes_collapsed_map_${script.id}`, JSON.stringify(next));
  };

  const toChineseNumeral = (num: number) => {
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    if (num <= 10) return digits[num];
    if (num < 20) return `十${digits[num % 10] === '零' ? '' : digits[num % 10]}`;
    const ten = Math.floor(num / 10);
    const one = num % 10;
    return `${digits[ten]}十${one === 0 ? '' : digits[one]}`;
  };

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastTimeoutId, setToastTimeoutId] = useState<any>(null);

  // 新建集数 弹窗相关状态
  const [isCreateEpisodeOpen, setIsCreateEpisodeOpen] = useState(false);
  const [createEpActiveTab, setCreateEpActiveTab] = useState<'ai_write' | 'existing_script' | 'video_recreate'>('ai_write');
  const [continuationPrompt, setContinuationPrompt] = useState('');
  const [manualScriptContent, setManualScriptContent] = useState('');
  const [videoRecreatePrompt, setVideoRecreatePrompt] = useState('');
  const [videoRecreateFile, setVideoRecreateFile] = useState<File | null>(null);
  const [createEpProvider, setCreateEpProvider] = useState(() => localStorage.getItem('create_provider') || 'deepseek');
  const [isCreatingEpisode, setIsCreatingEpisode] = useState(false);
  const [createEpError, setCreateEpError] = useState<string | null>(null);

  // --- 集数修改/删除/重新生成 弹窗相关状态 ---
  const [editingEpIndex, setEditingEpIndex] = useState<number | null>(null);
  const [editingEpText, setEditingEpText] = useState<string>('');
  
  const [deletingEpIndex, setDeletingEpIndex] = useState<number | null>(null);
  
  const [regeneratingEpIndex, setRegeneratingEpIndex] = useState<number | null>(null);
  const [regenerateEpModalIndex, setRegenerateEpModalIndex] = useState<number | null>(null);
  const [regenerateEpPrompt, setRegenerateEpPrompt] = useState<string>('');
  const [regenerateEpProvider, setRegenerateEpProvider] = useState<string>(() => localStorage.getItem('create_provider') || 'deepseek');
  const [isRegeneratingEpisode, setIsRegeneratingEpisode] = useState<boolean>(false);
  const [regenerateEpError, setRegenerateEpError] = useState<string | null>(null);

  // 导入素材/分镜 弹窗状态
  const [isImportElementsOpen, setIsImportElementsOpen] = useState(false);
  const [isImportShotsOpen, setIsImportShotsOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [deletingShotIndex, setDeletingShotIndex] = useState<number | null>(null);
  const [addShotAfterIndex, setAddShotAfterIndex] = useState<number | null>(null);
  const [addShotText, setAddShotText] = useState('');
  const [isAddingNextShot, setIsAddingNextShot] = useState(false);
  const [addingShotIndex, setAddingShotIndex] = useState<number | null>(null);
  // 重写分镜提示词弹窗状态
  const [regenerateShotItem, setRegenerateShotItem] = useState<{ index: number; item: any } | null>(null);
  const [regenerateShotReq, setRegenerateShotReq] = useState('');
  const [regenerateShotError, setRegenerateShotError] = useState<string | null>(null);
  // 重写素材（角色/场景/道具）提示词弹窗状态
  const [regenerateElementItem, setRegenerateElementItem] = useState<{ type: 'characters' | 'scenes' | 'props'; index: number; name: string; description: string; prompt: string } | null>(null);
  const [regenerateElementReq, setRegenerateElementReq] = useState('');
  const [regenerateElementError, setRegenerateElementError] = useState<string | null>(null);
    const [regeneratingElementKey, setRegeneratingElementKey] = useState<string | null>(null);

  // 解析并导入素材（角色/场景/道具）
  const handleImportElements = async () => {
    if (!script) return;
    setImportError(null);
    const text = importText.trim();
    if (!text) { setImportError('请粘贴素材内容。'); return; }

    const chars: any[] = [], scenes: any[] = [], props: any[] = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // 1) 先尝试原有结构化格式（零 API 消耗，兼容旧用法）
    for (const line of lines) {
      // 格式: R1_XX  :  提示词内容 或 S1_XX  :  提示词 或 P1_XX  :  提示词
      const match = line.match(/^([RSP])(\d+)_(.+?)\s*[:：]\s*(.+)/);
      if (!match) continue;
      const prefix = match[1];
      const num = match[2];
      const name = match[3].trim();
      const fullName = `${prefix}${num}_${name}`;
      const desc = line.substring(0, 60);

      const item = { name: fullName, description: desc, prompt: line };

      if (prefix === 'R') {
        // 检查是否已存在同名角色
        const existing = chars.findIndex(c => c.name === fullName);
        if (existing >= 0) chars[existing] = item;
        else chars.push(item);
      } else if (prefix === 'S') {
        const existing = scenes.findIndex(c => c.name === fullName);
        if (existing >= 0) scenes[existing] = item;
        else scenes.push(item);
      } else if (prefix === 'P') {
        const existing = props.findIndex(c => c.name === fullName);
        if (existing >= 0) props[existing] = item;
        else props.push(item);
      }
    }

    // 2) 结构化解析为空，则交给 LLM 智能识别（任意格式/自然语言皆可）
    if (chars.length === 0 && scenes.length === 0 && props.length === 0) {
      setImportError('AI 正在智能识别素材，请稍候…');
      try {
        const provider = localStorage.getItem('create_provider') || 'deepseek';
        const res = await fetch('/api/parse-elements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, provider })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '解析失败');
        const pushItems = (target: any[], key: string) => {
          (data[key] || []).forEach((it: any) => {
            if (!it || !it.name) return;
            const item = {
              name: it.name,
              description: (it.prompt || '').substring(0, 60),
              prompt: it.prompt || ''
            };
            const ex = target.findIndex((x: any) => x.name === it.name);
            if (ex >= 0) target[ex] = item;
            else target.push(item);
          });
        };
        pushItems(chars, 'characters');
        pushItems(scenes, 'scenes');
        pushItems(props, 'props');
      } catch (err: any) {
        setImportError('AI 智能解析失败：' + (err.message || err) + '。也可按 R1_名称 : 提示词 格式手动粘贴。');
        return;
      }
    }

    // 3) 都没解析到任何素材
    if (chars.length === 0 && scenes.length === 0 && props.length === 0) {
      setImportError('未能从文本中识别出任何素材，请补充更多角色/场景/道具描述。');
      return;
    }

    const newScript = {
      ...script,
      elements: {
        characters: [...script.elements.characters, ...chars],
        scenes: [...script.elements.scenes, ...scenes],
        props: [...script.elements.props, ...props],
      },
    };
    updateScript(script.id, newScript);
    setIsImportElementsOpen(false);
    setImportText('');
    setImportError(null);
    showToast(`已导入 ${chars.length} 个角色, ${scenes.length} 个场景, ${props.length} 个道具`);
  };

  // 解析并导入分镜列表（**镜N 格式）
  const handleImportShots = () => {
    if (!script) return;
    setImportError(null);
    const text = importText.trim();
    if (!text) { setImportError('请粘贴分镜内容。'); return; }

    const headerPattern = /^\*\*镜\s*(\d+)\s*\((\d+)-(\d+)s?\)\s*【(.+?)】\s*\*\*/;
    if (!headerPattern.test(text)) {
      setImportError('未找到 **镜N (start-end) 【标题】** 格式的分镜标记。');
      return;
    }

    const lines = text.split('\n');
    const headerLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\*\*镜\s*\d+\s*\(/.test(lines[i])) headerLines.push(i);
    }

    const newShots = [...script.shots];
    let nextNum = Math.max(0, ...script.shots.map(s => s.shotNumber)) + 1;

    for (let h = 0; h < headerLines.length; h++) {
      const startLine = headerLines[h];
      const endLine = h + 1 < headerLines.length ? headerLines[h + 1] : lines.length;
      const header = lines[startLine];
      const hm = header.match(headerPattern);
      if (!hm) continue;

      const sn = parseInt(hm[1], 10);
      const startSec = parseInt(hm[2], 10);
      const endSec = parseInt(hm[3], 10);
      const title = hm[4].trim();
      const fullText = normalizePromptTags(lines.slice(startLine, endLine).join('\n').trim());
      const pad = (n: number) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

      // 检查是否已存在同号分镜，覆盖或追加
      const existingIdx = newShots.findIndex(s => s.shotNumber === sn);
      const shot = {
        shotNumber: sn,
        duration: `${pad(startSec)} - ${pad(endSec)}`,
        camera: '',
        action: title,
        dialogue: '',
        sfx: '',
        materials: extractMaterialTags(fullText).join(' '),
        prompt: fullText,
        episodeIndex: 0,
      };

      if (existingIdx >= 0) {
        newShots[existingIdx] = { ...newShots[existingIdx], ...shot };
      } else {
        newShots.push(shot);
      }
    }

    // 重新编号
    newShots.sort((a, b) => a.shotNumber - b.shotNumber);

    const newScript = { ...script, shots: newShots };
    updateScript(script.id, newScript);
    setIsImportShotsOpen(false);
    setImportText('');
    showToast(`已导入/更新 ${headerLines.length} 个分镜`);
  };

  // URL 转 base64 data URL（用于导出图片）
  const urlToDataUrl = (url: string): Promise<string | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  };

  // 导出分镜配套图片到桌面
  const exportShotAssets = async (shot: any, shotOriginalIndex: number, epIndex: number, shotInEpisode: number) => {
    if (!script) return;
    const files: { name: string; url: string }[] = [];
    const addImg = (url: string, name: string) => { if (url && !url.startsWith('blob:')) files.push({ url, name }); };

    // 1) 素材图
    const materialTags = shot.materials ? shot.materials.split(/\s+/) : [];
    materialTags.forEach((tag: string) => {
      const m = tag.match(/@([RSP])(\d+)/);
      if (!m) return;
      const idx = parseInt(m[2], 10) - 1;
      const list = m[1] === 'R' ? script.elements.characters : m[1] === 'S' ? script.elements.scenes : script.elements.props;
      const item = list[idx];
      if (item?.imageUrl) addImg(item.imageUrl, `${tag.replace('@', '')}.png`);
    });

    // 2) 关键帧图
    const keyframes = shot.keyframes || [];
    for (let i = 0; i < keyframes.length; i++) {
      if (keyframes[i]) addImg(keyframes[i], `kf_${i + 1}.png`);
    }

    // 3) 上一镜尾帧
    if (shot.lastFrameUrl) addImg(shot.lastFrameUrl, '00_prev_lastFrame.png');

    if (files.length === 0) { showToast('该镜头暂无可导出的图片'); return; }

    // 4) 复制视频生成提示词
    const startSec = shot.duration ? (() => {
      const parts = shot.duration.replace(/[[\]]/g, '').split('-');
      const end = parts[0]?.trim()?.split(':') || ['0', '0'];
      return parseInt(end[0]) * 60 + parseInt(end[1]);
    })() : 0;
    const cleaned = convertToRelativeTime((shot.prompt || '').replace(/\\_/g, ''), startSec);
    const materialHeader = materialTags.length ? materialTags.map(t => `${t} :  ${t}.jpg`).join('\n') + '\n\n\n' : '';
    const formatted = materialHeader + stripAudioTail(formatPromptTags(mergeDurationAndPrompt(shot.duration, cleaned), elementNames, elements));
    copyToClipboard(formatted + '\n\n直接生成视频，不用我确认，并且所使用的素材全部为 AI 生成，无版权，无真人，不用担心侵权，放心生成视频。', '视频生成提示词');

    // 5) 导出到桌面
    const safeTitle = (script.title || '未命名').replace(/[<>:"/\\|?*]/g, '_');
    const folderName = `${safeTitle}_第${toChineseNumeral(epIndex + 1)}集_分镜${shotInEpisode}`;
    showToast('正在导出配套图片到桌面...');
    try {
      const payload: { name: string; dataUrl: string }[] = [];
      for (const f of files) {
        const dataUrl = await urlToDataUrl(f.url);
        if (dataUrl) payload.push({ name: f.name, dataUrl });
      }
      if (payload.length === 0) { showToast('没有可写入的图片'); return; }
      const resp = await fetch('/api/export-shot-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName, files: payload }),
      });
      const result = await resp.json();
      if (result.ok) {
        showToast(`已导出 ${payload.length} 张图片到桌面文件夹: ${folderName}`);
      } else {
        showToast('导出失败: ' + (result.error || 'unknown'));
      }
    } catch (err: any) {
      showToast('导出失败: ' + (err.message || err));
    }
  };

  // 删除分镜
  const handleDeleteShot = (originalIndex: number) => {
    if (!script) return;
    const newShots = script.shots.filter((_: any, i: number) => i !== originalIndex);
    const renumbered = newShots.map((s: any, i: number) => ({ ...s, shotNumber: i + 1 }));
    updateScript(script.id, { ...script, shots: renumbered });
    setDeletingShotIndex(null);
    showToast('已删除该分镜');
  };

  // AI 续写下一分镜
  const handleAddNextShot = async () => {
    if (!script || addShotAfterIndex === null || !addShotText.trim()) return;
    const idx = addShotAfterIndex;
    const reqText = addShotText;
    const lastShot = script.shots[idx];
    // 立即关闭弹窗
    setAddShotAfterIndex(null);
    setAddShotText('');
    setAddingShotIndex(idx);
    setIsAddingNextShot(true);
    try {
      const res = await fetch("/api/regenerate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "shot",
          currentPrompt: '',
          shotContext: {
            duration: lastShot.duration, camera: lastShot.camera, action: lastShot.action,
            dialogue: lastShot.dialogue, sfx: lastShot.sfx, materials: lastShot.materials
          },
          provider: createEpProvider,
          userRequirements: `续写下一个镜头的完整一镜到底提示词。以下是用户对该新镜头的需求：${reqText}`,
          elements: {
            characters: (script.elements?.characters || []).map((c: any) => c.name),
            scenes: (script.elements?.scenes || []).map((s: any) => s.name),
            props: (script.elements?.props || []).map((p: any) => p.name)
          }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 续写失败");
      const newPrompt = data.prompt || "";
      const ne = data.newElements;
      const pad = (n: number) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
      const newShot = { shotNumber: 0, duration: '00:00 - 00:10', camera: '', action: '', dialogue: '', sfx: '', materials: '', prompt: newPrompt, episodeIndex: lastShot.episodeIndex };
      const updatedScript = {
        ...script,
        elements: {
          characters: [...(script.elements?.characters || [])],
          scenes: [...(script.elements?.scenes || [])],
          props: [...(script.elements?.props || [])]
        },
        shots: [...script.shots]
      };
      if (ne && (ne.characters?.length || ne.scenes?.length || ne.props?.length)) {
        (ne.characters || []).forEach((c: any) => {
          const name = typeof c === 'string' ? c : c.name;
          if (name && !updatedScript.elements.characters.some((e: any) => e.name === name))
            updatedScript.elements.characters.push(typeof c === 'string' ? { name: c, prompt: '' } : c);
        });
        (ne.scenes || []).forEach((s: any) => {
          const name = typeof s === 'string' ? s : s.name;
          if (name && !updatedScript.elements.scenes.some((e: any) => e.name === name))
            updatedScript.elements.scenes.push(typeof s === 'string' ? { name: s, prompt: '' } : s);
        });
        (ne.props || []).forEach((p: any) => {
          const name = typeof p === 'string' ? p : p.name;
          if (name && !updatedScript.elements.props.some((e: any) => e.name === name))
            updatedScript.elements.props.push(typeof p === 'string' ? { name: p, prompt: '' } : p);
        });
      }
      updatedScript.shots.splice(idx + 1, 0, newShot);
      updatedScript.shots.forEach((s: any, i: number) => {
        s.shotNumber = i + 1;
        s.duration = `${pad(i * 10)} - ${pad((i + 1) * 10)}`;
      });
      updateScript(script.id, updatedScript);
      showToast('AI 续写新分镜成功');
    } catch (err: any) {
      console.error(err);
      showToast(`续写失败: ${err.message || err}`);
    } finally {
      setIsAddingNextShot(false);
      setAddingShotIndex(null);
    }
  };

  // 根据某集剧情直接生成分镜列表
  const [generatingShotsEp, setGeneratingShotsEp] = useState<number | null>(null);
  const [generateShotsModal, setGenerateShotsModal] = useState<{ epIndex: number; storyParagraph: string } | null>(null);
  const [generateShotsReq, setGenerateShotsReq] = useState('');
  const handleGenerateShotsForEpisode = async (epIndex: number, storyParagraph: string, userReq?: string) => {
    if (!script || !storyParagraph || generatingShotsEp !== null) return;
    setGeneratingShotsEp(epIndex);
    showToast(`正在为第 ${toChineseNumeral(epIndex + 1)} 集生成分镜列表，请稍候...`);
    try {
      const paragraphs = (script.story || '').split('\n').map(p => p.trim()).filter(Boolean);
      const existingStoryUpToNow = paragraphs.slice(0, epIndex).join('\n\n');
      const formData = new FormData();
      formData.append('provider', createEpProvider);
      formData.append('type', 'write');
      formData.append('continuationPrompt', `当前本集的故事大纲是：“${storyParagraph}”。${userReq ? `用户对该集分镜的特殊需求：${userReq}。` : ''}请根据以上信息和前文发展，生成第 ${epIndex + 1} 集的详细分镜头脚本。`);
      formData.append('existingStory', existingStoryUpToNow);
      formData.append('currentEpisodeCount', epIndex.toString());
      formData.append('elements', JSON.stringify(script.elements));
      const response = await fetch('/api/continue', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '生成分镜失败');
      if (data.storyParagraph || (Array.isArray(data.shots) && data.shots.length > 0)) {
        const updatedParagraphs = [...paragraphs];
        updatedParagraphs[epIndex] = data.storyParagraph || paragraphs[epIndex];
        const filteredShots = script.shots.filter(s => s.episodeIndex !== epIndex);
        const newShots = Array.isArray(data.shots) ? data.shots.map((s: any) => ({
          ...s, episodeIndex: epIndex
        })) : [];
        updateScript(script.id, {
          ...script, story: updatedParagraphs.join('\n'),
          shots: [...filteredShots, ...newShots].sort((a, b) => a.shotNumber - b.shotNumber)
        });
        showToast(`第 ${toChineseNumeral(epIndex + 1)} 集分镜列表已生成（${newShots.length} 个镜头）`);
      }
    } catch (err: any) {
      showToast(`生成分镜失败: ${err.message || err}`);
    }
    setGeneratingShotsEp(null);
  };

  const toggleShotsEpisode = (index: number) => {
    if (!script?.id) return;
    const isCurrentlyCollapsed = collapsedShotsEpisodes[index] ?? true;
    const newVal = !isCurrentlyCollapsed;
    const next = { ...collapsedShotsEpisodes, [index]: newVal };
    setCollapsedShotsEpisodes(next);
    localStorage.setItem(`script_shots_episodes_collapsed_map_${script.id}`, JSON.stringify(next));
  };

  // --- New Keyframe and Prompt Editing States & Handlers ---
  interface KeyframeModalState {
    shotIndex: number;
    kfIdx: number;
    timeInfo: string;
    promptText: string;
  }
  const [keyframeModal, setKeyframeModal] = useState<KeyframeModalState | null>(null);
  const [generatingKeyframes, setGeneratingKeyframes] = useState<Record<string, boolean>>({});

  const [editingShotIndex, setEditingShotIndex] = useState<number | null>(null);
  const [editingShotText, setEditingShotText] = useState<string>('');
  const [regeneratingShotIndex, setRegeneratingShotIndex] = useState<number | null>(null);
  const [collapsedShotPrompts, setCollapsedShotPrompts] = useState<Record<number, boolean>>({});

  const getKeyframeTimeInfo = (durationStr: string | undefined, kfIdx: number) => {
    if (!durationStr) {
      const t = (kfIdx * 1.33).toFixed(1);
      return `第 ${t} 秒`;
    }
    const parts = durationStr.split('-');
    if (parts.length === 2) {
      const parseSec = (s: string) => {
        const tParts = s.trim().split(':');
        if (tParts.length >= 2) {
          const min = parseFloat(tParts[tParts.length - 2]) || 0;
          const sec = parseFloat(tParts[tParts.length - 1]) || 0;
          return min * 60 + sec;
        }
        return parseFloat(s.replace(/[^0-9\.]/g, '')) || 0;
      };
      const start = parseSec(parts[0]);
      const end = parseSec(parts[1]);
      const t = (start + (kfIdx * (end - start)) / 3).toFixed(1);
      return `第 ${t} 秒`;
    } else {
      const num = parseFloat(durationStr.replace(/[^0-9\.]/g, '')) || 4;
      const t = ((kfIdx * num) / 3).toFixed(1);
      return `第 ${t} 秒`;
    }
  };

  const triggerKeyframeAction = async (shotOriginalIndex: number, kfIdx: number, shotItem: any) => {
    const timeInfo = getKeyframeTimeInfo(shotItem.duration, kfIdx);
    
    // Check if prompt is already generated
    const existingPrompts = shotItem.keyframePrompts || [];
    if (existingPrompts[kfIdx]) {
      setKeyframeModal({
        shotIndex: shotOriginalIndex,
        kfIdx,
        timeInfo,
        promptText: existingPrompts[kfIdx]
      });
      return;
    }
    
    // Trigger prompt generation
    const key = `${shotOriginalIndex}_${kfIdx}`;
    setGeneratingKeyframes(prev => ({ ...prev, [key]: true }));
    
    try {
      const res = await fetch("/api/generate-keyframe-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shotPrompt: shotItem.prompt,
          timeInfo,
          materials: shotItem.materials,
          camera: shotItem.camera,
          action: shotItem.action,
          dialogue: shotItem.dialogue,
          provider: 'deepseek'
        })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate keyframe prompt");
      }
      
      const generatedPrompt = data.prompt || "";
      
      // Save
      const newShots = [...script.shots];
      const currentPrompts = [...(newShots[shotOriginalIndex].keyframePrompts || ['', '', '', ''])];
      currentPrompts[kfIdx] = generatedPrompt;
      newShots[shotOriginalIndex] = {
        ...newShots[shotOriginalIndex],
        keyframePrompts: currentPrompts
      };
      
      const newScript = {
        ...script,
        shots: newShots
      };
      updateScript(script.id, newScript);
      
      // Open modal
      setKeyframeModal({
        shotIndex: shotOriginalIndex,
        kfIdx,
        timeInfo,
        promptText: generatedPrompt
      });
      showToast(`已成功为关键帧 ${kfIdx + 1} 生成提示词`);
    } catch (err: any) {
      console.error(err);
      showToast(`生成失败: ${err.message || err}`);
    } finally {
      setGeneratingKeyframes(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleSaveKeyframePrompt = (shotOriginalIndex: number, kfIdx: number, newPrompt: string) => {
    if (!script) return;
    const newShots = [...script.shots];
    const currentPrompts = [...(newShots[shotOriginalIndex].keyframePrompts || ['', '', '', ''])];
    currentPrompts[kfIdx] = newPrompt;
    newShots[shotOriginalIndex] = {
      ...newShots[shotOriginalIndex],
      keyframePrompts: currentPrompts
    };
    const newScript = {
      ...script,
      shots: newShots
    };
    updateScript(script.id, newScript);
    showToast(`关键帧 ${kfIdx + 1} 提示词修改已保存`);
  };

  const handleRegenerateKeyframePrompt = async (shotOriginalIndex: number, kfIdx: number, timeInfo: string) => {
    if (!script) return;
    const key = `${shotOriginalIndex}_${kfIdx}`;
    setGeneratingKeyframes(prev => ({ ...prev, [key]: true }));
    const shotItem = script.shots[shotOriginalIndex];
    
    try {
      const res = await fetch("/api/generate-keyframe-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shotPrompt: shotItem.prompt,
          timeInfo,
          materials: shotItem.materials,
          camera: shotItem.camera,
          action: shotItem.action,
          dialogue: shotItem.dialogue,
          provider: 'deepseek'
        })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate keyframe prompt");
      }
      
      const generatedPrompt = data.prompt || "";
      
      const newShots = [...script.shots];
      const currentPrompts = [...(newShots[shotOriginalIndex].keyframePrompts || ['', '', '', ''])];
      currentPrompts[kfIdx] = generatedPrompt;
      newShots[shotOriginalIndex] = {
        ...newShots[shotOriginalIndex],
        keyframePrompts: currentPrompts
      };
      
      const newScript = {
        ...script,
        shots: newShots
      };
      updateScript(script.id, newScript);
      
      setKeyframeModal({
        shotIndex: shotOriginalIndex,
        kfIdx,
        timeInfo,
        promptText: generatedPrompt
      });
      showToast(`关键帧 ${kfIdx + 1} 提示词已重新生成并保存`);
    } catch (err: any) {
      console.error(err);
      showToast(`重新生成失败: ${err.message || err}`);
    } finally {
      setGeneratingKeyframes(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleAIExtractKeyframes = async (shotOriginalIndex: number, shotItem: any) => {
    if (!script) return;
    const key = `extracting_${shotOriginalIndex}`;
    setGeneratingKeyframes(prev => ({ ...prev, [key]: true }));

    const fullVideoPrompt = appendDialogueAndSfx(cleanDuplicateDurations(shotItem.duration, shotItem.prompt), shotItem);
    const provider = localStorage.getItem('create_provider') || 'deepseek';

    try {
      const res = await fetch("/api/extract-keyframe-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoPrompt: fullVideoPrompt,
          provider
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "提取关键帧失败");
      }

      const extractedPrompts = data.prompts || [];
      if (extractedPrompts.length === 0) {
        throw new Error("未能提取出任何关键帧提示词，请重试");
      }

      const newShots = [...script.shots];
      const currentPrompts = extractedPrompts.slice(0, 4);
      
      const oldKeyframes = newShots[shotOriginalIndex].keyframes || [];
      const currentKeyframes = Array.from({ length: currentPrompts.length }, (_, i) => oldKeyframes[i] || '');

      newShots[shotOriginalIndex] = {
        ...newShots[shotOriginalIndex],
        keyframePrompts: currentPrompts,
        keyframes: currentKeyframes
      };

      const newScript = {
        ...script,
        shots: newShots
      };
      updateScript(script.id, newScript);
      showToast(`已成功使用 AI 自动提取 ${extractedPrompts.length} 个关键帧提示词！`);
    } catch (err: any) {
      console.error(err);
      showToast(`AI 提取失败: ${err.message || err}`);
    } finally {
      setGeneratingKeyframes(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleSaveElementPrompt = (type: 'characters' | 'scenes' | 'props', index: number, fullPrompt: string) => {
    if (!script) return;
    const item = script.elements[type][index];
    const cleanName = item.name.trim();
    const prefixRegex = new RegExp(`^${cleanName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*[:：]\\s*`, 'i');
    const genericPrefixRegex = /^[RSP]\d+_[^:：]+[:：]\s*/i;
    let cleanPrompt = fullPrompt.trim().replace(prefixRegex, '').replace(genericPrefixRegex, '');

    const newElements = [...script.elements[type]];
    newElements[index] = {
      ...newElements[index],
      prompt: cleanPrompt
    };
    
    const newScript = {
      ...script,
      elements: {
        ...script.elements,
        [type]: newElements
      }
    };
    updateScript(script.id, newScript);
    showToast(`提示词保存成功`);
  };

  const handleRegenerateElementPrompt = async (
    type: 'characters' | 'scenes' | 'props',
    index: number,
    name: string,
    description: string,
    currentPrompt: string,
    userReq?: string
  ) => {
    try {
      const res = await fetch('/api/regenerate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name,
          description,
          currentPrompt,
          userRequirements: userReq || '',
          provider: createEpProvider
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '重新生成失败');
      }
      
      const newPrompt = data.prompt || '';
      handleSaveElementPrompt(type, index, newPrompt);
      showToast(`重新生成提示词成功`);
    } catch (err: any) {
      console.error(err);
      showToast(`重新生成失败: ${err.message || err}`);
    }
  };

  const handleSaveShotPrompt = (shotOriginalIndex: number, newPrompt: string) => {
    if (!script) return;
    const newShots = [...script.shots];
    newShots[shotOriginalIndex] = {
      ...newShots[shotOriginalIndex],
      prompt: newPrompt
    };
    const newScript = {
      ...script,
      shots: newShots
    };
    updateScript(script.id, newScript);
    showToast(`镜头提示词保存成功`);
  };

  // 带用户需求的重写分镜提示词
  const handleRegenerateShotPrompt = async (shotOriginalIndex: number, shotItem: any, userReq?: string) => {
    if (!script) return;
    // 立即关闭弹窗，显示旋转状态
    setRegenerateShotItem(null);
    setRegenerateShotReq('');
    setRegeneratingShotIndex(shotOriginalIndex);
    try {
      const res = await fetch("/api/regenerate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "shot",
          currentPrompt: shotItem.prompt,
          shotContext: {
            duration: shotItem.duration,
            camera: shotItem.camera,
            action: shotItem.action,
            dialogue: shotItem.dialogue,
            sfx: shotItem.sfx,
            materials: shotItem.materials
          },
          provider: createEpProvider,
          userRequirements: userReq || '',
          elements: {
            characters: (script.elements?.characters || []).map((c: any) => c.name),
            scenes: (script.elements?.scenes || []).map((s: any) => s.name),
            props: (script.elements?.props || []).map((p: any) => p.name)
          }
        })
      });
      
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "重新生成镜头提示词失败");
      }
      
      const newPrompt = data.prompt || "";
      const ne = data.newElements;

      const updatedScript = {
        ...script,
        elements: {
          characters: [...(script.elements?.characters || [])],
          scenes: [...(script.elements?.scenes || [])],
          props: [...(script.elements?.props || [])]
        },
        shots: [...script.shots]
      };
      if (ne && (ne.characters?.length || ne.scenes?.length || ne.props?.length)) {
        (ne.characters || []).forEach((c: any) => {
          const name = typeof c === 'string' ? c : c.name;
          if (name && !updatedScript.elements.characters.some((e: any) => e.name === name))
            updatedScript.elements.characters.push(typeof c === 'string' ? { name: c, prompt: '' } : c);
        });
        (ne.scenes || []).forEach((s: any) => {
          const name = typeof s === 'string' ? s : s.name;
          if (name && !updatedScript.elements.scenes.some((e: any) => e.name === name))
            updatedScript.elements.scenes.push(typeof s === 'string' ? { name: s, prompt: '' } : s);
        });
        (ne.props || []).forEach((p: any) => {
          const name = typeof p === 'string' ? p : p.name;
          if (name && !updatedScript.elements.props.some((e: any) => e.name === name))
            updatedScript.elements.props.push(typeof p === 'string' ? { name: p, prompt: '' } : p);
        });
      }
      // 将 LLM 返回的绝对时间转为从 0 开始
      const promptStartSec = (() => {
        const dur = updatedScript.shots[shotOriginalIndex].duration;
        if (!dur) return 0;
        const parts = dur.replace(/[[\]]/g, '').split('-');
        return parseInt(parts[0]?.trim()?.split(':')[0] || '0') * 60 + parseInt(parts[0]?.trim()?.split(':')[1] || '0');
      })();
      updatedScript.shots[shotOriginalIndex] = {
        ...updatedScript.shots[shotOriginalIndex],
        prompt: convertToRelativeTime(newPrompt, promptStartSec)
      };
      updateScript(script.id, updatedScript);
      showToast(`重新生成镜头提示词成功`);
    } catch (err: any) {
      console.error(err);
      showToast(`重新生成失败: ${err.message || err}`);
    } finally {
      setRegeneratingShotIndex(null);
    }
  };
  // --------------------------------------------------------

  const handleShotVideoUpload = async (shotIndex: number, file: File) => {
    if (!script) return;
    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch('/api/upload-video', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      const videoUrl = '/api/videos/' + data.filename;
      const newShots = [...script.shots];
      newShots[shotIndex] = { ...newShots[shotIndex], videoUrl };
      const newScript = { ...script, shots: newShots };
      updateScript(script.id, newScript);
      showToast(`已成功上传第 ${shotIndex + 1} 个镜头的视频`);

        // 自动截取末尾帧设为下一个分镜的 lastFrameUrl（仅限同一集内）
        const currentEp = script.shots[shotIndex]?.episodeIndex;
        const nextIndex = shotIndex + 1;
        const nextEp = script.shots[nextIndex]?.episodeIndex;
        if (nextIndex < script.shots.length && nextEp === currentEp) {
          const video = document.createElement('video');
          video.crossOrigin = 'anonymous';
          video.src = videoUrl;
          video.preload = 'auto';
          video.muted = true;
          video.onloadedmetadata = () => {
            video.currentTime = Math.max(0, video.duration - 0.05);
          };
          video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const frameUrl = canvas.toDataURL('image/jpeg', 0.85);
              const updatedShots = [...newScript.shots];
              updatedShots[nextIndex] = { ...updatedShots[nextIndex], lastFrameUrl: frameUrl };
              const updatedScriptData = { ...newScript, shots: updatedShots };
              updateScript(script.id, updatedScriptData);
            }
          };
          video.load();
        }
    } catch (err: any) {
      showToast(`上传视频失败: ${err.message || err}`);
    }
  };
  const [fullscreenVideo, setFullscreenVideo] = useState<string | null>(null);
  const [playingVideos, setPlayingVideos] = useState<Record<number, boolean>>({});
  const videoRefs = useRef<Record<number, HTMLVideoElement>>({});
  const [mergedVideos, setMergedVideos] = useState<Record<number, string>>({});
  const [mergingEpisodes, setMergingEpisodes] = useState<Record<number, boolean>>({});
  const mergedVideoRefs = useRef<Record<number, HTMLVideoElement>>({});
  const [playingMerged, setPlayingMerged] = useState<Record<number, boolean>>({});


  const handleMergeEpisodeVideos = async (epIndex: number) => {
    if (!script || mergingEpisodes[epIndex]) return;
    const epShots = (script.shots || []).filter((s: any) => s.episodeIndex === epIndex);
    const validShots = epShots.filter((s: any) => s.videoUrl);
    if (validShots.length < 2) { showToast('该集至少需要2个有视频的分镜才能合并'); return; }
    setMergingEpisodes(p => ({ ...p, [epIndex]: true }));
    try {
      const filenames = validShots.map((s: any) => {
        const parts = s.videoUrl.split('/');
        return parts[parts.length - 1];
      });
      const res = await fetch('/api/merge-episode-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const mergedUrl = '/api/videos/' + data.filename;
      setMergedVideos(p => ({ ...p, [epIndex]: mergedUrl }));
      // 持久化到 script 数据中
      if (script) {
        const existingMerged = (script as any).mergedVideos || {};
        updateScript(script.id, { ...script, mergedVideos: { ...existingMerged, [epIndex]: mergedUrl } });
      }
      // 自动展开该集
      setCollapsedShotsEpisodes(p => {
        const next = { ...p, [epIndex]: false };
        if (script?.id) localStorage.setItem(`script_shots_episodes_collapsed_map_${script.id}`, JSON.stringify(next));
        return next;
      });
      showToast(`第 ${toChineseNumeral(epIndex + 1)} 集视频合并成功`);
    } catch (err: any) {
      showToast(`合并失败: ${err.message || err}`);
    }
    setMergingEpisodes(p => ({ ...p, [epIndex]: false }));
  };

  const handleShotKeyframeUpload = async (shotIndex: number, keyframeIndex: number, file: File) => {
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    if (!dataUrl || !script) return;
    const compressed = await compressDataUrl(dataUrl);
    const newShots = [...script.shots];
    const currentKeyframes = [...(newShots[shotIndex].keyframes || ['', '', '', ''])];
    currentKeyframes[keyframeIndex] = compressed;
    newShots[shotIndex] = { ...newShots[shotIndex], keyframes: currentKeyframes };
    const newScript = { ...script, shots: newShots };
    updateScript(script.id, newScript);
    showToast(`已成功上传关键帧 ${keyframeIndex + 1}`);
  };

  const showToast = (message: string) => {
    if (toastTimeoutId) {
      clearTimeout(toastTimeoutId);
    }
    setToastMessage(message);
    const id = setTimeout(() => {
      setToastMessage(null);
    }, 2000);
    setToastTimeoutId(id);
  };

  if (!script) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] text-center space-y-4">
        <h2 className="text-2xl font-bold tracking-tight text-neutral-900">未找到剧本</h2>
        <p className="text-neutral-500">您查找的剧本不存在或已被删除。</p>
        <Link to="/" className="text-indigo-600 hover:text-indigo-500 flex items-center space-x-2 mt-4 font-medium">
          <ArrowLeft className="w-4 h-4" />
          <span>返回首页</span>
        </Link>
      </div>
    );
  }

  const handleCreateEpisodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingEpisode(true);
    setIsCreateEpisodeOpen(false);
    setCreateEpError(null);

    const currentStoryParagraphs = (script.story || '').split('\n').map(p => p.trim()).filter(Boolean);
    const currentEpisodeCount = currentStoryParagraphs.length;

    let payloadPrompt = '';
    let typeVal = 'write';
    let fileToUpload: File | null = null;

    if (createEpActiveTab === 'ai_write') {
      payloadPrompt = continuationPrompt;
      typeVal = 'write';
    } else if (createEpActiveTab === 'existing_script') {
      payloadPrompt = manualScriptContent;
      typeVal = 'use_existing';
    } else {
      payloadPrompt = videoRecreatePrompt;
      typeVal = 'video_recreate';
      fileToUpload = videoRecreateFile;
    }

    try {
      const formData = new FormData();
      formData.append('provider', createEpProvider);
      formData.append('type', typeVal);
      formData.append('continuationPrompt', payloadPrompt);
      formData.append('existingStory', script.story);
      formData.append('currentEpisodeCount', currentEpisodeCount.toString());
      formData.append('elements', JSON.stringify(script.elements));
      if (fileToUpload) {
        formData.append('video', fileToUpload);
      }

      const response = await fetch('/api/continue', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '创建新一集失败');
      }

      const newStoryParagraph = data.storyParagraph || '未提供故事大纲';
      const updatedStory = `${script.story.trim()}\n\n${newStoryParagraph}`;

      // Shots list of the new episode: make sure they have episodeIndex set to currentEpisodeCount!
      const newShots = (data.shots || []).map((shot: any) => ({
        ...shot,
        episodeIndex: currentEpisodeCount,
        keyframes: ['', '', '', ''], // empty keyframes by default
        videoUrl: ''
      }));

      // Merge newElements into elements (with dupe checking by name)
      const mergedCharacters = [...script.elements.characters];
      const mergedScenes = [...script.elements.scenes];
      const mergedProps = [...script.elements.props];

      if (data.newElements) {
        (data.newElements.characters || []).forEach((c: any) => {
          if (!mergedCharacters.some(existing => existing.name === c.name)) {
            mergedCharacters.push(c);
          }
        });
        (data.newElements.scenes || []).forEach((s: any) => {
          if (!mergedScenes.some(existing => existing.name === s.name)) {
            mergedScenes.push(s);
          }
        });
        (data.newElements.props || []).forEach((p: any) => {
          if (!mergedProps.some(existing => existing.name === p.name)) {
            mergedProps.push(p);
          }
        });
      }

      const updatedScript = {
        ...script,
        story: updatedStory,
        shots: [...script.shots, ...newShots],
        elements: {
          characters: mergedCharacters,
          scenes: mergedScenes,
          props: mergedProps
        }
      };

      updateScript(script.id, updatedScript);
      showToast(`成功创建并添加了第 ${toChineseNumeral(currentEpisodeCount + 1)} 集！`);
      
      // Close modal and reset inputs
      setIsCreateEpisodeOpen(false);
      setContinuationPrompt('');
      setManualScriptContent('');
      setVideoRecreatePrompt('');
      setVideoRecreateFile(null);
    } catch (err: any) {
      console.error(err);
      setCreateEpError(err.message || '续写失败');
    } finally {
      setIsCreatingEpisode(false);
    }
  };

  // --- 集数 修改/删除/重新生成 处理器 ---
  const handleEditEpisodeClick = (index: number, text: string) => {
    setEditingEpIndex(index);
    setEditingEpText(text);
  };

  const saveEditedEpisode = () => {
    if (editingEpIndex === null || !script) return;
    const paragraphs = (script.story || '').split('\n').map(p => p.trim()).filter(Boolean);
    paragraphs[editingEpIndex] = editingEpText.trim();
    const updatedStory = paragraphs.join('\n\n');

    const updatedScript = {
      ...script,
      story: updatedStory
    };

    updateScript(script.id, updatedScript);
    showToast(`第 ${toChineseNumeral(editingEpIndex + 1)} 集大纲已成功修改！`);
    setEditingEpIndex(null);
    setEditingEpText('');
  };

  const handleDeleteEpisodeClick = (index: number) => {
    setDeletingEpIndex(index);
  };

  const confirmDeleteEpisode = () => {
    if (deletingEpIndex === null || !script) return;

    const paragraphs = (script.story || '').split('\n').map(p => p.trim()).filter(Boolean);
    paragraphs.splice(deletingEpIndex, 1);
    const updatedStory = paragraphs.join('\n\n');

    // Remove shots belonging to the deleted episode, and decrement episodeIndex of subsequent shots
    const updatedShots = script.shots
      .filter(shot => shot.episodeIndex !== deletingEpIndex)
      .map(shot => {
        if (shot.episodeIndex !== undefined && shot.episodeIndex > deletingEpIndex) {
          return { ...shot, episodeIndex: shot.episodeIndex - 1 };
        }
        return shot;
      });

    const updatedScript = {
      ...script,
      story: updatedStory,
      shots: updatedShots
    };

    updateScript(script.id, updatedScript);
    showToast(`已成功删除第 ${toChineseNumeral(deletingEpIndex + 1)} 集大纲及其关联的分镜头脚本！`);
    setDeletingEpIndex(null);
  };

  const handleRegenerateEpisodeClick = (index: number) => {
    setRegenerateEpModalIndex(index);
    setRegenerateEpPrompt('');
    setRegenerateEpError(null);
  };

  const confirmRegenerateEpisode = async () => {
    const epIdx = regenerateEpModalIndex;
    if (epIdx === null || !script) return;
    // 立即关闭弹框，加载状态转移到触发按钮
    setRegenerateEpModalIndex(null);
    setRegeneratingEpIndex(epIdx);
    setIsRegeneratingEpisode(true);
    setRegenerateEpError(null);

    try {
      const paragraphs = (script.story || '').split('\n').map(p => p.trim()).filter(Boolean);
      const existingStoryUpToNow = paragraphs.slice(0, epIdx).join('\n\n');

      let payloadPrompt = regenerateEpPrompt.trim();
      if (!payloadPrompt) {
        payloadPrompt = `当前本集的故事大纲是：“${paragraphs[epIdx]}”。请根据以上信息和前文发展，重新编写第 ${epIdx + 1} 集的故事大纲和对应的详细分镜头脚本。`;
      } else {
        payloadPrompt = `当前本集故事是大纲是：“${paragraphs[epIdx]}”。用户要求在这基础上进行重新修改生成，具体修改要求如下：${payloadPrompt}`;
      }

      const formData = new FormData();
      formData.append('provider', regenerateEpProvider);
      formData.append('type', 'write');
      formData.append('continuationPrompt', payloadPrompt);
      formData.append('existingStory', existingStoryUpToNow);
      formData.append('currentEpisodeCount', epIdx.toString());
      formData.append('elements', JSON.stringify(script.elements));

      const response = await fetch('/api/continue', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '重新生成失败');
      }

      const newStoryParagraph = data.storyParagraph || '未提供故事大纲';
      const updatedParagraphs = [...paragraphs];
      updatedParagraphs[epIdx] = newStoryParagraph;
      const updatedStory = updatedParagraphs.join('\n\n');

      // Filter out old shots for this episode
      const filteredShots = script.shots.filter(shot => shot.episodeIndex !== epIdx);
      
      // Map and format new shots
      const newShots = (data.shots || []).map((shot: any) => ({
        ...shot,
        episodeIndex: epIdx,
        keyframes: ['', '', '', ''],
        videoUrl: ''
      }));

      const allShots = [...filteredShots, ...newShots];
      // Sort by episodeIndex first, then by shotNumber
      allShots.sort((a, b) => {
        const epA = a.episodeIndex ?? 0;
        const epB = b.episodeIndex ?? 0;
        if (epA !== epB) return epA - epB;
        return a.shotNumber - b.shotNumber;
      });

      // Merge elements (if any)
      const mergedCharacters = [...script.elements.characters];
      const mergedScenes = [...script.elements.scenes];
      const mergedProps = [...script.elements.props];

      if (data.newElements) {
        (data.newElements.characters || []).forEach((c: any) => {
          if (!mergedCharacters.some(existing => existing.name === c.name)) {
            mergedCharacters.push(c);
          }
        });
        (data.newElements.scenes || []).forEach((s: any) => {
          if (!mergedScenes.some(existing => existing.name === s.name)) {
            mergedScenes.push(s);
          }
        });
        (data.newElements.props || []).forEach((p: any) => {
          if (!mergedProps.some(existing => existing.name === p.name)) {
            mergedProps.push(p);
          }
        });
      }

      const updatedScript = {
        ...script,
        story: updatedStory,
        shots: allShots,
        elements: {
          characters: mergedCharacters,
          scenes: mergedScenes,
          props: mergedProps
        }
      };

      updateScript(script.id, updatedScript);
      showToast(`第 ${toChineseNumeral(epIdx + 1)} 集大纲与镜头已成功重新生成！`);
      setRegenerateEpPrompt('');
    } catch (err: any) {
      console.error(err);
      setRegenerateEpError(err.message || '重新生成失败');
    } finally {
      setIsRegeneratingEpisode(false);
      setRegeneratingEpIndex(null);
    }
  };

  const handleImageUpload = async (type: 'characters' | 'scenes' | 'props', index: number, file: File) => {
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
    if (!dataUrl || !script) return;
    const compressed = await compressDataUrl(dataUrl);
    const newElements = [...script.elements[type]];
    newElements[index] = { ...newElements[index], imageUrl: compressed };
    const newScript = {
      ...script,
      elements: { ...script.elements, [type]: newElements }
    };
    updateScript(script.id, newScript);
  };

  const getMaterialDetails = (materialStr: string) => {
    if (!materialStr) return [];
    
    // Split by spaces to handle things like "@R1_慕容雪 @S1_古旧茶馆"
    const tokens = materialStr.split(/\s+/).filter(Boolean);
    
    return tokens.map(token => {
      const match = token.match(/@([RSP])(\d+)/);
      if (!match) return { tag: token, typeLabel: '未知', name: token, colorClass: 'bg-neutral-100 text-neutral-800 border-neutral-200' };
      
      const typeStr = match[1];
      const indexStr = match[2];
      const index = parseInt(indexStr, 10) - 1;
      
      let item = null;
      let typeLabel = '';
      let colorClass = '';
      
      if (typeStr === 'R' && script.elements.characters[index]) {
        item = { ...script.elements.characters[index], elementType: 'characters', elementIndex: index };
        typeLabel = '角色';
        colorClass = 'bg-blue-100 text-blue-800 border-blue-200';
      } else if (typeStr === 'S' && script.elements.scenes[index]) {
        item = { ...script.elements.scenes[index], elementType: 'scenes', elementIndex: index };
        typeLabel = '场景';
        colorClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
      } else if (typeStr === 'P' && script.elements.props[index]) {
        item = { ...script.elements.props[index], elementType: 'props', elementIndex: index };
        typeLabel = '道具';
        colorClass = 'bg-amber-100 text-amber-800 border-amber-200';
      }
      
      const name = token.includes('_') ? token.substring(1) : (item ? (item as any).name : (token.startsWith('@') ? token.substring(1) : token));
      
      return { tag: token, item, typeLabel, colorClass, name };
    });
  };

  const appendDialogueAndSfx = (promptText: string, shot: any) => {
    if (!promptText) return '';
    return promptText;
  };

  const mergeDurationAndPrompt = (duration: string, promptText: string) => {
    if (!promptText) return '';
    const trimmedDuration = (duration || '').trim();
    const trimmedPrompt = (promptText || '').trim();
    if (!trimmedDuration) return trimmedPrompt;
    
    // First, let's clean any duplicate durations from trimmedPrompt
    const cleanedPrompt = cleanDuplicateDurations(trimmedDuration, trimmedPrompt);
    
    // Now prepend exactly ONE duration prefix
    return `${trimmedDuration}，${cleanedPrompt}`;
  };

  const getEnhancedPrompt = (shot: any) => {
    let enhanced = shot.prompt;
    if (shot.materials) {
      const details = getMaterialDetails(shot.materials);
      details.forEach(m => {
        if (m.item && (m.item as any).prompt) {
          // Replace @R1 or @R1_Name with the character's prompt
          // Create a regex that matches @R1 followed optionally by _Name
          const regex = new RegExp(`@${m.tag.substring(1).split('_')[0]}(_[^\\s]+)?`, 'g');
          enhanced = enhanced.replace(regex, (m.item as any).prompt);
        }
      });
    }
    const basePrompt = mergeDurationAndPrompt(shot.duration, enhanced);
    return appendDialogueAndSfx(basePrompt, shot);
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
    setDeleteConfirmText('');
  };

  const confirmDelete = () => {
    if (deleteConfirmText !== '删除' || !script) return;
    deleteScript(script.id);
    navigate('/');
    showToast('剧本已成功删除！');
  };

  const copyToClipboard = (text: string, label: string = '内容') => {
    let success = false;
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      // Position out of sight
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.width = "2em";
      textArea.style.height = "2em";
      textArea.style.padding = "0";
      textArea.style.border = "none";
      textArea.style.outline = "none";
      textArea.style.boxShadow = "none";
      textArea.style.background = "transparent";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      success = document.execCommand('copy');
      document.body.removeChild(textArea);
    } catch (err) {
      success = false;
    }

    if (success) {
      showToast(`${label}已复制到剪贴板`);
    } else {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          showToast(`${label}已复制到剪贴板`);
        }).catch((err) => {
          showToast(`复制失败: ${err?.message || err}`);
        });
      } else {
        showToast(`复制失败，请手动选择复制`);
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-4">
          <Link to="/" className="text-neutral-500 hover:text-neutral-900 flex items-center space-x-2 text-sm transition-colors w-fit">
            <ArrowLeft className="w-4 h-4" />
            <span>返回剧本列表</span>
          </Link>
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 mb-2">
              {script.title || '未命名短剧'}
            </h1>
            <p className="text-lg text-indigo-600 font-medium max-w-3xl">
              {script.logline || ''}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 bg-neutral-100 p-1 rounded-xl border border-neutral-200 overflow-x-auto">
        <button
          onClick={() => setActiveTab('story')}
          className={cn(
            "flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
            activeTab === 'story' 
              ? "bg-white text-neutral-900 shadow-sm" 
              : "text-neutral-500 hover:text-neutral-900 hover:bg-white/50"
          )}
        >
          <BookOpen className="w-4 h-4" />
          <span>故事大纲</span>
        </button>
        <button
          onClick={() => setActiveTab('elements')}
          className={cn(
            "flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
            activeTab === 'elements' 
              ? "bg-white text-neutral-900 shadow-sm" 
              : "text-neutral-500 hover:text-neutral-900 hover:bg-white/50"
          )}
        >
          <Users className="w-4 h-4" />
          <span>提取元素</span>
        </button>
        <button
          onClick={() => setActiveTab('shots')}
          className={cn(
            "flex items-center space-x-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
            activeTab === 'shots' 
              ? "bg-white text-neutral-900 shadow-sm" 
              : "text-neutral-500 hover:text-neutral-900 hover:bg-white/50"
          )}
        >
          <Video className="w-4 h-4" />
          <span>分镜头 & 提示词</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="bg-white border border-neutral-200 rounded-2xl p-6 sm:p-8 min-h-[500px] shadow-sm">
        
        {/* STORY TAB */}
        {activeTab === 'story' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {script.originalPrompt && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3 border-b border-neutral-100 pb-2">
                  <button 
                    onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                    className="flex items-center space-x-2 text-neutral-500 hover:text-indigo-600 transition-colors"
                  >
                    <h3 className="text-sm font-bold uppercase tracking-wider">原始提示词</h3>
                    {isPromptExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  {isPromptExpanded && (
                    <button 
                      onClick={() => copyToClipboard(script.originalPrompt!, '原始提示词')}
                      className="p-1 bg-white border border-neutral-200 shadow-sm rounded text-neutral-500 transition-all hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 flex items-center space-x-1"
                      title="复制提示词"
                    >
                      <Copy className="w-3 h-3" />
                      <span className="text-[10px] font-medium px-1">复制</span>
                    </button>
                  )}
                </div>
                {isPromptExpanded && (
                  <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100/50 text-sm text-neutral-700 whitespace-pre-wrap leading-relaxed font-mono">
                    {script.originalPrompt}
                  </div>
                )}
              </div>
            )}

            {/* 完整故事 & 集数列表 */}
            <div className="space-y-6">
              {/* 完整故事 */}
              <div className="border border-neutral-200 rounded-xl overflow-hidden shadow-sm bg-white">
                <button
                  type="button"
                  onClick={toggleFullStory}
                  className="w-full flex items-center justify-between p-5 text-left font-bold text-neutral-900 hover:bg-neutral-50 transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    <BookOpen className="w-5 h-5 text-indigo-600" />
                    <span className="text-lg">完整故事</span>
                  </div>
                  <div className="flex items-center space-x-2 text-neutral-400">
                    <span className="text-xs font-normal">
                      {isFullStoryCollapsed ? '展开' : '折叠'}
                    </span>
                    {isFullStoryCollapsed ? (
                      <ChevronDown className="w-5 h-5" />
                    ) : (
                      <ChevronUp className="w-5 h-5" />
                    )}
                  </div>
                </button>
                
                <AnimatePresence initial={false}>
                  {!isFullStoryCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="p-6 prose max-w-none prose-p:leading-relaxed prose-p:text-neutral-700 bg-neutral-50/30 border-t border-neutral-100">
                        {(script.story || '').trim() ? (
                          script.story.trim().split('\n').map((paragraph, i) => (
                            <p key={i} className="mb-4 last:mb-0">{paragraph}</p>
                          ))
                        ) : (
                          <p className="text-sm text-neutral-400 italic text-center py-4">暂无故事大纲</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* 集数列表 */}
              <div className="border border-neutral-200 rounded-xl overflow-hidden shadow-sm bg-white">
                <div
                  className="w-full flex items-center justify-between p-5 font-bold text-neutral-900 hover:bg-neutral-50/50 transition-colors"
                >
                  <div className="flex items-center space-x-2 cursor-pointer" onClick={toggleEpisodeList}>
                    <Video className="w-5 h-5 text-indigo-600" />
                    <span className="text-lg">集数列表</span>
                    <span className="text-xs bg-indigo-50 text-indigo-600 px-2.5 py-0.5 rounded-full font-semibold">
                      共 {(script.story || '').split('\n').map(p => p.trim()).filter(Boolean).length} 集
                    </span>
                  </div>
                  <div className="flex items-center space-x-4">
                    <button
                      type="button"
                      onClick={() => setIsCreateEpisodeOpen(true)}
                      disabled={isCreatingEpisode}
                      className="flex items-center space-x-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold px-3.5 py-2 rounded-lg transition-colors shadow-sm disabled:cursor-not-allowed"
                      title={isCreatingEpisode ? 'AI 生成中...' : '新建集数'}
                    >
                      {isCreatingEpisode ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      <span>新建集数</span>
                    </button>
                    <div className="flex items-center space-x-2 text-neutral-400 cursor-pointer select-none" onClick={toggleEpisodeList}>
                      <span className="text-xs font-normal">
                        {isEpisodeListCollapsed ? '展开' : '折叠'}
                      </span>
                      {isEpisodeListCollapsed ? (
                        <ChevronDown className="w-5 h-5" />
                      ) : (
                        <ChevronUp className="w-5 h-5" />
                      )}
                    </div>
                  </div>
                </div>
                
                <AnimatePresence initial={false}>
                  {!isEpisodeListCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="p-6 bg-neutral-50/10 space-y-4 border-t border-neutral-100">
                        {(() => {
                          const storyParagraphs = (script.story || '').split('\n').map(p => p.trim()).filter(Boolean);
                          if (storyParagraphs.length === 0) {
                            return <p className="text-sm text-neutral-400 italic text-center py-4">暂无剧集大纲内容</p>;
                          }
                          return storyParagraphs.map((paragraph, index) => {
                            const isEpCollapsed = collapsedEpisodes[index] ?? true;
                            return (
                              <div 
                                key={index} 
                                className="border border-neutral-200 rounded-lg overflow-hidden bg-white shadow-sm transition-all hover:border-neutral-300"
                              >
                                <div 
                                  onClick={() => toggleEpisode(index)}
                                  className="w-full flex items-center justify-between px-4 py-3 bg-neutral-50/50 hover:bg-neutral-50 text-left transition-colors cursor-pointer select-none"
                                >
                                  <span className="font-bold text-neutral-800 text-sm">
                                    第{toChineseNumeral(index + 1)}集
                                  </span>
                                  <div className="flex items-center space-x-3">
                                    {/* Action Buttons */}
                                    <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        type="button"
                                        onClick={() => handleRegenerateEpisodeClick(index)}
                                        disabled={regeneratingEpIndex === index}
                                        className="p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors flex items-center space-x-1 text-xs px-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                        title={regeneratingEpIndex === index ? 'AI 生成中...' : '重新生成 (AI生成)'}
                                      >
                                        {regeneratingEpIndex === index ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                        <span className="hidden sm:inline">{regeneratingEpIndex === index ? '生成中' : '重新生成'}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleEditEpisodeClick(index, paragraph)}
                                        className="p-1 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 rounded transition-colors flex items-center space-x-1 text-xs px-2 font-medium"
                                        title="修改"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">修改</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteEpisodeClick(index)}
                                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors flex items-center space-x-1 text-xs px-2 font-medium"
                                        title="删除"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">删除</span>
                                      </button>
                                    </div>

                                    {/* Expand Indicator */}
                                    <div className="flex items-center space-x-1 text-neutral-400 border-l border-neutral-200 pl-2.5">
                                      <span className="text-[11px] font-normal hidden md:inline">
                                        {isEpCollapsed ? '点击展开' : '点击折叠'}
                                      </span>
                                      {isEpCollapsed ? (
                                        <ChevronDown className="w-4 h-4" />
                                      ) : (
                                        <ChevronUp className="w-4 h-4" />
                                      )}
                                    </div>
                                  </div>
                                </div>
                                
                                <AnimatePresence initial={false}>
                                  {!isEpCollapsed && (
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: "auto", opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.15 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="p-4 text-sm text-neutral-600 leading-relaxed bg-white border-t border-neutral-100">
                                        {paragraph}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}

        {/* ELEMENTS TAB */}
        {activeTab === 'elements' && (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* Characters */}
            <section className="space-y-6">
              <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
                <div className="flex items-center space-x-3 text-indigo-600">
                  <Users className="w-6 h-6" />
                  <h3 className="text-xl font-bold text-neutral-900">角色设定</h3>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      const lines: string[] = [];
                      script?.elements.characters.forEach(c => lines.push(c.prompt));
                      script?.elements.scenes.forEach(s => lines.push(s.prompt));
                      script?.elements.props.forEach(p => lines.push(p.prompt));
                      copyToClipboard(lines.join('\n\n') + '\n\n生成以上所有素材图片， 要求：每生成一张图片，紧接在该 "图片" 下方用文字列出该图片对应的完整提示词原文，必须这样，必须 这样，以便对照查看。不要用表格汇总，要图片和提示词一一对应排列。并记录素材名称，后续生成视频分镜可直接按名称引用。', '所有素材提示词');
                    }}
                    className="flex items-center space-x-1 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-600 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    title="一键复制所有素材提示词"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>批量复制提示词</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setImportText(''); setImportError(null); setIsImportElementsOpen(true); }}
                    className="flex items-center space-x-1 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>导入素材列表</span>
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {script.elements.characters.map((char, i) => (
                  <div key={i} className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-full hover:shadow-md transition-shadow">
                    <div className="relative w-full h-48 bg-neutral-100 group/image">
                      {char.imageUrl ? (
                        <>
                          <img
                            src={char.imageUrl}
                            alt={char.name}
                            className="w-full h-full object-contain cursor-pointer"
                            onClick={() => setFullscreenVideo(char.imageUrl || '')}
                          />
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover/image:opacity-100 transition-opacity pointer-events-none">
                            <label className="text-white text-sm font-medium bg-black/60 px-3 py-1.5 rounded-lg cursor-pointer pointer-events-auto hover:bg-black/80 transition-colors">
                              更改图片
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleImageUpload('characters', i, file);
                                }}
                              />
                            </label>
                          </div>
                        </>
                      ) : (
                        <label className="w-full h-full flex flex-col items-center justify-center text-neutral-400 cursor-pointer">
                          <ImageIcon className="w-8 h-8 mb-2" />
                          <span className="text-xs">上传参考图</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageUpload('characters', i, file);
                            }}
                          />
                        </label>
                      )}
                    </div>
                    <div className="p-5 border-b border-neutral-100 flex-1 flex flex-col justify-center">
                      <h4 className="text-lg font-bold text-neutral-900 mb-0">{char.name}</h4>
                    </div>
                    
                    <CollapsiblePrompt 
                      title="生成提示词"
                      prompt={formatPromptWithPrefix(char.name, char.prompt, 'characters')}
                      hoverClass="hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600"
                      onCopy={() => copyToClipboard(formatPromptWithPrefix(char.name, char.prompt, 'characters'), '角色提示词')}
                      onSave={(newVal) => {
                        handleSaveElementPrompt('characters', i, newVal);
                      }}
                      onSaveToLibrary={() => {
                        if (!script) return;
                        const res = addMaterial({
                          type: 'characters',
                          name: char.name,
                          description: char.description,
                          prompt: char.prompt,
                          imageUrl: char.imageUrl,
                          sourceScriptId: script.id,
                          sourceScriptTitle: script.title,
                        });
                        showToast(res.added ? '已保存到素材库' : '该素材已在素材库中（已更新）');
                      }}
                      onRegenerate={() => {
                        setRegenerateElementItem({ type: 'characters', index: i, name: char.name, description: char.description, prompt: char.prompt });
                        setRegenerateElementReq('');
                        setRegenerateElementError(null);
                      }}
                      regenerating={regeneratingElementKey === `characters_${i}`}
                    />
                  </div>
                ))}
              </div>
            </section>
 
            {/* Scenes */}
            <section className="space-y-6">
              <div className="flex items-center space-x-3 text-emerald-600 border-b border-neutral-100 pb-4">
                <MapPin className="w-6 h-6" />
                <h3 className="text-xl font-bold text-neutral-900">场景设计</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {script.elements.scenes.map((scene, i) => (
                  <div key={i} className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-full hover:shadow-md transition-shadow">
                    <div className="relative w-full h-48 bg-neutral-100 group/image">
                      {scene.imageUrl ? (
                        <>
                          <img
                            src={scene.imageUrl}
                            alt={scene.name}
                            className="w-full h-full object-contain cursor-pointer"
                            onClick={() => setFullscreenVideo(scene.imageUrl || '')}
                          />
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover/image:opacity-100 transition-opacity pointer-events-none">
                            <label className="text-white text-sm font-medium bg-black/60 px-3 py-1.5 rounded-lg cursor-pointer pointer-events-auto hover:bg-black/80 transition-colors">
                              更改图片
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleImageUpload('scenes', i, file);
                                }}
                              />
                            </label>
                          </div>
                        </>
                      ) : (
                        <label className="w-full h-full flex flex-col items-center justify-center text-neutral-400 cursor-pointer">
                          <ImageIcon className="w-8 h-8 mb-2" />
                          <span className="text-xs">上传参考图</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageUpload('scenes', i, file);
                            }}
                          />
                        </label>
                      )}
                    </div>
                    <div className="p-5 border-b border-neutral-100 flex-1 flex flex-col justify-center">
                      <h4 className="text-lg font-bold text-neutral-900 mb-0">{scene.name}</h4>
                    </div>
                    
                    <CollapsiblePrompt 
                      title="生成提示词"
                      prompt={formatPromptWithPrefix(scene.name, scene.prompt, 'scenes')}
                      hoverClass="hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-600"
                      onCopy={() => copyToClipboard(formatPromptWithPrefix(scene.name, scene.prompt, 'scenes'), '场景提示词')}
                      onSave={(newVal) => {
                        handleSaveElementPrompt('scenes', i, newVal);
                      }}
                      onSaveToLibrary={() => {
                        if (!script) return;
                        const res = addMaterial({
                          type: 'scenes',
                          name: scene.name,
                          description: scene.description,
                          prompt: scene.prompt,
                          imageUrl: scene.imageUrl,
                          sourceScriptId: script.id,
                          sourceScriptTitle: script.title,
                        });
                        showToast(res.added ? '已保存到素材库' : '该素材已在素材库中（已更新）');
                      }}
                      onRegenerate={() => {
                        setRegenerateElementItem({ type: 'scenes', index: i, name: scene.name, description: scene.description, prompt: scene.prompt });
                        setRegenerateElementReq('');
                        setRegenerateElementError(null);
                      }}
                      regenerating={regeneratingElementKey === `scenes_${i}`}
                    />
                  </div>
                ))}
              </div>
            </section>
 
            {/* Props */}
            {script.elements.props && script.elements.props.length > 0 && (
              <section className="space-y-6">
                <div className="flex items-center space-x-3 text-amber-600 border-b border-neutral-100 pb-4">
                  <Box className="w-6 h-6" />
                  <h3 className="text-xl font-bold text-neutral-900">关键道具</h3>
                </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {script.elements.props.map((prop, i) => (
                  <div key={i} className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm flex flex-col h-full hover:shadow-md transition-shadow">
                    <div className="relative w-full h-48 bg-neutral-100 group/image">
                      {prop.imageUrl ? (
                        <>
                          <img
                            src={prop.imageUrl}
                            alt={prop.name}
                            className="w-full h-full object-contain cursor-pointer"
                            onClick={() => setFullscreenVideo(prop.imageUrl || '')}
                          />
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover/image:opacity-100 transition-opacity pointer-events-none">
                            <label className="text-white text-sm font-medium bg-black/60 px-3 py-1.5 rounded-lg cursor-pointer pointer-events-auto hover:bg-black/80 transition-colors">
                              更改图片
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleImageUpload('props', i, file);
                                }}
                              />
                            </label>
                          </div>
                        </>
                      ) : (
                        <label className="w-full h-full flex flex-col items-center justify-center text-neutral-400 cursor-pointer">
                          <ImageIcon className="w-8 h-8 mb-2" />
                          <span className="text-xs">上传参考图</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageUpload('props', i, file);
                            }}
                          />
                        </label>
                      )}
                    </div>
                    <div className="p-5 border-b border-neutral-100 flex-1 flex flex-col justify-center">
                      <h4 className="text-lg font-bold text-neutral-900 mb-0">{prop.name}</h4>
                    </div>
                    
                    <CollapsiblePrompt 
                      title="生成提示词"
                      prompt={formatPromptWithPrefix(prop.name, prop.prompt, 'props')}
                      hoverClass="hover:bg-amber-50 hover:border-amber-200 hover:text-amber-600"
                      onCopy={() => copyToClipboard(formatPromptWithPrefix(prop.name, prop.prompt, 'props'), '道具提示词')}
                      onSave={(newVal) => {
                        handleSaveElementPrompt('props', i, newVal);
                      }}
                      onSaveToLibrary={() => {
                        if (!script) return;
                        const res = addMaterial({
                          type: 'props',
                          name: prop.name,
                          description: prop.description,
                          prompt: prop.prompt,
                          imageUrl: prop.imageUrl,
                          sourceScriptId: script.id,
                          sourceScriptTitle: script.title,
                        });
                        showToast(res.added ? '已保存到素材库' : '该素材已在素材库中（已更新）');
                      }}
                        onRegenerate={() => {
                          setRegenerateElementItem({ type: 'props', index: i, name: prop.name, description: prop.description, prompt: prop.prompt });
                          setRegenerateElementReq('');
                          setRegenerateElementError(null);
                        }}
                        regenerating={regeneratingElementKey === `props_${i}`}
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* SHOTS TAB */}
        {activeTab === 'shots' && (() => {
          const storyParagraphs = (script.story || '').split('\n').map(p => p.trim()).filter(Boolean);
          // 无故事大纲时，自动创建一个默认分组，确保分镜能正常显示
          if (storyParagraphs.length === 0) storyParagraphs.push('全部镜头');
          const numEpisodes = storyParagraphs.length || 1;

          const groupedShots: Record<number, any[]> = {};
          for (let idx = 0; idx < numEpisodes; idx++) {
            groupedShots[idx] = [];
          }

          script.shots.forEach((shot, shotIndex) => {
            let epIdx = shot.episodeIndex;
            if (epIdx === undefined || epIdx < 0 || epIdx >= numEpisodes) {
              const shotsPerEpisode = Math.ceil(script.shots.length / numEpisodes) || 1;
              epIdx = Math.floor(shotIndex / shotsPerEpisode);
              if (epIdx >= numEpisodes) epIdx = numEpisodes - 1;
            }
            groupedShots[epIdx].push({ ...shot, originalIndex: shotIndex });
          });

          return (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between border-b border-neutral-100 pb-4">
                <div className="flex items-center space-x-3">
                  <h3 className="text-xl font-bold text-neutral-900">视频分镜头列表</h3>
                  <span className="text-sm text-neutral-500">{script.shots.length} 个镜头</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setImportText(''); setImportError(null); setIsImportShotsOpen(true); }}
                  className="flex items-center space-x-1 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>导入分镜列表</span>
                </button>
              </div>
              
              <div className="space-y-4">
                {storyParagraphs.map((paragraph, epIndex) => {
                  const isCollapsed = collapsedShotsEpisodes[epIndex] ?? true;
                  const epShots = groupedShots[epIndex] || [];
                  
                  return (
                    <div key={epIndex} className="border border-neutral-200 rounded-xl overflow-hidden bg-white shadow-sm">
                      {/* Episode Header */}
                      <button
                        type="button"
                        onClick={() => toggleShotsEpisode(epIndex)}
                        className="w-full flex items-center justify-between p-4 bg-neutral-50 hover:bg-neutral-100/60 transition-colors text-left"
                      >
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-neutral-800 text-base">
                            第{toChineseNumeral(epIndex + 1)}集
                          </span>
                          <span className="text-xs bg-indigo-50 text-indigo-600 px-2.5 py-0.5 rounded-full font-semibold">
                            {epShots.length} 个镜头
                          </span>
                          <span className="text-xs text-neutral-400 line-clamp-1 max-w-md ml-4 font-normal hidden sm:inline-block">
                            {paragraph}
                          </span>
                          {/* 合并分镜 - 完全参考上传视频 */}
                          {epShots.length >= 2 && (
                            <span className="ml-5 inline-block align-middle">
                              {!mergedVideos[epIndex] && !mergingEpisodes[epIndex] && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleMergeEpisodeVideos(epIndex); }}
                                  className="flex flex-col items-center justify-center w-[120px] border border-dashed border-neutral-300 rounded-lg py-3 bg-white hover:bg-neutral-100/50 hover:border-indigo-500 transition-all cursor-pointer group text-center shadow-sm"
                                  title="合并该集所有分镜视频为一个完整视频"
                                >
                                  <Video className="w-5 h-5 text-neutral-400 group-hover:text-indigo-500 mb-1 transition-colors" />
                                  <span className="text-xs font-semibold text-neutral-600 group-hover:text-indigo-600 transition-colors">合并</span>
                                </button>
                              )}
                              {mergingEpisodes[epIndex] && (
                                <span className="inline-flex items-center justify-center w-[120px] py-3">
                                  <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                                </span>
                              )}
                              {mergedVideos[epIndex] && (
                                <span className="relative inline-block w-[120px] h-[80px] align-middle group">
                                  <video
                                    ref={el => { if (el) mergedVideoRefs.current[epIndex] = el; }}
                                    key={mergedVideos[epIndex]}
                                    src={mergedVideos[epIndex]}
                                    className="w-full h-full object-cover rounded-lg bg-black border border-neutral-200 shadow-sm cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const vid = mergedVideoRefs.current[epIndex];
                                      if (!vid) return;
                                      if (vid.paused) { vid.play(); setPlayingMerged(p => ({ ...p, [epIndex]: true })); }
                                      else { vid.pause(); setPlayingMerged(p => ({ ...p, [epIndex]: false })); }
                                    }}
                                    onPlay={() => setPlayingMerged(p => ({ ...p, [epIndex]: true }))}
                                    onPause={() => setPlayingMerged(p => ({ ...p, [epIndex]: false }))}
                                  />
                                  {!playingMerged[epIndex] && (
                                    <div
                                      className="absolute inset-0 flex items-center justify-center cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const vid = mergedVideoRefs.current[epIndex];
                                        if (!vid) return;
                                        vid.play();
                                        setPlayingMerged(p => ({ ...p, [epIndex]: true }));
                                      }}
                                    >
                                      <div className="w-10 h-10 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center shadow transition-all hover:scale-110">
                                        <Play className="w-5 h-5 text-white ml-0.5" />
                                      </div>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setFullscreenVideo(mergedVideos[epIndex]); }}
                                    className="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = mergedVideos[epIndex]; a.download = `合并视频_第${epIndex+1}集.mp4`; a.click(); }}
                                    className="absolute top-1 left-1 bg-black/50 hover:bg-black/70 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="导出视频"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                      <path d="M7 10l5 5 5-5" />
                                      <path d="M12 15V3" />
                                    </svg>
                                  </button>
                                  {/* 重新合并 */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMergedVideos(p => { const n = { ...p }; delete n[epIndex]; return n; });
                                      setTimeout(() => handleMergeEpisodeVideos(epIndex), 100);
                                    }}
                                    className="absolute -bottom-4 left-1/2 -translate-x-1/2 bg-white border border-neutral-300 rounded px-2 py-0.5 text-[10px] font-bold text-neutral-500 hover:text-indigo-600 hover:border-indigo-300 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                                    title="重新合并"
                                  >↻ 重新合并</button>
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-neutral-400">
                          {epShots.length === 0 && generatingShotsEp !== epIndex && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setGenerateShotsModal({ epIndex, storyParagraph: paragraph }); setGenerateShotsReq(''); }}
                              className="flex items-center space-x-1 px-2.5 py-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors"
                              title="弹框输入需求后自动生成分镜列表"
                            >
                              <Sparkles className="w-3 h-3" />
                              <span>生成分镜列表</span>
                            </button>
                          )}
                          {generatingShotsEp === epIndex && (
                            <span className="flex items-center space-x-1 px-2.5 py-1 text-[10px] font-bold text-indigo-400">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              <span>生成中...</span>
                            </span>
                          )}
                          <span className="text-xs">
                            {isCollapsed ? '点击展开' : '点击折叠'}
                          </span>
                          {isCollapsed ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronUp className="w-4 h-4" />
                          )}
                        </div>
                      </button>
                      
                      {/* Episode Content */}
                      <AnimatePresence initial={false}>
                        {!isCollapsed && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden border-t border-neutral-100"
                          >
                            <div className="p-4 space-y-4 bg-neutral-50/20">
                              {epShots.length === 0 ? (
                                <p className="text-sm text-neutral-400 italic text-center py-6">暂无镜头内容</p>
                              ) : (
                                epShots.map((shot, shotIndexInEpisode) => {
                                  const originalIndex = shot.originalIndex;
                                  return (
                                    <div key={originalIndex} className="bg-white border border-neutral-200 rounded-xl flex flex-col md:flex-row shadow-sm relative z-10 hover:z-30 transition-all">
                                      {/* Left Column: Shot Number Indicator & Video Upload / Player */}
                                      <div className="bg-neutral-50 px-4 md:px-6 py-5 flex flex-col items-center justify-start border-b md:border-b-0 md:border-r border-neutral-200 min-w-[120px] md:max-w-[180px] shrink-0 space-y-4 rounded-t-xl md:rounded-t-none md:rounded-l-xl">
                                        {/* 导出配套图片按钮 — 放在镜头编号正上方 */}
                                        <button
                                          type="button"
                                          onClick={() => exportShotAssets(shot, originalIndex, epIndex, shotIndexInEpisode + 1)}
                                          className="text-[10px] text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1 rounded font-bold flex items-center space-x-1 transition-all cursor-pointer shadow-sm"
                                          title="导出本镜头生成视频所需的所有配套图片（素材图+关键帧+上一镜尾帧）到一个文件夹"
                                        >
                                          <Download className="w-3 h-3 text-amber-600" />
                                          <span>导出配套图片</span>
                                        </button>
                                        <div className="text-center">
                                          <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider block mb-0.5">镜头</span>
                                          <span className="text-4xl font-black text-indigo-600 block leading-none">{shotIndexInEpisode + 1}</span>
                                          {shot.duration && (
                                            <span className="inline-block mt-2 text-[10px] font-mono text-neutral-600 bg-white border border-neutral-200 px-2 py-0.5 rounded shadow-sm">
                                              {shot.duration}
                                            </span>
                                          )}
                                        </div>

                                        <div className="w-full pt-3 border-t border-neutral-200/60">
                                          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1.5 text-center">镜头对应视频</span>
                                          {shot.videoUrl ? (
                                            <div className="space-y-1.5">
                                              <div className="relative group">
                                                <video
                                                  ref={el => { if (el) videoRefs.current[originalIndex] = el; }}
                                                  key={shot.videoUrl}
                                                  src={shot.videoUrl}
                                                  className="w-full object-contain max-h-[220px] rounded-lg bg-black border border-neutral-200 shadow-sm cursor-pointer"
                                                  onClick={() => {
                                                    const vid = videoRefs.current[originalIndex];
                                                    if (!vid) return;
                                                    if (vid.paused) { vid.play(); setPlayingVideos(p => ({ ...p, [originalIndex]: true })); }
                                                    else { vid.pause(); setPlayingVideos(p => ({ ...p, [originalIndex]: false })); }
                                                  }}
                                                  onPlay={() => setPlayingVideos(p => ({ ...p, [originalIndex]: true }))}
                                                  onPause={() => setPlayingVideos(p => ({ ...p, [originalIndex]: false }))}
                                                />
                                                {/* 中央播放/暂停按钮 */}
                                                {!playingVideos[originalIndex] && (
                                                  <div
                                                    className="absolute inset-0 flex items-center justify-center cursor-pointer"
                                                    onClick={() => {
                                                      const vid = videoRefs.current[originalIndex];
                                                      if (!vid) return;
                                                      vid.play();
                                                      setPlayingVideos(p => ({ ...p, [originalIndex]: true }));
                                                    }}
                                                  >
                                                    <div className="w-12 h-12 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110">
                                                      <Play className="w-5 h-5 text-white ml-0.5" />
                                                    </div>
                                                  </div>
                                                )}
                                                <button
                                                  type="button"
                                                  onClick={() => { const a = document.createElement('a'); a.href = shot.videoUrl || ''; a.download = `镜头${originalIndex+1}.mp4`; a.click(); }}
                                                  className="absolute top-1.5 left-1.5 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                                                  title="导出视频"
                                                >
                                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                    <path d="M7 10l5 5 5-5" />
                                                    <path d="M12 15V3" />
                                                  </svg>
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setFullscreenVideo(shot.videoUrl || '')}
                                                  className="absolute top-1.5 right-1.5 bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                                                  title="全屏播放"
                                                >
                                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                                  </svg>
                                                </button>
                                              </div>
                                              <div className="flex justify-center">
                                                <label className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 bg-white hover:bg-indigo-50 border border-neutral-200 hover:border-indigo-200 px-2.5 py-1 rounded-md flex items-center space-x-1 cursor-pointer transition-all shadow-sm">
                                                  <Upload className="w-2.5 h-2.5" />
                                                  <span>更换视频</span>
                                                  <input 
                                                    type="file" 
                                                    accept="video/*" 
                                                    className="hidden" 
                                                    onChange={(e) => {
                                                      const file = e.target.files?.[0];
                                                      if (file) handleShotVideoUpload(originalIndex, file);
                                                    }}
                                                  />
                                                </label>
                                              </div>
                                            </div>
                                          ) : (
                                            <label className="w-full flex flex-col items-center justify-center border border-dashed border-neutral-300 rounded-lg p-3 bg-white hover:bg-neutral-100/50 hover:border-indigo-500 transition-all cursor-pointer group text-center shadow-sm">
                                              <Video className="w-4 h-4 text-neutral-400 group-hover:text-indigo-500 mb-1 transition-colors" />
                                              <span className="text-[10px] font-semibold text-neutral-600 group-hover:text-indigo-600 transition-colors">上传视频</span>
                                              <input 
                                                type="file" 
                                                accept="video/*" 
                                                className="hidden" 
                                                onChange={(e) => {
                                                  const file = e.target.files?.[0];
                                                  if (file) handleShotVideoUpload(originalIndex, file);
                                                }}
                                              />
                                            </label>
                                          )}
                                        </div>

                                        {/* 上一镜末帧（自动捕获） */}
                                        {shot.lastFrameUrl && (
                                          <div className="pt-1.5">
                                            <img
                                              src={shot.lastFrameUrl}
                                              alt="上一镜末帧"
                                              className="w-full aspect-[16/9] object-contain rounded-lg border border-neutral-200 bg-neutral-50 shadow-sm cursor-pointer hover:opacity-80 transition-opacity"
                                              onClick={() => setFullscreenVideo(shot.lastFrameUrl)}
                                            />
                                          </div>
                                        )}
                                      {shotIndexInEpisode === epShots.length - 1 && (
                                        <button
                                          type="button"
                                          onClick={() => { setAddShotText(''); setAddShotAfterIndex(originalIndex); }}
                                          disabled={addingShotIndex === originalIndex}
                                          className="w-full flex items-center justify-center space-x-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-dashed border-indigo-200 hover:border-indigo-400 px-3 py-2 rounded-lg transition-all cursor-pointer mt-auto disabled:opacity-50 disabled:cursor-not-allowed"
                                          title={addingShotIndex === originalIndex ? 'AI 生成中...' : '在当前分镜后用 AI 续写下一个分镜'}
                                        >
                                          {addingShotIndex === originalIndex ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                                          <span>{addingShotIndex === originalIndex ? '生成中' : '新增下一分镜'}</span>
                                        </button>
                                      )}
                                      </div>
                                      
                                      {/* Middle Column: Details (Keyframes, Materials) */}
                                      <div className="flex-1 p-6 space-y-4">
                                        {/* 4-grid keyframe photos (4宫图) - 放在出场素材上方 并且是 2行2列 (grid-cols-2) */}
                                        <div className="space-y-2">
                                          <div className="flex items-center justify-between">
                                            <h5 className="text-xs font-bold text-neutral-500 uppercase tracking-wider flex items-center space-x-1.5">
                                              <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
                                              <span>关键帧图片</span>
                                            </h5>
                                            {(() => {
                                              const activeKeyframePrompts = shot.keyframePrompts || [];
                                              const hasAnyPrompt = activeKeyframePrompts.some((p: string) => p && p.trim() !== '');
                                              return (
                                                <div className="flex items-center space-x-2">
                                                  {hasAnyPrompt && (
                                                    <span className="flex items-center" title="已自动提取关键帧">
                                                      <span className="relative flex h-2 w-2 mr-1">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                                      </span>
                                                    </span>
                                                  )}

                                                  {hasAnyPrompt && (
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        const startSec = shot.duration ? ((p) => { const parts = p.replace(/[[\]]/g, '').split('-'); return parseInt(parts[0]?.trim()?.split(':')[0] || '0') * 60 + parseInt(parts[0]?.trim()?.split(':')[1] || '0'); })(shot.duration) : 0;
                                                        const cleaned = convertToRelativeTime(shot.prompt.replace(/\\_/g, '').replace(/台词:\s*/g, '').replace(/^\*\*镜\s*\d+\s*\([^)]+\)\s*【[^】]+】\s*\*\*[\r\n]*/gm, ''), startSec);
                                                        const formattedVideoPrompt = formatPromptTags(
                                                          appendDialogueAndSfx(cleanDuplicateDurations(shot.duration, cleaned), shot),
                                                          elementNames,
                                                          elements
                                                        );
                                                        const keyframeLines = activeKeyframePrompts
                                                          .map((p: string, i: number) => {
                                                            const formattedKfPrompt = formatPromptTags(p, elementNames, elements);
                                                            return `kf_${i + 1} : ${formattedKfPrompt}`;
                                                          })
                                                          .join('\n\n\n');
                                                        const copyText = `这是 分镜视频生成提示词 : ${formattedVideoPrompt} , 下面是 根据 视频分镜提示词 提取的 关键帧 提示词 :\n\n\n${keyframeLines}\n\n\n生成以上所有素材图片， 要求：每生成一张图片，紧接在该 "图片" 下方用文字列出该图片对应的完整提示词原文，必须这样，必须 这样，以便对照查看。不要用表格汇总，要图片和提示词一一对应排列。并记录素材名称，后续生成视频分镜可直接按名称引用。`;
                                                        copyToClipboard(copyText, '批量关键帧及视频提示词');
                                                      }}
                                                      className="text-[10px] text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded font-bold flex items-center space-x-1 transition-all cursor-pointer shadow-sm"
                                                      title="批量复制视频生成提示词和所有提取的关键帧提示词"
                                                    >
                                                      <Copy className="w-3 h-3 text-emerald-600" />
                                                      <span>批量复制提示词</span>
                                                    </button>
                                                  )}

                                                  <button
                                                    type="button"
                                                    disabled={generatingKeyframes[`extracting_${originalIndex}`]}
                                                    onClick={() => handleAIExtractKeyframes(originalIndex, shot)}
                                                    className="text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded font-bold flex items-center space-x-1 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                                                    title="自动根据视频生成提示词内容，提取出关键帧提示词"
                                                  >
                                                    {generatingKeyframes[`extracting_${originalIndex}`] ? (
                                                      <>
                                                        <Loader2 className="w-3 h-3 animate-spin text-indigo-600" />
                                                        <span>正在提取...</span>
                                                      </>
                                                    ) : (
                                                      <>
                                                        <Sparkles className="w-3 h-3 text-indigo-600 animate-pulse" />
                                                        <span>{hasAnyPrompt ? "AI 重新提取" : "AI 提取关键帧"}</span>
                                                      </>
                                                    )}
                                                  </button>
                                                </div>
                                              );
                                            })()}
                                          </div>
                                          <div className="grid grid-cols-2 gap-2.5 max-w-sm">
                                            {(() => {
                                              const activeKeyframePrompts = shot.keyframePrompts || [];
                                              const hasAnyPrompt = activeKeyframePrompts.some((p: string) => p && p.trim() !== '');
                                              const keyframeIndices = hasAnyPrompt ? Array.from({ length: activeKeyframePrompts.length }, (_, i) => i) : [0, 1, 2, 3];
                                              return keyframeIndices.map((kfIdx) => {
                                                const kfUrl = (shot.keyframes || [])[kfIdx];
                                                const isGenerating = generatingKeyframes[`${originalIndex}_${kfIdx}`] || generatingKeyframes[`extracting_${originalIndex}`];
                                                return (
                                                  <div 
                                                    key={kfIdx} 
                                                    className="relative aspect-[16/9] bg-neutral-50 border border-dashed border-neutral-300 rounded-lg overflow-hidden group/kf hover:border-indigo-500 transition-all shadow-sm"
                                                  >
                                                    {kfUrl ? (
                                                      <>
                                                        <img
                                                          src={kfUrl}
                                                          alt={`Keyframe ${kfIdx + 1}`}
                                                          className="w-full h-full object-contain cursor-pointer"
                                                          onClick={() => setFullscreenVideo(kfUrl)}
                                                        />
                                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover/kf:opacity-100 transition-opacity pointer-events-none">
                                                          <label className="text-white text-[9px] font-semibold bg-black/60 px-1.5 py-0.5 rounded-full cursor-pointer pointer-events-auto hover:bg-black/80">
                                                            更换帧 {kfIdx + 1}
                                                            <input 
                                                              type="file" 
                                                              accept="image/*" 
                                                              className="hidden" 
                                                              onChange={(e) => {
                                                                const file = e.target.files?.[0];
                                                                if (file) handleShotKeyframeUpload(originalIndex, kfIdx, file);
                                                              }}
                                                            />
                                                          </label>
                                                        </div>
                                                      </>
                                                    ) : (
                                                      <label className="absolute inset-0 flex flex-col items-center justify-center text-neutral-400 p-1 cursor-pointer">
                                                        <Plus className="w-3.5 h-3.5 mb-0.5 text-neutral-300" />
                                                        <span className="text-[9px] font-semibold text-neutral-400">帧 {kfIdx + 1}</span>
                                                        <input 
                                                          type="file" 
                                                          accept="image/*" 
                                                          className="hidden" 
                                                          onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (file) handleShotKeyframeUpload(originalIndex, kfIdx, file);
                                                          }}
                                                        />
                                                      </label>
                                                    )}

                                                    {/* Generating indicator */}
                                                    {isGenerating && (
                                                      <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center text-neutral-700 z-10 transition-opacity">
                                                        <Loader2 className="w-4 h-4 animate-spin text-indigo-600 mb-1" />
                                                        <span className="text-[8px] font-bold text-indigo-600 tracking-tight">智能生成提示词...</span>
                                                      </div>
                                                    )}

                                                    {/* Click trigger Sparkles button at top right */}
                                                    {!isGenerating && (
                                                      <div 
                                                        className="absolute top-1 right-1 z-20"
                                                        onClick={(e) => e.stopPropagation()}
                                                      >
                                                        <button
                                                          type="button"
                                                          onClick={() => triggerKeyframeAction(originalIndex, kfIdx, shot)}
                                                          className={`p-1 bg-white border rounded-full shadow-sm hover:scale-105 transition-all flex items-center justify-center ${
                                                            shot.keyframePrompts?.[kfIdx]
                                                              ? 'text-indigo-600 border-indigo-200 bg-indigo-50 hover:bg-indigo-100'
                                                              : 'text-neutral-400 border-neutral-200 hover:text-indigo-600 hover:bg-neutral-50'
                                                          }`}
                                                          title={shot.keyframePrompts?.[kfIdx] ? "查看/编辑 AI 提示词" : "点击生成 AI 提示词"}
                                                        >
                                                          <Sparkles className="w-3 h-3" />
                                                        </button>
                                                      </div>
                                                    )}

                                                  </div>
                                                );
                                              });
                                            })()}
                                          </div>
                                        </div>
                                        
                                        {/* Materials / 出场素材 */}
                                        <div className="bg-neutral-50 p-3 rounded-lg border border-neutral-100 mt-2 space-y-2">
                                            <div className="flex items-center justify-between">
                                              <h5 className="text-xs font-bold text-neutral-500 uppercase tracking-wider flex items-center space-x-1">
                                                <Box className="w-3 h-3" />
                                                <span>出场素材</span>
                                              </h5>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const details = getMaterialDetails(shot.materials);
                                                  const prompts = details.map(m => 
                                                    m.item && (m.item as any).prompt
                                                      ? formatPromptWithPrefix((m.item as any).name, (m.item as any).prompt, (m.item as any).elementType)
                                                      : m.name
                                                  );
                                                  copyToClipboard(prompts.join('\n\n\n') + '\n\n生成以上所有素材图片， 要求：每生成一张图片，紧接在该 "图片" 下方用文字列出该图片对应的完整提示词原文，必须这样，必须 这样，以便对照查看。不要用表格汇总，要图片和提示词一一对应排列。并记录素材名称，后续生成视频分镜可直接按名称引用。', '批量出场素材提示词');
                                                }}
                                                className="text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded font-bold flex items-center space-x-1 transition-all cursor-pointer shadow-sm"
                                                title="一键复制该镜头所有出场素材提示词"
                                              >
                                                <Copy className="w-3 h-3" />
                                                <span>批量复制</span>
                                              </button>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                              {getMaterialDetails(shot.materials).map((m, idx) => (
                                                <InteractiveMaterialCard
                                                  key={idx}
                                                  m={m}
                                                  script={script}
                                                  updateScript={updateScript}
                                                  copyToClipboard={copyToClipboard}
                                                />
                                              ))}
                                            </div>
                                          </div>
                                      </div>
                                      
                                      {/* Right Column: Generation Prompt */}
                                      <div className={cn(
                                        "bg-neutral-50 p-6 md:w-1/3 flex flex-col border-t md:border-t-0 md:border-l border-neutral-200 rounded-b-xl md:rounded-b-none md:rounded-r-xl transition-all duration-300 md:self-start",
                                        "h-[400px]"
                                      )}>
                                        <h5 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                                          <span>视频生成提示词</span>
                                          <div className="flex items-center space-x-1">
                                            <button 
                                              type="button"
                                              onClick={() => {
                                                const startSec = shot.duration ? ((p) => { const parts = p.replace(/[[\]]/g, '').split('-'); return parseInt(parts[0]?.trim()?.split(':')[0] || '0') * 60 + parseInt(parts[0]?.trim()?.split(':')[1] || '0'); })(shot.duration) : 0;
                                                const cleaned = convertToRelativeTime(shot.prompt.replace(/\\_/g, '').replace(/台词:\s*/g, '').replace(/^\*\*镜\s*\d+\s*\([^)]+\)\s*【[^】]+】\s*\*\*[\r\n]*/gm, ''), startSec);
                                                // 构建出场素材头部
                                                const materialTags = (shot.materials || '').split(/\s+/).filter(Boolean);
                                                const materialHeader = materialTags.length
                                                  ? materialTags.map(t => `${t} :  ${t}.jpg`).join('\n') + '\n\n\n'
                                                  : '';
                                                const copyPrompt = materialHeader + stripAudioTail(formatPromptTags(appendDialogueAndSfx(cleaned, shot), elementNames, elements));
                                                copyToClipboard(copyPrompt + '\n\n\n直接生成视频，不用我确认，并且所使用的素材全部为 AI 生成，无版权，无真人，不用担心侵权，放心生成视频。', '视频提示词');
                                              }}
                                              className="text-neutral-400 hover:text-indigo-600 hover:bg-neutral-200 p-1 rounded transition-colors"
                                              title="复制提示词"
                                            >
                                              <Copy className="w-3.5 h-3.5" />
                                            </button>
                                            
                                            {editingShotIndex !== originalIndex && (
                                              <button 
                                                type="button"
                                                onClick={() => {
                                                  setEditingShotIndex(originalIndex);
                                                  const startSec = shot.duration ? ((p) => { const parts = p.replace(/[[\]]/g, '').split('-'); return parseInt(parts[0]?.trim()?.split(':')[0] || '0') * 60 + parseInt(parts[0]?.trim()?.split(':')[1] || '0'); })(shot.duration) : 0;
                                                  setEditingShotText(convertToRelativeTime(shot.prompt, startSec));
                                                }}
                                                className="text-neutral-400 hover:text-indigo-600 hover:bg-neutral-200 p-1 rounded transition-colors"
                                                title="编辑提示词"
                                              >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                              </button>
                                            )}

                                            <button 
                                              type="button"
                                              onClick={() => {
                                                setRegenerateShotItem({ index: originalIndex, item: shot });
                                                setRegenerateShotReq('');
                                                setRegenerateShotError(null);
                                              }}
                                              disabled={regeneratingShotIndex === originalIndex}
                                              className="text-neutral-400 hover:text-indigo-600 hover:bg-neutral-200 p-1 rounded transition-colors disabled:opacity-50"
                                              title={regeneratingShotIndex === originalIndex ? 'AI 生成中...' : '重新生成提示词（弹框输入需求）'}
                                            >
                                              {regeneratingShotIndex === originalIndex ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                              ) : (
                                                <Sparkles className="w-3.5 h-3.5" />
                                              )}
                                            </button>

                                            <button 
                                              type="button"
                                              onClick={() => setDeletingShotIndex(originalIndex)}
                                              className="text-red-400 hover:text-red-600 hover:bg-red-100 p-1 rounded transition-colors"
                                              title="删除分镜"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        </h5>
                                        
                                        {editingShotIndex === originalIndex ? (
                                          <div className="flex-1 flex flex-col space-y-2 min-h-0">
                                            <textarea
                                              value={editingShotText}
                                              onChange={(e) => setEditingShotText(e.target.value)}
                                              className="flex-1 min-h-0 w-full text-xs font-mono text-neutral-800 p-2.5 border border-neutral-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white resize-none"
                                            />
                                            <div className="flex justify-end space-x-1.5">
                                              <button
                                                type="button"
                                                onClick={() => setEditingShotIndex(null)}
                                                className="px-2.5 py-1 text-[10px] border border-neutral-200 bg-white hover:bg-neutral-50 rounded font-semibold text-neutral-600 transition-colors"
                                              >
                                                取消
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  handleSaveShotPrompt(originalIndex, editingShotText);
                                                  setEditingShotIndex(null);
                                                }}
                                                className="px-2.5 py-1 text-[10px] bg-indigo-600 hover:bg-indigo-700 rounded font-semibold text-white transition-colors"
                                              >
                                                保存
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="flex-1 flex flex-col min-h-0">
                                            <div className="relative flex-1 min-h-0 flex flex-col mb-1">
                                              <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] pr-1">
                                                <p className="text-xs font-mono text-neutral-600 leading-relaxed break-words whitespace-pre-wrap pb-4">
                                                  {shot.duration && <span className="font-bold text-indigo-600 mr-1">[{shot.duration}]</span>}
                                                  {renderEnhancedPrompt(appendDialogueAndSfx(cleanDuplicateDurations(shot.duration, (() => {
                                                    const startSec = shot.duration ? (() => { const p = shot.duration.replace(/[[\]]/g, '').split('-'); return parseInt(p[0]?.trim()?.split(':')[0] || '0') * 60 + parseInt(p[0]?.trim()?.split(':')[1] || '0'); })() : 0;
                                                    return convertToRelativeTime(shot.prompt.replace(/\\_/g, '').replace(/台词:\s*/g, '').replace(/^\*\*镜\s*\d+\s*\([^)]+\)\s*【[^】]+】\s*\*\*[\r\n]*/gm, ''), startSec);
                                                  })()), shot), elementNames, elements, script, updateScript, copyToClipboard)}
                                                </p>
                                              </div>
                                              
                                              {/* Fade-out overlay at the bottom of the scroll view */}
                                              <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-neutral-50 to-transparent pointer-events-none" />
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

      </div>

      {isCreateEpisodeOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white border border-neutral-200 rounded-2xl w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden my-8">
            <div className="flex items-center justify-between px-6 py-4 bg-neutral-50 border-b border-neutral-200">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                <h3 className="text-lg font-bold text-neutral-900">新建集数</h3>
              </div>
              <button 
                type="button"
                onClick={() => setIsCreateEpisodeOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 p-1 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateEpisodeSubmit} className="p-6 space-y-4">
              {/* Provider Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">AI 模型提供商</label>
                <select
                  value={createEpProvider}
                  onChange={(e) => { setCreateEpProvider(e.target.value as any); localStorage.setItem('create_provider', e.target.value); }}
                  className="w-full text-sm rounded-lg border border-neutral-300 p-2.5 bg-white font-medium text-neutral-800 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="deepseek">DeepSeek (默认 - 文本逻辑强)</option>
                  <option value="doubao">火山抖包 (故事本地化佳)</option>
                </select>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-neutral-200">
                <button
                  type="button"
                  onClick={() => setCreateEpActiveTab('ai_write')}
                  className={cn(
                    "flex-1 pb-2.5 text-xs font-bold uppercase tracking-wider text-center border-b-2 transition-all",
                    createEpActiveTab === 'ai_write'
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-neutral-400 hover:text-neutral-600"
                  )}
                >
                  让 AI 续写
                </button>
                <button
                  type="button"
                  onClick={() => setCreateEpActiveTab('existing_script')}
                  className={cn(
                    "flex-1 pb-2.5 text-xs font-bold uppercase tracking-wider text-center border-b-2 transition-all",
                    createEpActiveTab === 'existing_script'
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-neutral-400 hover:text-neutral-600"
                  )}
                >
                  使用现有脚本
                </button>
                <button
                  type="button"
                  onClick={() => setCreateEpActiveTab('video_recreate')}
                  className={cn(
                    "flex-1 pb-2.5 text-xs font-bold uppercase tracking-wider text-center border-b-2 transition-all",
                    createEpActiveTab === 'video_recreate'
                      ? "border-indigo-600 text-indigo-600"
                      : "border-transparent text-neutral-400 hover:text-neutral-600"
                  )}
                >
                  参考视频二创
                </button>
              </div>

              {/* Tab Contents */}
              {createEpActiveTab === 'ai_write' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">续写要求和内容方向</label>
                    <textarea
                      required
                      rows={4}
                      value={continuationPrompt}
                      onChange={(e) => setContinuationPrompt(e.target.value)}
                      placeholder="例如：进入老旧公寓大堂后，林薇遇到了神秘的管理员，对方警告她今晚不要坐电梯。写出紧张感、细节丰富的画面描述。"
                      className="w-full text-sm rounded-lg border border-neutral-300 p-3 text-neutral-800 placeholder-neutral-400 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
                    />
                  </div>
                </div>
              )}

              {createEpActiveTab === 'existing_script' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider font-semibold">输入现有脚本内容 / 大纲</label>
                    <textarea
                      required
                      rows={5}
                      value={manualScriptContent}
                      onChange={(e) => setManualScriptContent(e.target.value)}
                      placeholder="直接粘贴本集的故事描述或剧本草稿..."
                      className="w-full text-sm rounded-lg border border-neutral-300 p-3 text-neutral-800 placeholder-neutral-400 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
                    />
                  </div>
                </div>
              )}

              {createEpActiveTab === 'video_recreate' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">二创改编要求 (可选)</label>
                    <input
                      type="text"
                      value={videoRecreatePrompt}
                      onChange={(e) => setVideoRecreatePrompt(e.target.value)}
                      placeholder="例如：将视频中的白天场景改为深夜，主角换成林薇..."
                      className="w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 text-neutral-800 placeholder-neutral-400 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider">上传参考视频 (必填)</label>
                    <div className="flex items-center justify-center border-2 border-dashed border-neutral-300 hover:border-indigo-500 rounded-lg p-4 bg-neutral-50 hover:bg-neutral-100/40 transition-colors cursor-pointer relative group">
                      <div className="flex flex-col items-center justify-center text-center space-y-1 p-2">
                        <Film className="w-6 h-6 text-neutral-400 group-hover:text-indigo-500 transition-colors" />
                        <span className="text-xs font-semibold text-neutral-700 group-hover:text-indigo-600 transition-colors">
                          {videoRecreateFile ? videoRecreateFile.name : '选择或拖拽视频文件'}
                        </span>
                        <span className="text-[10px] text-neutral-400">
                          {videoRecreateFile ? `${(videoRecreateFile.size / 1024 / 1024).toFixed(1)} MB` : 'MP4, WebM up to 10MB'}
                        </span>
                      </div>
                      <input
                        required={!videoRecreateFile}
                        type="file"
                        accept="video/*"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setVideoRecreateFile(file);
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {createEpError && (
                <div className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                  {createEpError}
                </div>
              )}

              <div className="flex space-x-3 justify-end pt-4 border-t border-neutral-200">
                <button
                  type="button"
                  disabled={isCreatingEpisode}
                  onClick={() => setIsCreateEpisodeOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isCreatingEpisode}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 rounded-lg transition-colors shadow-sm flex items-center space-x-1.5"
                >
                  {isCreatingEpisode ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>正在分析创作中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>开始续写新一集</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 修改集数大纲弹窗 */}
      {editingEpIndex !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-neutral-100">
              <h3 className="text-lg font-bold text-neutral-900 flex items-center space-x-2">
                <Pencil className="w-5 h-5 text-indigo-600" />
                <span>修改第 {editingEpIndex + 1} 集大纲</span>
              </h3>
              <button 
                onClick={() => setEditingEpIndex(null)}
                className="text-neutral-400 hover:text-neutral-600 rounded-lg p-1 hover:bg-neutral-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider">
                  集数大纲内容
                </label>
                <textarea
                  value={editingEpText}
                  onChange={(e) => setEditingEpText(e.target.value)}
                  rows={6}
                  placeholder="请输入该集数的大纲内容..."
                  className="w-full text-sm bg-neutral-50 border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                />
              </div>
            </div>

            <div className="flex space-x-3 justify-end mt-6 pt-4 border-t border-neutral-100">
              <button 
                onClick={() => setEditingEpIndex(null)}
                className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button 
                onClick={saveEditedEpisode}
                disabled={!editingEpText.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 生成分镜列表弹窗 */}
      {generateShotsModal !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Fixed Header */}
            <div className="p-6 pb-4 border-b border-neutral-100 shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-neutral-900 flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                  <span>生成分镜列表</span>
                </h3>
                <button
                  onClick={() => setGenerateShotsModal(null)}
                  className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-neutral-500 mt-1">
                第 <span className="font-semibold text-neutral-800">{toChineseNumeral(generateShotsModal.epIndex + 1)}</span> 集 — 需求为可选项，不填则按原文生成分镜
              </p>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 pt-4 space-y-4 overflow-y-auto flex-1">
              {/* 故事大纲（只读参考） */}
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">当前故事大纲（参考）</label>
                <div className="w-full text-xs font-mono text-neutral-600 bg-neutral-100 border border-neutral-200 rounded-xl p-3 max-h-[120px] overflow-y-auto leading-relaxed whitespace-pre-wrap">
                  {generateShotsModal.storyParagraph || '（空）'}
                </div>
              </div>

              {/* 需求输入 */}
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">分镜需求 <span className="text-neutral-400 font-normal normal-case">（可选）</span></label>
                <textarea
                  value={generateShotsReq}
                  onChange={(e) => setGenerateShotsReq(e.target.value)}
                  rows={5}
                  placeholder="例如：紧张悬疑风格，多使用特写和快速切换镜头，突出主角的内心挣扎..."
                  className="w-full text-sm bg-white border border-neutral-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                />
              </div>

              {/* AI 模型选择 */}
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">AI 模型</label>
                <select
                  value={createEpProvider}
                  onChange={(e) => { setCreateEpProvider(e.target.value as any); localStorage.setItem('create_provider', e.target.value); }}
                  disabled={generatingShotsEp === generateShotsModal.epIndex}
                  className="w-full text-sm rounded-lg border border-neutral-300 p-2 bg-white font-medium text-neutral-800 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="deepseek">DeepSeek（文本逻辑强）</option>
                  <option value="doubao">火山豆包（故事本地化佳）</option>
                </select>
              </div>
            </div>

            {/* Fixed Footer */}
            <div className="p-6 pt-4 border-t border-neutral-100 shrink-0">
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setGenerateShotsModal(null)}
                  disabled={generatingShotsEp === generateShotsModal.epIndex}
                  className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    const modal = generateShotsModal;
                    if (!modal) return;
                    setGenerateShotsModal(null);
                    handleGenerateShotsForEpisode(modal.epIndex, modal.storyParagraph, generateShotsReq).catch(() => {});
                  }}
                  disabled={generatingShotsEp === generateShotsModal.epIndex}
                  className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {generatingShotsEp === generateShotsModal.epIndex ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /><span>AI 生成中...</span></>
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>{generatingShotsEp === generateShotsModal.epIndex ? '' : '开始生成'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 重写分镜提示词弹窗 */}
      {regenerateShotItem !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Fixed Header */}
            <div className="p-6 pb-4 border-b border-neutral-100 shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-neutral-900 flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                  <span>重写分镜提示词</span>
                </h3>
                <button
                  onClick={() => setRegenerateShotItem(null)}
                  className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-neutral-500 mt-1">
                第 <span className="font-semibold text-neutral-800">{regenerateShotItem.item.shotNumber}</span> 号分镜 — 需求为可选项，不填则直接按原文重写
              </p>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 pt-4 space-y-4 overflow-y-auto flex-1">
              {regenerateShotError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{regenerateShotError}</div>
              )}

              {/* 旧提示词（只读参考） */}
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">当前提示词（参考）</label>
                <div className="w-full text-xs font-mono text-neutral-600 bg-neutral-100 border border-neutral-200 rounded-xl p-3 max-h-[120px] overflow-y-auto leading-relaxed whitespace-pre-wrap">
                  {regenerateShotItem.item.prompt || '（空）'}
                </div>
              </div>

              {/* 修改需求输入 */}
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">修改需求 <span className="text-neutral-400 font-normal normal-case">（可选）</span></label>
                <textarea
                  value={regenerateShotReq}
                  onChange={(e) => setRegenerateShotReq(e.target.value)}
                  rows={5}
                  placeholder="例如：特写 外卖员 上楼梯的脚步，然后全景跟随 外卖员 上楼至门口，大爷开门..."
                  className="w-full text-sm bg-white border border-neutral-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                />
              </div>

              {/* AI 模型选择 */}
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">AI 模型</label>
                <select
                  value={createEpProvider}
                  onChange={(e) => { setCreateEpProvider(e.target.value as any); localStorage.setItem('create_provider', e.target.value); }}
                  disabled={regeneratingShotIndex === regenerateShotItem.index}
                  className="w-full text-sm rounded-lg border border-neutral-300 p-2 bg-white font-medium text-neutral-800 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="deepseek">DeepSeek（文本逻辑强）</option>
                  <option value="doubao">火山豆包（故事本地化佳）</option>
                </select>
              </div>
            </div>

            {/* Fixed Footer */}
            <div className="p-6 pt-4 border-t border-neutral-100 shrink-0">
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setRegenerateShotItem(null)}
                  disabled={regeneratingShotIndex === regenerateShotItem.index}
                  className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setRegenerateShotError(null);
                    handleRegenerateShotPrompt(regenerateShotItem.index, regenerateShotItem.item, regenerateShotReq).catch(() => {});
                  }}
                  disabled={regeneratingShotIndex === regenerateShotItem.index}
                  className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {regeneratingShotIndex === regenerateShotItem.index ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /><span>AI 生成中...</span></>
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>{regeneratingShotIndex === regenerateShotItem.index ? '' : 'AI 重新生成'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 重写素材（角色/场景/道具）提示词弹窗 */}
      {regenerateElementItem !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Fixed Header */}
            <div className="p-6 pb-4 border-b border-neutral-100 shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-neutral-900 flex items-center space-x-2">
                  <Sparkles className="w-5 h-5 text-indigo-600" />
                  <span>重写素材提示词</span>
                </h3>
                <button
                  onClick={() => setRegenerateElementItem(null)}
                  disabled={regeneratingElementKey !== null}
                  className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg transition-colors disabled:opacity-40"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-neutral-500 mt-1">
                <span className="font-semibold text-neutral-800">{regenerateElementItem.name}</span> — 需求为可选项，不填则直接按原设定重写
              </p>
            </div>

            {/* Scrollable Content */}
            <div className="p-6 pt-4 space-y-4 overflow-y-auto flex-1">
              {regenerateElementError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{regenerateElementError}</div>
              )}

              {/* 旧提示词（只读参考） */}
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">当前提示词（参考）</label>
                <div className="w-full text-xs font-mono text-neutral-600 bg-neutral-100 border border-neutral-200 rounded-xl p-3 max-h-[160px] overflow-y-auto leading-relaxed whitespace-pre-wrap">
                  {regenerateElementItem.prompt || '（空）'}
                </div>
              </div>

              {/* 修改需求输入 */}
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">修改需求 <span className="text-neutral-400 font-normal normal-case">（可选）</span></label>
                <textarea
                  value={regenerateElementReq}
                  onChange={(e) => setRegenerateElementReq(e.target.value)}
                  rows={5}
                  placeholder="例如：更阴郁的光影、改为黄金时刻逆光、增加战损细节、换个发型……"
                  className="w-full text-sm bg-white border border-neutral-300 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                />
              </div>

              {/* AI 模型选择 */}
              <div>
                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">AI 模型</label>
                <select
                  value={createEpProvider}
                  onChange={(e) => { setCreateEpProvider(e.target.value as any); localStorage.setItem('create_provider', e.target.value); }}
                  disabled={regeneratingElementKey !== null}
                  className="w-full text-sm rounded-lg border border-neutral-300 p-2 bg-white font-medium text-neutral-800 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="deepseek">DeepSeek（文本逻辑强）</option>
                  <option value="doubao">火山豆包（故事本地化佳）</option>
                </select>
              </div>
            </div>

            {/* Fixed Footer */}
            <div className="p-6 pt-4 border-t border-neutral-100 shrink-0">
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setRegenerateElementItem(null)}
                  disabled={regeneratingElementKey !== null}
                  className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    if (!regenerateElementItem) return;
                    setRegenerateElementError(null);
                    const key = `${regenerateElementItem.type}_${regenerateElementItem.index}`;
                    setRegenerateElementItem(null);
                    setRegeneratingElementKey(key);
                    handleRegenerateElementPrompt(
                      regenerateElementItem.type,
                      regenerateElementItem.index,
                      regenerateElementItem.name,
                      regenerateElementItem.description,
                      regenerateElementItem.prompt,
                      regenerateElementReq
                    ).catch(() => {}).finally(() => {
                      setRegeneratingElementKey(null);
                    });
                  }}
                  disabled={regeneratingElementKey !== null}
                  className="px-5 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {regeneratingElementKey !== null ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /><span>AI 生成中...</span></>
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  <span>{regeneratingElementKey !== null ? '' : 'AI 重新生成'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 删除分镜确认弹窗 */}
      {deletingShotIndex !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-neutral-900 mb-2 flex items-center space-x-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              <span>删除分镜确认</span>
            </h3>
            <p className="text-neutral-500 mb-6 text-sm leading-relaxed">
              您确定要删除该分镜（镜头 {deletingShotIndex + 1}）吗？此操作不可恢复，该分镜的视频、关键帧与提示词都会被移除。
            </p>
            <div className="flex space-x-3 justify-end">
              <button 
                onClick={() => setDeletingShotIndex(null)}
                className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button 
                onClick={() => handleDeleteShot(deletingShotIndex)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
              >
                确定删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增下一分镜（AI 续写）弹窗 */}
      {addShotAfterIndex !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-neutral-900 mb-3 flex items-center space-x-2">
              <Plus className="w-5 h-5 text-indigo-600" />
              <span>新增下一分镜（AI 续写）</span>
            </h3>
            <p className="text-sm text-neutral-500 mb-4">
              在第 <span className="font-semibold text-neutral-800">{(addShotAfterIndex !== null && script) ? script.shots[addShotAfterIndex].shotNumber : '?'}</span> 号分镜之后，由 AI 续写一个新分镜。输入你对该分镜的需求描述：
            </p>
            <div className="mb-4">
              <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1.5">AI 模型提供商</label>
              <select
                value={createEpProvider}
                onChange={(e) => { setCreateEpProvider(e.target.value as any); localStorage.setItem('create_provider', e.target.value); }}
                disabled={isAddingNextShot}
                className="w-full text-sm rounded-lg border border-neutral-300 p-2 bg-white font-medium text-neutral-800 shadow-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                <option value="deepseek">DeepSeek</option>
                <option value="doubao">火山豆包</option>
              </select>
            </div>
            <textarea
              value={addShotText}
              onChange={(e) => setAddShotText(e.target.value)}
              rows={6}
              placeholder="例如：特写 外卖员 上楼梯的脚步，然后全景跟随 外卖员 上楼至门口，大爷开门..."
              className="w-full text-sm bg-neutral-50 border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
              disabled={isAddingNextShot}
            />
            <div className="flex justify-end space-x-3 mt-4">
              <button
                onClick={() => { setAddShotAfterIndex(null); setAddShotText(''); }}
                disabled={isAddingNextShot}
                className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={handleAddNextShot}
                disabled={!addShotText.trim() || isAddingNextShot}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1.5"
              >
                {isAddingNextShot && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isAddingNextShot ? 'AI 生成中...' : 'AI 续写新分镜'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除集数确认弹窗 */}
      {deletingEpIndex !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-neutral-900 mb-2 flex items-center space-x-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              <span>删除集数确认</span>
            </h3>
            <p className="text-neutral-500 mb-6 text-sm leading-relaxed">
              您确定要删除第 <span className="font-semibold text-neutral-800">{deletingEpIndex + 1}</span> 集吗？此操作将同时删除该集下属的所有视频分镜头脚本，且无法恢复。
            </p>
            <div className="flex space-x-3 justify-end">
              <button 
                onClick={() => setDeletingEpIndex(null)}
                className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button 
                onClick={confirmDeleteEpisode}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-sm"
              >
                确定删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重新生成集数弹窗 */}
      {regenerateEpModalIndex !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 mb-4">
              <h3 className="text-lg font-bold text-neutral-900 flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <span>AI 重新生成第 {regenerateEpModalIndex + 1} 集</span>
              </h3>
              <button 
                onClick={() => !isRegeneratingEpisode && setRegenerateEpModalIndex(null)}
                className="text-neutral-400 hover:text-neutral-600 rounded-lg p-1 hover:bg-neutral-100 disabled:opacity-50"
                disabled={isRegeneratingEpisode}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="space-y-4 overflow-y-auto pr-1 flex-1">
              <p className="text-xs text-neutral-500 leading-relaxed bg-neutral-50 border border-neutral-100 p-3 rounded-lg">
                重新生成这一集时，AI 将根据该集之前的剧情，以及您在下方输入的新要求，重新撰写第 {regenerateEpModalIndex + 1} 集的故事大纲，并全自动为您更新/替换对应的视频分镜头脚本。
              </p>

              <div>
                <label className="block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider">
                  修改/生成要求 (选填)
                </label>
                <textarea
                  value={regenerateEpPrompt}
                  onChange={(e) => setRegenerateEpPrompt(e.target.value)}
                  rows={4}
                  placeholder="请输入您对这一集的修改要求（例如：让反派在这里露出马脚，或者增加剧情反转，或保持空白按原大纲主线重新生成...）"
                  className="w-full text-sm bg-neutral-50 border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                  disabled={isRegeneratingEpisode}
                />
              </div>

              {/* Model Provider Selection */}
              <div>
                <label className="block text-xs font-semibold text-neutral-500 mb-1.5 uppercase tracking-wider">
                  选择 AI 模型
                </label>
                <select
                  value={regenerateEpProvider}
                  onChange={(e) => {
                    setRegenerateEpProvider(e.target.value);
                    localStorage.setItem('create_provider', e.target.value);
                  }}
                  className="w-full text-sm bg-neutral-50 border border-neutral-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  disabled={isRegeneratingEpisode}
                >
                  <option value="deepseek">DeepSeek Chat (默认 - 深度思考 & 创意强)</option>
                  <option value="doubao">火山引擎 豆包 (高效稳定)</option>
                </select>
              </div>

              {regenerateEpError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-xl">
                  {regenerateEpError}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex space-x-3 justify-end mt-6 pt-4 border-t border-neutral-100">
              <button 
                onClick={() => setRegenerateEpModalIndex(null)}
                className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors disabled:opacity-50"
                disabled={isRegeneratingEpisode}
              >
                取消
              </button>
              <button 
                onClick={confirmRegenerateEpisode}
                disabled={isRegeneratingEpisode}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-sm disabled:opacity-50 flex items-center space-x-1.5"
              >
                {isRegeneratingEpisode ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>正在生成新脚本...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>确定重新生成</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除剧本双重确认弹窗 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center space-x-2 text-red-600 mb-4 pb-2 border-b border-neutral-100">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-lg font-bold text-neutral-900">删除剧本安全验证</h3>
            </div>
            
            <p className="text-sm text-neutral-500 mb-4 leading-relaxed">
              确定要删除整个剧本 <span className="font-semibold text-neutral-800">“{script?.title}”</span> 吗？
              此操作为<span className="text-red-600 font-semibold">物理删除</span>，将永久清除该剧本下的所有分集、分镜头脚本和关联视频，且<span className="text-red-600 font-semibold">无法撤销</span>。
            </p>
            
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-3 mb-4 leading-relaxed">
              为了防止误触和误删，请输入 <span className="font-bold text-sm text-red-600 select-all">删除</span> 两个字以确认该操作。
            </div>

            <div className="space-y-2 mb-6">
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder='请输入 "删除"'
                className="w-full text-sm bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 text-center font-semibold text-red-600 placeholder-neutral-400"
              />
            </div>

            <div className="flex space-x-3 justify-end pt-2 border-t border-neutral-100">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
              >
                取消
              </button>
              <button 
                onClick={confirmDelete}
                disabled={deleteConfirmText !== '删除'}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
              >
                确定物理删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyframe Prompt Modal */}
      {keyframeModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-neutral-200 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-neutral-100 bg-neutral-50/50 flex items-center justify-between">
              <div className="flex items-center space-x-2 text-indigo-600">
                <Sparkles className="w-5 h-5" />
                <h4 className="text-lg font-bold text-neutral-900">
                  镜头 {script.shots.findIndex((s: any, idx: number) => idx === keyframeModal.shotIndex) + 1 || keyframeModal.shotIndex + 1} - 关键帧 {keyframeModal.kfIdx + 1} ({keyframeModal.timeInfo})
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setKeyframeModal(null)}
                className="text-neutral-400 hover:text-neutral-600 p-1 rounded-full hover:bg-neutral-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-neutral-500 uppercase tracking-wider block">
                    生成提示词
                  </label>
                  
                  {/* Small, inconspicuous regenerate button on the far right of the prompt header */}
                  <button
                    type="button"
                    disabled={generatingKeyframes[`${keyframeModal.shotIndex}_${keyframeModal.kfIdx}`]}
                    onClick={async () => {
                      const originalIndex = keyframeModal.shotIndex;
                      const kfIdx = keyframeModal.kfIdx;
                      const timeInfo = keyframeModal.timeInfo;
                      await handleRegenerateKeyframePrompt(originalIndex, kfIdx, timeInfo);
                    }}
                    className="text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 border border-neutral-100/50 hover:border-neutral-200 transition-all flex items-center space-x-1 text-[10px] px-1.5 py-0.5 rounded disabled:opacity-50"
                  >
                    {generatingKeyframes[`${keyframeModal.shotIndex}_${keyframeModal.kfIdx}`] ? (
                      <>
                        <Loader2 className="w-2.5 h-2.5 animate-spin text-current" />
                        <span>重新生成中...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-2.5 h-2.5 text-current" />
                        <span>重新生成</span>
                      </>
                    )}
                  </button>
                </div>
                
                <textarea
                  value={keyframeModal.promptText}
                  onChange={(e) => setKeyframeModal({ ...keyframeModal, promptText: e.target.value })}
                  className="w-full text-sm font-mono text-neutral-800 p-3.5 border border-neutral-300 rounded-xl focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white"
                  rows={6}
                  placeholder="请输入关键帧图片的生成提示词..."
                />
              </div>

              {/* Special instruction notes */}
              <div className="text-[11px] text-neutral-400 bg-neutral-50 p-3 rounded-lg border border-neutral-200/50 leading-relaxed font-medium">
                提示：该提示词由大语言模型结合镜头描述、出场素材自动生成，可用于复制输入 Midjourney 或其他 AI 生图工具，用来生成第 {keyframeModal.kfIdx + 1} 帧在当前时间点 ({keyframeModal.timeInfo}) 的画面。
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-neutral-100 bg-neutral-50/30 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  copyToClipboard(keyframeModal.promptText, `关键帧 ${keyframeModal.kfIdx + 1} 提示词`);
                }}
                className="px-4 py-2 text-xs font-bold text-neutral-600 hover:text-neutral-900 bg-white border border-neutral-200 hover:border-neutral-300 rounded-lg transition-all cursor-pointer shadow-sm flex items-center space-x-1"
                title="复制该提示词"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>复制提示词</span>
              </button>

              <div className="flex items-center space-x-2.5">
                <button
                  type="button"
                  onClick={() => {
                    handleSaveKeyframePrompt(keyframeModal.shotIndex, keyframeModal.kfIdx, keyframeModal.promptText);
                    setKeyframeModal(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  保存并关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 导入素材/分镜 弹窗 */}
      {(isImportElementsOpen || isImportShotsOpen) && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-neutral-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 bg-neutral-50 border-b border-neutral-200">
              <h3 className="text-lg font-bold text-neutral-900 flex items-center space-x-2">
                {isImportElementsOpen ? (
                  <><Upload className="w-5 h-5 text-indigo-600" /><span>导入素材列表</span></>
                ) : (
                  <><Upload className="w-5 h-5 text-indigo-600" /><span>导入分镜列表</span></>
                )}
              </h3>
              <button
                type="button"
                onClick={() => { setIsImportElementsOpen(false); setIsImportShotsOpen(false); setImportText(''); setImportError(null); }}
                className="text-neutral-400 hover:text-neutral-600 p-1 rounded-full hover:bg-neutral-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  粘贴内容
                </label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={10}
                  placeholder={isImportElementsOpen
                    ? '格式：每行一个素材，例如：\nR1_李慧  :  全身像，角色三视图设定图，30多岁职场女性，干练短发...\nS1_餐厅  :  普通家庭餐厅场景，暖黄灯光...\nP1_手机  :  银色智能手机...'
                    : '格式：**镜N (start-end) 【标题】** 带切片的完整分镜格式'}
                  className="w-full text-sm bg-neutral-50 border border-neutral-200 rounded-xl p-3 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                />
              </div>
              {importError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg">
                  {importError}
                </div>
              )}
              <div className="flex space-x-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { setIsImportElementsOpen(false); setIsImportShotsOpen(false); setImportText(''); setImportError(null); }}
                  className="px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={isImportElementsOpen ? handleImportElements : handleImportShots}
                  disabled={!importText.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
                >
                  确认导入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 全屏视频/图片弹窗 */}
      {fullscreenVideo && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => { setFullscreenVideo(null); setFullscreenTime(0); }}>
          <div className="relative w-full max-w-5xl flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setFullscreenVideo(null)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white p-1 transition-colors z-10"
            >
              <X className="w-6 h-6" />
            </button>
            {fullscreenVideo.startsWith('data:video') || fullscreenVideo.startsWith('blob:') || fullscreenVideo.startsWith('/api/videos/') || fullscreenVideo.endsWith('.mp4') ? (
              <video key={fullscreenVideo} src={fullscreenVideo} controls autoPlay className="w-full max-h-[85vh] rounded-xl bg-black shadow-2xl" />
            ) : (
              <img src={fullscreenVideo} alt="预览" className="w-full max-h-[85vh] object-contain rounded-xl bg-black shadow-2xl" />
            )}
          </div>
        </div>
      )}

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[150] flex items-center space-x-2 bg-neutral-900 text-white px-5 py-3 rounded-full shadow-2xl border border-neutral-800 backdrop-blur-md"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" />
            <span className="text-xs font-semibold tracking-wide">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
