package com.yourorg.telemetry;

import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Simple in-memory fixed-window rate limiter (plain Java, no dependencies).
 *
 * Good enough for a POC and a single instance. With several backend instances, use
 * your API gateway's rate limiting or a shared store (for example Bucket4j with Redis),
 * because each instance here counts on its own.
 */
public final class TelemetryRateLimiter {

    private static final int MAX_TRACKED_KEYS = 100_000;

    private final int limit;
    private final long windowMs;
    private final Clock clock;
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    private record Window(long start, AtomicInteger count) {}

    public TelemetryRateLimiter(int limit, Duration window, Clock clock) {
        this.limit = limit;
        this.windowMs = window.toMillis();
        this.clock = clock;
    }

    /** Returns true if the call is allowed for this key in the current window. */
    public boolean tryAcquire(String key) {
        if (key == null) key = "unknown";
        long now = clock.millis();
        Window window = windows.compute(key, (k, current) ->
                current == null || now - current.start() >= windowMs ? new Window(now, new AtomicInteger()) : current);
        boolean allowed = window.count().incrementAndGet() <= limit;
        if (windows.size() > MAX_TRACKED_KEYS) {
            windows.entrySet().removeIf(e -> now - e.getValue().start() >= windowMs); // bounded memory
        }
        return allowed;
    }
}
