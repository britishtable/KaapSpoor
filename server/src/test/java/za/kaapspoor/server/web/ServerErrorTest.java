package za.kaapspoor.server.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import za.kaapspoor.server.TestcontainersConfig;
import za.kaapspoor.server.auth.TokenService;

/**
 * Real Tomcat, because MockMvc performs no error dispatch: an unhandled exception on a permitAll path
 * used to be forwarded to /error, which required authentication, so a 500 reached the client as a 401.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfig.class)
@ActiveProfiles("test")
class ServerErrorTest {

    private static final String INTERNAL = "internal detail that must not leak";

    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @MockitoBean TokenService tokens;

    private final HttpClient http = HttpClient.newHttpClient();

    private HttpResponse<String> refresh() throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/refresh"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"refreshToken\":\"abc\"}"))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private void assertInternalServerError(HttpResponse<String> r) throws Exception {
        assertThat(r.statusCode()).isEqualTo(500);
        assertThat(r.headers().firstValue("Content-Type")).hasValueSatisfying(
                ct -> assertThat(ct).startsWith("application/problem+json"));
        JsonNode body = json.readTree(r.body());
        assertThat(body.get("status").asInt()).isEqualTo(500);
        assertThat(body.get("detail").asText()).isEqualTo("Internal server error");
        assertThat(r.body()).doesNotContain(INTERNAL);
    }

    @Test
    void unexpectedExceptionOnAuthPathIs500ProblemNot401() throws Exception {
        when(tokens.refresh(anyString())).thenThrow(new IllegalStateException(INTERNAL));
        assertInternalServerError(refresh());
    }

    @Test
    void strayIllegalArgumentExceptionIs500NotA400EchoingItsMessage() throws Exception {
        when(tokens.refresh(anyString())).thenThrow(new IllegalArgumentException(INTERNAL));
        assertInternalServerError(refresh());
    }

    @Test
    void missingTokenIs401WithProblemBody() throws Exception {
        HttpResponse<String> r = http.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/me")).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(r.statusCode()).isEqualTo(401);
        assertThat(r.headers().firstValue("Content-Type")).hasValueSatisfying(
                ct -> assertThat(ct).startsWith("application/problem+json"));
        assertThat(r.headers().firstValue("WWW-Authenticate")).hasValueSatisfying(
                h -> assertThat(h).startsWith("Bearer"));
        JsonNode body = json.readTree(r.body());
        assertThat(body.get("status").asInt()).isEqualTo(401);
        assertThat(body.get("detail").asText()).isEqualTo("Authentication required");
    }
}
