package za.kaapspoor.server.hike;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class HikeDtos {

    private HikeDtos() {}

    /** Mirrors JournalPlan in app/src/lib/data/types.ts. */
    public record HikePlan(String approach, String main, String exit, @Schema(requiredMode = REQUIRED) boolean reversed) {}

    /** Everything the client may set. Required fields are checked by the service (a missing one is a 400). */
    public record HikeWrite(
            @Schema(requiredMode = REQUIRED) String routeId,
            @Schema(types = {"string", "null"}, format = "date") LocalDate date,
            @Schema(requiredMode = REQUIRED) String notes,
            @Schema(requiredMode = REQUIRED) Visibility visibility,
            @Schema(requiredMode = REQUIRED) Visibility notesVisibility,
            HikePlan plan,
            @Schema(types = {"string", "null"}, format = "date-time") Instant startedAt,
            @Schema(types = {"string", "null"}, format = "date-time") Instant finishedAt,
            @Schema(requiredMode = REQUIRED) Instant updatedAt,
            @Schema(requiredMode = REQUIRED) boolean deleted) {}

    /** The server's current state of one hike. Always carries every field; the nullable ones are null, not absent. */
    public record Hike(
            @Schema(requiredMode = REQUIRED) UUID id,
            @Schema(requiredMode = REQUIRED) String routeId,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "date") LocalDate date,
            @Schema(requiredMode = REQUIRED) String notes,
            @Schema(requiredMode = REQUIRED) Visibility visibility,
            @Schema(requiredMode = REQUIRED) Visibility notesVisibility,
            @Schema(requiredMode = REQUIRED) HikePlan plan,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "date-time") Instant startedAt,
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, format = "date-time") Instant finishedAt,
            @Schema(requiredMode = REQUIRED) Instant updatedAt,
            @Schema(requiredMode = REQUIRED) boolean deleted,
            @Schema(requiredMode = REQUIRED) long revision) {}

    public record HikeChanges(
            @Schema(requiredMode = REQUIRED) List<Hike> hikes,
            @Schema(requiredMode = REQUIRED) long next,
            @Schema(requiredMode = REQUIRED) boolean hasMore) {}
}
