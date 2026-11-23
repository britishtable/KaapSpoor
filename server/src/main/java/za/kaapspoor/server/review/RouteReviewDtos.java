package za.kaapspoor.server.review;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.Map;
import za.kaapspoor.server.hike.ReviewAnswers.Difficulty;
import za.kaapspoor.server.hike.ReviewAnswers.Navigation;
import za.kaapspoor.server.hike.ReviewAnswers.Safety;
import za.kaapspoor.server.hike.ReviewAnswers.Water;

public final class RouteReviewDtos {

    private RouteReviewDtos() {}

    /** How many people gave each answer. Enjoyment keys are "1" to "5". */
    public record Counts(
            @Schema(requiredMode = REQUIRED) int answered,
            @Schema(requiredMode = REQUIRED) Map<String, Integer> counts) {}

    /** A question is null until at least {@code REVIEW_SUMMARY_MIN} people have answered it. */
    public record ReviewSummary(
            @Schema(requiredMode = REQUIRED) Counts difficulty,
            @Schema(requiredMode = REQUIRED) Counts enjoyment,
            @Schema(requiredMode = REQUIRED) Counts safety,
            @Schema(requiredMode = REQUIRED) Counts navigation,
            @Schema(requiredMode = REQUIRED) Counts water) {}

    /**
     * One person's review. {@code month} is only ever set for a PUBLIC hike with a date; no other date
     * reaches this response. Unanswered questions are omitted.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record PublicReview(
            @Schema(requiredMode = REQUIRED) String displayName,
            @JsonInclude(JsonInclude.Include.ALWAYS)
            @Schema(requiredMode = REQUIRED, types = {"string", "null"}, description = "yyyy-MM") String month,
            @Schema(requiredMode = REQUIRED) boolean dateRecorded,
            Difficulty difficulty,
            Integer enjoyment,
            Safety safety,
            String safetyNote,
            Navigation navigation,
            Water water,
            String note) {}

    public record RouteReviews(
            @Schema(requiredMode = REQUIRED) boolean graded,
            @Schema(requiredMode = REQUIRED) int people,
            @Schema(requiredMode = REQUIRED) ReviewSummary summary,
            @Schema(requiredMode = REQUIRED) List<PublicReview> reviews) {}
}
