package za.kaapspoor.server.account;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "app_user")
public class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    /** Normalised (trimmed, lower-cased) by the caller; null when unknown. */
    private String email;

    @Column(name = "email_verified", nullable = false)
    private boolean emailVerified;

    @Column(name = "password_hash")
    private String passwordHash;

    @Column(name = "display_name", nullable = false)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role = Role.USER;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    protected AppUser() {}

    public AppUser(String email, boolean emailVerified, String passwordHash, String displayName, Instant createdAt) {
        this.email = email;
        this.emailVerified = emailVerified;
        this.passwordHash = passwordHash;
        this.displayName = displayName;
        this.createdAt = createdAt;
    }

    /** Caller validates via {@link DisplayNames#validate}. */
    public void rename(String displayName) { this.displayName = displayName; }

    /**
     * A provider has proven ownership of this email, which nobody had before. Any password was set by
     * whoever registered the unproven email, so it is dropped. The caller must also revoke the user's sessions.
     */
    public void claimEmailByVerifiedOwner() {
        this.emailVerified = true;
        this.passwordHash = null;
    }

    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public boolean isEmailVerified() { return emailVerified; }
    public String getPasswordHash() { return passwordHash; }
    public String getDisplayName() { return displayName; }
    public Role getRole() { return role; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getDeletedAt() { return deletedAt; }
}
