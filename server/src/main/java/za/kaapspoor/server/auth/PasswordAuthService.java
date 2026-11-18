package za.kaapspoor.server.auth;

import java.time.Clock;
import java.util.Optional;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import za.kaapspoor.server.account.AppUser;
import za.kaapspoor.server.account.AppUserRepository;
import za.kaapspoor.server.account.DisplayNames;
import za.kaapspoor.server.account.Emails;

@Service
public class PasswordAuthService {

    /** Thrown for any failed login; the message never says which half was wrong. */
    public static class BadCredentialsException extends RuntimeException {
        public BadCredentialsException() {
            super("Email or password is incorrect");
        }
    }

    private final AppUserRepository users;
    private final TokenService tokens;
    private final Clock clock;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
    /** Checked against when the email is unknown, so unknown and wrong-password take similar time. */
    private final String dummyHash = encoder.encode("not-a-real-password");

    PasswordAuthService(AppUserRepository users, TokenService tokens, Clock clock) {
        this.users = users;
        this.tokens = tokens;
        this.clock = clock;
    }

    /** A duplicate email surfaces as DataIntegrityViolationException (mapped to 409) from the unique index. */
    public TokenPair register(AuthRequests.Register request) {
        String displayName = DisplayNames.validate(request.displayName());
        AppUser user = users.saveAndFlush(new AppUser(
                Emails.normalise(request.email()),
                false,
                encoder.encode(request.password()),
                displayName,
                clock.instant()));
        return tokens.issue(user);
    }

    public TokenPair login(AuthRequests.Login request) {
        Optional<AppUser> found = users.findByEmailAndDeletedAtIsNull(Emails.normalise(request.email()));
        String hash = found.map(AppUser::getPasswordHash).orElse(null);
        boolean matches = encoder.matches(request.password(), hash != null ? hash : dummyHash);
        if (found.isEmpty() || hash == null || !matches) {
            throw new BadCredentialsException();
        }
        return tokens.issue(found.get());
    }
}
