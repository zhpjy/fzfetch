import React, { useCallback, useRef } from 'react';
import { Search, Terminal, Download, FileText, AlertCircle, CheckCircle2, X, Loader2 } from 'lucide-react';
import { useSearchSocket } from './hooks/useSearchSocket';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useDownload } from './hooks/useDownload';
import { StatusIndicator } from './components/StatusIndicator';
import { FuzzyHighlight } from './components/FuzzyHighlight';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const {
    query,
    setQuery,
    results,
    setResults,
    status,
    isSearching,
    triggerForceRefresh
  } = useSearchSocket();

  const onGhostFound = useCallback((path: string) => {
    setResults(prev => prev.filter(item => item.path !== path));
  }, [setResults]);

  const { handleDownload, downloadingPath, toast, setToast } = useDownload(onGhostFound);

  const { selectedIndex } = useKeyboardNavigation(results, handleDownload);

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono flex flex-col items-center select-none overflow-hidden">
      
      {/* Header / Status Bar */}
      <div className="w-full max-w-5xl px-8 pt-10 flex justify-between items-end mb-6">
        <div className="flex items-center gap-4">
          <Terminal className="text-emerald-500" size={28} />
          <h1 className="text-2xl font-bold tracking-tighter text-zinc-100">FZFETCH</h1>
        </div>
        
        <StatusIndicator 
          status={status} 
          isSearching={isSearching} 
          onRefresh={triggerForceRefresh} 
        />
      </div>

      {/* Main Search Area */}
      <div className="w-full max-w-5xl px-8 relative group mb-2">
        <div className="absolute left-14 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition-colors pointer-events-none">
          <Search size={22} />
        </div>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          placeholder="输入关键词进行实时模糊搜索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 outline-none rounded-xl py-5 pl-16 pr-8 text-xl shadow-2xl focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 text-zinc-100 transition-all placeholder:text-zinc-700"
        />
      </div>

      {/* Results Section */}
      <div className="w-full max-w-5xl flex-1 px-8 pb-6 overflow-hidden flex flex-col">
        <div className="border border-zinc-800 rounded-xl flex-1 overflow-hidden flex flex-col bg-zinc-900/50 shadow-inner relative mt-4">
          
          {/* Progress bar for index refresh */}
          {status === 'refreshing' && (
            <div className="h-0.5 w-full bg-zinc-800 overflow-hidden absolute top-0">
               <div className="h-full bg-emerald-500 w-1/3 animate-shimmer" />
            </div>
          )}
          
          <div className="overflow-y-auto custom-scrollbar flex-1">
            {results.length > 0 ? (
              <div className="divide-y divide-zinc-800/50">
                {results.map((item, index) => (
                  <div
                    key={item.path}
                    id={`item-${index}`}
                    onClick={() => handleDownload(item)}
                    className={cn(
                      "px-8 py-4 cursor-pointer flex items-center justify-between group transition-all border-l-4",
                      selectedIndex === index 
                        ? 'border-l-emerald-500 bg-emerald-500/5'
                        : 'border-l-transparent hover:bg-zinc-800/30'
                    )}
                  >
                    <div className="flex items-center gap-5 min-w-0">
                      <div className="flex-shrink-0">
                        {selectedIndex === index ? (
                           <span className="text-emerald-500 font-bold tracking-widest text-sm">&gt;</span>
                        ) : (
                          <FileText size={18} className="text-zinc-700 group-hover:text-zinc-500 transition-colors" />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className={cn(
                          "truncate text-base",
                          selectedIndex === index ? 'text-zinc-50 font-bold' : 'text-zinc-300'
                        )}>
                          <FuzzyHighlight text={item.path.split('/').pop() || ''} query={query} />
                        </div>
                        <div className="truncate text-xs text-zinc-500 italic mt-0.5 font-sans opacity-60">
                          <FuzzyHighlight text={item.path} query={query} />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 flex-shrink-0">
                      <div className="w-10 flex justify-center">
                        {downloadingPath === item.path ? (
                          <Loader2 size={18} className="text-emerald-500 animate-spin" />
                        ) : (
                          <Download size={18} className={cn(
                            "transition-all duration-200",
                            selectedIndex === index ? 'opacity-100 text-emerald-500' : 'opacity-0 group-hover:opacity-30'
                          )} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center opacity-10">
                 {status === 'refreshing' ? (
                    <Loader2 size={48} className="animate-spin mb-4" />
                 ) : (
                    <Terminal size={64} className="mb-4" />
                 )}
                 <p className="text-sm tracking-[0.4em] font-bold uppercase">
                   {status === 'refreshing' ? 'Scanning file system' : 'Waiting for input'}
                 </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer / Key Hints */}
      <div className="w-full max-w-5xl px-10 py-4 flex items-center justify-between text-[10px] font-bold opacity-30 uppercase tracking-[0.2em]">
        <div className="flex gap-8">
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-100">↑↓</kbd>
            Select Item
          </span>
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-100">Enter</kbd>
            Download
          </span>
        </div>
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-100">Esc</kbd>
            Clear
          </span>
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div 
          className={cn(
            "fixed top-10 right-10 flex items-center gap-3 px-5 py-4 rounded-xl border shadow-2xl animate-in slide-in-from-right-10 duration-300 z-50",
            toast.type === 'error' 
              ? 'bg-zinc-900 border-red-900/50 text-red-400' 
              : 'bg-zinc-900 border-emerald-900/50 text-emerald-400'
          )}
        >
          {toast.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
          <span className="text-sm font-bold tracking-tight">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-4 opacity-50 hover:opacity-100 transition-opacity">
            <X size={16} />
          </button>
        </div>
      )}

    </div>
  );
}
