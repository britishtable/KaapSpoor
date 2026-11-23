package za.kaapspoor.server.hike;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
class HikeReviewApiTest {

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
        jdbc.update("delete from route where id in ('r-1')");
        jdbc.update("insert into route (id, title, area, graded, updated_at)"
                + " values ('r-1', 'R1', '{Cape Town}', true, now())");
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

    private ObjectNode body(ObjectNode review) {
        ObjectNode n = json.createObjectNode();
        n.put("routeId", "r-1");
        n.putNull("date");
        n.put("notes", "n");
        n.put("visibility", "PRIVATE");
        n.put("notesVisibility", "PRIVATE");
        n.putNull("plan");
        n.putNull("startedAt");
        n.putNull("finishedAt");
        n.put("updatedAt", clock.instant().toString());
        n.put("deleted", false);
        if (review == null) n.putNull("review"); else n.set("review", review);
        return n;
    }

    private ObjectNode fullReview() {
        ObjectNode r = json.createObjectNode();
        r.put("difficulty", "HARDER");
        r.put("enjoyment", 4);
        r.put("safety", "MOSTLY");
        r.put("safetyNote", "loose scree");
        r.put("navigation", "OBVIOUS");
        r.put("water", "SEASONAL");
        r.put("note", "go early");
        return r;
    }

    private ResultActions putRaw(String token, UUID id, ObjectNode body) throws Exception {
        return mvc.perform(put("/api/v1/hikes/" + id)
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body)));
    }

    private JsonNode putOk(String token, UUID id, ObjectNode body) throws Exception {
        return json.readTree(putRaw(token, id, body).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    @Test
    void putWithReviewRoundTrips() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        JsonNode h = putOk(t, id, body(fullReview()));
        assertEquals(fullReview(), h.get("review"));
        String feed = mvc.perform(get("/api/v1/hikes?since=0").header("Authorization", "Bearer " + t))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertEquals(fullReview(), json.readTree(feed).get("hikes").get(0).get("review"));
    }

    @Test
    void absentAnswersAreOmitted() throws Exception {
        String t = register("a@example.com");
        ObjectNode r = json.createObjectNode().put("enjoyment", 3);
        JsonNode h = putOk(t, UUID.randomUUID(), body(r));
        assertEquals(r, h.get("review"));
    }

    @Test
    void putWithoutReviewClearsIt() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        putOk(t, id, body(fullReview()));
        clock.advance(10);
        JsonNode h = putOk(t, id, body(null));
        assertTrue(h.get("review").isNull());
    }

    @Test
    void emptyReviewIs400() throws Exception {
        String t = register("a@example.com");
        putRaw(t, UUID.randomUUID(), body(json.createObjectNode()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("A review needs at least one answer."));
        putRaw(t, UUID.randomUUID(), body(json.createObjectNode().put("note", "  ")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void noteOver2000Is400() throws Exception {
        String t = register("a@example.com");
        putRaw(t, UUID.randomUUID(), body(json.createObjectNode().put("note", "x".repeat(2001))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("That review is too long."));
        putOk(t, UUID.randomUUID(), body(json.createObjectNode().put("note", "x".repeat(2000))));
    }

    @Test
    void safetyNoteOver1000Is400() throws Exception {
        String t = register("a@example.com");
        putRaw(t, UUID.randomUUID(), body(json.createObjectNode().put("safety", "NO").put("safetyNote", "x".repeat(1001))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("That review is too long."));
    }

    @Test
    void safetyNoteWithoutSafetyIs400() throws Exception {
        String t = register("a@example.com");
        putRaw(t, UUID.randomUUID(), body(json.createObjectNode().put("safetyNote", "x").put("note", "y")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Say whether it felt safe before saying what happened."));
    }

    @Test
    void enjoymentOutOfRangeIs400() throws Exception {
        String t = register("a@example.com");
        putRaw(t, UUID.randomUUID(), body(json.createObjectNode().put("enjoyment", 6)))
                .andExpect(status().isBadRequest());
        putRaw(t, UUID.randomUUID(), body(json.createObjectNode().put("enjoyment", 0)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void reviewOnActiveHikeIs400() throws Exception {
        String t = register("a@example.com");
        ObjectNode b = body(fullReview());
        b.put("startedAt", clock.instant().minusSeconds(60).toString());
        putRaw(t, UUID.randomUUID(), b)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value("Finish the hike before reviewing it."));
    }

    @Test
    void reviewOnTomorrowsHikeIs400() throws Exception {
        String t = register("a@example.com");
        LocalDate tomorrow = clock.instant().atZone(ZoneId.of("Africa/Johannesburg")).toLocalDate().plusDays(1);
        ObjectNode b = body(fullReview());
        b.put("date", tomorrow.toString());
        putRaw(t, UUID.randomUUID(), b)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.detail").value(containsString("once it's happened")));
        ObjectNode c = body(null);
        c.put("date", tomorrow.toString());
        putOk(t, UUID.randomUUID(), c);
    }

    @Test
    void eitherScaleAccepted() throws Exception {
        String t = register("a@example.com");
        putOk(t, UUID.randomUUID(), body(json.createObjectNode().put("difficulty", "EASY")));
    }

    @Test
    void tombstoneDropsReview() throws Exception {
        String t = register("a@example.com");
        UUID id = UUID.randomUUID();
        putOk(t, id, body(fullReview()));
        clock.advance(10);
        ObjectNode del = body(fullReview());
        del.put("deleted", true);
        JsonNode h = putOk(t, id, del);
        assertTrue(h.get("review").isNull());
        Map<String, Object> row = jdbc.queryForMap(
                "select review_note, review_difficulty, review_enjoyment, review_safety, review_safety_note,"
                        + " review_navigation, review_water from hike where id = ?", id);
        row.values().forEach(v -> assertNull(v));
    }
}
