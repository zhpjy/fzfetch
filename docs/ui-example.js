import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, 
  Terminal, 
  RefreshCw, 
  Download, 
  FileText, 
  AlertCircle, 
  CheckCircle2, 
  Database,
  X,
  Loader2
} from 'lucide-react';

// --- 常量配置 ---
const DEBOUNCE_MS = 100;

// --- Mock 预设数据集 ---
const MOCK_FILES = [
  "/projects/fzfetch/src/main.rs",
  "/projects/fzfetch/src/core/search.rs",
  "/projects/fzfetch/Cargo.toml",
  "/etc/nginx/nginx.conf",
  "/var/log/system.log",
  "/home/user/documents/report_v2_final.pdf",
  "/projects/react-app/src/components/Header.tsx",
  "/projects/react-app/package.json",
  "/usr/local/bin/rustc",
  "/downloads/ubuntu-22.04-desktop-amd64.iso",
  "/projects/api-server/db/migration.sql",
  "/projects/api-server/src/auth/jwt.rs",
  "/config/settings.yaml",
  "/assets/images/logo_transparent.png",
  "/backup/db_2023_10_27.tar.gz"
];

/**
 * 环形流动加载动画 (FancyLoader)
 * 采用渐变描边和缩放动画，视觉效果更现代
 */
const FancyLoader = () => (
  <div className="relative flex items-center justify-center w-5 h-5">
    <svg className="animate-spin" viewBox="0 0 24 24">
      <defs>
        <linearGradient id="loader-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="transparent" />
          <stop offset="100%" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <circle
        className="opacity-20"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
      />
      <path
        fill="url(#loader-grad)"
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
    <div className="absolute w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
  </div>
);

/**
 * 模糊高亮组件
 */
const FuzzyHighlight = ({ text, query }) => {
  if (!query) return <span>{text}</span>;

  const chars = text.split('');
  const queryChars = query.toLowerCase().split('');
  let queryIdx = 0;

  return (
    <span>
      {chars.map((char, i) => {
        if (queryIdx < queryChars.length && char.toLowerCase() === queryChars[queryIdx]) {
          queryIdx++;
          return <span key={i} className="text-emerald-600 font-bold underline decoration-emerald-500/30">{char}</span>;
        }
        return <span key={i}>{char}</span>;
      })}
    </span>
  );
};

/**
 * 轻量级通知组件
 */
