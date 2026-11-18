package za.kaapspoor.server.hike;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import za.kaapspoor.server.hike.HikeDtos.HikePlan;

@Entity
@Table(name = "hike")
public class Hike {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "route_id", nullable = false)
    private String routeId;

    @Column(name = "hiked_on")
    private LocalDate hikedOn;

    @Column(nullable = false)
    private String notes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Visibility visibility;

    @Enumerated(EnumType.STRING)
    @Column(name = "notes_visibility", nullable = false)
    private Visibility notesVisibility;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private HikePlan plan;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "client_updated_at", nullable = false)
    private Instant clientUpdatedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(nullable = false)
    private long revision;

    @Column(name = "received_at", nullable = false)
    private Instant receivedAt;

    protected Hike() {}

    public Hike(UUID id, UUID userId) {
        this.id = id;
        this.userId = userId;
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getRouteId() { return routeId; }
    public LocalDate getHikedOn() { return hikedOn; }
    public String getNotes() { return notes; }
    public Visibility getVisibility() { return visibility; }
    public Visibility getNotesVisibility() { return notesVisibility; }
    public HikePlan getPlan() { return plan; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public Instant getClientUpdatedAt() { return clientUpdatedAt; }
    public Instant getDeletedAt() { return deletedAt; }
    public long getRevision() { return revision; }

    public boolean isTombstone() { return deletedAt != null; }

    /** Overwrites every client-settable field; the caller has already validated and clamped. */
    void apply(HikeDtos.HikeWrite w, Instant effectiveUpdatedAt, long revision, Instant now) {
        this.routeId = w.routeId();
        this.hikedOn = w.date();
        this.visibility = w.visibility();
        this.notesVisibility = w.notesVisibility();
        this.startedAt = w.startedAt();
        this.finishedAt = w.finishedAt();
        this.clientUpdatedAt = effectiveUpdatedAt;
        this.revision = revision;
        this.receivedAt = now;
        if (w.deleted()) {
            // Final and scrubbed: the route, date and visibility stay; the private content goes.
            this.deletedAt = now;
            this.notes = "";
            this.plan = null;
        } else {
            this.notes = w.notes();
            this.plan = w.plan();
        }
    }
}
