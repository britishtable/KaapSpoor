package za.kaapspoor.server.account;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppUserRepository extends JpaRepository<AppUser, UUID> {

    /** Email must already be normalised; soft-deleted users are excluded. */
    Optional<AppUser> findByEmailAndDeletedAtIsNull(String email);
}
