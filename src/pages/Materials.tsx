import { useState, useMemo, useRef } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { Library, Search, Copy, Trash2, Image as ImageIcon, Users, MapPin, Box, Filter, Plus, X, Upload } from 'lucide-react';
import { useMaterials } from '../hooks/useMaterials';
import { LibraryMaterial } from '../types';

const TYPE_META: Record<LibraryMaterial['type'], { label: string; badge: string; icon: any; ring: string }> = {
  characters: { label: '角色', badge: 'bg-indigo-100 text-indigo-700', icon: Users, ring: 'ring-indigo-200' },
  scenes: { label: '场景', badge: 'bg-emerald-100 text-emerald-700', icon: MapPin, ring: 'ring-emerald-200' },
  props: { label: '道具', badge: 'bg-amber-100 text-amber-700', icon: Box, ring: 'ring-amber-200' },
};

const TYPE_OPTIONS: { value: LibraryMaterial['type']; label: string }[] = [
  { value: 'characters', label: '角色' },
  { value: 'scenes', label: '场景' },
  { value: 'props', label: '道具' },
];

const copyToClipboard = (text: string, label: string = '提示词') => {
  navigator.clipboard?.writeText(text).then(
    () => showToast(`已复制${label}`),
    () => showToast('复制失败，请手动复制')
  );
};

let toastTimer: any = null;
function showToast(message: string) {
  const el = document.getElementById('materials-toast');
  if (el) {
    el.textContent = message;
    el.classList.remove('opacity-0');
    el.classList.add('opacity-100');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('opacity-100');
      el.classList.add('opacity-0');
    }, 2000);
  }
}

