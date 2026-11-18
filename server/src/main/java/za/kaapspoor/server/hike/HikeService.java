package za.kaapspoor.server.hike;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import za.kaapspoor.server.hike.HikeDtos.HikeChanges;
import za.kaapspoor.server.hike.HikeDtos.HikePlan;
import za.kaapspoor.server.hike.HikeDtos.HikeWrite;
import za.kaapspoor.server.route.RouteRepository;
import za.kaapspoor.server.web.BadRequestException;

@Service
public class HikeService {

    static final int MAX_NOTES = 5000;
    static final int MAX_PLAN_ID = 200;
    static final int MAX_PAGE = 500;
    static final LocalDate EARLIEST_DATE = LocalDate.of(1950, 1, 1);
    private static final ZoneId SA = ZoneId.of("Africa/Johannesburg");

    private final HikeRepository hikes;
    private final RouteRepository routes;
    private final JdbcTemplate jdbc;
    private final Clock clock;

    HikeService(HikeRepository hikes, RouteRepository routes, JdbcTemplate jdbc, Clock clock) {
        this.hikes = hikes;
        this.routes = routes;
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Transactional
    public HikeDtos.Hike upsert(UUID userId, UUID id, HikeWrite w) {
        // Rule 2: serialise this user's writes. Also proves the user exists and is not soft-deleted (rule 1).
        if (!lockActiveUser(userId)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        validate(w, now);

        Optional<Hike> found = hikes.findById(id);
        if (found.isPresent() && !found.get().getUserId().equals(userId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This hike id is already in use.");
        }
        Instant effective = min(w.updatedAt().truncatedTo(ChronoUnit.MICROS), now);
        if (found.isPresent()) {
            Hike stored = found.get();
            // A stored tombstone is final. An incoming delete skips last-write-wins (deletion beats any
            // edit, whichever is newer), but the LWW key never moves backwards.
            if (stored.isTombstone() || (!w.deleted() && stored.getClientUpdatedAt().isAfter(effective))) {
                return toDto(stored);
            }
            if (stored.getClientUpdatedAt().isAfter(effective)) {
                effective = stored.getClientUpdatedAt();
            }
        }
        long revision = jdbc.queryForObject(
                "update app_user set hike_revision = hike_revision + 1 where id = ? returning hike_revision",
                Long.class, userId);
        Hike hike = found.orElseGet(() -> new Hike(id, userId));
        hike.apply(w, effective, revision, now);
        return toDto(hikes.save(hike));
    }

    @Transactional(readOnly = true)
    public HikeChanges changes(UUID userId, long since, int limit) {
        if (!isActive(userId)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        if (since < 0) {
            throw new BadRequestException("since must not be negative.");
        }
        if (limit < 1) {
            throw new BadRequestException("limit must be at least 1.");
        }
        int size = Math.min(limit, MAX_PAGE);
        List<Hike> page = hikes.findByUserIdAndRevisionGreaterThanOrderByRevisionAsc(
                userId, since, Pageable.ofSize(size + 1));
        boolean hasMore = page.size() > size;
        List<Hike> shown = hasMore ? page.subList(0, size) : page;
        long next = shown.isEmpty() ? since : shown.get(shown.size() - 1).getRevision();
        return new HikeChanges(shown.stream().map(HikeService::toDto).toList(), next, hasMore);
    }

    private boolean isActive(UUID userId) {
        Integer n = jdbc.queryForObject(
                "select count(*) from app_user where id = ? and deleted_at is null", Integer.class, userId);
        return n != null && n > 0;
    }

    /** Takes the row lock; false when the user is missing or soft-deleted. */
    private boolean lockActiveUser(UUID userId) {
        try {
            jdbc.queryForObject(
                    "select hike_revision from app_user where id = ? and deleted_at is null for update",
                    Long.class, userId);
            return true;
        } catch (EmptyResultDataAccessException e) {
            return false;
        }
    }

    private void validate(HikeWrite w, Instant now) {
        if (w.routeId() == null || w.notes() == null || w.visibility() == null
                || w.notesVisibility() == null || w.updatedAt() == null) {
            throw new BadRequestException(
                    "routeId, notes, visibility, notesVisibility and updatedAt are required.");
        }
        if (!routes.existsById(w.routeId())) {
            throw new BadRequestException("That route does not exist.");
        }
        if (w.notes().length() > MAX_NOTES) {
            throw new BadRequestException("Notes can be at most " + MAX_NOTES + " characters.");
        }
        if (w.date() != null) {
            LocalDate latest = now.atZone(SA).toLocalDate().plusDays(1);
            if (w.date().isBefore(EARLIEST_DATE) || w.date().isAfter(latest)) {
                throw new BadRequestException("The date must be between 1950-01-01 and tomorrow.");
            }
        }
        if (w.finishedAt() != null) {
            if (w.startedAt() == null) {
                throw new BadRequestException("A finished hike needs a start time.");
            }
            if (w.finishedAt().isBefore(w.startedAt())) {
                throw new BadRequestException("A hike cannot finish before it starts.");
            }
        }
        HikePlan p = w.plan();
        if (p != null && (tooLong(p.approach()) || tooLong(p.main()) || tooLong(p.exit()))) {
            throw new BadRequestException("Plan route ids can be at most " + MAX_PLAN_ID + " characters.");
        }
    }

    private static boolean tooLong(String s) {
        return s != null && s.length() > MAX_PLAN_ID;
    }

    private static Instant min(Instant a, Instant b) {
        return a.isBefore(b) ? a : b;
    }

    private static HikeDtos.Hike toDto(Hike h) {
        return new HikeDtos.Hike(h.getId(), h.getRouteId(), h.getHikedOn(), h.getNotes(), h.getVisibility(),
                h.getNotesVisibility(), h.getPlan(), h.getStartedAt(), h.getFinishedAt(), h.getClientUpdatedAt(),
                h.isTombstone(), h.getRevision());
    }
}
