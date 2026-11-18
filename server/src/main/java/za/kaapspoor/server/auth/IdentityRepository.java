package za.kaapspoor.server.auth;

import org.springframework.data.jpa.repository.JpaRepository;

public interface IdentityRepository extends JpaRepository<Identity, Identity.Key> {}
