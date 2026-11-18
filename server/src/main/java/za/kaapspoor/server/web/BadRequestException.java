package za.kaapspoor.server.web;

/**
 * The caller sent something unusable. Mapped to 400 with this message as the detail, so the message
 * must be safe and meant for users. Anything else (a stray {@link IllegalArgumentException} included)
 * is a server bug and becomes a generic 500.
 */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
