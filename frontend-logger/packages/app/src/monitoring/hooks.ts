import { useCallback, useMemo, useState } from 'react';
import { logger, type LogContext, type Logger } from '@your-org/common';

/**
 * A logger bound to a feature or screen, stable across renders.
 *
 *   const log = useLogger({ feature: 'lending', screen: 'LoanApplication' });
 *   log.info('loan.application.step.completed', { step: 'income' });
 */
export function useLogger(context: LogContext): Logger {
  const key = JSON.stringify(context);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => logger.child(context), [key]);
}

/**
 * Sends an error from an event handler or async code to the nearest AppErrorBoundary
 * (boundaries only catch render errors). The state updater throws during the next
 * render, so the boundary catches and logs it.
 */
export function useShowBoundary(): (error: unknown) => void {
  const [, setState] = useState<void>();
  return useCallback((error: unknown) => {
    setState(() => {
      throw error;
    });
  }, []);
}
