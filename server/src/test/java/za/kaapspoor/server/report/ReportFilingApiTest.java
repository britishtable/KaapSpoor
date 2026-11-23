package za.kaapspoor.server.report;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import za.kaapspoor.server.MutableClock;
import za.kaapspoor.server.TestClockConfig;
import za.kaapspoor.server.TestcontainersConfig;

@SpringBootTest
@AutoConfigureMockMvc
@Import({TestcontainersConfig.class, TestClockConfig.class})
@ActiveProfiles("test")
class ReportFilingApiTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired MutableClock clock;

    private int users;

    @BeforeEach
    void clean() {
        clock.reset();
        users = 0;
        jdbc.update("delete from report_confirmation");
        jdbc.update("delete from report");
        jdbc.update("delete from hike");
        jdbc.update("delete from identity");
        jdbc.update("delete from refresh_token");
        jdbc.update("delete from app_user");
        jdbc.update("delete from route where id in ('r', 's')");
        jdbc.update("insert into route (id, title, area, graded, updated_at)"
                + " values ('r', 'R', '{Cape Town}', true, now())");
        jdbc.update("insert into route (id, title, area, graded, updated_at)"
                + " values ('s', 'S', '{Cape Town}', true, now())");
    }

    private String register(String name) throws Exception {
        String body = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", "u" + (++users) + "@example.com",
                                "password", "correct-horse", "displayName", name))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).get("accessToken").asText();
    }

    private UUID putHike(String token, String route, boolean finished, boolean deleted) throws Exception {
        UUID id = UUID.randomUUID();
        putHike(token, id, route, finished, deleted);
        return id;
    }

    private void putHike(String token, UUID id, String route, boolean finished, boolean deleted) throws Exception {
        ObjectNode n = json.createObjectNode();
        n.put("routeId", route);
        n.putNull("date");
        n.put("notes", "n");
        n.put("visibility", "PRIVATE");
        n.put("notesVisibility", "PRIVATE");
        n.putNull("plan");
        n.put("startedAt", clock.instant().minusSeconds(3600).toString());
        if (finished) n.put("finishedAt", clock.instant().toString()); else n.putNull("finishedAt");
        n.put("updatedAt", clock.instant().toString());
        n.put("deleted", deleted);
        n.putNull("review");
        mvc.perform(put("/api/v1/hikes/" + id)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(n)))
                .andExpect(status().isOk());
        clock.advance(1);
    }

    private ObjectNode body(String category, Instant observedAt) {
        ObjectNode n = json.createObjectNode();
        n.put("routeId", "r");
        n.put("category", category);
        n.put("observedAt", observedAt.toString());
        return n;
    }

    private ResultActions file(String token, UUID id, ObjectNode n) throws Exception {
        return mvc.perform(put("/api/v1/reports/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(n)));
    }

    private JsonNode ok(String token, UUID id, ObjectNode n) throws Exception {
        return json.readTree(file(token, id, n).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private String bad(String token, ObjectNode n) throws Exception {
        return json.readTree(file(token, UUID.randomUUID(), n).andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString()).get("detail").asText();
    }

    private Instant seen() {
        return clock.instant().minus(Duration.ofHours(1)).truncatedTo(ChronoUnit.MILLIS);
    }

    @Test
    void putCreatesAndReturnsMyReport() throws Exception {
        String a = register("A");
        Instant at = seen();
        ObjectNode n = body("OBSTRUCTION", at).put("note", "Big tree");
        n.putObject("position").put("lon", 18.4).put("lat", -33.95);
        UUID id = UUID.randomUUID();
        JsonNode r = ok(a, id, n);
        assertEquals(id.toString(), r.get("id").asText());
        assertEquals("r", r.get("routeId").asText());
        assertEquals("OBSTRUCTION", r.get("category").asText());
        assertEquals("Big tree", r.get("note").asText());
        assertEquals(at, Instant.parse(r.get("observedAt").asText()));
        assertEquals(18.4, r.get("position").get("lon").asDouble(), 1e-6);
        assertEquals(-33.95, r.get("position").get("lat").asDouble(), 1e-6);
        assertTrue(r.get("hikeId").isNull());
        assertFalse(r.get("held").asBoolean());
        assertEquals(at.plus(Duration.ofDays(30)), Instant.parse(r.get("expiresAt").asText()));
        assertTrue(r.get("lastConfirmedAt").isNull());
        assertTrue(r.get("clearedAt").isNull());
        assertFalse(r.get("unverified").asBoolean());
    }

    @Test
    void noPositionIsNull() throws Exception {
        String a = register("A");
        JsonNode r = ok(a, UUID.randomUUID(), body("WATER", seen()));
        assertTrue(r.get("position").isNull());
        assertEquals("", r.get("note").asText());
    }

    @Test
    void safetyIsUnverified() throws Exception {
        String a = register("A");
        assertTrue(ok(a, UUID.randomUUID(), body("SAFETY", seen())).get("unverified").asBoolean());
    }

    @Test
    void retryIsIdempotent() throws Exception {
        String a = register("A");
        UUID id = UUID.randomUUID();
        JsonNode first = ok(a, id, body("FIRE", seen()).put("note", "one"));
        JsonNode again = ok(a, id, body("WATER", seen()).put("note", "two"));
        assertEquals(first, again);
        assertEquals(1, jdbc.queryForObject("select count(*) from report", Integer.class));
    }

    @Test
    void otherUsersIdIs409() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID id = UUID.randomUUID();
        ok(a, id, body("FIRE", seen()));
        file(b, id, body("FIRE", seen())).andExpect(status().isConflict());
    }

    @Test
    void closureHasNoExpiry() throws Exception {
        String a = register("A");
        assertTrue(ok(a, UUID.randomUUID(), body("CLOSURE", seen())).get("expiresAt").isNull());
    }

    @Test
    void lifetimesFollowTheTable() throws Exception {
        String a = register("A");
        Instant at = seen();
        Map<String, Integer> days = Map.of("TRAIL_DAMAGE", 60, "FIRE", 30, "WATER", 14, "WILDLIFE", 2,
                "SAFETY", 14, "CONDITIONS", 3);
        for (var e : days.entrySet()) {
            JsonNode r = ok(a, UUID.randomUUID(), body(e.getKey(), at));
            assertEquals(at.plus(Duration.ofDays(e.getValue())), Instant.parse(r.get("expiresAt").asText()),
                    e.getKey());
        }
    }

    @Test
    void reportDuringActiveHikeIsHeld() throws Exception {
        String a = register("A");
        UUID hike = UUID.randomUUID();
        putHike(a, hike, "r", false, false);
        UUID id = UUID.randomUUID();
        ObjectNode n = body("OBSTRUCTION", seen()).put("hikeId", hike.toString());
        JsonNode r = ok(a, id, n);
        assertTrue(r.get("held").asBoolean());
        assertEquals(hike.toString(), r.get("hikeId").asText());
        putHike(a, hike, "r", true, false);
        assertFalse(ok(a, id, n).get("held").asBoolean());
    }

    @Test
    void heldReleases12HoursAfterReceipt() throws Exception {
        String a = register("A");
        UUID hike = putHike(a, "r", false, false);
        Instant at = seen();
        Instant received = clock.instant();
        UUID id = UUID.randomUUID();
        ObjectNode n = body("OBSTRUCTION", at).put("hikeId", hike.toString());
        assertTrue(ok(a, id, n).get("held").asBoolean());
        clock.set(received.plus(Duration.ofHours(12)).minusSeconds(1));
        assertTrue(ok(a, id, n).get("held").asBoolean());
        clock.set(received.plus(Duration.ofHours(12)));
        assertFalse(ok(a, id, n).get("held").asBoolean());
    }

    @Test
    void backDatedReportDuringUnfinishedHikeIsHeldOnArrival() throws Exception {
        String a = register("A");
        UUID hike = putHike(a, "r", false, false);
        Instant at = clock.instant().minus(Duration.ofHours(13)).truncatedTo(ChronoUnit.MILLIS);
        Instant received = clock.instant();
        UUID id = UUID.randomUUID();
        ObjectNode n = body("OBSTRUCTION", at).put("hikeId", hike.toString());
        assertTrue(ok(a, id, n).get("held").asBoolean());
        clock.set(received.plus(Duration.ofHours(12)).minusSeconds(1));
        assertTrue(ok(a, id, n).get("held").asBoolean());
        clock.set(received.plus(Duration.ofHours(12)));
        assertFalse(ok(a, id, n).get("held").asBoolean());
    }

    @Test
    void lateUploadIsHeldUntil12HoursAfterReceiptUnlessTheHikeFinishes() throws Exception {
        String a = register("A");
        UUID hike = UUID.randomUUID();
        putHike(a, hike, "r", false, false);
        Instant morning = clock.instant().truncatedTo(ChronoUnit.MILLIS); // "08:00"
        Instant evening = morning.plus(Duration.ofHours(13)); // "21:00"
        clock.set(evening);
        UUID id = UUID.randomUUID();
        ObjectNode n = body("WATER", morning).put("hikeId", hike.toString());
        assertTrue(ok(a, id, n).get("held").asBoolean());
        clock.set(evening.plus(Duration.ofHours(12)).minusSeconds(1)); // 08:59:59 next day
        assertTrue(ok(a, id, n).get("held").asBoolean());
        clock.set(evening.plus(Duration.ofHours(12))); // 09:00 next day
        assertFalse(ok(a, id, n).get("held").asBoolean());

        clock.set(evening);
        UUID other = UUID.randomUUID();
        ObjectNode m = body("FIRE", morning).put("hikeId", hike.toString());
        assertTrue(ok(a, other, m).get("held").asBoolean());
        putHike(a, hike, "r", true, false);
        assertFalse(ok(a, other, m).get("held").asBoolean());
    }

    @Test
    void missingFieldsIs400() throws Exception {
        String a = register("A");
        ObjectNode n = body("FIRE", seen());
        n.remove("category");
        bad(a, n);
        n = body("FIRE", seen());
        n.remove("observedAt");
        bad(a, n);
        n = body("FIRE", seen());
        n.remove("routeId");
        bad(a, n);
    }

    @Test
    void unknownRouteIs400() throws Exception {
        String a = register("A");
        assertEquals("That route does not exist.", bad(a, body("FIRE", seen()).put("routeId", "nope")));
    }

    @Test
    void longNoteIs400() throws Exception {
        String a = register("A");
        bad(a, body("FIRE", seen()).put("note", "x".repeat(501)));
        ok(a, UUID.randomUUID(), body("FIRE", seen()).put("note", "x".repeat(500)));
    }

    @Test
    void futureIs400() throws Exception {
        String a = register("A");
        assertEquals("That time is in the future.",
                bad(a, body("FIRE", clock.instant().plusSeconds(150))));
    }

    @Test
    void observedAtTwoMinutesAheadAccepted() throws Exception {
        String a = register("A");
        ok(a, UUID.randomUUID(), body("FIRE", clock.instant().plusSeconds(120)));
    }

    @Test
    void olderThanTwoWeeksIs400() throws Exception {
        String a = register("A");
        assertEquals("Reports are for things seen in the last two weeks.",
                bad(a, body("FIRE", clock.instant().minus(Duration.ofDays(14)).minusSeconds(5))));
        ok(a, UUID.randomUUID(), body("FIRE", clock.instant().minus(Duration.ofDays(14)).plusSeconds(5)));
    }

    @Test
    void positionOutsideBoxIs400() throws Exception {
        String a = register("A");
        ObjectNode n = body("FIRE", seen());
        n.putObject("position").put("lon", 30.0).put("lat", -33.0);
        assertEquals("That spot is outside the area KaapSpoor covers.", bad(a, n));
        n = body("FIRE", seen());
        n.putObject("position").put("lon", 18.0).put("lat", -29.0);
        bad(a, n);
    }

    @Test
    void foreignHikeIs400() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID hike = putHike(b, "r", false, false);
        assertEquals("That hike isn't yours.",
                bad(a, body("FIRE", seen()).put("hikeId", hike.toString())));
    }

    @Test
    void reportOnAnotherRouteIsHeldBehindAnUnfinishedHike() throws Exception {
        String a = register("A");
        UUID hike = UUID.randomUUID();
        putHike(a, hike, "s", false, false);
        UUID id = UUID.randomUUID();
        ObjectNode n = body("OBSTRUCTION", seen()).put("hikeId", hike.toString());
        JsonNode r = ok(a, id, n);
        assertEquals("r", r.get("routeId").asText());
        assertTrue(r.get("held").asBoolean());
        putHike(a, hike, "s", true, false);
        assertFalse(ok(a, id, n).get("held").asBoolean());
    }

    @Test
    void everyHikeRefusalReadsTheSame() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID foreign = putHike(b, "s", false, false);
        UUID deleted = UUID.randomUUID();
        putHike(a, deleted, "r", false, false);
        putHike(a, deleted, "r", false, true);
        String msg = "That hike isn't yours.";
        assertEquals(msg, bad(a, body("FIRE", seen()).put("hikeId", foreign.toString())));
        assertEquals(msg, bad(a, body("FIRE", seen()).put("hikeId", deleted.toString())));
        assertEquals(msg, bad(a, body("FIRE", seen()).put("hikeId", UUID.randomUUID().toString())));
    }

    @Test
    void deletedHikeIs400() throws Exception {
        String a = register("A");
        UUID hike = UUID.randomUUID();
        putHike(a, hike, "r", false, false);
        putHike(a, hike, "r", false, true);
        bad(a, body("FIRE", seen()).put("hikeId", hike.toString()));
    }

    @Test
    void unknownHikeIs400() throws Exception {
        String a = register("A");
        bad(a, body("FIRE", seen()).put("hikeId", UUID.randomUUID().toString()));
    }

    @Test
    void softDeletedUserIs401() throws Exception {
        String a = register("A");
        jdbc.update("update app_user set deleted_at = now()");
        file(a, UUID.randomUUID(), body("FIRE", seen())).andExpect(status().isUnauthorized());
    }

    @Test
    void requiresAuth() throws Exception {
        mvc.perform(put("/api/v1/reports/" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(body("FIRE", seen()))))
                .andExpect(status().isUnauthorized());
    }
}
