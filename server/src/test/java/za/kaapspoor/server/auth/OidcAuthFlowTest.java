package za.kaapspoor.server.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static za.kaapspoor.server.auth.TestIdTokens.APPLE_AUDIENCE;
import static za.kaapspoor.server.auth.TestIdTokens.APPLE_ISSUER;
import static za.kaapspoor.server.auth.TestIdTokens.GOOGLE_AUDIENCE;
import static za.kaapspoor.server.auth.TestIdTokens.GOOGLE_ISSUER;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import za.kaapspoor.server.TestcontainersConfig;

@SpringBootTest
@AutoConfigureMockMvc
@Import({TestcontainersConfig.class, OidcAuthFlowTest.TestKeys.class})
@ActiveProfiles("test")
class OidcAuthFlowTest {

    /** Swaps only the key source; issuer, audience and timestamp validation are the production factory's. */
    @TestConfiguration(proxyBeanMethods = false)
    static class TestKeys {
        @Bean
        @Primary
        IdTokenVerifier testIdTokenVerifier(OidcProperties properties, Clock clock) {
            return new IdTokenVerifier(properties, clock, provider -> TestIdTokens.jwkSource());
        }
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired OidcProperties properties;
    @Autowired OidcAuthService oidcAuth;

    @BeforeEach
    void clean() {
        jdbc.update("delete from refresh_token");
        jdbc.update("delete from identity");
        jdbc.update("delete from report_confirmation");
        jdbc.update("delete from report");
        jdbc.update("delete from hike");
        jdbc.update("delete from app_user");
    }

    private static Instant now() {
        return Instant.now();
    }

    private static String google(String subject, String email, boolean verified, String name) {
        return TestIdTokens.sign(GOOGLE_ISSUER, GOOGLE_AUDIENCE, subject, email, verified, name,
                now(), now().plus(Duration.ofMinutes(5)));
    }

