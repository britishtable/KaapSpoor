package za.kaapspoor.server.auth;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.util.Base64;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

/** HS256 access-token signing, keyed by the base64 {@code kaapspoor.jwt-secret}. */
@Configuration
public class JwtConfig {

    private static final int MIN_SECRET_BYTES = 32;

    @Bean
    JwtEncoder jwtEncoder(@Value("${kaapspoor.jwt-secret}") String base64Secret) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(secretKey(base64Secret)));
    }

    @Bean
    JwtDecoder jwtDecoder(@Value("${kaapspoor.jwt-secret}") String base64Secret) {
        return NimbusJwtDecoder.withSecretKey(secretKey(base64Secret))
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
    }

    private static SecretKey secretKey(String base64Secret) {
        byte[] bytes = Base64.getDecoder().decode(base64Secret);
        if (bytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException("kaapspoor.jwt-secret must be at least 32 bytes");
        }
        return new SecretKeySpec(bytes, "HmacSHA256");
    }
}
