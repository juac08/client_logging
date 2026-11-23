import { configureStore } from '@reduxjs/toolkit';
import { api, setApiBaseUrl } from '@poc/api';
import { config } from './config';

setApiBaseUrl(config.apiBaseUrl);

export const store = configureStore({
  reducer: { [api.reducerPath]: api.reducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
});
