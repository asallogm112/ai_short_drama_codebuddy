import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { useScripts } from '../hooks/useScripts';
import { Wand2, Loader2, Cpu, FileText } from 'lucide-react';
import { ScriptData, Shot } from '../types';

// 本地解析 **镜N (start-end) 【title】** 格式的分镜列表
const parseShotsFromScript = (text: string): Shot[] => {
  // 匹配 **镜 N (start-end) 【title】** 标题行
  const headerRegex = /\*\*镜\s*(\d+)\s*\((\d+)-(\d+)s?\)\s*【(.+?)】\s*\*\*/g;
  const shots: Shot[] = [];
  let lastIndex = 0;
  let match;

  // 按标题行分割文本
  const blocks: { start: number; end: number }[] = [];
  while ((match = headerRegex.exec(text)) !== null) {
    blocks.push({ start: match.index, end: headerRegex.lastIndex });
  }

  if (blocks.length === 0) return [];

  const shotLines = text.split('\n');
  
  // 找每个标题行的行号
  const headerLines: number[] = [];
  for (let i = 0; i < shotLines.length; i++) {
    if (/^\*\*镜\s*\d+\s*\(/.test(shotLines[i])) {
      headerLines.push(i);
    }
  }

  for (let h = 0; h < headerLines.length; h++) {
    const headerLineIndex = headerLines[h];
    const nextHeaderIndex = h + 1 < headerLines.length ? headerLines[h + 1] : shotLines.length;
    const headerText = shotLines[headerLineIndex];

    // 解析标题
    const headerMatch = headerText.match(/\*\*镜\s*(\d+)\s*\((\d+)-(\d+)s?\)\s*【(.+?)】\s*\*\*/);
    if (!headerMatch) continue;

    const shotNumber = parseInt(headerMatch[1], 10);
    const startSecond = parseInt(headerMatch[2], 10);
    const endSecond = parseInt(headerMatch[3], 10);
    const title = headerMatch[4].trim();

    // 收集该分镜的完整文本（标题 + 所有切片行），原样保留
    const blockLines = shotLines.slice(headerLineIndex, nextHeaderIndex);
    const fullText = blockLines.join('\n').trim();

    const pad = (n: number) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

    shots.push({
      shotNumber,
      duration: `${pad(startSecond)} - ${pad(endSecond)}`,
      camera: '',
      action: title,
      dialogue: '',
      sfx: '',
      materials: '',
      prompt: fullText,
      episodeIndex: 0,
    });
  }

  return shots;
};

export function Create() {
  const navigate = useNavigate();
  const { saveScript } = useScripts();
  
  const [theme, setTheme] = useState('');
  const [idea, setIdea] = useState('');
  const [existingScript, setExistingScript] = useState('');
  const [videoIdea, setVideoIdea] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<'scratch' | 'existing' | 'video'>(() => {
    const saved = localStorage.getItem('create_active_tab');
    if (saved === 'scratch' || saved === 'existing' || saved === 'video') {
      return saved;
    }
    return 'scratch';
  });
  const [provider, setProvider] = useState(() => {
    return localStorage.getItem('create_provider') || 'deepseek';
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providersConfig, setProvidersConfig] = useState<{
    deepseek: boolean;
    doubao: boolean;
  }>({
    deepseek: false,
    doubao: false
  });

  useEffect(() => {
    localStorage.setItem('create_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('create_provider', provider);
  }, [provider]);

  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.json())
      .then(data => {
        if (data) {
          setProvidersConfig({
            deepseek: !!data.deepseek,
            doubao: !!data.doubao
          });
        }
      })
      .catch(err => console.error('Failed to fetch providers config:', err));
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setExistingScript(content);
    };
    reader.readAsText(file);
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
  };

  const handleLocalParse = () => {
    const text = existingScript.trim();
    if (!text) {
      setError('请先粘贴脚本内容。');
      return;
    }

    if (!/^\*\*镜\s*\d+\s*\(/.test(text)) {
      setError('未找到 **镜N (start-end) 【标题】** 格式的分镜标记。');
      return;
    }

    const shots = parseShotsFromScript(text);
    if (shots.length === 0) {
      setError('未能解析出分镜，请检查格式。');
      return;
    }

    const newScript = {
      id: uuidv4(),
      title: '已有分镜脚本',
      logline: '',
      story: text,
      elements: { characters: [], scenes: [], props: [] },
      shots,
      createdAt: Date.now(),
      originalPrompt: `现有分镜脚本\n${text}`,
    };

    saveScript(newScript);
    navigate(`/script/${newScript.id}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const isScratch = activeTab === 'scratch';
    const isVideo = activeTab === 'video';
    const isExisting = activeTab === 'existing';

    // 现有脚本且包含 **镜 标记 → 直接本地解析，不走 API
    if (isExisting && /^\*\*镜\s*\d+\s*\(/.test(existingScript.trim())) {
      handleLocalParse();
      return;
    }

    const payloadTheme = isScratch ? theme : '';
    const payloadIdea = isScratch ? idea : '';
    const payloadScript = isExisting ? existingScript : '';
    const payloadVideoIdea = isVideo ? videoIdea : '';

    if (!payloadTheme.trim() && !payloadIdea.trim() && !payloadScript.trim() && !videoFile) {
      setError('请提供所需的信息或上传视频。');
      return;
    }

    if (isVideo && !videoFile) {
      setError('请上传参考视频。');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let response;
      
      if (isVideo && videoFile) {
        const formData = new FormData();
        formData.append('theme', payloadTheme);
        formData.append('idea', payloadIdea);
        formData.append('existingScript', payloadScript);
        formData.append('videoIdea', payloadVideoIdea);
        formData.append('provider', provider);
        formData.append('video', videoFile);
        
        response = await fetch('/api/generate', {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            theme: payloadTheme,
            idea: payloadIdea,
            existingScript: payloadScript,
            videoIdea: payloadVideoIdea,
            provider,
          }),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '生成剧本失败');
      }

      const raw = data as ScriptData;
      
      // 确保所有字段有默认值，防止 Detail 页崩溃
      const safeData = {
        title: raw.title || '未命名短剧',
        logline: raw.logline || '',
        story: raw.story || '',
        elements: {
          characters: raw.elements?.characters || [],
          scenes: raw.elements?.scenes || [],
          props: raw.elements?.props || [],
        },
        shots: raw.shots || [],
      };

      const combinedPrompt = [
        payloadTheme.trim() ? `题材/类型: ${payloadTheme.trim()}` : '',
        payloadIdea.trim() ? `创意描述: ${payloadIdea.trim()}` : '',
        payloadScript.trim() ? `现有脚本: \n${payloadScript.trim()}` : '',
        isVideo ? `参考视频: ${videoFile?.name || '已上传视频'}` : '',
        payloadVideoIdea.trim() ? `参考视频二创要求: \n${payloadVideoIdea.trim()}` : ''
      ].filter(Boolean).join('\n\n');

      const newScript = {
        ...safeData,
        id: uuidv4(),
        createdAt: Date.now(),
        originalPrompt: combinedPrompt,
      };

      saveScript(newScript);
      navigate(`/script/${newScript.id}`);
      
    } catch (err: any) {
      console.error(err);
      let errorMessage = err.message || '发生意外错误。';
      if (errorMessage.includes('503') || errorMessage.includes('high demand') || errorMessage.includes('UNAVAILABLE')) {
        errorMessage = '当前AI模型请求量过大，导致服务暂时不可用（503）。请稍后重试。';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight flex items-center space-x-3">
          <Wand2 className="w-8 h-8 text-indigo-600" />
          <span>生成剧本</span>
        </h1>
        <p className="text-neutral-500 mt-2">
          输入您的创意，让人工智能为您制作一部完整的电影级短剧。
        </p>
      </div>

      <div className="bg-white border border-neutral-200 rounded-2xl p-6 sm:p-8 shadow-xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          
          <div className="flex space-x-1 bg-neutral-100 p-1 rounded-lg mb-6">
            <button
              type="button"
              onClick={() => setActiveTab('scratch')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'scratch'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50'
              }`}
            >
              从头生成
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('existing')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'existing'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50'
              }`}
            >
              现有脚本
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('video')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === 'video'
                  ? 'bg-white text-indigo-600 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50'
              }`}
            >
              参考视频二创
            </button>
          </div>

          {activeTab === 'scratch' && (
            <>
              <div className="space-y-2">
                <label htmlFor="theme" className="block text-sm font-medium text-neutral-700">
                  剧本题材 / 类型
                </label>
                <input
                  id="theme"
                  type="text"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="例如：赛博朋克爱情、历史悬疑、喜剧"
                  className="w-full bg-white border border-neutral-200 rounded-lg px-4 py-3 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="idea" className="block text-sm font-medium text-neutral-700">
                  核心创意
                </label>
                <textarea
                  id="idea"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="描述主要情节、特定角色或转折..."
                  rows={4}
                  className="w-full bg-white border border-neutral-200 rounded-lg px-4 py-3 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                />
              </div>
            </>
          )}

          {activeTab === 'existing' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="existingScript" className="block text-sm font-medium text-neutral-700">
                  粘贴现有脚本 / 上传文件
                </label>
                <label className="text-xs text-indigo-600 cursor-pointer hover:text-indigo-700 font-medium">
                  上传 .txt 脚本
                  <input
                    type="file"
                    accept=".txt,.md"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>
              <textarea
                id="existingScript"
                value={existingScript}
                onChange={(e) => setExistingScript(e.target.value)}
                placeholder="您可以直接粘贴现有的剧本草稿，或者通过右上角上传文本文件..."
                rows={6}
                className="w-full bg-white border border-neutral-200 rounded-lg px-4 py-3 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
              />
            </div>
          )}

          {activeTab === 'video' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-neutral-700">
                  上传参考视频
                </label>
                <div className="flex items-center space-x-4">
                  <label className="cursor-pointer inline-flex items-center justify-center px-4 py-2 border border-neutral-300 shadow-sm text-sm font-medium rounded-md text-neutral-700 bg-white hover:bg-neutral-50 transition-colors">
                    选择视频文件
                    <input
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={handleVideoUpload}
                    />
                  </label>
                  {videoFile && (
                    <span className="text-sm text-neutral-600 truncate max-w-[200px] sm:max-w-xs">
                      {videoFile.name}
                    </span>
                  )}
                </div>
                <p className="text-xs text-neutral-500 mt-1">
                  上传视频后，AI 将分析其画面和情节作为灵感来源。
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="videoIdea" className="block text-sm font-medium text-neutral-700">
                  二创要求 (可选)
                </label>
                <textarea
                  id="videoIdea"
                  value={videoIdea}
                  onChange={(e) => setVideoIdea(e.target.value)}
                  placeholder="描述您希望如何改编这个视频，例如：保留叙事结构，但将背景改到赛博朋克世界；或者提取视频中的主要矛盾，加入喜剧元素..."
                  rows={4}
                  className="w-full bg-white border border-neutral-200 rounded-lg px-4 py-3 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="provider" className="block text-sm font-medium text-neutral-700 flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-neutral-400" />
              <span>AI 模型提供商</span>
            </label>
            <select
              id="provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              disabled={activeTab === 'video'}
              className="w-full bg-white border border-neutral-200 rounded-lg px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all appearance-none cursor-pointer disabled:bg-neutral-100 disabled:text-neutral-500"
            >
              <option value="deepseek">DeepSeek (默认)</option>
              <option value="doubao">
                豆包 / 火山引擎 {providersConfig.doubao ? '' : '(需要配置 API Key)'}
              </option>
            </select>
            <p className="text-xs text-neutral-500 mt-1">
              {providersConfig.deepseek
                ? 'DeepSeek API Key 已配置，可直接使用。'
                : 'DeepSeek 未配置 API Key，请在 .env 中设置 DEEPSEEK_API_KEY。'}
              {providersConfig.doubao && ' 豆包/火山引擎 API Key 也已配置。'}
            </p>
          </div>

          {error && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm">
              {error}
            </div>
          )}

          <div className="pt-4 border-t border-neutral-200">
            <button
              type="submit"
              disabled={
                loading || 
                (activeTab === 'scratch' ? (!theme.trim() && !idea.trim()) : (activeTab === 'existing' ? !existingScript.trim() : !videoFile))
              }
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-100 disabled:text-neutral-400 text-white font-medium py-4 rounded-xl flex items-center justify-center space-x-2 transition-colors shadow-sm"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>正在生成剧本（这可能需要一分钟）...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5" />
                  <span>一键生成完整剧本</span>
                </>
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
