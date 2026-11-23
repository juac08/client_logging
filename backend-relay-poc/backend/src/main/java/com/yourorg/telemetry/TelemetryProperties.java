package com.yourorg.telemetry;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * application.yml:
 *
 * <pre>
 * telemetry:
 *   enabled: true                       # kill switch: false = accept and drop everything
 *   max-entries-per-batch: 50
 *   max-body-bytes: 32768
 *   batches-per-minute-per-session: 30
 *   batches-per-minute-per-ip: 300
 * </pre>
 */
@ConfigurationProperties(prefix = "telemetry")
public record TelemetryProperties(
        @DefaultValue("true") boolean enabled,
        @DefaultValue("50") int maxEntriesPerBatch,
        @DefaultValue("32768") long maxBodyBytes,
        @DefaultValue("30") int batchesPerMinutePerSession,
        @DefaultValue("300") int batchesPerMinutePerIp) {}
