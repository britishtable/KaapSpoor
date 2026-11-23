package za.kaapspoor.server.review;

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
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
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
class RouteReviewApiTest {

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
        jdbc.update("delete from route where id in ('g', 'u')");
        jdbc.update("insert into route (id, title, area, graded, updated_at)"
                + " values ('g', 'Graded', '{Cape Town}', true, now())");
        jdbc.update("insert into route (id, title, area, graded, updated_at)"
                + " values ('u', 'Ungraded', '{Cape Town}', false, now())");
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

    /** PUTs a hike; {@code review} may be null. Returns the hike id. */
    private UUID hike(String token, String route, String date, String visibility, ObjectNode review,
            boolean deleted, UUID id) throws Exception {
        ObjectNode n = json.createObjectNode();
        n.put("routeId", route);
        if (date == null) n.putNull("date"); else n.put("date", date);
        n.put("notes", "n");
        n.put("visibility", visibility);
        n.put("notesVisibility", "PRIVATE");
        n.putNull("plan");
        n.putNull("startedAt");
        n.putNull("finishedAt");
        n.put("updatedAt", clock.instant().toString());
        n.put("deleted", deleted);
        if (review == null) n.putNull("review"); else n.set("review", review);
        mvc.perform(put("/api/v1/hikes/" + id)
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(n)))
                .andExpect(status().isOk());
        clock.advance(1);
        return id;
    }

    private UUID hike(String token, String route, String date, String visibility, ObjectNode review)
            throws Exception {
        return hike(token, route, date, visibility, review, false, UUID.randomUUID());
    }

    private ObjectNode difficulty(String d) {
        return json.createObjectNode().put("difficulty", d);
    }

    private static final ZoneId SA = ZoneId.of("Africa/Johannesburg");

    /** Reads the reviews as they are right now, with the clock where the test left it. */
    private String rawNow(String route) throws Exception {
        return mvc.perform(get("/api/v1/routes/" + route + "/reviews"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    private JsonNode readNow(String route) throws Exception {
        return json.readTree(rawNow(route));
    }

    /** Reads as if it were the next South African day, then puts the clock back. */
    private String raw(String route) throws Exception {
        Instant saved = clock.instant();
        clock.set(saved.atZone(SA).toLocalDate().plusDays(1).atStartOfDay(SA).toInstant().plusSeconds(1));
        try {
            return rawNow(route);
        } finally {
            clock.set(saved);
        }
    }

    private JsonNode read(String route) throws Exception {
        return json.readTree(raw(route));
    }

    private List<String> names(JsonNode r) {
        List<String> out = new ArrayList<>();
        for (JsonNode rv : r.get("reviews")) out.add(rv.get("displayName").asText());
        return out;
    }

    @Test
    void anonymousCanRead() throws Exception {
        mvc.perform(get("/api/v1/routes/g/reviews")).andExpect(status().isOk());
    }

    @Test
    void unknownRouteIs404() throws Exception {
        mvc.perform(get("/api/v1/routes/nope/reviews")).andExpect(status().isNotFound());
    }

    @Test
    void countsPeopleNotHikes() throws Exception {
        String a = register("A");
        String b = register("B");
        String c = register("C");
        hike(a, "g", "2026-01-01", "PUBLIC", difficulty("AS_GRADED"));
        hike(a, "g", "2026-02-01", "PUBLIC", difficulty("AS_GRADED"));
        hike(a, "g", "2026-03-01", "PUBLIC", difficulty("AS_GRADED"));
        hike(a, "g", "2026-04-01", "PUBLIC", difficulty("HARDER"));
        hike(b, "g", "2026-01-01", "PUBLIC", difficulty("AS_GRADED"));
        hike(c, "g", "2026-01-01", "PUBLIC", difficulty("AS_GRADED"));
        JsonNode r = read("g");
        assertEquals(3, r.get("people").asInt());
        assertEquals(3, r.get("summary").get("difficulty").get("answered").asInt());
        JsonNode counts = r.get("summary").get("difficulty").get("counts");
        assertEquals(1, counts.get("HARDER").asInt());
        assertEquals(2, counts.get("AS_GRADED").asInt());
        assertEquals(3, r.get("reviews").size());
    }

    @Test
    void latestIsByHikeDateThenUpdatedAt() throws Exception {
        String a = register("A");
        hike(a, "g", "2026-03-01", "PUBLIC", difficulty("EASIER"));
        hike(a, "g", null, "PUBLIC", difficulty("HARDER"));
        for (String n : new String[] {"B", "C"}) {
            hike(register(n), "g", "2026-01-01", "PUBLIC", difficulty("EASIER"));
        }
        JsonNode counts = read("g").get("summary").get("difficulty").get("counts");
        assertEquals(3, counts.get("EASIER").asInt());
        assertFalse(counts.has("HARDER"));
    }

    @Test
    void summaryHiddenBelowThree() throws Exception {
        hike(register("A"), "g", "2026-01-01", "PUBLIC", difficulty("EASIER"));
        hike(register("B"), "g", "2026-01-01", "PUBLIC", difficulty("EASIER"));
        JsonNode r = read("g");
        assertTrue(r.get("summary").get("difficulty").isNull());
        assertEquals(2, r.get("reviews").size());
    }

    @Test
    void privateHikeShowsNoMonth() throws Exception {
        hike(register("Priv"), "g", "2026-03-14", "PRIVATE", difficulty("EASIER"));
        hike(register("Fr"), "g", "2026-03-14", "FRIENDS", difficulty("EASIER"));
        hike(register("Pub"), "g", "2026-03-14", "PUBLIC", difficulty("EASIER"));
        hike(register("NoDate"), "g", null, "PUBLIC", difficulty("EASIER"));
        String body = raw("g");
        assertFalse(body.contains("2026-03-14"));
        for (JsonNode rv : json.readTree(body).get("reviews")) {
            switch (rv.get("displayName").asText()) {
                case "Priv", "Fr" -> {
                    assertTrue(rv.get("month").isNull());
                    assertTrue(rv.get("dateRecorded").asBoolean());
                }
                case "Pub" -> {
                    assertEquals("2026-03", rv.get("month").asText());
                    assertTrue(rv.get("dateRecorded").asBoolean());
                }
                default -> {
                    assertTrue(rv.get("month").isNull());
                    assertFalse(rv.get("dateRecorded").asBoolean());
                }
            }
        }
    }

    @Test
    void wrongScaleDropped() throws Exception {
        for (String n : new String[] {"A", "B", "C"}) {
            hike(register(n), "g", "2026-01-01", "PUBLIC", difficulty("EASY").put("enjoyment", 4));
        }
        hike(register("D"), "g", "2026-01-01", "PUBLIC", difficulty("HARDER"));
        JsonNode r = read("g");
        assertTrue(r.get("summary").get("difficulty").isNull());
        assertEquals(3, r.get("summary").get("enjoyment").get("answered").asInt());
        int withoutDifficulty = 0;
        for (JsonNode rv : r.get("reviews")) {
            if (rv.has("enjoyment")) {
                assertFalse(rv.has("difficulty"));
                withoutDifficulty++;
            }
        }
        assertEquals(3, withoutDifficulty);
    }

    @Test
    void deletedHikeDisappears() throws Exception {
        String aTok = register("A");
        UUID gone = hike(aTok, "g", "2026-01-01", "PUBLIC", difficulty("EASIER"));
        hike(register("B"), "g", "2026-01-01", "PUBLIC", difficulty("EASIER"));
        hike(register("C"), "g", "2026-01-01", "PUBLIC", difficulty("EASIER"));
        assertEquals(3, read("g").get("people").asInt());
        hike(aTok, "g", "2026-01-01", "PUBLIC", null, true, gone);
        JsonNode r = read("g");
        assertEquals(2, r.get("people").asInt());
        assertEquals(2, r.get("reviews").size());
        assertTrue(r.get("summary").get("difficulty").isNull());
    }

    @Test
    void formerMember() throws Exception {
        hike(register("Gone"), "g", "2026-01-01", "PUBLIC", difficulty("EASIER"));
        jdbc.update("update app_user set deleted_at = now() where display_name = 'Gone'");
        assertEquals("Former member", read("g").get("reviews").get(0).get("displayName").asText());
    }

    @Test
    void noteOnlyReviewListedNotCounted() throws Exception {
        hike(register("A"), "g", "2026-01-01", "PUBLIC", json.createObjectNode().put("note", "lovely"));
        JsonNode r = read("g");
        assertEquals(1, r.get("people").asInt());
        assertEquals(1, r.get("reviews").size());
        assertEquals("lovely", r.get("reviews").get(0).get("note").asText());
        for (String q : new String[] {"difficulty", "enjoyment", "safety", "navigation", "water"}) {
            assertTrue(r.get("summary").get(q).isNull());
        }
    }

    @Test
    void onlyWrongScaleAnswerIsExcludedEntirely() throws Exception {
        hike(register("Only"), "g", "2026-01-01", "PUBLIC", difficulty("EASY"));
        hike(register("Other"), "g", "2026-01-01", "PUBLIC", difficulty("EASIER"));
        JsonNode r = read("g");
        assertEquals(1, r.get("people").asInt());
        assertEquals(1, r.get("reviews").size());
        assertEquals("Other", r.get("reviews").get(0).get("displayName").asText());
    }

    @Test
    void sameDateTieBrokenByUpdatedAt() throws Exception {
        String a = register("A");
        hike(a, "g", "2026-03-01", "PUBLIC", difficulty("EASIER"));
        hike(a, "g", "2026-03-01", "PUBLIC", difficulty("HARDER"));
        for (String n : new String[] {"B", "C"}) {
            hike(register(n), "g", "2026-01-01", "PUBLIC", difficulty("HARDER"));
        }
        JsonNode counts = read("g").get("summary").get("difficulty").get("counts");
        assertEquals(3, counts.get("HARDER").asInt());
        assertFalse(counts.has("EASIER"));
    }

    @Test
    void newerUnreviewedHikeKeepsOlderReview() throws Exception {
        String a = register("A");
        hike(a, "g", "2026-01-01", "PUBLIC", difficulty("HARDER"));
        hike(a, "g", "2026-06-01", "PUBLIC", null);
        for (String n : new String[] {"B", "C"}) {
            hike(register(n), "g", "2026-01-01", "PUBLIC", difficulty("HARDER"));
        }
        JsonNode r = read("g");
        assertEquals(3, r.get("people").asInt());
        assertEquals(3, r.get("summary").get("difficulty").get("counts").get("HARDER").asInt());
    }

    @Test
    void ungradedRouteCountsItsOwnScaleOnly() throws Exception {
        hike(register("A"), "u", "2026-01-01", "PUBLIC", difficulty("EASY"));
        hike(register("B"), "u", "2026-01-01", "PUBLIC", difficulty("MODERATE"));
        hike(register("C"), "u", "2026-01-01", "PUBLIC", difficulty("HARD"));
        hike(register("D"), "u", "2026-01-01", "PUBLIC", difficulty("EASIER"));
        JsonNode r = read("u");
        assertFalse(r.get("graded").asBoolean());
        assertEquals(3, r.get("people").asInt());
        JsonNode d = r.get("summary").get("difficulty");
        assertEquals(3, d.get("answered").asInt());
        assertEquals(1, d.get("counts").get("EASY").asInt());
        assertEquals(1, d.get("counts").get("MODERATE").asInt());
        assertEquals(1, d.get("counts").get("HARD").asInt());
        assertFalse(d.get("counts").has("EASIER"));
    }

    @Test
    void reviewWrittenTodayIsHiddenUntilTheNextSaDay() throws Exception {
        // 23:30 in Johannesburg is 21:30Z: still "today" in SA, though UTC midnight is hours away.
        String a = register("A"); // tokens are issued at the real time, so register before moving the clock
        clock.set(Instant.parse("2026-06-10T21:30:00Z"));
        hike(a, "g", "2026-06-10", "PUBLIC", difficulty("EASIER"));
        JsonNode now = readNow("g");
        assertEquals(0, now.get("people").asInt());
        assertEquals(0, now.get("reviews").size());
        clock.set(Instant.parse("2026-06-10T21:59:59Z"));
        assertEquals(0, readNow("g").get("people").asInt());
        clock.set(Instant.parse("2026-06-10T22:00:00Z")); // SA midnight
        JsonNode next = readNow("g");
        assertEquals(1, next.get("people").asInt());
        assertEquals(List.of("A"), names(next));
    }

    @Test
    void hiddenReviewCountsNowhere() throws Exception {
        String a = register("A"), b = register("B"), c = register("C");
        clock.set(Instant.parse("2026-06-10T08:00:00Z"));
        hike(a, "g", "2026-06-09", "PUBLIC", difficulty("EASIER"));
        hike(b, "g", "2026-06-09", "PUBLIC", difficulty("EASIER"));
        clock.set(Instant.parse("2026-06-11T08:00:00Z"));
        hike(c, "g", "2026-06-11", "PUBLIC", difficulty("EASIER"));
        JsonNode r = readNow("g");
        assertEquals(2, r.get("people").asInt());
        assertTrue(r.get("summary").get("difficulty").isNull());
        assertEquals(List.of("A", "B"), names(r));
    }

    @Test
    void editingTodayHidesThePersonUntilTomorrowRatherThanShowingTheOldReview() throws Exception {
        String a = register("A");
        clock.set(Instant.parse("2026-06-10T08:00:00Z"));
        UUID id = hike(a, "g", "2026-06-09", "PUBLIC", difficulty("EASIER"));
        clock.set(Instant.parse("2026-06-11T08:00:00Z"));
        assertEquals(List.of("A"), names(readNow("g")));
        hike(a, "g", "2026-06-09", "PUBLIC", difficulty("HARDER"), false, id);
        JsonNode r = readNow("g");
        assertEquals(0, r.get("people").asInt());
        assertEquals(0, r.get("reviews").size());
        clock.set(Instant.parse("2026-06-12T08:00:00Z"));
        assertEquals(List.of("A"), names(readNow("g")));
    }

    @Test
    void anOlderReviewDoesNotStandInForAHiddenNewerOne() throws Exception {
        String a = register("A");
        clock.set(Instant.parse("2026-06-10T08:00:00Z"));
        hike(a, "g", "2026-05-01", "PUBLIC", difficulty("EASIER"));
        clock.set(Instant.parse("2026-06-11T08:00:00Z"));
        hike(a, "g", "2026-06-11", "PUBLIC", difficulty("HARDER"));
        assertEquals(0, readNow("g").get("people").asInt());
    }

    @Test
    void listIsOrderedByMonthThenNameNeverByWriteTime() throws Exception {
        // Written in the order Zed, old, mid, Bea, anon, with Zed first so recency would put it last.
        hike(register("Zed"), "g", "2026-05-02", "PUBLIC", difficulty("EASIER"));
        hike(register("mid"), "g", "2026-03-02", "PUBLIC", difficulty("EASIER"));
        hike(register("Old"), "g", "2026-01-02", "PUBLIC", difficulty("EASIER"));
        hike(register("bea"), "g", "2026-05-20", "PUBLIC", difficulty("EASIER"));
        hike(register("Priv"), "g", "2026-06-01", "PRIVATE", difficulty("EASIER"));
        hike(register("anna"), "g", null, "PUBLIC", difficulty("EASIER"));
        assertEquals(List.of("bea", "Zed", "mid", "Old", "anna", "Priv"), names(read("g")));
    }
}
