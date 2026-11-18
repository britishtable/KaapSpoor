package za.kaapspoor.server.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.time.Instant;
import java.util.Date;

/** Signs provider-style ID tokens with a test RSA key that stands in for Google's and Apple's JWKS. */
final class TestIdTokens {

    static final String GOOGLE_ISSUER = "https://accounts.google.com";
    static final String APPLE_ISSUER = "https://appleid.apple.com";
    /** Must match kaapspoor.oidc.*.audiences in application-test.yml. */
    static final String GOOGLE_AUDIENCE = "test-google-client";
    static final String APPLE_AUDIENCE = "test-apple-client";

    static final RSAKey KEY = generate("test-key");
    /** A key the verifier has never seen. */
    static final RSAKey OTHER_KEY = generate("other-key");

    private TestIdTokens() {}

    static JWKSource<SecurityContext> jwkSource() {
        return new ImmutableJWKSet<>(new JWKSet(KEY.toPublicJWK()));
    }

    /** {@code email} and {@code name} are omitted from the token when null. */
    static String sign(String issuer, String audience, String subject, String email, boolean emailVerified,
            String name, Instant iat, Instant exp) {
        return sign(KEY, JWSAlgorithm.RS256, issuer, audience, subject, email, emailVerified, name, iat, exp);
    }

    static String sign(RSAKey key, JWSAlgorithm alg, String issuer, String audience, String subject, String email,
            boolean emailVerified, String name, Instant iat, Instant exp) {
        JWTClaimsSet.Builder claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .audience(audience)
                .subject(subject)
                .claim("email_verified", emailVerified)
                .issueTime(Date.from(iat))
                .expirationTime(Date.from(exp));
        if (email != null) {
            claims.claim("email", email);
        }
        if (name != null) {
            claims.claim("name", name);
        }
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(alg).keyID(key.getKeyID()).build(), claims.build());
            jwt.sign(new RSASSASigner(key));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    private static RSAKey generate(String kid) {
        try {
            return new RSAKeyGenerator(2048).keyID(kid).generate();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }
}
