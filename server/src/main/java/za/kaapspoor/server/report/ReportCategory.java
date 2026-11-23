package za.kaapspoor.server.report;

import java.time.Duration;
import java.util.Optional;

/** The eight report categories and how long each stays active after it was last seen. */
public enum ReportCategory {
    OBSTRUCTION(30),
    TRAIL_DAMAGE(60),
    CLOSURE(-1),
    FIRE(30),
    WATER(14),
    WILDLIFE(2),
    SAFETY(14),
    CONDITIONS(3);

    private final int days;

    ReportCategory(int days) {
        this.days = days;
    }

    /** Empty for a closure, which lasts until it is cleared. */
    public Optional<Duration> lifetime() {
        return days < 0 ? Optional.empty() : Optional.of(Duration.ofDays(days));
    }

    /** The longest finite lifetime of any category. */
    public static Duration maxFiniteLifetime() {
        return java.util.Arrays.stream(values()).flatMap(c -> c.lifetime().stream())
                .max(Duration::compareTo).orElse(Duration.ZERO);
    }

    /** The categories that never expire on their own. */
    public static java.util.List<ReportCategory> unbounded() {
        return java.util.Arrays.stream(values()).filter(c -> c.lifetime().isEmpty()).toList();
    }
}
