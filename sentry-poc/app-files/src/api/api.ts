/**
 * Demo API. Each endpoint hits a dev-server route that produces one kind of outcome.
 * In your monorepo the only change to your real createApi file is the baseQuery line.
 */
import { createApi } from '@reduxjs/toolkit/query/react';
import { baseQueryWithLogging } from './baseQueryWithLogging';

export type Loan = { id: string; amount: number; status: string };

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithLogging, // was: customBaseQuery
  endpoints: (build) => ({
    getLoans: build.query<Loan[], void>({ query: () => '/loans' }),
    getServerError: build.query<unknown, void>({ query: () => '/loans/server-error' }),
    getSlowLoans: build.query<Loan[], void>({ query: () => '/loans/slow' }),
    getHangingRequest: build.query<unknown, void>({ query: () => '/loans/hang' }),
    getBadJson: build.query<unknown, void>({ query: () => '/loans/bad-json' }),
    getMissingLoan: build.query<unknown, void>({ query: () => '/loans/not-found' }),
    getExpiredSession: build.query<unknown, void>({ query: () => '/me/expired' }),
    // Port 1 is closed everywhere, so this fails fast with FETCH_ERROR (like being offline)
    getUnreachable: build.query<unknown, void>({ query: () => 'http://localhost:1/unreachable' }),
    submitLoan: build.mutation<unknown, { amount: number }>({
      query: (body) => ({ url: '/loans/submit', method: 'POST', body }),
    }),
  }),
});

export const {
  useLazyGetLoansQuery,
  useLazyGetServerErrorQuery,
  useLazyGetSlowLoansQuery,
  useLazyGetHangingRequestQuery,
  useLazyGetBadJsonQuery,
  useLazyGetMissingLoanQuery,
  useLazyGetExpiredSessionQuery,
  useLazyGetUnreachableQuery,
  useSubmitLoanMutation,
} = api;
