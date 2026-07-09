import { Outlet, Link, useLocation } from 'react-router-dom';
import { Clapperboard, PlusCircle, LayoutGrid, Library } from 'lucide-react';
import { cn } from '../lib/utils';

export function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans selection:bg-indigo-500/30">
      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2 text-indigo-600 hover:text-indigo-500 transition-colors">
            <Clapperboard className="w-6 h-6" />
            <span className="font-bold text-lg tracking-tight text-neutral-900">AI 短剧工作室</span>
          </Link>
          
          <nav className="flex space-x-1">
            <Link 
              to="/materials" 
              className={cn(
                "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2",
                location.pathname === '/materials' 
                  ? "bg-neutral-100 text-neutral-900" 
                  : "text-neutral-500 hover:bg-neutral-100/50 hover:text-neutral-900"
              )}
            >
              <Library className="w-4 h-4" />
              <span className="hidden sm:inline">素材库</span>
            </Link>
            <Link 
              to="/" 
              className={cn(
                "px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center space-x-2",
                location.pathname === '/' 
                  ? "bg-neutral-100 text-neutral-900" 
                  : "text-neutral-500 hover:bg-neutral-100/50 hover:text-neutral-900"
              )}
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
    </div>
  );
}
