package za.kaapspoor.server.auth;

/** A refresh token that is unknown, expired, revoked or already used, or a rejected ID token. Maps to 401. */
public class InvalidTokenException extends RuntimeException {

    public InvalidTokenException() {
        super("Invalid refresh token");
    }

    public InvalidTokenException(String message) {
        super(message);
    }
}
