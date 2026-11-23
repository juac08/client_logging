package com.yourorg.telemetry;

import com.yourorg.telemetry.TelemetryModels.AppInfo;
import com.yourorg.telemetry.TelemetryModels.ClientEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Writes each validated client event as one log line through SLF4J, so it flows through
 * the SAME pipeline as your backend logs (console, files, Application Insights Java agent,
 * OpenTelemetry, ...). No Azure code here.
 *
 * Fields go into the MDC with a "client." prefix:
 *  - Application Insights Java agent: MDC entries become custom dimensions (Properties).
 *  - Spring Boot structured logging (logging.structured.format.console=ecs|logstash): JSON fields.
 *  - Plain text: add %X to the log pattern to see them.
 *
 * Use the logger name "client-telemetry" to filter these lines, or to keep client errors
 * out of backend alert rules.
 */
@Component
public class ClientEventLogger {

    static final String LOGGER_NAME = "client-telemetry";
    private static final Logger log = LoggerFactory.getLogger(LOGGER_NAME);

    public void log(AppInfo app, ClientEvent event) {
        Map<String, String> fields = new LinkedHashMap<>();
        put(fields, "client.event", event.event());
        put(fields, "client.level", event.level());
        put(fields, "client.timestamp", event.timestamp().toString());
        put(fields, "client.feature", event.feature());
        put(fields, "client.endpoint", event.endpoint());
        put(fields, "client.status", event.status());
        put(fields, "client.errorCode", event.errorCode());
        put(fields, "client.errorName", event.errorName());
        put(fields, "client.durationMs", event.durationMs() == null ? null : event.durationMs().toString());
        put(fields, "client.appVersion", app.version());
        put(fields, "client.platform", app.platform());
        put(fields, "client.osVersion", app.osVersion());
        put(fields, "client.environment", app.environment());
        put(fields, "client.sessionId", app.sessionId());

        // Only our own keys are added and removed; the request's existing MDC
        // (for example your backend's traceId) stays and is attached too.
        fields.forEach(MDC::put);
        try {
            String message = "client " + event.event();
            switch (event.level()) {
                case "error" -> log.error(message);
                case "warn" -> log.warn(message);
                default -> log.info(message);
            }
        } finally {
            fields.keySet().forEach(MDC::remove);
        }
    }

    private static void put(Map<String, String> fields, String key, String value) {
        if (value != null) fields.put(key, value);
    }
}
