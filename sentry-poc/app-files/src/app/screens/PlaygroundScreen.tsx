/**
 * Telemetry playground (Sentry version): every button produces one kind of event.
 * Errors appear as Issues in Sentry; warnings appear as breadcrumbs on the next issue.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { logger } from '@poc/common';
import {
  useLazyGetBadJsonQuery,
  useLazyGetExpiredSessionQuery,
  useLazyGetHangingRequestQuery,
  useLazyGetLoansQuery,
  useLazyGetMissingLoanQuery,
  useLazyGetServerErrorQuery,
  useLazyGetSlowLoansQuery,
  useLazyGetUnreachableQuery,
  useSubmitLoanMutation,
} from '@poc/api';
import { AppErrorBoundary } from '../components/AppErrorBoundary';
import { useShowBoundary } from '../hooks/useShowBoundary';

type Run = (label: string, action: () => Promise<unknown> | unknown) => void;

export function PlaygroundScreen() {
  const [status, setStatus] = useState('Tap a button, then check Issues in Sentry.');
  const [crash, setCrash] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const run: Run = async (label, action) => {
    setStatus(`${label}: running…`);
    try {
      await action();
      setStatus(`${label}: OK`);
    } catch (e) {
      const s = (e as { status?: unknown })?.status;
      setStatus(`${label}: failed${s !== undefined ? ` (${String(s)})` : ''}`);
    }
  };

  const [getLoans] = useLazyGetLoansQuery();
  const [getServerError] = useLazyGetServerErrorQuery();
  const [getSlow] = useLazyGetSlowLoansQuery();
  const [getHang] = useLazyGetHangingRequestQuery();
  const [getBadJson] = useLazyGetBadJsonQuery();
  const [getMissing] = useLazyGetMissingLoanQuery();
  const [getExpired] = useLazyGetExpiredSessionQuery();
  const [getUnreachable] = useLazyGetUnreachableQuery();
  const [submitLoan] = useSubmitLoanMutation();

  return (
    <ScrollView contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="automatic">
      <Text style={styles.title}>Logging POC</Text>
      <View style={styles.statusBox}>
        <Text style={styles.status}>{status}</Text>
      </View>

      <Section title="API (base query wrapper)">
        <Button label="Load loans: success (nothing logged)" onPress={() => run('Load loans', () => getLoans().unwrap())} />
        <Button label="Server error 503 → error" onPress={() => run('Server error', () => getServerError().unwrap())} />
        <Button label="Slow request 3 s → warn" onPress={() => run('Slow', () => getSlow().unwrap())} />
        <Button label="Timeout 5 s → error" onPress={() => run('Timeout', () => getHang().unwrap())} />
        <Button label="Bad JSON → error" onPress={() => run('Bad JSON', () => getBadJson().unwrap())} />
        <Button label="Not found 404 → warn" onPress={() => run('Not found', () => getMissing().unwrap())} />
        <Button label="Session expired 401 → warn" onPress={() => run('Expired', () => getExpired().unwrap())} />
        <Button label="Network error → warn" onPress={() => run('Network', () => getUnreachable().unwrap())} />
        <Button label="Submit loan 422 → warn" onPress={() => run('Submit', () => submitLoan({ amount: 250000 }).unwrap())} />
      </Section>

      <Section title="Error boundary (feature: lending)">
        <AppErrorBoundary feature="lending" resetKeys={[resetKey]}>
          <LendingWidget crash={crash} onCrash={() => setCrash(true)} />
        </AppErrorBoundary>
        <Button
          label="Clear crash (changes resetKeys)"
          onPress={() => {
            setCrash(false);
            setResetKey((k) => k + 1);
            setStatus('Boundary reset');
          }}
        />
      </Section>

      <Section title="Captured automatically by Sentry">
        <Button
          label="Throw in onPress → issue with stack trace (red screen in debug)"
          onPress={() => {
            throw new TypeError('Pressed on loan 12345678901'); // message must NOT reach Sentry
          }}
        />
        <Button
          label="Unhandled promise rejection → issue"
          onPress={() => {
            Promise.reject(new RangeError('Rejected for customer 01019012345'));
            setStatus('Rejected a promise without catch (reported after a moment)');
          }}
        />
        <Button
          label="Native crash → closes the app; reported on next launch"
          onPress={() => Sentry.nativeCrash()}
        />
      </Section>

      <Section title="Manual logging">
        <Button
          label="Handled error → feature.operation.failed"
          onPress={() => {
            logger.error('feature.operation.failed', { feature: 'lending', errorCode: 'SUBMISSION_FAILED' });
            setStatus('Logged a handled error');
          }}
        />
        <Button
          label="Warning only → breadcrumb (no issue)"
          onPress={() => {
            logger.warn('api.request.slow', { endpoint: 'getLoans', durationMs: 3100 });
            setStatus('Added a breadcrumb: it shows on the next issue you trigger');
          }}
        />
        <Button
          label="Privacy test: send bad fields (should be dropped)"
          onPress={() => {
            logger.error('feature.operation.failed', {
              feature: 'lending', // kept
              errorCode: 'Card 4111 1111 1111 1111 declined', // free text: dropped
              endpoint: 'loan12345678901', // long digits: dropped
              // @ts-expect-error: not an allowed field, removed at runtime
              accountNumber: '12345678901',
            });
            setStatus('Sent bad fields: the Sentry issue should have only the feature tag');
          }}
        />
      </Section>
    </ScrollView>
  );
}

/** Lives inside the boundary, so both render crashes and showBoundary() reach it. */
function LendingWidget({ crash, onCrash }: { crash: boolean; onCrash: () => void }) {
  const showBoundary = useShowBoundary();

  if (crash) {
    throw new TypeError('Cannot read amount of loan 12345678901'); // message must NOT be sent
  }

  return (
    <View>
      <Text style={styles.widgetText}>Lending widget is healthy.</Text>
      <Button label="Render crash → ui.render.failed" onPress={onCrash} />
      <Button
        label="Async error → showBoundary → ui.render.failed"
        onPress={async () => {
          try {
            await new Promise((_, reject) => setTimeout(() => reject(new SyntaxError('Async fail')), 300));
          } catch (e) {
            showBoundary(e);
          }
        }}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 56, paddingBottom: 48, backgroundColor: '#f6f8fa' },
  title: { fontSize: 24, fontWeight: '700', color: '#1f2328', marginBottom: 12 },
  statusBox: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 16 },
  status: { color: '#1f2328' },
  section: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0b5cad', marginBottom: 8 },
  widgetText: { color: '#1a7f37', marginBottom: 4 },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#eef5fc',
    marginTop: 6,
  },
  buttonPressed: { opacity: 0.6 },
  buttonText: { color: '#0b5cad', fontWeight: '600' },
});