// 压缩图片 data URL：限制最长边为 maxSize px，保存到 localStorage 防超限
const compressDataUrl = (dataUrl: string, maxSize = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
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

export function Materials() {
  const { materials, addMaterial, removeMaterial, clearAll } = useMaterials();
  const [activeTab, setActiveTab] = useState<'all' | LibraryMaterial['type']>('all');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 新增素材弹框
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<{
    type: LibraryMaterial['type'];
    name: string;
    description: string;
    prompt: string;
    imageUrl?: string;
  }>({ type: 'characters', name: '', description: '', prompt: '', imageUrl: undefined });
  const [imgLoading, setImgLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 删除二次确认
  const [pendingDelete, setPendingDelete] = useState<LibraryMaterial | null>(null);
  useBodyScrollLock(showAdd || pendingDelete !== null);

  const filtered = useMemo(() => {
    let list = materials;
    if (activeTab !== 'all') list = list.filter(m => m.type === activeTab);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(m =>
        m.name.toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q) ||
        (m.prompt || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [materials, activeTab, query]);

  const counts = {
    all: materials.length,
    characters: materials.filter(m => m.type === 'characters').length,
    scenes: materials.filter(m => m.type === 'scenes').length,
    props: materials.filter(m => m.type === 'props').length,
  };

  const TABS: { key: 'all' | LibraryMaterial['type']; label: string }[] = [
    { key: 'all', label: `全部 ${counts.all}` },
    { key: 'characters', label: `角色 ${counts.characters}` },
    { key: 'scenes', label: `场景 ${counts.scenes}` },
    { key: 'props', label: `道具 ${counts.props}` },
  ];

  const resetForm = () => {
    setForm({ type: 'characters', name: '', description: '', prompt: '', imageUrl: undefined });
    setImgLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const closeAdd = () => {
    setShowAdd(false);
    resetForm();
  };

  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgLoading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const compressed = await compressDataUrl(dataUrl);
      setForm(f => ({ ...f, imageUrl: compressed }));
      setImgLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const submitAdd = () => {
    const name = form.name.trim();
    if (!name) {
      showToast('请填写素材名称');
      return;
    }
    const res = addMaterial({
      type: form.type,
      name,
      description: form.description.trim(),
      prompt: form.prompt.trim(),
      imageUrl: form.imageUrl,
    });
    showToast(res.added ? '素材已添加' : '同名素材已更新');
    closeAdd();
  };

  const confirmDelete = () => {
    if (pendingDelete) removeMaterial(pendingDelete.id);
    setPendingDelete(null);
    showToast('已删除');
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-indigo-50 rounded-xl">
            <Library className="w-7 h-7 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">素材库</h1>
            <p className="text-neutral-500 mt-1 text-sm">跨剧本保存的素材参考图与提示词，可随时复制复用。</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>新增素材</span>
        </button>
      </div>

      {/* 搜索 + 筛选 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索素材名称、描述或提示词..."
            className="w-full text-sm bg-white border border-neutral-200 rounded-xl pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
          />
        </div>
        <div className="flex items-center space-x-1 bg-white border border-neutral-200 rounded-xl p-1">
          <Filter className="w-4 h-4 text-neutral-400 ml-1.5" />
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={
                'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ' +
                (activeTab === t.key
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-500 hover:bg-neutral-100')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {materials.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[55vh] text-center space-y-6 border-2 border-dashed border-neutral-200 rounded-2xl">
          <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center border border-neutral-200 shadow-sm">
            <ImageIcon className="w-10 h-10 text-neutral-400" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight">素材库还是空的</h2>
            <p className="text-neutral-500 max-w-sm mx-auto text-sm">
              点右上角「新增素材」手动添加，或在剧本详情页把做好的素材点「保存到素材库」收藏进来。
            </p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-neutral-400 py-20 text-sm">没有匹配「{query}」的素材</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {filtered.map(m => {
            const meta = TYPE_META[m.type];
            const Icon = meta.icon;
            const expanded = expandedId === m.id;
            return (
              <div
                key={m.id}
                className={`bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col ring-1 ${meta.ring}`}
              >
                <div className="relative w-full aspect-[4/3] bg-neutral-100 flex items-center justify-center">
                  {m.imageUrl ? (
                    <img src={m.imageUrl} alt={m.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex flex-col items-center text-neutral-300">
                      <ImageIcon className="w-10 h-10" />
                      <span className="text-xs mt-1">暂无参考图</span>
                    </div>
                  )}
                  <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-bold ${meta.badge} flex items-center space-x-1`}>
                    <Icon className="w-3 h-3" />
                    <span>{meta.label}</span>
                  </span>
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="text-sm font-bold text-neutral-900 line-clamp-1 mb-1" title={m.name}>{m.name}</h3>
                  {m.description ? (
                    <p className="text-xs text-neutral-500 line-clamp-2 mb-2 flex-1">{m.description}</p>
                  ) : (
                    <div className="flex-1" />
                  )}

                  <button
                    onClick={() => setExpandedId(expanded ? null : m.id)}
                    className="text-[11px] font-semibold text-neutral-500 hover:text-indigo-600 transition-colors mb-2 self-start"
                  >
                    {expanded ? '收起提示词 ▲' : '查看提示词 ▼'}
                  </button>

                  {expanded && (
                    <pre className="text-[11px] leading-relaxed text-neutral-700 bg-neutral-50 border border-neutral-100 rounded-lg p-2.5 mb-2 whitespace-pre-wrap break-words max-h-48 overflow-auto">
{m.prompt}
                    </pre>
                  )}

                  <div className="flex items-center space-x-2 mt-auto pt-1">
                    <button
                      onClick={() => m.prompt && copyToClipboard(m.prompt, `${meta.label}提示词`)}
                      disabled={!m.prompt}
                      className="flex-1 flex items-center justify-center space-x-1 text-xs font-medium bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制</span>
                    </button>
                    <button
                      onClick={() => setPendingDelete(m)}
                      className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="从素材库删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {m.sourceScriptTitle && (
                    <p className="text-[10px] text-neutral-400 mt-2 truncate">来源：{m.sourceScriptTitle}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {materials.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => {
              if (confirm('确定清空整个素材库吗？此操作不可撤销。')) clearAll();
            }}
            className="text-xs text-neutral-400 hover:text-red-600 transition-colors"
          >
            清空素材库
          </button>
        </div>
      )}

      {/* 新增素材弹框 */}
      {showAdd && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeAdd}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
              <h2 className="text-lg font-bold tracking-tight">新增素材</h2>
              <button
                onClick={closeAdd}
                className="p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1.5">素材类型</label>
                <div className="flex items-center space-x-2">
                  {TYPE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setForm(f => ({ ...f, type: opt.value }))}
                      className={
                        'px-4 py-2 rounded-lg text-sm font-medium border transition-colors ' +
                        (form.type === opt.value
                          ? 'bg-neutral-900 text-white border-neutral-900'
                          : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50')
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1.5">素材名称 <span className="text-red-500">*</span></label>
                <input
                  value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="例如：林晚 / 古风街道 / 神秘钥匙"
                  className="w-full text-sm bg-white border border-neutral-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1.5">描述</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="可选，简单描述素材特征"
                  rows={2}
                  className="w-full text-sm bg-white border border-neutral-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1.5">参考图</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePickImage}
                  className="hidden"
                />
                {form.imageUrl ? (
                  <div className="relative w-full aspect-[4/3] bg-neutral-100 rounded-xl overflow-hidden flex items-center justify-center">
                    <img src={form.imageUrl} alt="预览" className="w-full h-full object-contain" />
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, imageUrl: undefined }))}
                      className="absolute top-2 right-2 p-1.5 bg-white/90 hover:bg-white text-neutral-600 rounded-lg shadow-sm transition-colors"
                      title="移除图片"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={imgLoading}
                    className="w-full aspect-[4/3] bg-neutral-50 border-2 border-dashed border-neutral-200 rounded-xl flex flex-col items-center justify-center text-neutral-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors disabled:opacity-60"
                  >
                    {imgLoading ? (
                      <span className="text-sm">图片处理中…</span>
                    ) : (
                      <>
                        <Upload className="w-7 h-7 mb-1" />
                        <span className="text-xs">点击上传图片</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-600 mb-1.5">提示词</label>
                <textarea
                  value={form.prompt}
                  onChange={(e) => setForm(f => ({ ...f, prompt: e.target.value }))}
                  placeholder="可选，填写该素材的生成提示词"
                  rows={4}
                  className="w-full text-sm bg-white border border-neutral-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 px-6 py-4 border-t border-neutral-200">
              <button
                onClick={closeAdd}
                className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitAdd}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-sm"
              >
                保存素材
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除二次确认弹框 */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5">
              <h2 className="text-base font-bold tracking-tight text-neutral-900">确认删除</h2>
              <p className="text-sm text-neutral-500 mt-2">
                确定要从素材库删除「<span className="font-semibold text-neutral-800">{pendingDelete.name}</span>」吗？此操作不可撤销。
              </p>
            </div>
            <div className="flex items-center justify-end space-x-2 px-6 py-4 border-t border-neutral-200">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-neutral-600 hover:bg-neutral-100 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-700 text-white transition-colors shadow-sm"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div
        id="materials-toast"
        className="fixed bottom-5 right-5 z-[120] bg-neutral-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-neutral-800 flex items-center space-x-2 opacity-0 transition-opacity duration-300 pointer-events-none"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-xs font-semibold tracking-wide"></span>
      </div>
    </div>
  );
}
