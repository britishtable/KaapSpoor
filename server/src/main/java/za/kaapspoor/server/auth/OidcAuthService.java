package za.kaapspoor.server.auth;

import java.time.Clock;
import java.util.Optional;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import za.kaapspoor.server.account.AppUser;
import za.kaapspoor.server.account.AppUserRepository;
import za.kaapspoor.server.account.DisplayNames;
import za.kaapspoor.server.account.Emails;

/** Signs in with a Google or Apple ID token, finding, linking or creating the KaapSpoor user. */
@Service
public class OidcAuthService {

    static final String FALLBACK_NAME = "Hiker";

    /** {@code created} is true when this sign-in made a new user (201 rather than 200). */
    public record SignIn(TokenPair tokens, boolean created) {}

    private final IdTokenVerifier verifier;
    private final AppUserRepository users;
    private final IdentityRepository identities;
    private final TokenService tokens;
    private final Clock clock;
    private final TransactionTemplate tx;

    OidcAuthService(IdTokenVerifier verifier, AppUserRepository users, IdentityRepository identities,
            TokenService tokens, Clock clock, PlatformTransactionManager transactionManager) {
        this.verifier = verifier;
        this.users = users;
        this.identities = identities;
        this.tokens = tokens;
        this.clock = clock;
        this.tx = new TransactionTemplate(transactionManager);
    }

    public SignIn signIn(AuthRequests.Oidc request) {
        VerifiedIdentity identity = verifier.verify(request.provider(), request.idToken());
        try {
            return tx.execute(status -> resolve(identity, request.displayName()));
        } catch (DataIntegrityViolationException raced) {
            // A concurrent first sign-in for the same subject (or verified email) committed first. Its
            // rows are visible to a fresh transaction, so one retry resolves to that user. Any other
            // violation fails the same way again and propagates.
            return tx.execute(status -> resolve(identity, request.displayName()));
        }
    }

    private SignIn resolve(VerifiedIdentity identity, String requestedName) {
        Optional<Identity> existing = identities.findById(new Identity.Key(identity.provider(), identity.subject()));
        if (existing.isPresent()) {
            AppUser user = users.findById(existing.get().getUserId()).orElseThrow();
            return new SignIn(tokens.issue(user), false);
        }

        String email = identity.email() == null ? null : Emails.normalise(identity.email());
        if (identity.emailVerified() && email != null) {
            Optional<AppUser> owner = users.findByEmailAndDeletedAtIsNull(email);
            if (owner.isPresent()) {
                AppUser user = owner.get();
                if (!user.isEmailVerified()) {
                    // Whoever registered this email never proved it; they may not be the person now
                    // proving it. Lock their credentials out before handing the account over.
                    user.claimEmailByVerifiedOwner();
                    tokens.revokeAllForUser(user.getId());
                }
                link(identity, user);
                return new SignIn(tokens.issue(user), false);
            }
        }

        boolean storeEmail = identity.emailVerified() && email != null && !users.existsByEmail(email);
        AppUser user = users.saveAndFlush(new AppUser(
                storeEmail ? email : null,
                storeEmail,
                null,
                displayName(identity.name(), requestedName),
                clock.instant()));
        link(identity, user);
        return new SignIn(tokens.issue(user), true);
    }

    private void link(VerifiedIdentity identity, AppUser user) {
        identities.saveAndFlush(new Identity(identity.provider(), identity.subject(), user.getId()));
    }

    /** The first usable of the token's name, the request's name, then {@link #FALLBACK_NAME}. */
    private static String displayName(String tokenName, String requestedName) {
        for (String candidate : new String[] {tokenName, requestedName}) {
            try {
                return DisplayNames.validate(candidate);
            } catch (IllegalArgumentException unusable) {
                // try the next one
            }
        }
        return FALLBACK_NAME;
    }
}
