import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import type { LimitOrder } from '../../types/trading';
import { Spinner } from '../ui/Spinner';

interface OpenOrdersProps {
  onOrderCancelled?: () => void;
}

export function OpenOrders({ onOrderCancelled }: OpenOrdersProps) {
  const [orders, setOrders] = useState<LimitOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      const data = await api.getLimitOrders();
      setOrders(data.filter(o => o.status === 'pending'));
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    // Poll for updates every 10 seconds
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleCancel = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      await api.cancelLimitOrder(orderId);
      setOrders(prev => prev.filter(o => o.id !== orderId));
      onOrderCancelled?.();
    } catch (error) {
      console.error('Failed to cancel order:', error);
    } finally {
      setCancellingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Open Orders</h3>
        <div className="flex items-center justify-center py-6">
          <Spinner size="sm" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">Open Orders</h3>
        <span className="text-xs text-text-muted">
          {orders.length} {orders.length === 1 ? 'order' : 'orders'}
        </span>
      </div>

      {orders.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-text-muted text-sm">No open orders</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center justify-between p-2 bg-bg-tertiary rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-xs font-semibold',
                    order.side === 'long' ? 'text-accent-green' : 'text-accent-red'
                  )}>
                    {order.side === 'long' ? 'LONG' : 'SHORT'}
                  </span>
                  <span className="text-sm text-text-primary font-medium">{order.asset}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-text-muted">
                  <span>Size: {order.size}</span>
                  <span>@ ${order.price.toLocaleString()}</span>
                  <span>{order.leverage}x</span>
                </div>
              </div>
              <button
                onClick={() => handleCancel(order.id)}
                disabled={cancellingId === order.id}
                className={cn(
                  'px-2 py-1 text-xs font-medium rounded transition-colors',
                  cancellingId === order.id
                    ? 'bg-bg-elevated text-text-muted cursor-not-allowed'
                    : 'bg-accent-red/10 text-accent-red hover:bg-accent-red/20'
                )}
              >
                {cancellingId === order.id ? '...' : 'Cancel'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
