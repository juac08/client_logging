/**
 * Logs 'screen.viewed' with the route NAME only (never params, which can hold ids).
 *
 *   const navigationRef = useNavigationContainerRef();
 *   const onStateChange = useScreenTracking(navigationRef);
 *   <NavigationContainer ref={navigationRef} onReady={onStateChange} onStateChange={onStateChange}>
 */
import { useCallback, useRef } from 'react';
import type { NavigationContainerRefWithCurrent, ParamListBase } from '@react-navigation/native';
import { logger } from '@your-org/common';

export function useScreenTracking(ref: NavigationContainerRefWithCurrent<ParamListBase>) {
  const previous = useRef<string | undefined>(undefined);
  return useCallback(() => {
    const name = ref.getCurrentRoute()?.name;
    if (name && name !== previous.current) {
      logger.info('screen.viewed', { screen: name });
      previous.current = name;
    }
  }, [ref]);
}
