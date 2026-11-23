import React from 'react';
import { Provider } from 'react-redux';
import * as Sentry from '@sentry/react-native';
import { AppErrorBoundary } from './src/app/components/AppErrorBoundary';
import { PlaygroundScreen } from './src/app/screens/PlaygroundScreen';
import { store } from './src/app/store';

function App() {
  return (
    // Global boundary: outermost, so the fallback works even if a provider crashes
    <AppErrorBoundary feature="app">
      <Provider store={store}>
        <PlaygroundScreen />
      </Provider>
    </AppErrorBoundary>
  );
}

// Sentry.wrap adds Sentry's touch tracking and profiler hooks. Its touch
// breadcrumbs are dropped by beforeBreadcrumb, so no button labels are sent.
export default Sentry.wrap(App);
