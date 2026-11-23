package za.kaapspoor.server.report;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** A day-level report. The geography position is not mapped; ReportService reads and writes it with SQL. */
@Entity
@Table(name = "report")
public class Report {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "route_id", nullable = false, updatable = false)
    private String routeId;

    @Column(name = "hike_id", updatable = false)
    private UUID hikeId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, updatable = false)
    private ReportCategory category;

    @Column(nullable = false, updatable = false)
    private String note;

    @Column(name = "observed_at", nullable = false, updatable = false)
    private Instant observedAt;

    @Column(name = "last_confirmed_at")
    private Instant lastConfirmedAt;

    @Column(name = "cleared_at")
    private Instant clearedAt;

    @Column(name = "received_at", nullable = false, updatable = false)
    private Instant receivedAt;

    protected Report() {}

    Report(UUID id, UUID userId, String routeId, UUID hikeId, ReportCategory category, String note,
            Instant observedAt, Instant receivedAt) {
        this.id = id;
        this.userId = userId;
        this.routeId = routeId;
        this.hikeId = hikeId;
        this.category = category;
        this.note = note;
        this.observedAt = observedAt;
        this.receivedAt = receivedAt;
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getRouteId() { return routeId; }
    public UUID getHikeId() { return hikeId; }
    public ReportCategory getCategory() { return category; }
    public String getNote() { return note; }
    public Instant getObservedAt() { return observedAt; }
    public Instant getLastConfirmedAt() { return lastConfirmedAt; }
    public Instant getClearedAt() { return clearedAt; }
    public Instant getReceivedAt() { return receivedAt; }
}
