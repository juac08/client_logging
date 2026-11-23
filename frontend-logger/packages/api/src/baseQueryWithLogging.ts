import { customBaseQuery } from './customBaseQuery'; // your existing base query, unchanged
import { withLogging } from './withLogging';

export const baseQueryWithLogging = withLogging(customBaseQuery);

// In your createApi file, change one line:
//   baseQuery: baseQueryWithLogging, // was: customBaseQuery
