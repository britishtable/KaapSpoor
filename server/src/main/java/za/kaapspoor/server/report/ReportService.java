package za.kaapspoor.server.report;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import za.kaapspoor.server.report.ReportDtos.Answer;
import za.kaapspoor.server.report.ReportDtos.MyReport;
import za.kaapspoor.server.report.ReportDtos.Position;
import za.kaapspoor.server.report.ReportDtos.ReportWrite;
import za.kaapspoor.server.route.RouteRepository;
import za.kaapspoor.server.web.BadRequestException;

@Service
public class ReportService {

    static final int MAX_NOTE = 500;
    static final Duration SKEW = Duration.ofMinutes(2);
    static final Duration MAX_AGE = Duration.ofDays(14);
    /**
     * A report filed during a hike is released this long after the later of when it was observed and
     * when the server received it, even if the hike is never finished.
     */
    static final Duration HOLD_FALLBACK = Duration.ofHours(12);
    static final double MIN_LON = 17.0, MAX_LON = 24.5, MIN_LAT = -35.0, MAX_LAT = -30.0;

    private final ReportRepository reports;
    private final RouteRepository routes;
    private final JdbcTemplate jdbc;
    private final Clock clock;
    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    ReportService(ReportRepository reports, RouteRepository routes, JdbcTemplate jdbc, Clock clock) {
        this.reports = reports;
        this.routes = routes;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Transactional
    public MyReport file(UUID userId, UUID id, ReportWrite w) {
        if (!lockActiveUser(userId)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        var found = reports.findById(id);
        if (found.isPresent()) {
            if (!found.get().getUserId().equals(userId)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "This report id is already in use.");
            }
            return view(found.get(), now);
        }
        validate(userId, w, now);
        Report r = new Report(id, userId, w.routeId(), w.hikeId(), w.category(),
                w.note() == null ? "" : w.note(), w.observedAt().truncatedTo(ChronoUnit.MICROS), now);
        reports.saveAndFlush(r);
        if (w.position() != null) {
            jdbc.update("update report set position = ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography where id = ?",
                    w.position().lon(), w.position().lat(), id);
        }
        return view(r, now);
    }

    /**
     * Records one person's answer and applies its effect, under a row lock on the report so two
     * simultaneous GONE answers cannot both miss the clear. A held report is invisible (404) to
     * everyone, its author included; an expired or cleared one is 409.
     */
    @Transactional
    public MyReport confirm(UUID userId, UUID id, Answer answer) {
        if (answer == null) {
            throw new BadRequestException("answer is required.");
        }
        if (!lockActiveUser(userId)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        UUID author;
        try {
            author = jdbc.queryForObject("select user_id from report where id = ? for update", UUID.class, id);
        } catch (EmptyResultDataAccessException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such report");
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        Report r = reports.findById(id).orElseThrow();
        MyReport before = view(r, now);
        if (before.held()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such report");
        }
        if (!isActive(before, now)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This report is no longer active.");
        }
        java.sql.Timestamp at = java.sql.Timestamp.from(now);
        jdbc.update("insert into report_confirmation (report_id, user_id, answer, answered_at) values (?, ?, ?, ?)"
                + " on conflict (report_id, user_id) do update set answer = excluded.answer,"
                + " answered_at = excluded.answered_at", id, userId, answer.name(), at);
        if (answer == Answer.STILL_THERE) {
            jdbc.update("update report set last_confirmed_at = ? where id = ?", at, id);
        } else if (answer == Answer.GONE) {
            Integer others = jdbc.queryForObject("select count(*) from report_confirmation where report_id = ?"
                    + " and answer = 'GONE' and user_id <> ?", Integer.class, id, author);
            Integer authorGone = jdbc.queryForObject("select count(*) from report_confirmation where report_id = ?"
                    + " and answer = 'GONE' and user_id = ?", Integer.class, id, author);
            if ((others != null && others >= 2) || (authorGone != null && authorGone > 0)) {
                jdbc.update("update report set cleared_at = ? where id = ?", at, id);
            }
        }
        entityManager.refresh(r); // the SQL updates above bypassed the entity
        return view(r, now);
    }

    /**
     * The one definition of hold/release and expiry. A report is held (author-only) until its hike is
     * finished, or 12 hours after the later of when it was observed and when it was received (so a
     * back-dated or late-uploaded report is not public on arrival); a report with no hike is never held.
     */
    @Transactional(readOnly = true)
    public MyReport view(Report r, Instant now) {
        Instant expiresAt = expiresAt(r);
        return new MyReport(r.getId(), r.getRouteId(), r.getCategory(), r.getNote(), r.getObservedAt(),
                positionOf(r.getId()), r.getHikeId(), isHeld(r, now), r.getLastConfirmedAt(), expiresAt,
                r.getClearedAt(), isUnverified(r));
    }

    /** The one definition of active: not cleared, and either no expiry or one still ahead. */
    static boolean isActive(MyReport v, Instant now) {
        return v.clearedAt() == null && (v.expiresAt() == null || v.expiresAt().isAfter(now));
    }

    boolean isHeld(Report r, Instant now) {
        if (r.getHikeId() == null) {
            return false;
        }
        Instant from = r.getObservedAt().isAfter(r.getReceivedAt()) ? r.getObservedAt() : r.getReceivedAt();
        if (!from.plus(HOLD_FALLBACK).isAfter(now)) {
            return false;
        }
        Integer finished = jdbc.queryForObject(
                "select count(*) from hike where id = ? and finished_at is not null", Integer.class, r.getHikeId());
        return finished == null || finished == 0;
    }

    static Instant expiresAt(Report r) {
        Instant from = r.getLastConfirmedAt() != null ? r.getLastConfirmedAt() : r.getObservedAt();
        return r.getCategory().lifetime().map(from::plus).orElse(null);
    }

    /** A safety report stays unverified until a non-author has answered STILL_THERE. */
    private boolean isUnverified(Report r) {
        if (r.getCategory() != ReportCategory.SAFETY) {
            return false;
        }
        Integer n = jdbc.queryForObject(
                "select count(*) from report_confirmation where report_id = ? and answer = 'STILL_THERE' and user_id <> ?",
                Integer.class, r.getId(), r.getUserId());
        return n == null || n == 0;
    }

    private Position positionOf(UUID id) {
        return jdbc.query(
                "select ST_X(position::geometry) as lon, ST_Y(position::geometry) as lat from report where id = ? and position is not null",
                rs -> rs.next() ? new Position(rs.getDouble("lon"), rs.getDouble("lat")) : null, id);
    }

    private void validate(UUID userId, ReportWrite w, Instant now) {
        if (w.routeId() == null || w.category() == null || w.observedAt() == null) {
            throw new BadRequestException("routeId, category and observedAt are required.");
        }
        if (!routes.existsById(w.routeId())) {
            throw new BadRequestException("That route does not exist.");
        }
        if (w.note() != null && w.note().length() > MAX_NOTE) {
            throw new BadRequestException("A note can be at most " + MAX_NOTE + " characters.");
        }
        if (w.observedAt().isAfter(now.plus(SKEW))) {
            throw new BadRequestException("That time is in the future.");
        }
        if (w.observedAt().isBefore(now.minus(MAX_AGE))) {
            throw new BadRequestException("Reports are for things seen in the last two weeks.");
        }
        Position p = w.position();
        if (p != null && !(p.lon() >= MIN_LON && p.lon() <= MAX_LON && p.lat() >= MIN_LAT && p.lat() <= MAX_LAT)) {
            throw new BadRequestException("That spot is outside the area KaapSpoor covers.");
        }
        // Any of the caller's own hikes holds the report, whatever route it is on: someone mid-hike who
        // reports on another route is still out there. One message for every refusal, so nothing can be probed.
        if (w.hikeId() != null) {
            Integer ok = jdbc.queryForObject(
                    "select count(*) from hike where id = ? and user_id = ? and deleted_at is null",
                    Integer.class, w.hikeId(), userId);
            if (ok == null || ok == 0) {
                throw new BadRequestException("That hike isn't yours.");
            }
        }
    }

    private boolean lockActiveUser(UUID userId) {
        try {
            jdbc.queryForObject("select id from app_user where id = ? and deleted_at is null for update",
                    UUID.class, userId);
            return true;
        } catch (EmptyResultDataAccessException e) {
            return false;
        }
    }
}
