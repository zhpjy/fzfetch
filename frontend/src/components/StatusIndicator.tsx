import React from 'react';
import { Database, RefreshCw, Loader2 } from 'lucide-react';
import { AppStatus } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StatusIndicatorProps {
  status: AppStatus;
  isSearching: boolean;
  onRefresh: () => void;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status, isSearching, onRefresh }) => {
  const getStatusConfig = () => {
    switch(status) {
      case 'refreshing':
        return { label: '正在更新索引...', color: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' };
      case 'disconnected':
        return { label: '未连接服务器', color: 'bg-red-500 shadow-[0_0_8px_#ef4444]' };
      case 'ready':
      default:
        return { label: '系统就绪', color: 'bg-emerald-500 shadow-[0_0_8px_#10b981]' };
    }
  };

  const statusConfig = getStatusConfig();

  return (
    <div className="flex items-center gap-6 text-[10px]">
      <div className="flex items-center gap-2 px-2 py-1 rounded border border-zinc-800 bg-zinc-900 min-w-[120px]">
        <span className={cn("h-2 w-2 rounded-full", statusConfig.color)} />
        <span className="uppercase font-bold opacity-60 tracking-tight">{statusConfig.label}</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 h-6">
          {status === 'refreshing' || isSearching ? (
             <Loader2 size={14} className="animate-spin text-emerald-500" />
          ) : (
            <Database size={14} className="text-zinc-600" />
          )}
          <span className={cn("font-bold tracking-widest", (status === 'refreshing' || isSearching) ? 'text-emerald-500' : 'opacity-40')}>
            {status === 'refreshing' ? 'SCANNING' : isSearching ? 'SEARCHING' : 'IDLE'}
          </span>
        </div>

        <button 
          onClick={onRefresh}
          disabled={status === 'refreshing'}
          className={cn(
            "flex items-center gap-2 px-2 py-1 rounded border transition-all text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-emerald-400 active:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          {status === 'refreshing' ? (
             <Loader2 size={12} className="animate-spin opacity-40" />
          ) : (
            <RefreshCw size={12} />
          )}
          <span className="font-bold uppercase tracking-wider">刷新</span>
        </button>
      </div>
    </div>
  );
};
