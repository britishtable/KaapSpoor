package za.kaapspoor.server.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class AuthRequests {

    private AuthRequests() {}

    /** displayName is validated by {@code DisplayNames.validate} in the service. */
    public record Register(
            @NotBlank @Email String email,
            @NotBlank @Size(min = 10, max = 72) String password,
            String displayName) {

        @Override
        public String toString() {
            return "Register[email=" + email + "]";
        }
    }

    public record Login(@NotBlank String email, @NotBlank @Size(max = 72) String password) {

        @Override
        public String toString() {
            return "Login[email=" + email + "]";
        }
    }

    public record RefreshToken(@NotBlank String refreshToken) {

        @Override
        public String toString() {
            return "RefreshToken[<redacted>]";
        }
    }
}
