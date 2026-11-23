package za.kaapspoor.server.report;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.UUID;

public final class ReportDtos {

    private ReportDtos() {}

    public record Position(
            @Schema(requiredMode = REQUIRED) double lon,
            @Schema(requiredMode = REQUIRED) double lat) {}

    /** What the client files. Required fields are checked by the service (a missing one is a 400). */
    public record ReportWrite(
            @Schema(requiredMode = REQUIRED) String routeId,
            @Schema(requiredMode = REQUIRED) ReportCategory category,
            String note,
            @Schema(requiredMode = REQUIRED) Instant observedAt,
            Position position,
            @Schema(types = {"string", "null"}, format = "uuid") UUID hikeId) {}

    /** The author's view of a report. The nullable fields are null, not absent. */
    public record MyReport(
            @Schema(requiredMode = REQUIRED) UUID id,
            @Schema(requiredMode = REQUIRED) String routeId,
            @Schema(requiredMode = REQUIRED) ReportCategory category,
            @Schema(requiredMode = REQUIRED) String note,
            @Schema(requiredMode = REQUIRED) Instant observedAt,
            @Schema(requiredMode = REQUIRED) Position position,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "uuid") UUID hikeId,
            @Schema(requiredMode = REQUIRED) boolean held,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "date-time") Instant lastConfirmedAt,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "date-time") Instant expiresAt,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "date-time") Instant clearedAt,
            @Schema(requiredMode = REQUIRED) boolean unverified) {}
}
