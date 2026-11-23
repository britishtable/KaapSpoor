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

    /** A released report as the public sees it: a name and a time, never an account or a hike. */
    public record PublicReport(
            @Schema(requiredMode = REQUIRED) UUID id,
            @Schema(requiredMode = REQUIRED) ReportCategory category,
            @Schema(requiredMode = REQUIRED) String note,
            @Schema(requiredMode = REQUIRED) String displayName,
            @Schema(requiredMode = REQUIRED) Instant observedAt,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "date-time") Instant lastConfirmedAt,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "date-time") Instant expiresAt,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "date-time") Instant clearedAt,
            @Schema(requiredMode = REQUIRED) boolean unverified,
            @Schema(requiredMode = REQUIRED) Position position) {}

    public enum Answer { STILL_THERE, GONE, NOT_SURE }

    public record ConfirmationWrite(@Schema(requiredMode = REQUIRED) Answer answer) {}

    public record RouteReports(
            @Schema(requiredMode = REQUIRED) java.util.List<PublicReport> active,
            @Schema(requiredMode = REQUIRED) java.util.List<PublicReport> history) {}
}
