package za.kaapspoor.server.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.UUID;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import za.kaapspoor.server.account.AppUser;

/**
 * Issues short-lived access JWTs and rotating opaque refresh tokens. A refresh token works once.
 * Presenting a used one more than {@link #REUSE_GRACE} after its first use is treated as theft and
 * revokes its whole family; within the grace window (two tabs refreshing at once) it is only refused.
 */
@Service
public class TokenService {

    static final Duration ACCESS_TTL = Duration.ofMinutes(15);
    static final Duration REFRESH_TTL = Duration.ofDays(60);
    static final Duration REUSE_GRACE = Duration.ofSeconds(10);
    private static final int REFRESH_BYTES = 32;

    private final JwtEncoder jwtEncoder;
    private final RefreshTokenRepository refreshTokens;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    TokenService(JwtEncoder jwtEncoder, RefreshTokenRepository refreshTokens, Clock clock) {
        this.jwtEncoder = jwtEncoder;
        this.refreshTokens = refreshTokens;
        this.clock = clock;
    }

    /** Starts a new token family for a fresh login. */
    @Transactional
    public TokenPair issue(AppUser user) {
        return issueInFamily(user, UUID.randomUUID(), clock.instant());
    }

    /**
     * Rotates {@code refreshToken} under a row lock. The family revocation on late reuse must
     * survive the exception that follows it, hence {@code noRollbackFor}.
     */
    @Transactional(noRollbackFor = InvalidTokenException.class)
    public TokenPair refresh(String refreshToken) {
        Instant now = clock.instant();
        RefreshToken token = refreshTokens.findByTokenHash(hash(refreshToken))
                .orElseThrow(InvalidTokenException::new);
        // A revoked sibling means the family is dead. Checking the family, not just this row, catches a
        // token minted concurrently with a revocation whose UPDATE could not see it (READ COMMITTED).
        if (token.getRevokedAt() != null
                || refreshTokens.existsByFamilyIdAndRevokedAtIsNotNull(token.getFamilyId())) {
            refreshTokens.revokeFamily(token.getFamilyId(), now);
            throw new InvalidTokenException();
        }
        if (token.getUsedAt() != null) {
            if (Duration.between(token.getUsedAt(), now).compareTo(REUSE_GRACE) > 0) {
                refreshTokens.revokeFamily(token.getFamilyId(), now);
            }
            throw new InvalidTokenException();
        }
        if (!now.isBefore(token.getExpiresAt())) {
            throw new InvalidTokenException();
        }
        token.markUsed(now);
        return issueInFamily(token.getUser(), token.getFamilyId(), now);
    }

    /** Ends the session (token family) the token belongs to. Unknown tokens are ignored. */
    @Transactional
    public void revoke(String refreshToken) {
        refreshTokens.findByTokenHash(hash(refreshToken))
                .ifPresent(token -> refreshTokens.revokeFamily(token.getFamilyId(), clock.instant()));
    }

    private TokenPair issueInFamily(AppUser user, UUID familyId, Instant now) {
        byte[] raw = new byte[REFRESH_BYTES];
        random.nextBytes(raw);
        String refreshToken = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        refreshTokens.save(new RefreshToken(user, familyId, hash(refreshToken), now, now.plus(REFRESH_TTL)));

        // JWT timestamps are whole seconds; truncate so accessExpiresAt equals the token's exp.
        Instant issuedAt = now.truncatedTo(ChronoUnit.SECONDS);
        Instant expiresAt = issuedAt.plus(ACCESS_TTL);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .subject(user.getId().toString())
                .claim("role", user.getRole().name())
                .issuedAt(issuedAt)
                .expiresAt(expiresAt)
                .build();
        String accessToken = jwtEncoder.encode(
                JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        return new TokenPair(accessToken, expiresAt, refreshToken);
    }

    private static byte[] hash(String token) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
