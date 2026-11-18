package za.kaapspoor.server.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import za.kaapspoor.server.TestcontainersConfig;
import za.kaapspoor.server.account.AppUser;
import za.kaapspoor.server.account.AppUserRepository;

@SpringBootTest
@Import({TestcontainersConfig.class, TokenServiceTest.TestClockConfig.class})
@ActiveProfiles("test")
class TokenServiceTest {

    @Autowired TokenService tokens;
    @Autowired AppUserRepository users;
    @Autowired JwtDecoder decoder;
    @Autowired MutableClock clock;
    @Autowired JdbcTemplate jdbc;

    private AppUser user;

    @BeforeEach
    void setUp() {
        jdbc.update("delete from refresh_token");
        jdbc.update("delete from hike");
        jdbc.update("delete from app_user");
        // Whole seconds, because JWT timestamps are whole seconds.
        clock.set(Instant.now().truncatedTo(ChronoUnit.SECONDS));
        user = users.save(new AppUser("sam@example.com", false, null, "Sam", clock.instant()));
    }

    @Test
    void issuedAccessTokenDecodesWithSubAndRole() {
        Instant issuedAt = clock.instant();
        TokenPair pair = tokens.issue(user);

        var jwt = decoder.decode(pair.accessToken());
        assertThat(jwt.getSubject()).isEqualTo(user.getId().toString());
        assertThat(jwt.getClaimAsString("role")).isEqualTo("USER");
        assertThat(jwt.getExpiresAt()).isEqualTo(issuedAt.plus(Duration.ofMinutes(15)));
        assertThat(pair.accessExpiresAt()).isEqualTo(jwt.getExpiresAt());
    }

    @Test
    void refreshRotates() {
        String r1 = tokens.issue(user).refreshToken();

        String r2 = tokens.refresh(r1).refreshToken();
        assertThat(r2).isNotEqualTo(r1);

        clock.advance(Duration.ofSeconds(11));
        assertThatThrownBy(() -> tokens.refresh(r1)).isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void reuseAfterGraceRevokesFamily() {
        String r1 = tokens.issue(user).refreshToken();
        String r2 = tokens.refresh(r1).refreshToken();

        clock.advance(Duration.ofSeconds(11));
        assertThatThrownBy(() -> tokens.refresh(r1)).isInstanceOf(InvalidTokenException.class);

        assertThatThrownBy(() -> tokens.refresh(r2)).isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void reuseWithinGraceDoesNotRevokeFamily() {
        String r1 = tokens.issue(user).refreshToken();
        String r2 = tokens.refresh(r1).refreshToken();

        clock.advance(Duration.ofSeconds(5));
        assertThatThrownBy(() -> tokens.refresh(r1)).isInstanceOf(InvalidTokenException.class);

        TokenPair next = tokens.refresh(r2);
        assertThat(next.refreshToken()).isNotEqualTo(r2);
    }

    @Test
    void tokenMissedByFamilyRevocationIsStillRejected() {
        String r1 = tokens.issue(user).refreshToken();
        String r2 = tokens.refresh(r1).refreshToken();
        // As if a revocation's UPDATE revoked r1 but never saw r2 (minted concurrently, uncommitted).
        jdbc.update("update refresh_token set revoked_at = now() where used_at is not null");

        assertThatThrownBy(() -> tokens.refresh(r2)).isInstanceOf(InvalidTokenException.class);
        assertThat(jdbc.queryForObject(
                "select count(*) from refresh_token where revoked_at is null", Integer.class)).isZero();
    }

    @Test
    void expiredRefreshTokenRejected() {
        String r1 = tokens.issue(user).refreshToken();

        clock.advance(Duration.ofDays(60).plusSeconds(1));
        assertThatThrownBy(() -> tokens.refresh(r1)).isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void shortSecretFailsStartup() {
        assertThatThrownBy(() -> new JwtConfig().jwtEncoder("c2hvcnQ="))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("kaapspoor.jwt-secret must be at least 32 bytes");
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class TestClockConfig {
        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock();
        }
    }

    static final class MutableClock extends Clock {
        private volatile Instant now = Instant.now();

        void set(Instant instant) { now = instant; }
        void advance(Duration by) { now = now.plus(by); }

        @Override public Instant instant() { return now; }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
    }
}
