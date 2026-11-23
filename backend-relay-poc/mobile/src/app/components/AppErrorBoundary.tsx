/**
 * The one class component: React can only catch render errors in a class
 * (getDerivedStateFromError / componentDidCatch). Everything else stays functional.
 * In your monorepo: packages/app/src/components/AppErrorBoundary.tsx
 */
import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { logger } from '@poc/common';

type Props = {
  feature: string; // where the crash happened: 'app', 'lending', ...
  resetKeys?: unknown[]; // when any value changes, the boundary resets
  children: ReactNode;
};

type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  // 1. Render phase: switch to the fallback UI (must stay pure)
  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  // 2. Commit phase: report the error. Name only: never message, stack or componentStack.
  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    logger.error('ui.render.failed', {
      feature: this.props.feature,
      errorCode: 'RENDER_ERROR',
      errorName: error instanceof Error ? error.name : undefined,
    });
  }

  // 3. Automatic reset, e.g. when the user navigates to a new screen instance
  componentDidUpdate(prevProps: Props): void {
    if (this.state.hasError && hasChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ hasError: false });
    }
  }

  private reset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.subtitle}>Boundary: {this.props.feature}</Text>
        <Pressable onPress={this.reset} accessibilityRole="button" style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

function hasChanged(a: unknown[] = [], b: unknown[] = []): boolean {
  return a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 160,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff4f4',
    borderRadius: 12,
  },
  title: { fontSize: 17, fontWeight: '600', color: '#1f2328' },
  subtitle: { marginTop: 4, color: '#57606a' },
  button: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 24, minHeight: 44 },
  buttonText: { fontWeight: '600', color: '#0b5cad' },
});