const Toast = ({ message, type, onClose }) => (
  <div className={`fixed top-6 right-6 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-2xl animate-in slide-in-from-right-10 duration-300 z-50 ${
    type === 'error' 
      ? 'bg-red-50 border-red-200 text-red-600' 
      : 'bg-white border-zinc-200 text-zinc-800'
  }`}>
    {type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} className="text-emerald-500" />}
    <span className="text-sm font-medium">{message}</span>
    <button onClick={onClose} className="ml-2 hover:opacity-70"><X size={14} /></button>
  </div>
);

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [downloadingPath, setDownloadingPath] = useState(null);
  const [toast, setToast] = useState(null);
  const [indexCount, setIndexCount] = useState(124083);
  
  const [appStatus, setAppStatus] = useState('ready'); 
  const searchInputRef = useRef(null);

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // 1. 刷新索引模拟
  const handleTriggerRefresh = () => {
    if (appStatus === 'refreshing') return; 
    setAppStatus('refreshing');
    setTimeout(() => {
      setAppStatus('ready');
      setIndexCount(prev => prev + Math.floor(Math.random() * 100));
    }, 4000); 
  };

  // 2. 模糊搜索逻辑 Mock
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!query) {
        setResults([]);
        return;
      }
      const filtered = MOCK_FILES
        .map(path => {
          const name = path.split('/').pop();
          let score = 0, qIdx = 0;
          const q = query.toLowerCase();
          for(let char of path.toLowerCase()) {
            if (qIdx < q.length && char === q[qIdx]) { qIdx++; score += 10; }
          }
          return { path, name, score, size: `${(Math.random() * 50).toFixed(1)} MB` };
        })
        .filter(item => item.score >= query.length * 10)
        .sort((a, b) => b.score - a.score);

      setResults(filtered);
      setSelectedIndex(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // 3. 下载逻辑
  const handleDownload = async (item) => {
    if (!item || downloadingPath) return;
    setDownloadingPath(item.path);
    setTimeout(() => {
      if (Math.random() > 0.8) {
        showToast("410 Gone: 文件已被移动或删除", "error");
        setResults(prev => prev.filter(r => r.path !== item.path));
      } else {
        showToast(`已开始下载: ${item.name}`, "success");
      }
      setDownloadingPath(null);
    }, 800);
  };

  // 4. 键盘导航
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') return setQuery('');
      if (results.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
      } else if (e.key === 'Enter') {
        handleDownload(results[selectedIndex]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [results, selectedIndex, downloadingPath]);

  useEffect(() => {
    const activeEl = document.getElementById(`item-${selectedIndex}`);
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  // 获取状态配置
  const getStatusConfig = () => {
    switch(appStatus) {
      case 'refreshing':
        return { label: '正在更新索引...', color: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' };
      case 'disconnected':
        return { label: '断开连接', color: 'bg-red-500 shadow-[0_0_8px_#ef4444]' };
      case 'ready':
      default:
        return { label: '缓存就绪', color: 'bg-emerald-500 shadow-[0_0_8px_#10b981]' };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-800 font-mono flex flex-col items-center selection:bg-emerald-500/10">
      
      {/* 状态栏 */}
      <div className="w-full max-w-4xl px-6 pt-12 flex justify-between items-end mb-4 relative z-10">
        <div className="flex items-center gap-3">
          <Terminal className="text-emerald-600" size={24} />
          <h1 className="text-xl font-bold tracking-tighter text-zinc-900">FZFETCH</h1>
          <div className="flex items-center gap-2 px-2 py-1 rounded border border-zinc-200 bg-white min-w-[130px]">
             <span className={`h-2.5 w-2.5 rounded-full ${statusConfig.color} transition-colors duration-500`} />
             <span className="text-[10px] uppercase font-bold opacity-60 tracking-tight">{statusConfig.label}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-5 text-xs">
          <div className="flex items-center gap-2 h-6">
            {appStatus === 'refreshing' ? (
              <FancyLoader />
            ) : (
              <Database size={16} className="text-zinc-400 opacity-60" />
            )}
            <span className={`tabular-nums font-bold min-w-[80px] ${appStatus === 'refreshing' ? 'text-emerald-600' : 'opacity-60'}`}>
              {appStatus === 'refreshing' ? 'SCANNING' : `${indexCount.toLocaleString()} FILES`}
            </span>
          </div>
          
          <button 
            onClick={handleTriggerRefresh}
            disabled={appStatus === 'refreshing'}
            className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-all shadow-sm ${
              appStatus === 'refreshing' 
              ? 'bg-zinc-100 border-zinc-200 text-zinc-400 cursor-not-allowed opacity-70' 
              : 'bg-white border-zinc-200 hover:border-zinc-400 hover:text-zinc-900 active:bg-zinc-50'
            }`}
          >
            {appStatus === 'refreshing' ? (
              <Loader2 size={14} className="animate-spin opacity-40" />
            ) : (
              <RefreshCw size={14} />
            )}
            <span className="hidden sm:inline font-bold text-xs uppercase tracking-wider">
              {appStatus === 'refreshing' ? '刷新中' : '刷新索引'}
            </span>
          </button>
        </div>
      </div>

      {/* 搜索区域 */}
      <div className="w-full max-w-4xl px-6 relative group z-10">
        <div className="absolute left-10 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-emerald-600 transition-colors">
          <Search size={22} />
        </div>
        <input
          ref={searchInputRef}
          autoFocus
          type="text"
          placeholder="输入关键词进行实时模糊搜索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full border border-zinc-200 outline-none rounded-xl py-5 pl-14 pr-6 text-lg shadow-xl bg-white focus:border-emerald-500 text-zinc-900 transition-all placeholder:opacity-40"
        />
      </div>

      {/* 结果区域 */}
      <div className="w-full max-w-4xl flex-1 px-6 mt-4 pb-4 overflow-hidden flex flex-col z-10">
        <div className="border border-zinc-200 rounded-xl flex-1 overflow-hidden flex flex-col bg-white shadow-sm relative">
          {appStatus === 'refreshing' && <div className="h-0.5 w-full bg-emerald-500 animate-[shimmer_2s_infinite] absolute top-0" />}
          
          <div className="overflow-y-auto custom-scrollbar flex-1">
            {results.length > 0 ? (
              <div className="divide-y divide-zinc-100">
                {results.map((item, index) => (
                  <div
                    key={item.path}
                    id={`item-${index}`}
                    onClick={() => { setSelectedIndex(index); handleDownload(item); }}
                    className={`px-6 py-4 cursor-pointer flex items-center justify-between group transition-all border-l-4 ${
                      selectedIndex === index 
                      ? 'border-l-emerald-500 bg-emerald-50/50'
                      : 'border-l-transparent hover:bg-zinc-50'
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <FileText size={18} className={selectedIndex === index ? 'text-emerald-600' : 'opacity-30'} />
                      <div className="flex flex-col min-w-0">
                        <div className={`truncate text-sm ${selectedIndex === index ? 'text-zinc-900 font-bold' : 'text-zinc-700'}`}>
                          <FuzzyHighlight text={item.name} query={query} />
                        </div>
                        <div className="truncate text-[10px] opacity-40 italic mt-0.5 font-sans">
                          <FuzzyHighlight text={item.path} query={query} />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <span className="text-[10px] opacity-40 font-mono tracking-tighter uppercase tabular-nums">
                        {item.size}
                      </span>
                      <div className="w-8 flex justify-center">
                        {downloadingPath === item.path ? (
                          <Loader2 size={18} className="text-emerald-600 animate-spin" />
                        ) : (
                          <Download size={18} className={`transition-all ${selectedIndex === index ? 'opacity-100 text-emerald-600' : 'opacity-0 group-hover:opacity-30'}`} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center opacity-20">
                 {appStatus === 'refreshing' ? (
                    <div className="py-8"><FancyLoader /></div>
                 ) : (
                    <Terminal size={48} className="mb-4" />
                 )}
                 <p className="text-xs tracking-[0.3em] font-bold uppercase mt-2">
                   {appStatus === 'refreshing' ? '正在后台扫描文件' : '等待搜索指令'}
                 </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部按键提示 */}
      <div className="w-full max-w-4xl px-6 py-4 flex items-center justify-between text-[10px] font-bold opacity-30 uppercase tracking-widest z-10">
        <div className="flex gap-6 text-zinc-900">
          <span className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded border border-zinc-300 bg-zinc-100 shadow-sm">↑↓</span>
            选择项
          </span>
          <span className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded border border-zinc-300 bg-zinc-100 shadow-sm">Enter</span>
            下载文件
          </span>
        </div>
        <div className="flex items-center gap-4 text-zinc-900">
          {appStatus === 'refreshing' && (
            <span className="flex items-center gap-2 text-emerald-600 font-bold">
              <FancyLoader /> 刷新中
            </span>
          )}
          <span className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded border border-zinc-300 bg-zinc-100 shadow-sm">Esc</span>
            清空
          </span>
        </div>
      </div>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #10b98144; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #10b981; }
        
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
