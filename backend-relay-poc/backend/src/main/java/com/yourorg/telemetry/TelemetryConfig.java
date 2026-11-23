package com.yourorg.telemetry;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.Duration;

/** Wires the plain-Java pieces into Spring. Copy the whole package into your backend. */
@Configuration
@EnableConfigurationProperties(TelemetryProperties.class)
public class TelemetryConfig {

    @Bean
    TelemetryValidator telemetryValidator() {
        return new TelemetryValidator(Clock.systemUTC());
    }

    @Bean
    TelemetryLimiters telemetryLimiters(TelemetryProperties props) {
        Clock clock = Clock.systemUTC();
        return new TelemetryLimiters(
                new TelemetryRateLimiter(props.batchesPerMinutePerSession(), Duration.ofMinutes(1), clock),
                new TelemetryRateLimiter(props.batchesPerMinutePerIp(), Duration.ofMinutes(1), clock));
    }

    /** Two limiters: per app session (normal use) and per IP (sessions are client-chosen). */
    public record TelemetryLimiters(TelemetryRateLimiter perSession, TelemetryRateLimiter perIp) {}
}
