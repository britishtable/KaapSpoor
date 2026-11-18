package za.kaapspoor.server.route;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Server-side stub of a route: just enough to validate ids. The geography
 * {@code location} column is written and queried through SQL, so it is not mapped here.
 */
@Entity
@Table(name = "route")
public class Route {

    @Id
    private String id;

    @Column(nullable = false)
    private String title;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(nullable = false, columnDefinition = "text[]")
    private String[] area;

    @Column(name = "location_source")
    private String locationSource;

    @Column(name = "retired_at")
    private OffsetDateTime retiredAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected Route() {}

    public String getId() { return id; }
    public String getTitle() { return title; }
    public String[] getArea() { return area; }
    public String getLocationSource() { return locationSource; }
    public OffsetDateTime getRetiredAt() { return retiredAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }
}
