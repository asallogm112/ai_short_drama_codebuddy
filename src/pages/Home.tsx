import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useScripts } from '../hooks/useScripts';
import { FileVideo, Calendar, ArrowRight, PlusCircle, Trash2 } from 'lucide-react';

export function Home() {
  const { scripts, deleteScript, loaded } = useScripts();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [scriptToDelete, setScriptToDelete] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastTimeoutId, setToastTimeoutId] = useState<any>(null);

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

  const handleDeleteClick = (script: any) => {
    setScriptToDelete(script);
    setDeleteConfirmText('');
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    if (deleteConfirmText !== '删除' || !scriptToDelete) return;
    deleteScript(scriptToDelete.id);
    setShowDeleteConfirm(false);
    setScriptToDelete(null);
    showToast('剧本已成功删除！');
  };

  if (!loaded) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-4">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-neutral-500 text-sm">加载中...</p>
      </div>
    );
  }
  if (scripts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-6">
        <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center border border-neutral-200 shadow-xl">
          <FileVideo className="w-10 h-10 text-neutral-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">暂无剧本</h2>
          <p className="text-neutral-500 max-w-sm mx-auto">
            开始创建您的第一个人工智能生成的短剧剧本，包含完整的角色、场景和分镜头列表。
          </p>
        </div>
        <Link 
          to="/create" 
          className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-lg font-medium transition-colors shadow-sm"
        >
          <span>创建您的第一个剧本</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">我的剧本</h1>
          <p className="text-neutral-500 mt-2">管理和查看您生成的短剧剧本。</p>
        </div>
        <Link 
          to="/create" 
          className="inline-flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg font-medium transition-colors shadow-sm text-sm"
        >
          <PlusCircle className="w-4 h-4" />
          <span>创建新剧本</span>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {scripts.map((script) => (
          <div 
            key={script.id} 
            className="group relative bg-white border border-neutral-200 rounded-xl overflow-hidden hover:border-neutral-300 transition-all flex flex-col h-full shadow-sm hover:shadow-md"
          >
            <div className="p-6 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-4">
                <div className="p-2 bg-indigo-50 rounded-lg">
                  <FileVideo className="w-6 h-6 text-indigo-600" />
                </div>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDeleteClick(script);
                  }}
                  className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors relative z-20"
                  title="删除剧本"
                >
                  <Trash2 className="w-4.5 h-4.5" />
                </button>
              </div>
              
              <h3 className="text-lg font-bold mb-2 line-clamp-1 group-hover:text-indigo-600 transition-colors">
                {script.title || '未命名剧本'}
              </h3>
              
              <p className="text-sm text-neutral-500 line-clamp-3 mb-6 flex-1">
                {script.logline || script.story}
              </p>
              
              <div className="flex items-center text-xs text-neutral-400 space-x-4 mt-auto">
                <div className="flex items-center space-x-1">
                  <Calendar className="w-3 h-3" />
                  <span>{new Date(script.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <span>{script.shots?.length || 0} 个镜头</span>
                </div>
              </div>
            </div>
            
            <Link 
              to={`/script/${script.id}`}
              className="absolute inset-0 z-10"
              aria-label={`查看剧本 ${script.title}`}
            />
          </div>
        ))}
      </div>

      {/* 删除剧本双重确认弹窗 */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-neutral-200 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center space-x-2 text-red-600 mb-4 pb-2 border-b border-neutral-100">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-lg font-bold text-neutral-900">删除剧本安全验证</h3>
            </div>
            
            <p className="text-sm text-neutral-500 mb-4 leading-relaxed">
              确定要删除整个剧本 <span className="font-semibold text-neutral-800">“{scriptToDelete?.title}”</span> 吗？
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

      {/* Toast 提示 */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-[120] bg-neutral-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-neutral-800 flex items-center space-x-2 animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold tracking-wide">{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
