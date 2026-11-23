/**
 * Catches render crashes, shows a fallback instead of a blank screen, and logs them.
 * The one class component: React can only catch render errors in a class.
 *
 *   <AppErrorBoundary feature="app">...</AppErrorBoundary>                       // outermost
 *   <AppErrorBoundary feature="lending" resetKeys={[route.key]}>...</AppErrorBoundary>
 */
import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { logger } from '@your-org/common';

type Props = {
  feature: string;
  children: ReactNode;
  /** When any value changes, the boundary resets (e.g. the route key). */
  resetKeys?: unknown[];
  /** Custom fallback; must not depend on providers that may have crashed. */
  renderFallback?: (reset: () => void) => ReactNode;
};

type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    // The logger extracts error.name only; message and componentStack are never sent
    logger.error(
      'ui.render.failed',
      { feature: this.props.feature, source: 'boundary', errorCode: 'RENDER_ERROR' },
      error,
    );
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.hasError && changed(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ hasError: false });
    }
  }

  private reset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.renderFallback) return this.props.renderFallback(this.reset);
    return (
      <View style={styles.container} accessibilityRole="alert">
        {/* Replace with your i18n keys and provider-free design-system components */}
        <Text style={styles.title}>Something went wrong</Text>
        <Pressable onPress={this.reset} accessibilityRole="button" style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

function changed(a: unknown[] = [], b: unknown[] = []): boolean {
  return a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { fontSize: 17, fontWeight: '600' },
  button: { marginTop: 16, minHeight: 44, paddingHorizontal: 24, justifyContent: 'center' },
  buttonText: { fontWeight: '600' },
});
