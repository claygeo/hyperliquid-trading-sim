import { useEffect, useState } from 'react';
import { useToast, type Toast as ToastType } from '../../context/ToastContext';
import { cn } from '../../lib/utils';

function ToastItem({ toast, onRemove }: { toast: ToastType; onRemove: () => void }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleRemove = () => {
    setIsExiting(true);
    setTimeout(onRemove, 200);
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onRemove, 200);
    }, (toast.duration ?? 4000) - 200);

    return () => clearTimeout(timeout);
  }, [toast.duration, onRemove]);

  const bgColor = {
    success: 'bg-accent-green/20 border-accent-green/50',
    error: 'bg-accent-red/20 border-accent-red/50',
    info: 'bg-accent-cyan/20 border-accent-cyan/50',
  }[toast.type];

  const textColor = {
    success: 'text-accent-green',
    error: 'text-accent-red',
    info: 'text-accent-cyan',
  }[toast.type];

  return (
    <div
      className={cn(
        'px-4 py-3 rounded-lg border backdrop-blur-sm shadow-lg transition-all duration-200',
        bgColor,
        isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'
      )}
      onClick={handleRemove}
    >
      <div className={cn('font-semibold text-sm', textColor)}>{toast.title}</div>
      {toast.message && (
        <div className="text-text-secondary text-xs mt-0.5">{toast.message}</div>
      )}
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div className="fixed bottom-20 md:bottom-4 right-4 z-50 flex flex-col gap-2 safe-area-bottom">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}