package za.kaapspoor.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ProblemDetail;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import za.kaapspoor.server.TestcontainersConfig;
import za.kaapspoor.server.account.AppUser;
import za.kaapspoor.server.account.AppUserRepository;
import za.kaapspoor.server.auth.Identity;
import za.kaapspoor.server.auth.IdentityRepository;
import za.kaapspoor.server.auth.OidcProvider;

/** Feeds real Postgres constraint violations to the handler: only the email index is a 409. */
@SpringBootTest
@Import(TestcontainersConfig.class)
@ActiveProfiles("test")
class ProblemHandlersTest {

    @Autowired ProblemHandlers handlers;
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

    @Test
    void duplicateEmailIs409() {
        users.saveAndFlush(new AppUser("sam@example.com", false, null, "Sam", Instant.now()));
        DataIntegrityViolationException e = catchThrowableOfType(DataIntegrityViolationException.class,
                () -> users.saveAndFlush(new AppUser("sam@example.com", false, null, "Other", Instant.now())));
        ProblemDetail problem = handlers.dataIntegrity(e);
        assertThat(problem.getStatus()).isEqualTo(409);
        assertThat(problem.getDetail()).isEqualTo("An account with this email already exists");
    }

    @Test
    void otherViolationIsNotReportedAsDuplicateEmail() {
        DataIntegrityViolationException e = catchThrowableOfType(DataIntegrityViolationException.class,
                () -> identities.saveAndFlush(new Identity(OidcProvider.GOOGLE, "g-1", UUID.randomUUID())));
        ProblemDetail problem = handlers.dataIntegrity(e);
        assertThat(problem.getStatus()).isEqualTo(500);
        assertThat(problem.getDetail()).doesNotContain("email");
    }
}
