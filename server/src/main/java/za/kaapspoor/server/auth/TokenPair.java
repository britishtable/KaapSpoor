package za.kaapspoor.server.auth;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;

public record TokenPair(
        @Schema(requiredMode = REQUIRED) String accessToken,
        @Schema(requiredMode = REQUIRED) Instant accessExpiresAt,
        @Schema(requiredMode = REQUIRED) String refreshToken) {

    /** Never prints token values, so an accidental log line cannot leak credentials. */
    @Override
    public String toString() {
        return "TokenPair[accessExpiresAt=" + accessExpiresAt + ", tokens=<redacted>]";
    }
}
