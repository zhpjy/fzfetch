import React from 'react';
import { Database, Loader2 } from 'lucide-react';
import { AppStatus, ConnectionStatus, IndexStatus, WorkStatus } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface StatusIndicatorProps {
  connectionStatus: ConnectionStatus;
  indexStatus: IndexStatus;
  workStatus: WorkStatus;
}

interface LegacyStatusIndicatorProps {
  status: AppStatus;
  isSearching: boolean;
  onRefresh?: () => void;
}

type Props = StatusIndicatorProps | LegacyStatusIndicatorProps;

export const StatusIndicator: React.FC<Props> = (props) => {
  const connectionStatus: ConnectionStatus =
    'connectionStatus' in props
      ? props.connectionStatus
      : props.status === 'disconnected'
        ? 'disconnected'
        : 'ready';

  const workStatus: WorkStatus =
    'workStatus' in props
      ? props.workStatus
      : props.status === 'refreshing'
        ? 'refreshing'
        : props.status === 'ready' && props.isSearching
          ? 'searching'
          : 'idle';

  const indexStatus: IndexStatus =
    'indexStatus' in props
      ? props.indexStatus
      : props.status === 'refreshing'
        ? 'refreshing'
        : props.status === 'ready'
          ? 'ready'
          : 'unknown';

  const getStatusConfig = () => {
    switch (connectionStatus) {
      case 'connecting':
        return { label: '正在连接', color: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' };
      case 'disconnected':
        return { label: '未连接服务器', color: 'bg-red-500 shadow-[0_0_8px_#ef4444]' };
      case 'error':
        return { label: '连接异常', color: 'bg-red-500 shadow-[0_0_8px_#ef4444]' };
      case 'ready':
      default:
        break;
    }

    switch (indexStatus) {
      case 'pending':
        return { label: '索引待初始化', color: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' };
      case 'refreshing':
        return { label: '索引后台更新中', color: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' };
      case 'unknown':
        return { label: '索引状态未知', color: 'bg-zinc-500 shadow-[0_0_8px_#71717a]' };
      default:
        return { label: '索引就绪', color: 'bg-emerald-500 shadow-[0_0_8px_#10b981]' };
    }
  };

  const getWorkLabel = () => {
    switch (workStatus) {
      case 'refreshing':
        return 'SCANNING';
      case 'searching':
        return 'SEARCHING';
      case 'idle':
      default:
        return 'IDLE';
    }
  };

  const isBusy =
    workStatus !== 'idle' || connectionStatus === 'connecting' || indexStatus === 'refreshing';

  const statusConfig = getStatusConfig();

  return (
    <div className="flex items-center gap-6 text-[10px]">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 h-6">
          {isBusy ? (
            <Loader2 size={14} className="animate-spin text-emerald-500" />
          ) : (
            <Database size={14} className="text-zinc-600" />
          )}
          <span className={cn("font-bold tracking-widest", isBusy ? 'text-emerald-500' : 'opacity-40')}>
            {getWorkLabel()}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 px-2 py-1 rounded border border-zinc-800 bg-zinc-900 min-w-[120px]">
        <span className={cn("h-2 w-2 rounded-full", statusConfig.color)} />
        <span className="uppercase font-bold opacity-60 tracking-tight">{statusConfig.label}</span>
      </div>
    </div>
  );
};
