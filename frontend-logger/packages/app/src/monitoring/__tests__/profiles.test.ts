import { getLoggingProfile, LOGGING_PROFILES } from '../profiles';

describe('logging profiles', () => {
  it('pt behaves exactly like pr (pre-production parity)', () => {
    expect(LOGGING_PROFILES.pt).toEqual(LOGGING_PROFILES.pr);
  });

  it('production never processes debug and always sends to the backend', () => {
    expect(LOGGING_PROFILES.pr.minLevel).toBe('info');
    expect(LOGGING_PROFILES.pr.sendToBackend).toBe(true);
  });

  it('dev stays local by default; st sends full detail', () => {
    expect(LOGGING_PROFILES.dev.sendToBackend).toBe(false);
    expect(LOGGING_PROFILES.st.sendToBackend).toBe(true);
    expect(LOGGING_PROFILES.st.minLevel).toBe('debug');
  });

  it('an unknown environment falls back to production rules', () => {
    expect(getLoggingProfile('prod-typo')).toEqual(LOGGING_PROFILES.pr);
    expect(getLoggingProfile('')).toEqual(LOGGING_PROFILES.pr);
  });
});
