package za.kaapspoor.server.auth;

/** Identity providers whose ID tokens {@code POST /api/v1/auth/oidc} accepts. */
public enum OidcProvider {
    GOOGLE,
    APPLE
}
