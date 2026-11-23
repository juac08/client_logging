/**
 * Sends an error from an event handler or async code to the nearest AppErrorBoundary.
 * A state updater runs during the next render; throwing inside it turns the error
 * into a render error, which the boundary catches (and logs).
 */
import { useCallback, useState } from 'react';

export function useShowBoundary() {
  const [, setState] = useState<void>();
  return useCallback((error: unknown) => {
    setState(() => {
      throw error;
    });
  }, []);
}
