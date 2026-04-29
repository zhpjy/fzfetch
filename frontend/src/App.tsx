import React, { useCallback, useRef } from 'react';
import { Search, Terminal, Download, FileText, AlertCircle, CheckCircle2, X, Loader2 } from 'lucide-react';
import { useSearchSocket } from './hooks/useSearchSocket';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useDownload } from './hooks/useDownload';
import { useMeasuredPathDisplay } from './hooks/useMeasuredPathDisplay';
import { StatusIndicator } from './components/StatusIndicator';
import { FuzzyHighlight } from './components/FuzzyHighlight';
import { basenameFromPath } from './pathDisplay';
import { useI18n } from './i18n/useI18n';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatFileSize(sizeBytes?: number | null) {
  if (sizeBytes == null || Number.isNaN(sizeBytes)) {
    return '--';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = sizeBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

const GITHUB_REPO_URL = 'https://github.com/zhpjy/fzfetch';

export default function App() {
  const { locale, setLocale, t } = useI18n();

  const {
    query,
    setQuery,
    results,
    setResults,
    connectionStatus,
    indexStatus,
    workStatus,
    isSearching,
    refreshToast,
    setRefreshToast,
  } = useSearchSocket();

  const inputRef = useRef<HTMLInputElement>(null);

  const onGhostFound = useCallback((path: string) => {
    setResults(prev => prev.filter(item => item.path !== path));
  }, [setResults]);

  const { handleDownload, downloadingPath, toast, setToast } = useDownload(onGhostFound);
  const { probeRef, getDisplayedPath } = useMeasuredPathDisplay();

  const { selectedIndex, setSelectedIndex } = useKeyboardNavigation(results, handleDownload, () => {
    setQuery('');
    inputRef.current?.focus();
  });

  const trimmedQuery = query.trim();
  const showWaiting = trimmedQuery.length === 0;
  const showNoMatches =
    !showWaiting &&
    connectionStatus === 'ready' &&
    indexStatus === 'ready' &&
    !isSearching &&
    results.length === 0;
  const showSearching = !showWaiting && isSearching && results.length === 0;
  const switchToChineseLabel = t('locale.switchToChinese');
  const switchToEnglishLabel = t('locale.switchToEnglish');
  const zhCurrentLabel = locale === 'zh-CN' ? '中文（当前语言）' : 'Chinese (current language)';
  const enCurrentLabel = locale === 'zh-CN' ? '英文（当前语言）' : 'English (current language)';
  const activeToast = toast ?? refreshToast;
  const emptyStateMessage =
    indexStatus === 'refreshing'
      ? t('empty.indexRefreshing')
      : indexStatus === 'pending'
        ? t('empty.indexPending')
        : showWaiting
          ? t('empty.waiting')
          : showSearching
            ? t('empty.searching')
            : showNoMatches
              ? t('empty.noMatches')
              : t('empty.waiting');
  return (
    <div className="h-screen bg-zinc-950 text-zinc-300 font-mono flex flex-col items-center select-none overflow-hidden">
      
      {/* Header / Status Bar */}
      <div
        data-testid="app-header"
        className="w-full max-w-5xl px-3 pt-4 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10 flex items-center sm:items-end justify-between gap-3 mb-3 sm:mb-6"
      >
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open fzfetch on GitHub"
          className="flex min-w-0 items-center gap-2.5 sm:gap-4 rounded-md transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          <Terminal className="text-emerald-500 sm:hidden" size={22} />
          <Terminal className="hidden text-emerald-500 sm:block" size={28} />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tighter text-zinc-100">FZFETCH</h1>
        </a>
        
        <div className="flex items-center gap-3 sm:gap-4">
          <div
            data-testid="locale-switcher"
            className="hidden sm:flex"
          >
            <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/70 p-1 text-[10px] font-semibold tracking-wider text-zinc-400">
              <button
                type="button"
                onClick={() => setLocale('zh-CN')}
                aria-label={locale === 'zh-CN' ? zhCurrentLabel : switchToChineseLabel}
                aria-pressed={locale === 'zh-CN'}
                className={cn(
                  'rounded px-2 py-1 transition-colors',
                  locale === 'zh-CN' ? 'bg-zinc-100 text-zinc-900' : 'hover:text-zinc-200',
                )}
              >
                {t('locale.labelChinese')}
              </button>
              <span className="text-zinc-600">/</span>
              <button
                type="button"
                onClick={() => setLocale('en')}
                aria-label={locale === 'en' ? enCurrentLabel : switchToEnglishLabel}
                aria-pressed={locale === 'en'}
                className={cn(
                  'rounded px-2 py-1 transition-colors',
                  locale === 'en' ? 'bg-zinc-100 text-zinc-900' : 'hover:text-zinc-200',
                )}
              >
                {t('locale.labelEnglish')}
              </button>
            </div>
          </div>
          <StatusIndicator 
            connectionStatus={connectionStatus}
            indexStatus={indexStatus}
            workStatus={workStatus}
          />
        </div>
      </div>

      {/* Main Search Area */}
      <div className="w-full max-w-5xl px-3 sm:px-6 lg:px-8 relative group mb-2">
        <div className="absolute left-8 sm:left-10 lg:left-14 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition-colors pointer-events-none">
          <Search size={18} className="sm:hidden" />
          <Search size={22} className="hidden sm:block" />
        </div>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 outline-none rounded-xl py-4 sm:py-5 pl-11 sm:pl-14 lg:pl-16 pr-4 sm:pr-6 lg:pr-8 text-base sm:text-lg lg:text-xl shadow-2xl focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 text-zinc-100 transition-all placeholder:text-zinc-700"
        />
      </div>

      {/* Results Section */}
      <div className="w-full max-w-5xl flex-1 min-h-0 px-3 sm:px-6 lg:px-8 pb-4 sm:pb-6 overflow-hidden flex flex-col">
        <div className="border border-zinc-800 rounded-xl flex-1 min-h-0 overflow-hidden flex flex-col bg-zinc-900/50 shadow-inner relative mt-4">
          
          {/* Progress bar for index refresh */}
          {indexStatus === 'refreshing' && (
            <div className="h-0.5 w-full bg-zinc-800 overflow-hidden absolute top-0">
               <div className="h-full bg-emerald-500 w-1/3 animate-shimmer" />
            </div>
          )}

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-hidden opacity-0"
          >
            <div className="px-3 py-2 sm:px-5 sm:py-2.5 lg:px-7 flex items-start justify-between gap-3 border-l-2 border-l-transparent">
              <div className="flex flex-1 items-start gap-2.5 sm:gap-3.5 min-w-0">
                <div className="flex-shrink-0">
                  <FileText size={14} className="sm:hidden" />
                  <FileText size={16} className="hidden sm:block" />
                </div>
                <div
                  data-testid="path-width-probe-container"
                  className="flex flex-1 flex-col min-w-0"
                >
                  <div className="truncate text-[13px] leading-4 sm:text-sm sm:leading-4">
                    probe.txt
                  </div>
                  <div
                    ref={probeRef}
                    data-testid="path-width-probe"
                    className="w-full truncate text-[9px] leading-3 sm:text-[10px] text-zinc-500 italic mt-0.5 font-sans opacity-70"
                  >
                    /path/width/probe.txt
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end justify-center gap-1 pt-0.5 sm:flex-row sm:items-center sm:gap-3.5 flex-shrink-0">
                <div className="min-w-0 text-right text-[10px] sm:min-w-14 sm:text-[11px] font-semibold tabular-nums text-zinc-500">
                  0 B
                </div>
                <div className="w-5 sm:w-8 flex justify-center">
                  <Download size={14} className="sm:hidden" />
                  <Download size={16} className="hidden sm:block" />
                </div>
              </div>
            </div>
          </div>
          
          <div
            data-testid="results-scroll-area"
            className="overflow-y-scroll custom-scrollbar flex-1 min-h-0"
          >
            {results.length > 0 ? (
              <div className="divide-y divide-zinc-800/50">
                {results.map((item, index) => {
                  const basename = basenameFromPath(item.path);
                  const isSelected = selectedIndex === index;
                  const displayedPath = getDisplayedPath(item.path, isSelected);

                  return (
                  <div
                    key={item.path}
                    id={`item-${index}`}
                    data-testid={`result-row-${index}`}
                    onClick={() => setSelectedIndex(index)}
                    className={cn(
                      "px-3 py-2 sm:px-5 sm:py-2.5 lg:px-7 cursor-pointer flex items-start justify-between gap-3 group transition-all border-l-2",
                      isSelected
                        ? 'border-l-emerald-500 bg-emerald-500/5'
                        : 'border-l-transparent hover:bg-zinc-800/30'
                    )}
                  >
                    <div className="flex flex-1 items-start gap-2.5 sm:gap-3.5 min-w-0">
                      <div className="flex-shrink-0">
                        {isSelected ? (
                          <>
                            <span className="text-emerald-500 font-bold tracking-widest text-xs sm:hidden">&gt;</span>
                            <span className="hidden sm:block text-emerald-500 font-bold tracking-widest text-xs">&gt;</span>
                          </>
                        ) : (
                          <>
                            <FileText size={14} className="text-zinc-700 group-hover:text-zinc-500 transition-colors sm:hidden" />
                            <FileText size={16} className="hidden sm:block text-zinc-700 group-hover:text-zinc-500 transition-colors" />
                          </>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col min-w-0">
                        <div
                          data-testid={`result-name-${index}`}
                          className={cn(
                          "text-[13px] leading-4 sm:text-sm sm:leading-4",
                          isSelected
                            ? 'whitespace-normal break-all text-zinc-50 font-semibold'
                            : 'truncate text-zinc-300'
                        )}>
                          <FuzzyHighlight text={basename} query={query} />
                        </div>
                        <div
                          data-testid={`result-path-${index}`}
                          title={item.path}
                          className={cn(
                            "w-full text-[9px] leading-3 sm:text-[10px] mt-0.5 font-sans",
                            isSelected
                              ? 'whitespace-normal break-all text-zinc-400 opacity-90'
                              : 'truncate text-zinc-500 italic opacity-70'
                          )}
                        >
                          {displayedPath}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end justify-center gap-1 pt-0.5 sm:flex-row sm:items-center sm:gap-3.5 flex-shrink-0">
                      <div className="min-w-0 text-right text-[10px] sm:min-w-14 sm:text-[11px] font-semibold tabular-nums text-zinc-500">
                        {formatFileSize(item.size_bytes)}
                      </div>
                      <button
                        type="button"
                        aria-label={`下载 ${basenameFromPath(item.path)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDownload(item);
                        }}
                        className="w-5 sm:w-8 flex justify-center"
                      >
                        {downloadingPath === item.path ? (
                          <Loader2 size={14} className="text-emerald-500 animate-spin sm:hidden" />
                        ) : (
                          <Download size={14} className={cn(
                            "sm:hidden transition-all duration-200",
                            isSelected ? 'opacity-100 text-emerald-500' : 'opacity-40 group-hover:opacity-60 sm:opacity-0 sm:group-hover:opacity-30'
                          )} />
                        )}
                        {downloadingPath === item.path ? (
                          <Loader2 size={16} className="hidden sm:block text-emerald-500 animate-spin" />
                        ) : (
                          <Download size={16} className={cn(
                            "hidden sm:block transition-all duration-200",
                            isSelected ? 'opacity-100 text-emerald-500' : 'opacity-0 group-hover:opacity-30'
                          )} />
                        )}
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center opacity-10">
                 {indexStatus === 'refreshing' ? (
                    <Loader2 size={48} className="animate-spin mb-4" />
                 ) : (
                    <Terminal size={64} className="mb-4" />
                 )}
                 <p className="text-sm tracking-[0.4em] font-bold uppercase">
                   {emptyStateMessage}
                 </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer / Key Hints */}
      <div
        data-testid="footer-hints"
        className="w-full max-w-5xl flex-shrink-0 px-4 sm:px-8 lg:px-10 py-3 sm:py-4 flex items-center justify-between text-[9px] sm:text-[10px] font-bold opacity-30 uppercase tracking-[0.15em] sm:tracking-[0.2em]"
      >
        <div className="flex gap-4 sm:gap-8">
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-100">↑↓</kbd>
            {t('hint.selectItem')}
          </span>
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-100">Enter</kbd>
            {t('hint.download')}
          </span>
        </div>
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-100">Esc</kbd>
            {t('hint.clear')}
          </span>
        </div>
      </div>

      {/* Toast Notification */}
      {activeToast && (
        <div 
          className={cn(
            "fixed top-10 right-10 flex items-center gap-3 px-5 py-4 rounded-xl border shadow-2xl animate-in slide-in-from-right-10 duration-300 z-50",
            activeToast.type === 'error' 
              ? 'bg-zinc-900 border-red-900/50 text-red-400' 
              : 'bg-zinc-900 border-emerald-900/50 text-emerald-400'
          )}
        >
          {activeToast.type === 'error' ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
          <span className="text-sm font-bold tracking-tight">{activeToast.msg}</span>
          <button
            type="button"
            aria-label={t('toast.dismiss')}
            title={t('toast.dismiss')}
            onClick={() => {
              setToast(null);
              setRefreshToast(null);
            }}
            className="ml-4 opacity-50 hover:opacity-100 transition-opacity"
          >
            <X size={16} />
          </button>
        </div>
      )}

    </div>
  );
}
