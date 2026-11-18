package za.kaapspoor.server.auth;

import java.time.Instant;

public record TokenPair(String accessToken, Instant accessExpiresAt, String refreshToken) {}
