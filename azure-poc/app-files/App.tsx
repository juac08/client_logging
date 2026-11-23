import React from 'react';
import { Provider } from 'react-redux';
import { AppErrorBoundary } from './src/app/components/AppErrorBoundary';
import { PlaygroundScreen } from './src/app/screens/PlaygroundScreen';
import { store } from './src/app/store';

export default function App() {
  return (
    // Global boundary: outermost, so the fallback works even if a provider crashes
    <AppErrorBoundary feature="app">
      <Provider store={store}>
        <PlaygroundScreen />
      </Provider>
    </AppErrorBoundary>
  );
}
