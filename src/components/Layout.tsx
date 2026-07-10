import { useState, useEffect } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { Outlet, Link } from 'react-router-dom';
import { Clapperboard, LayoutGrid, Archive, FileText, Copy, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { createPortal } from 'react-dom';

export function Layout() {
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptTab, setPromptTab] = useState<'simple' | 'real'>('simple');
  const [toast, setToast] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [promptData, setPromptData] = useState<Record<string, string> | null>(null);

  // 弹框打开时从服务器加载提示词
  useEffect(() => {
    if (showPrompts) {
      fetch('/api/system-prompts').then(r => r.json()).then(setPromptData).catch(() => {});
    }
  }, [showPrompts]);

  const getContent = (key: string, fallback: string) => promptData?.[key] ?? fallback;

  const startEdit = (key: string, content: string) => {
    setEditingKey(key);
    setEditText(content);
  };

  const saveEdit = () => {
    if (editingKey && promptData) {
      const next = { ...promptData, [editingKey]: editText };
      setPromptData(next);
      setEditingKey(null);
      fetch('/api/system-prompts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      setToast('已保存（下次调用 DeepSeek 将使用新提示词）');
    }
  };

  useBodyScrollLock(showPrompts);

  const copyPrompt = (text: string, label: string) => {
    try { navigator.clipboard.writeText(text); setToast(label + ' 已复制'); setTimeout(() => setToast(null), 2000); } catch {}
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans selection:bg-indigo-500/30">
      {showPrompts && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40" onClick={() => setShowPrompts(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-amber-500" />
                <span className="font-bold text-lg text-neutral-900">系统提示词</span>
                <span className="text-xs text-neutral-400">（可复制给豆包使用）</span>
              </div>
              <button type="button" onClick={() => setShowPrompts(false)} className="p-1.5 hover:bg-neutral-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-neutral-500" />
              </button>
            </div>
            {/* Tab 切换 */}
            <div className="flex border-b border-neutral-200 shrink-0">
              <button type="button" onClick={() => setPromptTab('simple')} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${promptTab === 'simple' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-neutral-500 hover:text-neutral-700'}`}>简化版</button>
              <button type="button" onClick={() => setPromptTab('real')} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${promptTab === 'real' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-neutral-500 hover:text-neutral-700'}`}>真实版（实际发送 DeepSeek）</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {[
                // 简化版 3 个
                { key: 'elementPrompt', title: '素材生成提示词', tab: 'simple' as const },
                { key: 'shotPrompt', title: '分镜生成提示词', tab: 'simple' as const },
                { key: 'fullMainPrompt', title: '完整主流程提示词（素材 + 分镜）', tab: 'simple' as const },
                // 真实版 5 个
                { key: 'realElementSys', title: '素材重生成 system message', tab: 'real' as const },
                { key: 'realElementPrompt', title: '素材重生成 user prompt', tab: 'real' as const },
                { key: 'realShotSys', title: '分镜重生成 system message', tab: 'real' as const },
                { key: 'realShotPrompt', title: '分镜重生成 user prompt', tab: 'real' as const },
                { key: 'realMainPrompt', title: '完整主流程生成完整 prompt', tab: 'real' as const },
              ].filter(s => s.tab === promptTab).map(section => {
                const content = getContent(section.key, '');
                const isEditing = editingKey === section.key;
                const isReal = section.tab === 'real';
                return (
                  <div key={section.key} className={`border rounded-xl overflow-hidden ${isReal ? 'border-amber-200' : 'border-neutral-200'}`}>
                    <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isReal ? 'bg-amber-50 border-amber-200' : 'bg-neutral-50 border-neutral-200'}`}>
                      <span className="text-sm font-bold text-neutral-700">{section.title}</span>
                      <div className="flex items-center space-x-2">
                        {isEditing ? (
                          <>
                            <button type="button" onClick={saveEdit} className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold">保存</button>
                            <button type="button" onClick={() => setEditingKey(null)} className="text-xs text-neutral-400 hover:text-neutral-600">取消</button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => startEdit(section.key, content)} className="flex items-center space-x-1 text-xs text-neutral-400 hover:text-neutral-700 font-medium"><span>编辑</span></button>
                            <button type="button" onClick={() => copyPrompt(content, section.title)} className="flex items-center space-x-1 text-xs text-indigo-500 hover:text-indigo-700 font-medium"><Copy className="w-3.5 h-3.5" /><span>复制</span></button>
                          </>
                        )}
                      </div>
                    </div>
                    {isEditing ? (
                      <textarea value={editText} onChange={e => setEditText(e.target.value)} className="w-full text-[12px] leading-relaxed font-mono p-4 max-h-64 resize-y border-0 focus:ring-0 outline-none" rows={12} />
                    ) : (
                      <pre className="text-[12px] leading-relaxed text-neutral-600 p-4 max-h-64 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all font-mono">{content || '（空，点击编辑填入内容）'}</pre>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2 text-indigo-600 hover:text-indigo-500 transition-colors">
            <Clapperboard className="w-6 h-6" />
            <span className="font-bold text-lg tracking-tight text-neutral-900">AI 短剧工作室</span>
          </Link>
          
          <nav className="flex space-x-1">
            <button
              type="button"
              onClick={() => setShowPrompts(true)}
              className={cn(
                "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2",
                "text-neutral-500 hover:bg-neutral-100/50 hover:text-neutral-900"
              )}
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">系统提示词</span>
            </button>
            <Link
              to="/materials"
              className="px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2 text-neutral-500 hover:bg-neutral-100/50 hover:text-neutral-900"
            >
              <Archive className="w-4 h-4" />
              <span className="hidden sm:inline">素材库</span>
            </Link>
            <Link
              to="/"
              className="px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2 text-neutral-500 hover:bg-neutral-100/50 hover:text-neutral-900"
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden sm:inline">我的剧本</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {toast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[999] px-4 py-2.5 bg-neutral-900 text-white text-sm font-medium rounded-xl shadow-2xl animate-in fade-in duration-200">
          {toast}
        </div>
      )}
    </div>
  );
}
