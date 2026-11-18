package za.kaapspoor.server.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import za.kaapspoor.server.TestcontainersConfig;
import za.kaapspoor.server.account.AppUser;
import za.kaapspoor.server.account.AppUserRepository;
import za.kaapspoor.server.auth.TokenService;

/** A real access token, decoded and converted by the beans the resource server uses. */
@SpringBootTest
@Import(TestcontainersConfig.class)
@ActiveProfiles("test")
class RoleAuthoritiesTest {

    @Autowired TokenService tokens;
    @Autowired AppUserRepository users;
    @Autowired JwtDecoder decoder;
    @Autowired Converter<Jwt, ? extends AbstractAuthenticationToken> jwtAuthenticationConverter;

    @Test
    void userTokenCarriesRoleUser() {
        AppUser user = users.saveAndFlush(
                new AppUser("role-" + System.nanoTime() + "@example.com", false, null, "Sam", Instant.now()));
        Jwt jwt = decoder.decode(tokens.issue(user).accessToken());

        AbstractAuthenticationToken auth = jwtAuthenticationConverter.convert(jwt);

        assertThat(auth.getAuthorities()).extracting(GrantedAuthority::getAuthority).containsExactly("ROLE_USER");
        assertThat(auth.getName()).isEqualTo(user.getId().toString());
    }
}