    private MvcResult oidc(String provider, String idToken, String displayName) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("provider", provider);
        body.put("idToken", idToken);
        if (displayName != null) {
            body.put("displayName", displayName);
        }
        return mvc.perform(post("/api/v1/auth/oidc")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(body)))
                .andReturn();
    }

    private JsonNode body(MvcResult r) throws Exception {
        return json.readTree(r.getResponse().getContentAsString());
    }

    private JsonNode me(MvcResult signIn) throws Exception {
        String access = body(signIn).get("accessToken").asText();
        return body(mvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + access)).andReturn());
    }

    @Test
    void newGoogleUserIs201AndRepeatIs200SameUser() throws Exception {
        MvcResult first = oidc("GOOGLE", google("g-1", "thandi@example.com", true, "Thandi M"), null);
        assertThat(first.getResponse().getStatus()).isEqualTo(201);
        JsonNode firstMe = me(first);
        assertThat(firstMe.get("displayName").asText()).isEqualTo("Thandi M");
        assertThat(firstMe.get("email").asText()).isEqualTo("thandi@example.com");

        MvcResult again = oidc("GOOGLE", google("g-1", "thandi@example.com", true, "Thandi M"), null);
        assertThat(again.getResponse().getStatus()).isEqualTo(200);
        assertThat(me(again).get("id").asText()).isEqualTo(firstMe.get("id").asText());
    }

    @Test
    void wrongAudienceIs401() throws Exception {
        String token = TestIdTokens.sign(GOOGLE_ISSUER, "someone-elses-client", "g-1", null, false, null,
                now(), now().plus(Duration.ofMinutes(5)));
        assertThat(oidc("GOOGLE", token, null).getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void expiredTokenIs401() throws Exception {
        // Expired by more than the 60 s clock skew.
        String token = TestIdTokens.sign(GOOGLE_ISSUER, GOOGLE_AUDIENCE, "g-1", null, false, null,
                now().minus(Duration.ofMinutes(10)), now().minus(Duration.ofSeconds(90)));
        assertThat(oidc("GOOGLE", token, null).getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void iatSlightlyInFutureAccepted() throws Exception {
        String token = TestIdTokens.sign(GOOGLE_ISSUER, GOOGLE_AUDIENCE, "g-1", null, false, "Sam",
                now().plusSeconds(30), now().plus(Duration.ofMinutes(5)));
        assertThat(oidc("GOOGLE", token, null).getResponse().getStatus()).isEqualTo(201);
    }

    @Test
    void wrongIssuerIs401() throws Exception {
        // A valid Apple token presented as Google: right key, wrong issuer and audience for the provider.
        String token = TestIdTokens.sign(APPLE_ISSUER, GOOGLE_AUDIENCE, "g-1", null, false, null,
                now(), now().plus(Duration.ofMinutes(5)));
        assertThat(oidc("GOOGLE", token, null).getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void unknownKeyIs401() throws Exception {
        String token = TestIdTokens.sign(TestIdTokens.OTHER_KEY, JWSAlgorithm.RS256, GOOGLE_ISSUER,
                GOOGLE_AUDIENCE, "g-1", null, false, null, now(), now().plus(Duration.ofMinutes(5)));
        assertThat(oidc("GOOGLE", token, null).getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void algorithmOtherThanRs256Is401() throws Exception {
        String token = TestIdTokens.sign(TestIdTokens.KEY, JWSAlgorithm.RS512, GOOGLE_ISSUER,
                GOOGLE_AUDIENCE, "g-1", null, false, null, now(), now().plus(Duration.ofMinutes(5)));
        assertThat(oidc("GOOGLE", token, null).getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void garbageTokenIs401() throws Exception {
        assertThat(oidc("GOOGLE", "not.a.jwt", null).getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void emptyAudienceListRejectsEveryToken() {
        OidcProperties.Provider google = properties.google();
        OidcProperties noAudiences = new OidcProperties(
                new OidcProperties.Provider(google.issuers(), google.jwksUri(), List.of()), properties.apple());
        IdTokenVerifier verifier =
                new IdTokenVerifier(noAudiences, Clock.systemUTC(), provider -> TestIdTokens.jwkSource());
        assertThatThrownBy(() -> verifier.verify(OidcProvider.GOOGLE, google("g-1", null, false, null)))
                .isInstanceOf(InvalidTokenException.class);
    }

    @Test
    void verifiedEmailLinksToPasswordAccount() throws Exception {
        String passwordUserId = registerSam();
        MvcResult r = oidc("GOOGLE", google("g-sam", "Sam@example.com", true, "Sam G"), null);
        assertThat(r.getResponse().getStatus()).isEqualTo(200);
        JsonNode me = me(r);
        assertThat(me.get("id").asText()).isEqualTo(passwordUserId);
        assertThat(me.get("displayName").asText()).isEqualTo("Sam");
        assertThat(jdbc.queryForObject("select count(*) from app_user", Integer.class)).isEqualTo(1);
    }

    @Test
    void linkToUnverifiedPasswordAccountLocksOutPriorCredentials() throws Exception {
        MvcResult registered = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of(
                                "email", "sam@example.com", "password", "correct-horse", "displayName", "Sam"))))
                .andReturn();
        String priorRefresh = body(registered).get("refreshToken").asText();
        String passwordUserId = me(registered).get("id").asText();

        MvcResult google = oidc("GOOGLE", google("g-sam", "sam@example.com", true, "Sam G"), null);
        assertThat(google.getResponse().getStatus()).isEqualTo(200);

        assertThat(refresh(priorRefresh).getResponse().getStatus()).isEqualTo(401);
        MvcResult login = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("email", "sam@example.com", "password", "correct-horse"))))
                .andReturn();
        assertThat(login.getResponse().getStatus()).isEqualTo(401);
        assertThat(body(login).get("detail").asText()).isEqualTo("Email or password is incorrect");

        JsonNode me = me(google);
        assertThat(me.get("id").asText()).isEqualTo(passwordUserId);
        assertThat(refresh(body(google).get("refreshToken").asText()).getResponse().getStatus()).isEqualTo(200);
        assertThat(jdbc.queryForObject("select email_verified from app_user", Boolean.class)).isTrue();
    }

    @Test
    void linkToVerifiedAccountKeepsItsSessions() throws Exception {
        MvcResult first = oidc("GOOGLE", google("g-1", "thandi@example.com", true, "Thandi"), null);
        assertThat(first.getResponse().getStatus()).isEqualTo(201);
        String appleToken = TestIdTokens.sign(APPLE_ISSUER, APPLE_AUDIENCE, "a-1", "thandi@example.com", true, null,
                now(), now().plus(Duration.ofMinutes(5)));
        MvcResult apple = oidc("APPLE", appleToken, null);
        assertThat(apple.getResponse().getStatus()).isEqualTo(200);
        assertThat(me(apple).get("id").asText()).isEqualTo(me(first).get("id").asText());
        assertThat(refresh(body(first).get("refreshToken").asText()).getResponse().getStatus()).isEqualTo(200);
    }

    private MvcResult refresh(String refreshToken) throws Exception {
        return mvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("refreshToken", refreshToken))))
                .andReturn();
    }

    @Test
    void unverifiedEmailDoesNotLink() throws Exception {
        String passwordUserId = registerSam();
        MvcResult r = oidc("GOOGLE", google("g-sam", "Sam@example.com", false, "Sam G"), null);
        assertThat(r.getResponse().getStatus()).isEqualTo(201);
        JsonNode me = me(r);
        assertThat(me.get("id").asText()).isNotEqualTo(passwordUserId);
        assertThat(me.get("email").isNull()).isTrue();
    }

    @Test
    void appleWithoutNameUsesRequestThenHiker() throws Exception {
        String withRequestName = TestIdTokens.sign(APPLE_ISSUER, APPLE_AUDIENCE, "a-1", null, false, null,
                now(), now().plus(Duration.ofMinutes(5)));
        MvcResult named = oidc("APPLE", withRequestName, "Thandi");
        assertThat(named.getResponse().getStatus()).isEqualTo(201);
        assertThat(me(named).get("displayName").asText()).isEqualTo("Thandi");

        String noName = TestIdTokens.sign(APPLE_ISSUER, APPLE_AUDIENCE, "a-2", null, false, null,
                now(), now().plus(Duration.ofMinutes(5)));
        MvcResult hiker = oidc("APPLE", noName, null);
        assertThat(hiker.getResponse().getStatus()).isEqualTo(201);
        assertThat(me(hiker).get("displayName").asText()).isEqualTo("Hiker");
    }

    @Test
    void concurrentFirstSignInResolvesToOneUser() throws Exception {
        int threads = 6;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<OidcAuthService.SignIn>> results = new ArrayList<>();
        try {
            for (int i = 0; i < threads; i++) {
                String token = google("g-race", "race@example.com", true, "Racer");
                Callable<OidcAuthService.SignIn> call = () -> {
                    start.await();
                    return oidcAuth.signIn(new AuthRequests.Oidc(OidcProvider.GOOGLE, token, null));
                };
                results.add(pool.submit(call));
            }
            start.countDown();
            List<OidcAuthService.SignIn> signIns = new ArrayList<>();
            for (Future<OidcAuthService.SignIn> f : results) {
                signIns.add(f.get());
            }
            assertThat(signIns.stream().filter(OidcAuthService.SignIn::created).count()).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
        Set<String> userIds = jdbc.queryForList("select user_id::text from identity", String.class)
                .stream().collect(Collectors.toSet());
        assertThat(userIds).hasSize(1);
        assertThat(jdbc.queryForObject("select count(*) from app_user", Integer.class)).isEqualTo(1);
    }

    private String registerSam() throws Exception {
        MvcResult r = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of(
                                "email", "sam@example.com", "password", "correct-horse", "displayName", "Sam"))))
                .andReturn();
        assertThat(r.getResponse().getStatus()).isEqualTo(201);
        return me(r).get("id").asText();
    }
}
