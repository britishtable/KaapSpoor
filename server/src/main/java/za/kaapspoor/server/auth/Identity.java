package za.kaapspoor.server.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/** Links a provider's subject (the stable "sub" claim) to a KaapSpoor user. */
@Entity
@Table(name = "identity")
public class Identity {

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

    protected Identity() {}

    public Identity(OidcProvider provider, String subject, UUID userId) {
        this.id = new Key(provider, subject);
        this.userId = userId;
    }

    public UUID getUserId() { return userId; }
}
