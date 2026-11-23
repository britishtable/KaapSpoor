package za.kaapspoor.server.hike;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
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
class HikeApiTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired MutableClock clock;

    @BeforeEach
    void clean() {
        clock.reset();
        jdbc.update("delete from report_confirmation");
        jdbc.update("delete from report");
        jdbc.update("delete from hike");
        jdbc.update("delete from identity");
        jdbc.update("delete from refresh_token");
        jdbc.update("delete from app_user");
        jdbc.update("delete from route where id in ('r-1', 'r-old')");
        jdbc.update("insert into route (id, title, area, updated_at) values ('r-1', 'R1', '{Cape Town}', now())");
        jdbc.update("insert into route (id, title, area, retired_at, updated_at)"
                + " values ('r-old', 'Old', '{Cape Town}', now(), now())");
    }

    private String register(String email) throws Exception {
        String body = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(
                                Map.of("email", email, "password", "correct-horse", "displayName", "Sam"))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body).get("accessToken").asText();
    }

    private ObjectNode body(String notes, Instant updatedAt) {
        ObjectNode n = json.createObjectNode();
        n.put("routeId", "r-1");
        n.putNull("date");
        n.put("notes", notes);
        n.put("visibility", "PRIVATE");
        n.put("notesVisibility", "PRIVATE");
        n.putNull("plan");
        n.putNull("startedAt");
        n.putNull("finishedAt");
        n.put("updatedAt", updatedAt.toString());
        n.put("deleted", false);
        return n;
    }

    private ResultActions putRaw(String token, UUID id, ObjectNode body) throws Exception {
        return mvc.perform(put("/api/v1/hikes/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body)));
    }

    private JsonNode putOk(String token, UUID id, ObjectNode body) throws Exception {
        String s = putRaw(token, id, body).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return json.readTree(s);
    }

    private JsonNode feed(String token, String query) throws Exception {
        String s = mvc.perform(get("/api/v1/hikes" + query).header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(s);
    }

    private Instant at(long secondsFromNow) {
        return clock.instant().plusSeconds(secondsFromNow);
    }

    @Test
    void putCreatesThenGetReturnsIt() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        JsonNode h = putOk(t, id, body("hello", at(0)));
        assertEquals(1, h.get("revision").asLong());
        assertEquals(id.toString(), h.get("id").asText());
        assertEquals("hello", h.get("notes").asText());
        assertEquals(false, h.get("deleted").asBoolean());
        JsonNode f = feed(t, "?since=0");
        assertEquals(1, f.get("hikes").size());
        assertEquals(1, f.get("next").asLong());
        assertEquals(false, f.get("hasMore").asBoolean());
    }

    @Test
    void planRoundTrips() throws Exception {
        String t = register("a@example.com");
        ObjectNode b = body("n", at(0));
        b.putObject("plan").put("approach", "a-1").put("reversed", true);
        JsonNode h = putOk(t, UUID.randomUUID(), b);
        assertEquals("a-1", h.get("plan").get("approach").asText());
        assertEquals(true, h.get("plan").get("reversed").asBoolean());
    }

    @Test
    void retryIsIdempotent() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        ObjectNode b = body("hello", at(0));
        JsonNode first = putOk(t, id, b);
        JsonNode second = putOk(t, id, b);
        // Rule 7: an equal write is applied again, so only the revision may move.
        assertEquals(((ObjectNode) first).without("revision"), ((ObjectNode) second).without("revision"));
        assertEquals(1, jdbc.queryForObject("select count(*) from hike", Integer.class));
    }

    @Test
    void olderWriteLoses() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        putOk(t, id, body("newer", at(0)));
        JsonNode r = putOk(t, id, body("older", at(-60)));
        assertEquals("newer", r.get("notes").asText());
        assertEquals(1, r.get("revision").asLong());
        assertEquals(1, feed(t, "").get("next").asLong());
    }

    @Test
    void futureClockIsClamped() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        putOk(t, id, body("a", Instant.parse("2099-01-01T00:00:00Z")));
        clock.advance(1);
        JsonNode r = putOk(t, id, body("b", at(0)));
        assertEquals("b", r.get("notes").asText());
        assertEquals(2, r.get("revision").asLong());
    }

    @Test
    void deleteIsFinalAndScrubbed() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        ObjectNode b = body("secret", at(0));
        b.putObject("plan").put("main", "m-1").put("reversed", false);
        dated(b);
        putOk(t, id, b);
        clock.advance(1);
        ObjectNode del = body("secret", at(0));
        dated(del);
        del.put("deleted", true);
        JsonNode tomb = putOk(t, id, del);
        assertEquals(true, tomb.get("deleted").asBoolean());
        assertEquals("", tomb.get("notes").asText());
        assertEquals("r-1", tomb.get("routeId").asText());
        assertWhenScrubbed(tomb);
        assertEquals(2, tomb.get("revision").asLong());

        clock.advance(1);
        JsonNode again = putOk(t, id, body("again", at(0)));
        assertEquals(true, again.get("deleted").asBoolean());
        assertEquals("", again.get("notes").asText());
        assertEquals(true, again.get("plan").isNull());
        assertEquals(2, again.get("revision").asLong());

        JsonNode f = feed(t, "?since=0");
        assertEquals(1, f.get("hikes").size());
        assertEquals(true, f.get("hikes").get(0).get("deleted").asBoolean());
        assertWhenScrubbed(f.get("hikes").get(0));
        assertEquals(2, f.get("next").asLong());
    }

    @Test
    void staleDeleteStillWins() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        ObjectNode b = body("edited", at(0));
        b.putObject("plan").put("main", "m-1").put("reversed", false);
        dated(b);
        putOk(t, id, b);
        ObjectNode del = body("edited", at(-60));
        dated(del);
        del.put("deleted", true);
        JsonNode r = putOk(t, id, del);
        assertEquals(true, r.get("deleted").asBoolean());
        assertEquals("", r.get("notes").asText());
        assertEquals(true, r.get("plan").isNull());
        assertWhenScrubbed(r);
        assertEquals(2, r.get("revision").asLong());
        JsonNode f = feed(t, "?since=1");
        assertEquals(1, f.get("hikes").size());
        assertEquals(true, f.get("hikes").get(0).get("deleted").asBoolean());
        assertWhenScrubbed(f.get("hikes").get(0));
        assertEquals(2, f.get("next").asLong());
    }

    @Test
    void planOmitsAbsentLegsInsteadOfNull() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        ObjectNode b = body("n", at(0));
        b.putObject("plan").put("main", "m-1").put("reversed", false);
        JsonNode plan = putOk(t, id, b).get("plan");
        assertEquals("m-1", plan.get("main").asText());
        assertEquals(false, plan.has("approach"));
        assertEquals(false, plan.has("exit"));
        JsonNode fed = feed(t, "").get("hikes").get(0).get("plan");
        assertEquals(false, fed.has("approach"));
        assertEquals(false, fed.has("exit"));
    }

    /** A hike with a date and start/finish times, so a delete has something to scrub. */
    private void dated(ObjectNode b) {
        b.put("date", "2026-07-21");
        b.put("startedAt", at(-7200).toString());
        b.put("finishedAt", at(-3600).toString());
    }

    private static void assertWhenScrubbed(JsonNode tomb) {
        assertEquals(true, tomb.get("date").isNull());
        assertEquals(true, tomb.get("startedAt").isNull());
        assertEquals(true, tomb.get("finishedAt").isNull());
    }

    @Test
    void unknownVisibilityIs400() throws Exception {
        String t = register("a@example.com");
        ObjectNode b = body("n", at(0));
        b.put("visibility", "SECRET");
        putRaw(t, UUID.randomUUID(), b)
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
    }

    @Test
    void otherUsersIdIs409() throws Exception {
        String a = register("a@example.com");
        String b = register("b@example.com");
        UUID id = UUID.randomUUID();
        putOk(a, id, body("mine", at(0)));
        putRaw(b, id, body("theirs", at(0)))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.detail").value("This hike id is already in use."));
        assertEquals(0, feed(b, "").get("hikes").size());
        assertEquals("mine", feed(a, "").get("hikes").get(0).get("notes").asText());
    }

    @Test
    void unknownRouteIs400() throws Exception {
        String t = register("a@example.com");
        ObjectNode b = body("n", at(0));
        b.put("routeId", "nope");
        putRaw(t, UUID.randomUUID(), b).andExpect(status().isBadRequest());
    }

    @Test
    void retiredRouteIsAccepted() throws Exception {
        String t = register("a@example.com");
        ObjectNode b = body("n", at(0));
        b.put("routeId", "r-old");
        putRaw(t, UUID.randomUUID(), b).andExpect(status().isOk());
    }

    @Test
    void notesOver5000Is400() throws Exception {
        String t = register("a@example.com");
        putRaw(t, UUID.randomUUID(), body("x".repeat(5001), at(0))).andExpect(status().isBadRequest());
        putRaw(t, UUID.randomUUID(), body("x".repeat(5000), at(0))).andExpect(status().isOk());
    }

    @Test
    void finishWithoutStartIs400() throws Exception {
        String t = register("a@example.com");
        ObjectNode b = body("n", at(0));
        b.put("finishedAt", at(-10).toString());
        putRaw(t, UUID.randomUUID(), b)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(containsString("start")));
    }

    @Test
    void finishBeforeStartIs400() throws Exception {
        String t = register("a@example.com");
        ObjectNode b = body("n", at(0));
        b.put("startedAt", at(-10).toString());
        b.put("finishedAt", at(-20).toString());
        putRaw(t, UUID.randomUUID(), b).andExpect(status().isBadRequest());
    }

    @Test
    void dateTomorrowAcceptedDayAfterIs400() throws Exception {
        String t = register("a@example.com");
        LocalDate today = clock.instant().atZone(ZoneId.of("Africa/Johannesburg")).toLocalDate();
        ObjectNode ok = body("n", at(0));
        ok.put("date", today.plusDays(1).toString());
        putRaw(t, UUID.randomUUID(), ok).andExpect(status().isOk());
        ObjectNode bad = body("n", at(0));
        bad.put("date", today.plusDays(2).toString());
        putRaw(t, UUID.randomUUID(), bad).andExpect(status().isBadRequest());
        ObjectNode old = body("n", at(0));
        old.put("date", "1949-12-31");
        putRaw(t, UUID.randomUUID(), old).andExpect(status().isBadRequest());
    }

    @Test
    void planIdOver200Is400() throws Exception {
        String t = register("a@example.com");
        ObjectNode b = body("n", at(0));
        b.putObject("plan").put("exit", "x".repeat(201)).put("reversed", false);
        putRaw(t, UUID.randomUUID(), b).andExpect(status().isBadRequest());
    }

    @Test
    void feedPagesWithLimit() throws Exception {
        String t = register("a@example.com");
        for (int i = 0; i < 3; i++) {
            putOk(t, UUID.randomUUID(), body("h" + i, at(i)));
        }
        JsonNode p1 = feed(t, "?since=0&limit=2");
        assertEquals(2, p1.get("hikes").size());
        assertEquals(true, p1.get("hasMore").asBoolean());
        assertEquals(2, p1.get("next").asLong());
        JsonNode p2 = feed(t, "?since=" + p1.get("next").asLong() + "&limit=2");
        assertEquals(1, p2.get("hikes").size());
        assertEquals(false, p2.get("hasMore").asBoolean());
        assertEquals(3, p2.get("next").asLong());
        JsonNode empty = feed(t, "?since=3");
        assertEquals(0, empty.get("hikes").size());
        assertEquals(3, empty.get("next").asLong());
    }

    @Test
    void requiresAuth() throws Exception {
        mvc.perform(put("/api/v1/hikes/" + UUID.randomUUID())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(body("n", at(0)))))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/hikes")).andExpect(status().isUnauthorized());
    }
}
