package za.kaapspoor.server.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import za.kaapspoor.server.TestcontainersConfig;
import za.kaapspoor.server.account.AppUser;
import za.kaapspoor.server.account.AppUserRepository;

/**
 * The concurrent first sign-in retry relies on a second link for the same subject failing on the
 * primary key. An assigned id makes Spring Data merge instead of insert, which would silently re-point
 * the committed identity at the losing thread's new user.
 */
@SpringBootTest
@Import(TestcontainersConfig.class)
@ActiveProfiles("test")
class IdentityPersistenceTest {

    @Autowired AppUserRepository users;
    @Autowired IdentityRepository identities;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void clean() {
        jdbc.update("delete from refresh_token");
        jdbc.update("delete from identity");
        jdbc.update("delete from report_confirmation");
        jdbc.update("delete from report");
        jdbc.update("delete from hike");
        jdbc.update("delete from app_user");
    }

    private UUID newUser(String name) {
        return users.saveAndFlush(new AppUser(null, false, null, name, Instant.now())).getId();
    }

    @Test
    void linkingAnAlreadyLinkedSubjectFailsInsteadOfRepointingIt() {
        UUID first = newUser("First");
        UUID second = newUser("Second");
        identities.saveAndFlush(new Identity(OidcProvider.GOOGLE, "g-dup", first));

        assertThatThrownBy(() -> identities.saveAndFlush(new Identity(OidcProvider.GOOGLE, "g-dup", second)))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.queryForObject(
                        "select user_id from identity where subject = 'g-dup'", UUID.class))
                .isEqualTo(first);
    }
}
