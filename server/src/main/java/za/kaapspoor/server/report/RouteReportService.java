package za.kaapspoor.server.report;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import za.kaapspoor.server.report.ReportDtos.MyReport;
import za.kaapspoor.server.report.ReportDtos.PublicReport;
import za.kaapspoor.server.report.ReportDtos.RouteReports;

/**
 * A route's reports. Held and expired are decided only by {@link ReportService#view}; this class
 * reads the route's reports and sorts them by what that says. A SQL pre-filter only narrows the
 * candidates (it can let extra reports through, never drop a listable one); it does not decide.
 * Candidates are bounded by the 90 day history window, but a busy route can still have many, and
 * each gets one view() call: fine for R1, to be batched later without a second definition.
 */
@Service
public class RouteReportService {

    static final String FORMER_MEMBER = "Former member";
    static final Duration HISTORY_WINDOW = Duration.ofDays(90);
    static final int MAX_HISTORY = 50;

    private final ReportRepository reports;
    private final ReportService reportService;
    private final JdbcTemplate jdbc;
    private final Clock clock;

    RouteReportService(ReportRepository reports, ReportService reportService, JdbcTemplate jdbc, Clock clock) {
        this.reports = reports;
        this.reportService = reportService;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public RouteReports forRoute(String routeId) {
        Integer known = jdbc.queryForObject("select count(*) from route where id = ?", Integer.class, routeId);
        if (known == null || known == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such route");
        }
        Instant now = clock.instant();
        Map<UUID, String> names = new HashMap<>();
        Comparator<PublicReport> newestFirst = Comparator.comparing(PublicReport::observedAt).reversed();
        List<PublicReport> active = new java.util.ArrayList<>();
        List<PublicReport> history = new java.util.ArrayList<>();
        for (Report r : candidates(routeId, now)) {
            MyReport v = reportService.view(r, now);
            if (v.held()) {
                continue;
            }
            PublicReport p = new PublicReport(v.id(), v.category(), v.note(), names.computeIfAbsent(
                    r.getUserId(), this::displayName), v.observedAt(), v.lastConfirmedAt(), v.expiresAt(),
                    v.clearedAt(), v.unverified(), v.position());
            if (ReportService.isActive(v, now)) {
                active.add(p);
            } else {
                Instant ended = v.clearedAt() == null ? v.expiresAt()
                        : v.expiresAt() == null || v.clearedAt().isBefore(v.expiresAt()) ? v.clearedAt() : v.expiresAt();
                if (ended.plus(HISTORY_WINDOW).isAfter(now)) {
                    history.add(p);
                }
            }
        }
        // Ordered by observedAt, newest first: the cap keeps the 50 most recently observed.
        active.sort(newestFirst);
        history.sort(newestFirst);
        return new RouteReports(active, history.stream().limit(MAX_HISTORY).toList());
    }

    /**
     * A superset of what can be listed: not cleared long ago, and either a category that never
     * expires or last seen within its longest lifetime plus the history window.
     */
    private List<Report> candidates(String routeId, Instant now) {
        Instant clearedAfter = now.minus(HISTORY_WINDOW);
        Instant seenAfter = now.minus(ReportCategory.maxFiniteLifetime().plus(HISTORY_WINDOW));
        String unbounded = ReportCategory.unbounded().stream()
                .map(c -> "'" + c.name() + "'").collect(java.util.stream.Collectors.joining(", "));
        List<UUID> ids = jdbc.queryForList("select id from report where route_id = ?"
                + " and (cleared_at is null or cleared_at > ?)"
                + " and (" + (unbounded.isEmpty() ? "false" : "category in (" + unbounded + ")")
                + " or coalesce(last_confirmed_at, observed_at) > ?)",
                UUID.class, routeId, java.sql.Timestamp.from(clearedAfter), java.sql.Timestamp.from(seenAfter));
        return reports.findAllById(ids);
    }

    /** The caller's own reports on a route that are still held back from the public. */
    @Transactional(readOnly = true)
    public List<MyReport> myHeld(UUID userId, String routeId) {
        Instant now = clock.instant();
        return reports.findByRouteIdAndUserId(routeId, userId).stream()
                .map(r -> reportService.view(r, now))
                .filter(MyReport::held)
                .sorted(Comparator.comparing(MyReport::observedAt).reversed())
                .toList();
    }

    private String displayName(UUID userId) {
        List<String> found = jdbc.query(
                "select case when deleted_at is null then display_name else ? end from app_user where id = ?",
                (rs, n) -> rs.getString(1), FORMER_MEMBER, userId);
        return found.isEmpty() ? FORMER_MEMBER : found.get(0);
    }
}
