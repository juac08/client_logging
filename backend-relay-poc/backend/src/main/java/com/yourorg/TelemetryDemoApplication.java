package com.yourorg;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Stand-in for YOUR backend, only for running the POC locally.
 * In your real backend you don't need this class: copy the com.yourorg.telemetry
 * package into a package your existing @SpringBootApplication already scans.
 */
@SpringBootApplication
public class TelemetryDemoApplication {
    public static void main(String[] args) {
        SpringApplication.run(TelemetryDemoApplication.class, args);
    }
}
