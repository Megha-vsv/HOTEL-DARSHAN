import React from 'react';
import { useSocket } from '../context/SocketContext';
import { X, CheckCircle, AlertTriangle, Bell } from 'lucide-react';

export default function NotificationToast() {
  const { notifications, dismissNotification } = useSocket();

  if (!notifications || notifications.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full px-4 pointer-events-none">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`pointer-events-auto p-4 rounded-xl shadow-xl border flex items-start gap-3 transform transition-all duration-300 animate-slide-up bg-white ${
            n.type === 'alert'
              ? 'border-red-200 text-red-900 bg-red-50'
              : n.type === 'success'
              ? 'border-emerald-200 text-emerald-900 bg-emerald-50'
              : 'border-neutral-200 text-neutral-800'
          }`}
        >
          <div className="mt-0.5 shrink-0">
            {n.type === 'alert' ? (
              <AlertTriangle className="w-5 h-5 text-red-500" />
            ) : n.type === 'success' ? (
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            ) : (
              <Bell className="w-5 h-5 text-[#e53935]" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm leading-snug">{n.title}</h4>
            <p className="text-xs text-neutral-600 mt-0.5 leading-relaxed">{n.message}</p>
          </div>
          <button
            onClick={() => dismissNotification(n.id)}
            className="text-neutral-400 hover:text-neutral-700 p-0.5 rounded shrink-0 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
