package za.kaapspoor.server.review;

import java.sql.Date;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.YearMonth;
import java.util.Comparator;
import java.util.UUID;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import za.kaapspoor.server.hike.ReviewAnswers.Difficulty;
import za.kaapspoor.server.hike.ReviewAnswers.Navigation;
import za.kaapspoor.server.hike.ReviewAnswers.Safety;
import za.kaapspoor.server.hike.ReviewAnswers.Water;
import za.kaapspoor.server.review.RouteReviewDtos.Counts;
import za.kaapspoor.server.review.RouteReviewDtos.PublicReview;
import za.kaapspoor.server.review.RouteReviewDtos.ReviewSummary;
import za.kaapspoor.server.review.RouteReviewDtos.RouteReviews;

@Service
public class RouteReviewService {

    /** A question's summary stays hidden until this many people have answered it. */
    static final int REVIEW_SUMMARY_MIN = 3;

    static final int MAX_REVIEWS = 100;

    static final String FORMER_MEMBER = "Former member";

    /** Each person's latest review of the route: their most recent hike by date, ties by update time. */
    private static final String LATEST_PER_PERSON = """
            select distinct on (h.user_id) h.*, u.display_name, u.deleted_at as user_deleted_at
            from hike h join app_user u on u.id = h.user_id
            where h.route_id = ? and h.deleted_at is null
              and (h.review_difficulty is not null or h.review_enjoyment is not null
                   or h.review_safety is not null or h.review_navigation is not null
                   or h.review_water is not null or h.review_note is not null)
            order by h.user_id, h.hiked_on desc nulls last, h.client_updated_at desc
            """;

    private static final ZoneId SA = ZoneId.of("Africa/Johannesburg");

    private final JdbcTemplate jdbc;
    private final Clock clock;

    RouteReviewService(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    private record Row(UUID hikeId, PublicReview review, Instant updatedAt) {}

    @Transactional(readOnly = true)
    public RouteReviews reviews(String routeId) {
        List<Boolean> graded = jdbc.queryForList("select graded from route where id = ?", Boolean.class, routeId);
        if (graded.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such route");
        }
        boolean isGraded = graded.get(0);
        // A review goes public the South African day after it was last written, so a poller
        // cannot learn "X hiked this today" from a private hike.
        Instant startOfToday = clock.instant().atZone(SA).toLocalDate().atStartOfDay(SA).toInstant();

        List<Row> rows = jdbc.query(LATEST_PER_PERSON, (rs, n) -> {
            Difficulty difficulty = rs.getString("review_difficulty") == null
                    ? null : Difficulty.valueOf(rs.getString("review_difficulty"));
            if (difficulty != null && difficulty.isGradedScale() != isGraded) {
                difficulty = null; // an answer on the route's old scale never shows under the new one
            }
            boolean pub = "PUBLIC".equals(rs.getString("visibility"));
            Date hikedOn = rs.getDate("hiked_on");
            // Only a public hike with a date ever reveals a date, and then only its month.
            String month = pub && hikedOn != null ? YearMonth.from(hikedOn.toLocalDate()).toString() : null;
            boolean dateRecorded = !(pub && hikedOn == null);
            String name = rs.getTimestamp("user_deleted_at") != null ? FORMER_MEMBER : rs.getString("display_name");
            int enjoyment = rs.getInt("review_enjoyment");
            Integer enjoymentOrNull = rs.wasNull() ? null : enjoyment;
            String safety = rs.getString("review_safety");
            String navigation = rs.getString("review_navigation");
            String water = rs.getString("review_water");
            PublicReview review = new PublicReview(name, month, dateRecorded, difficulty, enjoymentOrNull,
                    safety == null ? null : Safety.valueOf(safety),
                    rs.getString("review_safety_note"),
                    navigation == null ? null : Navigation.valueOf(navigation),
                    water == null ? null : Water.valueOf(water),
                    rs.getString("review_note"));
            return new Row(rs.getObject("id", UUID.class), review, rs.getTimestamp("client_updated_at").toInstant());
        }, routeId).stream()
                // Decided on each person's latest review: a fresh edit hides them until tomorrow
                // rather than falling back to an older review.
                .filter(r -> r.updatedAt().isBefore(startOfToday))
                .filter(r -> hasContent(r.review())).toList();

        List<PublicReview> all = rows.stream().map(Row::review).toList();
        ReviewSummary summary = new ReviewSummary(
                counts(all, r -> r.difficulty() == null ? null : r.difficulty().name()),
                counts(all, r -> r.enjoyment() == null ? null : String.valueOf(r.enjoyment())),
                counts(all, r -> r.safety() == null ? null : r.safety().name()),
                counts(all, r -> r.navigation() == null ? null : r.navigation().name()),
                counts(all, r -> r.water() == null ? null : r.water().name()));

        // No time-based order: it would reveal when each review was written.
        Comparator<Row> order = Comparator
                .comparing((Row r) -> r.review().month() == null)
                .thenComparing(r -> r.review().month() == null ? "" : r.review().month(),
                        Comparator.reverseOrder())
                .thenComparing(r -> r.review().displayName(), String.CASE_INSENSITIVE_ORDER)
                .thenComparing(Row::hikeId);
        List<PublicReview> listed = rows.stream()
                .sorted(order)
                .limit(MAX_REVIEWS)
                .map(Row::review)
                .toList();
        return new RouteReviews(isGraded, rows.size(), summary, listed);
    }

    /** A review whose only answer was on the wrong scale has nothing left to show. */
    private static boolean hasContent(PublicReview r) {
        return r.difficulty() != null || r.enjoyment() != null || r.safety() != null
                || r.navigation() != null || r.water() != null
                || (r.note() != null && !r.note().isBlank());
    }

    private static Counts counts(List<PublicReview> reviews, Function<PublicReview, String> answer) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        int answered = 0;
        for (PublicReview r : reviews) {
            String a = answer.apply(r);
            if (a != null) {
                counts.merge(a, 1, Integer::sum);
                answered++;
            }
        }
        return answered < REVIEW_SUMMARY_MIN ? null : new Counts(answered, counts);
    }
}
