package com.yourorg.telemetry;

import com.yourorg.telemetry.TelemetryModels.AppInfo;
import com.yourorg.telemetry.TelemetryValidator.Accepted;
import com.yourorg.telemetry.TelemetryValidator.Rejected;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class TelemetryValidatorTest {

    private static final Instant NOW = Instant.parse("2026-11-23T12:00:00Z");
    private final TelemetryValidator validator = new TelemetryValidator(Clock.fixed(NOW, ZoneOffset.UTC));

    private static Map<String, Object> entry(Map<String, Object> context) {
        Map<String, Object> e = new HashMap<>();
        e.put("level", "error");
        e.put("event", "api.request.failed");
        e.put("timestamp", NOW.toEpochMilli());
        e.put("context", context);
        return e;
    }

    @Test
    void acceptsAValidApiFailure() {
        var result = validator.validate(entry(Map.of(
                "endpoint", "getServerError", "status", 503, "errorCode", "SERVER_ERROR", "durationMs", 42.4)));
        assertThat(result).isInstanceOf(Accepted.class);
        var event = ((Accepted) result).event();
        assertThat(event.status()).isEqualTo("503");
        assertThat(event.durationMs()).isEqualTo(42L);
        assertThat(event.endpoint()).isEqualTo("getServerError");
    }

    @Test
    void acceptsRtkStringStatuses() {
        var result = validator.validate(entry(Map.of("status", "FETCH_ERROR", "errorCode", "NETWORK_ERROR")));
        assertThat(result).isInstanceOf(Accepted.class);
    }

    @Test
    void rejectsUnknownContextField() {
        assertThat(validator.validate(entry(Map.of("accountNumber", "12345678901"))))
                .isEqualTo(new Rejected("unknown context field"));
    }

    @Test
    void rejectsUnknownEntryField() {
        var e = entry(Map.of());
        e.put("message", "Payment failed for Ola");
        assertThat(validator.validate(e)).isEqualTo(new Rejected("unknown entry field"));
    }

    @Test
    void rejectsFreeTextAndLongDigits() {
        assertThat(validator.validate(entry(Map.of("feature", "Card 4111 declined"))))
                .isEqualTo(new Rejected("unsafe text value"));
        assertThat(validator.validate(entry(Map.of("endpoint", "loan12345678901"))))
                .isEqualTo(new Rejected("unsafe text value"));
        assertThat(validator.validate(entry(Map.of("errorName", 42))))
                .isEqualTo(new Rejected("unsafe text value"));
    }

    @Test
    void rejectsUnknownEventLevelAndErrorCode() {
        var e = entry(Map.of());
        e.put("event", "user.typed.password");
        assertThat(validator.validate(e)).isEqualTo(new Rejected("unknown event"));

        var l = entry(Map.of());
        l.put("level", "fatal");
        assertThat(validator.validate(l)).isEqualTo(new Rejected("invalid level"));

        assertThat(validator.validate(entry(Map.of("errorCode", "SOMETHING_NEW"))))
                .isEqualTo(new Rejected("unknown errorCode"));
    }

    @Test
    void rejectsInvalidStatusAndDuration() {
        assertThat(validator.validate(entry(Map.of("status", 99)))).isEqualTo(new Rejected("invalid status"));
        assertThat(validator.validate(entry(Map.of("status", "OOPS")))).isEqualTo(new Rejected("invalid status"));
        assertThat(validator.validate(entry(Map.of("durationMs", -1)))).isEqualTo(new Rejected("invalid durationMs"));
    }

    @Test
    void rejectsTimestampsOutsideTheWindow() {
        var old = entry(Map.of());
        old.put("timestamp", NOW.minusSeconds(8 * 24 * 3600).toEpochMilli());
        assertThat(validator.validate(old)).isEqualTo(new Rejected("timestamp out of range"));

        var future = entry(Map.of());
        future.put("timestamp", NOW.plusSeconds(3600).toEpochMilli());
        assertThat(validator.validate(future)).isEqualTo(new Rejected("timestamp out of range"));
    }

    @Test
    void validatesTheAppBlock() {
        var ok = new AppInfo("0.1.0", "ios", "18.2", "local", "k3j9x2m1qa");
        assertThat(validator.validateApp(ok)).isEmpty();
        assertThat(validator.validateApp(new AppInfo("0.1.0", "windows", "11", "local", "k3j9x2m1qa")))
                .contains("invalid app.platform");
        assertThat(validator.validateApp(new AppInfo("0.1.0", "ios", "18.2", "local", "Ola Nordmann")))
                .contains("invalid app.sessionId");
        assertThat(validator.validateApp(null)).contains("missing app");
    }
}
