package za.kaapspoor.server.auth;

/** The claims KaapSpoor uses from an ID token whose signature, issuer, audience and lifetime checked out. */
public record VerifiedIdentity(OidcProvider provider, String subject, String email, boolean emailVerified, String name) {}
