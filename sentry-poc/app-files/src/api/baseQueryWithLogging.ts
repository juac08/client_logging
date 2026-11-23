// In your monorepo: packages/api/src/baseQueryWithLogging.ts
import { customBaseQuery } from './customBaseQuery';
import { withLogging } from './withLogging';

export const baseQueryWithLogging = withLogging(customBaseQuery);
