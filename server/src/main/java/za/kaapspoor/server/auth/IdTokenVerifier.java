package za.kaapspoor.server.auth;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import java.net.MalformedURLException;
import java.time.Clock;
import java.time.Duration;
import java.util.Collection;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;

/**
 * Verifies Google and Apple ID tokens. The decoders are deliberately not {@link JwtDecoder} beans: the
 * resource server's bean is KaapSpoor's own HS256 access-token decoder and must stay the only one.
 */
@Component
@EnableConfigurationProperties(OidcProperties.class)
public class IdTokenVerifier {

    static final Duration CLOCK_SKEW = Duration.ofSeconds(60);

    private final Map<OidcProvider, JwtDecoder> decoders = new EnumMap<>(OidcProvider.class);

    @Autowired
    public IdTokenVerifier(OidcProperties properties, Clock clock) {
        this(properties, clock, IdTokenVerifier::remoteKeys);
    }

    /** Tests swap only {@code keySource}; every validator still comes from {@link #decoder}. */
    public IdTokenVerifier(OidcProperties properties, Clock clock,
            Function<OidcProperties.Provider, JWKSource<SecurityContext>> keySource) {
        for (OidcProvider provider : OidcProvider.values()) {
            OidcProperties.Provider config = properties.of(provider);
            decoders.put(provider, decoder(config, keySource.apply(config), clock));
        }
    }

    /** Throws {@link InvalidTokenException} for any token that fails signature or claim checks. */
    public VerifiedIdentity verify(OidcProvider provider, String idToken) {
        Jwt jwt;
        try {
            jwt = decoders.get(provider).decode(idToken);
        } catch (JwtException e) {
            throw new InvalidTokenException("Invalid ID token");
        }
        return new VerifiedIdentity(
                provider,
                jwt.getSubject(),
                jwt.getClaimAsString("email"),
                isTrue(jwt.getClaims().get("email_verified")),
                jwt.getClaimAsString("name"));
    }

    private static JwtDecoder decoder(OidcProperties.Provider config, JWKSource<SecurityContext> keys, Clock clock) {
        DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keys));
        // Claims are checked only by the Spring validators below, so the skew and clock are set in one place.
        processor.setJWTClaimsSetVerifier((claims, context) -> {});
        NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);

        JwtTimestampValidator timestamps = new JwtTimestampValidator(CLOCK_SKEW);
        timestamps.setClock(clock);
        List<String> issuers = config.issuers();
        List<String> audiences = config.audiences();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                timestamps,
                new JwtClaimValidator<Object>(JwtClaimNames.EXP, exp -> exp != null),
                new JwtClaimValidator<Object>(JwtClaimNames.ISS, iss -> iss != null && issuers.contains(iss.toString())),
                // An empty audience list matches nothing, so an unconfigured provider rejects every token.
                new JwtClaimValidator<Object>(JwtClaimNames.AUD,
                        aud -> aud instanceof Collection<?> c && c.stream().anyMatch(audiences::contains)),
                new JwtClaimValidator<Object>(JwtClaimNames.SUB, sub -> sub instanceof String s && !s.isBlank())));
        return decoder;
    }

    private static JWKSource<SecurityContext> remoteKeys(OidcProperties.Provider config) {
        try {
            return JWKSourceBuilder.create(config.jwksUri().toURL()).build();
        } catch (MalformedURLException e) {
            throw new IllegalStateException("Invalid JWKS URI " + config.jwksUri(), e);
        }
    }

    /** Apple sends email_verified as the string "true"; Google as a boolean. */
    private static boolean isTrue(Object claim) {
        return Boolean.TRUE.equals(claim) || "true".equals(claim);
    }
}
