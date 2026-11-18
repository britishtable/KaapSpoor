package za.kaapspoor.server.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/**
 * Links a provider's subject (the stable "sub" claim) to a KaapSpoor user.
 *
 * <p>The id is assigned, so without {@link Persistable} Spring Data would merge a new instance. A merge
 * of an already-linked subject silently re-points it at another user; an insert fails on the primary
 * key, which is what the concurrent first sign-in retry in {@code OidcAuthService} relies on.
 */
@Entity
@Table(name = "identity")
public class Identity implements Persistable<Identity.Key> {

    @Embeddable
    public static class Key implements Serializable {

        @Enumerated(EnumType.STRING)
        @Column(nullable = false)
        private OidcProvider provider;

        @Column(nullable = false)
        private String subject;

        protected Key() {}

        public Key(OidcProvider provider, String subject) {
            this.provider = provider;
            this.subject = subject;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Key k && provider == k.provider && Objects.equals(subject, k.subject);
        }

        @Override
        public int hashCode() {
            return Objects.hash(provider, subject);
        }
    }

    @EmbeddedId
    private Key id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Transient
    private boolean isNew = true;

    protected Identity() {}

    public Identity(OidcProvider provider, String subject, UUID userId) {
        this.id = new Key(provider, subject);
        this.userId = userId;
    }

    @PostLoad
    @PostPersist
    void markNotNew() {
        this.isNew = false;
    }

    @Override
    public Key getId() { return id; }

    @Override
    public boolean isNew() { return isNew; }

    public UUID getUserId() { return userId; }
}
