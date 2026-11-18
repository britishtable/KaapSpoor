package za.kaapspoor.server.auth;

import java.time.Instant;

public record TokenPair(String accessToken, Instant accessExpiresAt, String refreshToken) {

    /** Never prints token values, so an accidental log line cannot leak credentials. */
    @Override
    public String toString() {
        return "TokenPair[accessExpiresAt=" + accessExpiresAt + ", tokens=<redacted>]";
    }
}
