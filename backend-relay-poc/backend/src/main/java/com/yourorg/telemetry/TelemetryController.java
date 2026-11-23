package com.yourorg.telemetry;

import com.yourorg.telemetry.TelemetryConfig.TelemetryLimiters;
import com.yourorg.telemetry.TelemetryModels.ErrorResponse;
import com.yourorg.telemetry.TelemetryModels.TelemetryBatch;
import com.yourorg.telemetry.TelemetryModels.TelemetryResponse;
import com.yourorg.telemetry.TelemetryValidator.Accepted;
import com.yourorg.telemetry.TelemetryValidator.Rejected;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

/**
 * POST /telemetry/v1/batch — receives batches from the app's HTTP sink.
 *
 * Responses (the app's sink relies on these):
 *  202 accepted (some entries may have been dropped by validation; counts in the body)
 *  400 invalid batch (wrong schema, invalid app block, too many entries): the app drops it
 *  413 / 411 body too large / length unknown (TelemetryRequestSizeFilter): the app drops it
 *  429 rate limited: the app keeps the batch and retries later
 */
@RestController
@RequestMapping(TelemetryController.BASE_PATH)
public class TelemetryController {

    static final String BASE_PATH = "/telemetry/v1";
    private static final Logger log = LoggerFactory.getLogger(TelemetryController.class);

    private final TelemetryProperties props;
    private final TelemetryValidator validator;
    private final TelemetryLimiters limiters;
    private final ClientEventLogger eventLogger;

    public TelemetryController(
            TelemetryProperties props,
            TelemetryValidator validator,
            TelemetryLimiters limiters,
            ClientEventLogger eventLogger) {
        this.props = props;
        this.validator = validator;
        this.limiters = limiters;
        this.eventLogger = eventLogger;
    }

    @PostMapping(path = "/batch", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> ingest(@RequestBody TelemetryBatch batch, HttpServletRequest request) {
        // Kill switch: answer 202 so apps don't retry, but keep nothing
        if (!props.enabled()) return ResponseEntity.accepted().body(new TelemetryResponse(0, 0));

        if (batch == null || !Integer.valueOf(1).equals(batch.schemaVersion())) {
            return badRequest("unsupported schemaVersion");
        }
        Optional<String> appProblem = validator.validateApp(batch.app());
        if (appProblem.isPresent()) return badRequest(appProblem.get());
        if (batch.entries() == null || batch.entries().isEmpty()) return badRequest("no entries");
        if (batch.entries().size() > props.maxEntriesPerBatch()) return badRequest("too many entries");

        if (!limiters.perSession().tryAcquire(batch.app().sessionId())
                || !limiters.perIp().tryAcquire(request.getRemoteAddr())) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .header("Retry-After", "60")
                    .body(new ErrorResponse("rate limited"));
        }

        int accepted = 0;
        Map<String, Integer> rejectedByReason = new TreeMap<>();
        for (Map<String, Object> entry : batch.entries()) {
            switch (validator.validate(entry)) {
                case Accepted a -> {
                    eventLogger.log(batch.app(), a.event());
                    accepted++;
                }
                case Rejected r -> rejectedByReason.merge(r.reason(), 1, Integer::sum);
            }
        }

        int rejected = rejectedByReason.values().stream().mapToInt(Integer::intValue).sum();
        if (rejected > 0) {
            // Reasons only (never values): useful to spot a client bug or a probe
            log.warn("Dropped {} client telemetry entries: {}", rejected, rejectedByReason);
        }
        return ResponseEntity.accepted().body(new TelemetryResponse(accepted, rejected));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ErrorResponse> malformed() {
        return badRequest("malformed JSON");
    }

    private static ResponseEntity<ErrorResponse> badRequest(String reason) {
        return ResponseEntity.badRequest().body(new ErrorResponse(reason));
    }
}
