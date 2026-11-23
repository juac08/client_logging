package com.yourorg.telemetry;

import com.yourorg.telemetry.TelemetryModels.AppInfo;
import com.yourorg.telemetry.TelemetryModels.ClientEvent;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Server-side allowlist for client telemetry. Plain Java (no Spring), so it is easy to test.
 *
 * The app already sanitizes events, but the server never trusts the client: anyone can
 * call this endpoint. Every field is checked here; an entry with an unknown field or an
 * unsafe value is rejected as a whole, so nothing unexpected can reach the logs.
 */
public final class TelemetryValidator {

    public static final Set<String> LEVELS = Set.of("info", "warn", "error");

    public static final Set<String> EVENTS = Set.of(
            "app.started",
            "api.request.failed",
            "api.request.slow",
            "ui.render.failed",
            "app.js.error",
            "feature.operation.failed");

    public static final Set<String> ERROR_CODES = Set.of(
            "NETWORK_ERROR", "TIMEOUT", "PARSING_ERROR", "SERVER_ERROR", "UNAUTHORIZED",
            "CLIENT_ERROR", "UNKNOWN_ERROR", "UNEXPECTED_THROW", "RENDER_ERROR",
            "JS_FATAL", "JS_NON_FATAL", "UNHANDLED_REJECTION", "SUBMISSION_FAILED");

    public static final Set<String> PLATFORMS = Set.of("ios", "android");

    private static final Set<String> ENTRY_KEYS = Set.of("level", "event", "timestamp", "context");
    private static final Set<String> CONTEXT_KEYS =
            Set.of("feature", "endpoint", "status", "errorCode", "errorName", "durationMs");
    private static final Set<String> STATUS_STRINGS =
            Set.of("FETCH_ERROR", "TIMEOUT_ERROR", "PARSING_ERROR", "CUSTOM_ERROR");

    private static final Pattern SAFE_TEXT = Pattern.compile("^[A-Za-z0-9_.-]{1,64}$");
    private static final Pattern LONG_DIGITS = Pattern.compile("\\d{6,}");
    private static final Pattern VERSION = Pattern.compile("^[0-9A-Za-z.+_-]{1,32}$");
    private static final Pattern SESSION_ID = Pattern.compile("^[a-z0-9]{6,32}$");
    private static final Pattern ENVIRONMENT = Pattern.compile("^[a-z]{1,16}$");

    private static final Duration MAX_AGE = Duration.ofDays(7); // offline queue limit
    private static final Duration MAX_CLOCK_SKEW = Duration.ofMinutes(5);
    private static final long MAX_DURATION_MS = 10 * 60 * 1000;

    private final Clock clock;

    public TelemetryValidator(Clock clock) {
        this.clock = clock;
    }

    public sealed interface Result permits Accepted, Rejected {}

    public record Accepted(ClientEvent event) implements Result {}

    /** The reason names the rule, never the offending value (it may be personal data). */
    public record Rejected(String reason) implements Result {}

    /** Returns a reason if the app block is invalid; the whole batch is then refused. */
    public Optional<String> validateApp(AppInfo app) {
        if (app == null) return Optional.of("missing app");
        if (!matches(VERSION, app.version())) return Optional.of("invalid app.version");
        if (app.platform() == null || !PLATFORMS.contains(app.platform())) return Optional.of("invalid app.platform");
        if (!matches(VERSION, app.osVersion())) return Optional.of("invalid app.osVersion");
        if (!matches(ENVIRONMENT, app.environment())) return Optional.of("invalid app.environment");
        if (!matches(SESSION_ID, app.sessionId())) return Optional.of("invalid app.sessionId");
        return Optional.empty();
    }

    public Result validate(Map<String, Object> entry) {
        if (entry == null) return new Rejected("null entry");
        for (String key : entry.keySet()) {
            if (!ENTRY_KEYS.contains(key)) return new Rejected("unknown entry field");
        }

        if (!(entry.get("level") instanceof String level) || !LEVELS.contains(level)) {
            return new Rejected("invalid level");
        }
        if (!(entry.get("event") instanceof String event) || !EVENTS.contains(event)) {
            return new Rejected("unknown event");
        }
        if (!(entry.get("timestamp") instanceof Number ts)) return new Rejected("invalid timestamp");
        Instant timestamp = Instant.ofEpochMilli(ts.longValue());
        Instant now = clock.instant();
        if (timestamp.isBefore(now.minus(MAX_AGE)) || timestamp.isAfter(now.plus(MAX_CLOCK_SKEW))) {
            return new Rejected("timestamp out of range");
        }

        Object rawContext = entry.get("context");
        Map<?, ?> context = rawContext == null ? Map.of() : rawContext instanceof Map<?, ?> m ? m : null;
        if (context == null) return new Rejected("invalid context");
        for (Object key : context.keySet()) {
            if (!(key instanceof String k) || !CONTEXT_KEYS.contains(k)) return new Rejected("unknown context field");
        }

        Object rawFeature = context.get("feature");
        Object rawEndpoint = context.get("endpoint");
        Object rawErrorName = context.get("errorName");
        if (isUnsafeText(rawFeature) || isUnsafeText(rawEndpoint) || isUnsafeText(rawErrorName)) {
            return new Rejected("unsafe text value");
        }
        String feature = (String) rawFeature;
        String endpoint = (String) rawEndpoint;
        String errorName = (String) rawErrorName;

        Object rawCode = context.get("errorCode");
        String errorCode = null;
        if (rawCode != null) {
            if (!(rawCode instanceof String code) || !ERROR_CODES.contains(code)) return new Rejected("unknown errorCode");
            errorCode = code;
        }

        Object rawStatus = context.get("status");
        String status = null;
        if (rawStatus instanceof Number n) {
            int code = n.intValue();
            if (n.doubleValue() != code || code < 100 || code > 599) return new Rejected("invalid status");
            status = Integer.toString(code);
        } else if (rawStatus instanceof String s) {
            if (!STATUS_STRINGS.contains(s)) return new Rejected("invalid status");
            status = s;
        } else if (rawStatus != null) {
            return new Rejected("invalid status");
        }

        Object rawDuration = context.get("durationMs");
        Long durationMs = null;
        if (rawDuration != null) {
            if (!(rawDuration instanceof Number d) || d.doubleValue() < 0 || d.doubleValue() > MAX_DURATION_MS) {
                return new Rejected("invalid durationMs");
            }
            durationMs = Math.round(d.doubleValue());
        }

        return new Accepted(new ClientEvent(
                level, event, timestamp, feature, endpoint, status, errorCode, errorName, durationMs));
    }

    /** Absent is fine; present must be a short identifier with no long digit runs. */
    private static boolean isUnsafeText(Object value) {
        if (value == null) return false;
        if (!(value instanceof String s)) return true;
        return !SAFE_TEXT.matcher(s).matches() || LONG_DIGITS.matcher(s).find();
    }

    private static boolean matches(Pattern pattern, String value) {
        return value != null && pattern.matcher(value).matches();
    }
}
