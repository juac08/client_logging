import { customBaseQuery } from './customBaseQuery'; // your existing base query, unchanged
import { withLogging } from './withLogging';

/** The generated log endpoint's name. It must never be logged itself (see withLogging). */
export const LOG_ENDPOINT_NAME = 'sendLog';

export const baseQueryWithLogging = withLogging(customBaseQuery, {
  ignoreEndpoints: [LOG_ENDPOINT_NAME],
});

// In your createApi file, change one line:
//   baseQuery: baseQueryWithLogging, // was: customBaseQuery
