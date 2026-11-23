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
class ReportConfirmationApiTest {

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


    private com.fasterxml.jackson.databind.JsonNode answer(String token, UUID id, String answer, int expect) throws Exception {
        var res = mvc.perform(put("/api/v1/reports/" + id + "/confirmation")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"answer\":\"" + answer + "\"}"))
                .andExpect(status().is(expect)).andReturn().getResponse().getContentAsString();
        return res.isEmpty() ? null : json.readTree(res);
    }

    private JsonNode answer(String token, UUID id, String answer) throws Exception {
        return answer(token, id, answer, 200);
    }

    @Test
    void stillThereRefreshesLifetime() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID id = file(a, "WILDLIFE");
        clock.advance(86400);
        JsonNode r = answer(b, id, "STILL_THERE");
        assertEquals(clock.instant().plus(Duration.ofDays(2)).truncatedTo(ChronoUnit.MILLIS),
                Instant.parse(r.get("expiresAt").asText()).truncatedTo(ChronoUnit.MILLIS));
        assertFalse(r.get("lastConfirmedAt").isNull());
        assertEquals("A", r.get("displayName").asText());
    }

    @Test
    void twoDistinctGoneClears() throws Exception {
        String a = register("A");
        String b = register("B");
        String c = register("C");
        UUID id = file(a, "OBSTRUCTION");
        assertTrue(answer(b, id, "GONE").get("clearedAt").isNull());
        assertFalse(answer(c, id, "GONE").get("clearedAt").isNull());
        assertEquals(0, list().get("active").size());
        assertEquals(1, list().get("history").size());
    }

    @Test
    void sameUserGoneTwiceCountsOnce() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID id = file(a, "OBSTRUCTION");
        answer(b, id, "GONE");
        answer(b, id, "GONE");
        answer(b, id, "NOT_SURE");
        JsonNode r = answer(b, id, "GONE");
        assertTrue(r.get("clearedAt").isNull());
        assertEquals(1, list().get("active").size());
    }

    @Test
    void authorGoneClearsAlone() throws Exception {
        String a = register("A");
        UUID id = file(a, "OBSTRUCTION");
        assertFalse(answer(a, id, "GONE").get("clearedAt").isNull());
    }

    @Test
    void notSureChangesNothing() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID id = file(a, "SAFETY");
        JsonNode r = answer(b, id, "NOT_SURE");
        assertTrue(r.get("lastConfirmedAt").isNull());
        assertTrue(r.get("clearedAt").isNull());
        assertTrue(r.get("unverified").asBoolean());
    }

    @Test
    void safetyUnverifiedUntilSecondPerson() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID id = file(a, "SAFETY");
        assertTrue(answer(a, id, "STILL_THERE").get("unverified").asBoolean());
        assertFalse(answer(b, id, "STILL_THERE").get("unverified").asBoolean());
    }

    @Test
    void confirmingHeldIs404() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID id = file(a, "OBSTRUCTION", "x", startHike(a));
        answer(b, id, "STILL_THERE", 404);
        answer(a, id, "STILL_THERE", 404);
        answer(b, UUID.randomUUID(), "STILL_THERE", 404);
    }

    @Test
    void confirmingExpiredIs409() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID id = file(a, "WILDLIFE");
        clock.advance(3 * 86400);
        answer(b, id, "STILL_THERE", 409);
    }

    @Test
    void confirmingClearedIs409() throws Exception {
        String a = register("A");
        String b = register("B");
        UUID id = file(a, "OBSTRUCTION");
        answer(a, id, "GONE");
        answer(b, id, "STILL_THERE", 409);
    }

    @Test
    void requiresAuth() throws Exception {
        mvc.perform(put("/api/v1/reports/" + UUID.randomUUID() + "/confirmation")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"answer\":\"GONE\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void badAnswerIs400() throws Exception {
        String a = register("A");
        UUID id = file(a, "OBSTRUCTION");
        mvc.perform(put("/api/v1/reports/" + id + "/confirmation").header("Authorization", "Bearer " + a)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"answer\":\"MAYBE\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/v1/reports/" + id + "/confirmation").header("Authorization", "Bearer " + a)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void twoSimultaneousGoneAnswersClear() throws Exception {
        String a = register("A");
        String b = register("B");
        String c = register("C");
        UUID id = file(a, "OBSTRUCTION");
        var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            var f1 = pool.submit(() -> answer(b, id, "GONE", 200));
            var f2 = pool.submit(() -> answer(c, id, "GONE", 200));
            f1.get();
            f2.get();
        } finally {
            pool.shutdown();
        }
        assertEquals(0, list().get("active").size());
    }
}
