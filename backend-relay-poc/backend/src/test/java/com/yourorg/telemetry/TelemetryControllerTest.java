package com.yourorg.telemetry;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(TelemetryController.class)
@Import({TelemetryConfig.class, ClientEventLogger.class}) // the size filter is picked up by @WebMvcTest
@ExtendWith(OutputCaptureExtension.class)
class TelemetryControllerTest {

    @Autowired MockMvc mvc;

    private static String batch(String entries) {
        return """
            {"schemaVersion":1,
             "app":{"version":"0.1.0","platform":"ios","osVersion":"18.2","environment":"local","sessionId":"%s"},
             "entries":[%s]}
            """.formatted("s" + System.nanoTime() % 1_000_000_000L, entries);
    }

    private static String entry(String level, String event, String context) {
        return """
            {"level":"%s","event":"%s","timestamp":%d,"context":%s}
            """.formatted(level, event, System.currentTimeMillis(), context);
    }

    @Test
    void acceptsValidEntriesAndLogsThemWithClientFields(CapturedOutput output) throws Exception {
        var body = batch(entry("error", "api.request.failed",
                "{\"endpoint\":\"getServerError\",\"status\":503,\"errorCode\":\"SERVER_ERROR\",\"durationMs\":42}"));

        mvc.perform(post("/telemetry/v1/batch").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.accepted").value(1))
                .andExpect(jsonPath("$.rejected").value(0));

        assertThat(output).contains("client api.request.failed")
                .contains("client.endpoint=getServerError")
                .contains("client.errorCode=SERVER_ERROR");
    }

    @Test
    void dropsUnsafeEntriesWithoutLoggingTheirValues(CapturedOutput output) throws Exception {
        var body = batch(String.join(",",
                entry("info", "app.started", "{}"),
                entry("error", "feature.operation.failed", "{\"feature\":\"lending\",\"accountNumber\":\"12345678901\"}"),
                entry("error", "feature.operation.failed", "{\"errorCode\":\"Card 4111 1111 declined\"}")));

        mvc.perform(post("/telemetry/v1/batch").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.accepted").value(1))
                .andExpect(jsonPath("$.rejected").value(2));

        assertThat(output).contains("Dropped 2 client telemetry entries")
                .doesNotContain("12345678901")
                .doesNotContain("4111");
    }

    @Test
    void refusesInvalidBatches() throws Exception {
        mvc.perform(post("/telemetry/v1/batch").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"schemaVersion\":2,\"app\":null,\"entries\":[]}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/telemetry/v1/batch").contentType(MediaType.APPLICATION_JSON).content("not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("malformed JSON"));
    }

    @Test
    void refusesOversizedBodies() throws Exception {
        var huge = "x".repeat(40_000);
        mvc.perform(post("/telemetry/v1/batch").contentType(MediaType.APPLICATION_JSON).content(huge))
                .andExpect(status().isPayloadTooLarge());
    }

    @Test
    void rateLimitsPerSession() throws Exception {
        var body = batch(entry("info", "app.started", "{}")); // same sessionId every time
        for (int i = 0; i < 30; i++) {
            mvc.perform(post("/telemetry/v1/batch").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isAccepted());
        }
        mvc.perform(post("/telemetry/v1/batch").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isTooManyRequests());
    }
}
