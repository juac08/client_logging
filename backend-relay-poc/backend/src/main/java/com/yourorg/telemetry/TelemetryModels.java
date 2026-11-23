package com.yourorg.telemetry;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Wire format sent by the app's HTTP sink:
 *
 * <pre>
 * {
 *   "schemaVersion": 1,
 *   "app": { "version": "0.1.0", "platform": "ios", "osVersion": "18.2",
 *            "environment": "local", "sessionId": "k3j9x2m1qa" },
 *   "entries": [
 *     { "level": "error", "event": "api.request.failed", "timestamp": 1764000000000,
 *       "context": { "endpoint": "getServerError", "status": 503,
 *                    "errorCode": "SERVER_ERROR", "durationMs": 42 } }
 *   ]
 * }
 * </pre>
 *
 * Entries are kept as raw maps on purpose: the validator checks every field and
 * rejects anything unknown, instead of Jackson silently ignoring extra fields.
 */
public final class TelemetryModels {

    private TelemetryModels() {}

    public record TelemetryBatch(Integer schemaVersion, AppInfo app, List<Map<String, Object>> entries) {}

    public record AppInfo(String version, String platform, String osVersion, String environment, String sessionId) {}

    /** A validated, safe event. Only these fields ever reach the logs. */
    public record ClientEvent(
            String level,
            String event,
            Instant timestamp,
            String feature,
            String endpoint,
            String status,
            String errorCode,
            String errorName,
            Long durationMs) {}

    public record TelemetryResponse(int accepted, int rejected) {}

    public record ErrorResponse(String error) {}
}
