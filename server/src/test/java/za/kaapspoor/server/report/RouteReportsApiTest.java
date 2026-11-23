package za.kaapspoor.server.report;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import za.kaapspoor.server.MutableClock;
import za.kaapspoor.server.TestClockConfig;
import za.kaapspoor.server.TestcontainersConfig;

@SpringBootTest
@AutoConfigureMockMvc
@Import({TestcontainersConfig.class, TestClockConfig.class})
@ActiveProfiles("test")
class RouteReportsApiTest {

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

    private UUID startHike(String token) throws Exception {
        UUID id = UUID.randomUUID();
        putHike(token, id, false);
        return id;
    }

    private void putHike(String token, UUID id, boolean finished) throws Exception {
        ObjectNode n = json.createObjectNode();
        n.put("routeId", "r");
        n.putNull("date");
        n.put("notes", "n");
        n.put("visibility", "PRIVATE");
        n.put("notesVisibility", "PRIVATE");
        n.putNull("plan");
        n.put("startedAt", clock.instant().minusSeconds(3600).toString());
        if (finished) n.put("finishedAt", clock.instant().toString()); else n.putNull("finishedAt");
        n.put("updatedAt", clock.instant().toString());
        n.put("deleted", false);
        n.putNull("review");
        mvc.perform(put("/api/v1/hikes/" + id)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(n)))
                .andExpect(status().isOk());
        clock.advance(1);
    }

    private UUID file(String token, String category, String note, UUID hikeId) throws Exception {
        UUID id = UUID.randomUUID();
        ObjectNode n = json.createObjectNode();
        n.put("routeId", "r");
        n.put("category", category);
        n.put("note", note);
        n.put("observedAt", clock.instant().minus(Duration.ofHours(1)).truncatedTo(ChronoUnit.MILLIS).toString());
        if (hikeId != null) n.put("hikeId", hikeId.toString());
        mvc.perform(put("/api/v1/reports/" + id)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(n)))
                .andExpect(status().isOk());
        return id;
    }

    private UUID fileAt(String token, String category, Instant observedAt) throws Exception {
        UUID id = UUID.randomUUID();
        ObjectNode n = json.createObjectNode();
        n.put("routeId", "r");
        n.put("category", category);
        n.put("observedAt", observedAt.truncatedTo(ChronoUnit.MILLIS).toString());
        mvc.perform(put("/api/v1/reports/" + id)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(n)))
                .andExpect(status().isOk());
        return id;
    }

    private UUID file(String token, String category) throws Exception {
        return file(token, category, "", null);
    }

    private String rawList(String route) throws Exception {
        return mvc.perform(get("/api/v1/routes/" + route + "/reports"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    private JsonNode list() throws Exception {
        return json.readTree(rawList("r"));
    }

    private JsonNode mine(String token, String route) throws Exception {
        return json.readTree(mvc.perform(get("/api/v1/reports/mine").param("routeId", route)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    @Test
    void anonymousCanRead() throws Exception {
        JsonNode l = list();
        assertEquals(0, l.get("active").size());
        assertEquals(0, l.get("history").size());
    }

    @Test
    void unknownRouteIs404() throws Exception {
        mvc.perform(get("/api/v1/routes/nope/reports")).andExpect(status().isNotFound());
    }

    @Test
    void mineNeedsSignIn() throws Exception {
        mvc.perform(get("/api/v1/reports/mine").param("routeId", "r")).andExpect(status().isUnauthorized());
    }

    @Test
    void heldReportIsInvisibleEvenAsACount() throws Exception {
        String a = register("Alice Hiker");
        UUID hike = startHike(a);
        UUID id = file(a, "OBSTRUCTION", "tree down", hike);
        String raw = rawList("r");
        JsonNode l = json.readTree(raw);
        assertEquals(0, l.get("active").size());
        assertEquals(0, l.get("history").size());
        assertEquals(2, l.size(), "no count or other field leaks");
        assertFalse(raw.contains("Alice Hiker"));
        assertFalse(raw.contains(id.toString()));
    }

    @Test
    void releasedOnFinish() throws Exception {
        String a = register("Alice Hiker");
        UUID hike = startHike(a);
        UUID id = file(a, "OBSTRUCTION", "tree down", hike);
        putHike(a, hike, true);
        JsonNode active = list().get("active");
        assertEquals(1, active.size());
        JsonNode r = active.get(0);
        assertEquals(id.toString(), r.get("id").asText());
        assertEquals("Alice Hiker", r.get("displayName").asText());
        assertEquals("OBSTRUCTION", r.get("category").asText());
        assertTrue(r.get("lastConfirmedAt").isNull());
        assertTrue(r.get("clearedAt").isNull());
        assertTrue(r.get("position").isNull());
        assertFalse(r.get("unverified").asBoolean());
        assertFalse(r.has("userId"));
        assertFalse(r.has("hikeId"));
    }

    @Test
    void mineShowsOwnHeldOnly() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID hike = startHike(a);
        UUID id = file(a, "OBSTRUCTION", "x", hike);
        file(a, "WATER"); // released: not held, so not in mine
        JsonNode mineA = mine(a, "r");
        assertEquals(1, mineA.size());
        assertEquals(id.toString(), mineA.get(0).get("id").asText());
        assertTrue(mineA.get(0).get("held").asBoolean());
        assertEquals(0, mine(b, "r").size());
        assertEquals(0, mine(a, "s").size());
        putHike(a, hike, true);
        assertEquals(0, mine(a, "r").size());
    }

    @Test
    void expiredMovesToHistory() throws Exception {
        String a = register("A");
        UUID id = file(a, "WILDLIFE");
        file(a, "OBSTRUCTION");
        clock.advance(3 * 86400);
        JsonNode l = list();
        assertEquals(1, l.get("active").size());
        assertEquals(1, l.get("history").size());
        JsonNode h = l.get("history").get(0);
        assertEquals(id.toString(), h.get("id").asText());
        assertTrue(Instant.parse(h.get("expiresAt").asText()).isBefore(clock.instant()));
    }

    @Test
    void historyDropsAfter90Days() throws Exception {
        String a = register("A");
        file(a, "WILDLIFE");
        Instant end = Instant.parse(list().get("active").get(0).get("expiresAt").asText());
        clock.set(end.plus(Duration.ofDays(90)).minusSeconds(1));
        assertEquals(1, list().get("history").size());
        clock.set(end.plus(Duration.ofDays(90)));
        assertEquals(0, list().get("history").size());
    }

    @Test
    void anOldExpiredReportIsNotListedButAnOldClosureIs() throws Exception {
        String a = register("A");
        file(a, "WILDLIFE");
        UUID closure = file(a, "CLOSURE");
        clock.advance(200 * 86400L);
        JsonNode l = list();
        assertEquals(0, l.get("history").size());
        assertEquals(1, l.get("active").size());
        clock.advance(200 * 86400L);
        assertEquals(closure.toString(), list().get("active").get(0).get("id").asText());
    }

    @Test
    void historyListsOnlyReleasedEvenWithAHeldCandidate() throws Exception {
        String a = register("A");
        UUID hike = startHike(a);
        UUID held = file(a, "OBSTRUCTION", "x", hike);
        jdbc.update("update report set cleared_at = ? where id = ?",
                java.sql.Timestamp.from(clock.instant()), held);
        java.util.Set<String> expected = new java.util.HashSet<>();
        for (int i = 0; i < 50; i++) {
            expected.add(fileAt(a, "WILDLIFE", clock.instant().minus(Duration.ofDays(10)).plusSeconds(i)).toString());
        }
        JsonNode h = list().get("history");
        assertEquals(50, h.size());
        for (JsonNode r : h) {
            assertTrue(expected.contains(r.get("id").asText()));
            assertFalse(r.get("id").asText().equals(held.toString()));
        }
        assertFalse(rawList("r").contains("Alice"));
        assertEquals(1, mine(a, "r").size());
    }

    @Test
    void historyCapsAt50() throws Exception {
        String a = register("A");
        java.util.List<String> ids = new java.util.ArrayList<>();
        for (int i = 0; i < 55; i++) {
            ids.add(file(a, "WILDLIFE").toString());
            clock.advance(1);
        }
        clock.advance(5 * 86400);
        JsonNode h = list().get("history");
        assertEquals(50, h.size());
        for (String oldest : ids.subList(0, 5)) {
            for (JsonNode r : h) assertFalse(r.get("id").asText().equals(oldest));
        }
        for (int i = 1; i < h.size(); i++) {
            assertFalse(Instant.parse(h.get(i).get("observedAt").asText())
                    .isAfter(Instant.parse(h.get(i - 1).get("observedAt").asText())));
        }
    }

    @Test
    void activeIsNewestFirst() throws Exception {
        String a = register("A");
        UUID first = file(a, "OBSTRUCTION");
        clock.advance(600);
        UUID second = file(a, "WATER");
        JsonNode active = list().get("active");
        assertEquals(second.toString(), active.get(0).get("id").asText());
        assertEquals(first.toString(), active.get(1).get("id").asText());
    }

    @Test
    void closureStaysActiveUntilCleared() throws Exception {
        String a = register("A");
        UUID id = file(a, "CLOSURE");
        clock.advance(400 * 86400L);
        JsonNode l = list();
        assertEquals(1, l.get("active").size());
        assertEquals(id.toString(), l.get("active").get(0).get("id").asText());
        assertTrue(l.get("active").get(0).get("expiresAt").isNull());
        assertEquals(0, l.get("history").size());
    }

    @Test
    void clearedReportIsHistory() throws Exception {
        String a = register("A");
        UUID id = file(a, "CLOSURE");
        jdbc.update("update report set cleared_at = ? where id = ?",
                java.sql.Timestamp.from(clock.instant()), id);
        JsonNode l = list();
        assertEquals(0, l.get("active").size());
        assertEquals(1, l.get("history").size());
        assertFalse(l.get("history").get(0).get("clearedAt").isNull());
    }

    @Test
    void formerMember() throws Exception {
        String a = register("Alice Hiker");
        file(a, "OBSTRUCTION");
        jdbc.update("update app_user set deleted_at = now()");
        String raw = rawList("r");
        assertEquals("Former member", json.readTree(raw).get("active").get(0).get("displayName").asText());
        assertFalse(raw.contains("Alice Hiker"));
    }

    @Test
    void noteRenderedVerbatim() throws Exception {
        String a = register("A");
        file(a, "OBSTRUCTION", "<b>big</b> & \"tree\"", null);
        assertEquals("<b>big</b> & \"tree\"", list().get("active").get(0).get("note").asText());
    }

    @Test
    void reportsAreScopedToTheirRoute() throws Exception {
        String a = register("A");
        file(a, "OBSTRUCTION");
        assertEquals(0, json.readTree(rawList("s")).get("active").size());
    }
}
