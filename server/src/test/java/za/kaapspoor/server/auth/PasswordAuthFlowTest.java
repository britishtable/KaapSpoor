package za.kaapspoor.server.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
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
import org.springframework.test.web.servlet.MvcResult;
import za.kaapspoor.server.TestcontainersConfig;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfig.class)
@ActiveProfiles("test")
class PasswordAuthFlowTest {

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void clean() {
        jdbc.update("delete from identity");
        jdbc.update("delete from refresh_token");
        jdbc.update("delete from report_confirmation");
        jdbc.update("delete from report");
        jdbc.update("delete from hike");
        jdbc.update("delete from app_user");
    }

    private MvcResult register(String email, String password, String name) throws Exception {
        return mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(
                                Map.of("email", email, "password", password, "displayName", name))))
                .andReturn();
    }

    private MvcResult login(String email, String password) throws Exception {
        return mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", email, "password", password))))
                .andReturn();
    }

    private JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsString());
    }

    @Test
    void registerThenMe() throws Exception {
        MvcResult r = register("sam@example.com", "correct-horse", "Sam van Wyk");
        assertThat(r.getResponse().getStatus()).isEqualTo(201);
        String access = body(r).get("accessToken").asText();
        mvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + access))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Sam van Wyk"))
                .andExpect(jsonPath("$.initials").value("SV"))
                .andExpect(jsonPath("$.email").value("sam@example.com"))
                .andExpect(jsonPath("$.role").value("USER"));
    }

    @Test
    void loginIgnoresEmailCaseAndSpaces() throws Exception {
        register("sam@example.com", "correct-horse", "Sam");
        assertThat(login(" Sam@Example.COM ", "correct-horse").getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void registerTrimsEmailBeforeValidating() throws Exception {
        assertThat(register(" sam@example.com ", "correct-horse", "Sam").getResponse().getStatus())
                .isEqualTo(201);
        assertThat(login("sam@example.com", "correct-horse").getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void duplicateEmailIs409() throws Exception {
        register("sam@example.com", "correct-horse", "Sam");
        assertThat(register("SAM@example.com", "correct-horse", "Other").getResponse().getStatus())
                .isEqualTo(409);
    }

    @Test
    void wrongPasswordAndUnknownEmailLookIdentical() throws Exception {
        register("sam@example.com", "correct-horse", "Sam");
        MvcResult wrong = login("sam@example.com", "wrong-password-1");
        MvcResult unknown = login("nobody@example.com", "wrong-password-1");
        assertThat(wrong.getResponse().getStatus()).isEqualTo(401);
        assertThat(unknown.getResponse().getStatus()).isEqualTo(401);
        assertThat(body(wrong).get("detail").asText()).isEqualTo("Email or password is incorrect");
        assertThat(body(unknown).get("detail").asText()).isEqualTo(body(wrong).get("detail").asText());
    }

    @Test
    void shortPasswordIs400() throws Exception {
        assertThat(register("sam@example.com", "123456789", "Sam").getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    void blankOrLongDisplayNameIs400() throws Exception {
        assertThat(register("a@example.com", "correct-horse", "   ").getResponse().getStatus()).isEqualTo(400);
        assertThat(register("b@example.com", "correct-horse", "x".repeat(41)).getResponse().getStatus())
                .isEqualTo(400);
        String access = body(register("c@example.com", "correct-horse", "Ok")).get("accessToken").asText();
        mvc.perform(patch("/api/v1/me")
                        .header("Authorization", "Bearer " + access)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"" + "x".repeat(41) + "\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(patch("/api/v1/me")
                        .header("Authorization", "Bearer " + access)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"  Renamed Person \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("Renamed Person"))
                .andExpect(jsonPath("$.initials").value("RP"));
    }

    @Test
    void meWithoutTokenIs401() throws Exception {
        mvc.perform(get("/api/v1/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void unlistedPathRequiresAuth() throws Exception {
        mvc.perform(get("/api/v1/anything-else")).andExpect(status().isUnauthorized());
    }

    @Test
    void logoutRevokesRefresh() throws Exception {
        String refresh = body(register("sam@example.com", "correct-horse", "Sam")).get("refreshToken").asText();
        String payload = "{\"refreshToken\":\"" + refresh + "\"}";
        mvc.perform(post("/api/v1/auth/logout").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/auth/refresh").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isUnauthorized());
    }
}
