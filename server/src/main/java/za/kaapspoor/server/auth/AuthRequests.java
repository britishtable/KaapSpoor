package za.kaapspoor.server.auth;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public final class AuthRequests {

    private AuthRequests() {}

    /** Phone keyboards append a space; trimming here, before validation, keeps register and login alike. */
    private static String trim(String email) {
        return email == null ? null : email.trim();
    }

    /** displayName is validated by {@code DisplayNames.validate} in the service. */
    public record Register(
            @Schema(requiredMode = REQUIRED) @NotBlank @Email String email,
            @Schema(requiredMode = REQUIRED) @NotBlank @Size(min = 10, max = 72) String password,
            @Schema(requiredMode = REQUIRED) String displayName) {

        public Register {
            email = trim(email);
        }

        @Override
        public String toString() {
            return "Register[email=" + email + "]";
        }
    }

    public record Login(
            @Schema(requiredMode = REQUIRED) @NotBlank String email,
            @Schema(requiredMode = REQUIRED) @NotBlank @Size(max = 72) String password) {

        public Login {
            email = trim(email);
        }

        @Override
        public String toString() {
            return "Login[email=" + email + "]";
        }
    }

    /** displayName is a fallback for providers (Apple) that omit the name from the token. */
    public record Oidc(
            @Schema(requiredMode = REQUIRED) @NotNull OidcProvider provider,
            @Schema(requiredMode = REQUIRED) @NotBlank String idToken,
            String displayName) {

        @Override
        public String toString() {
            return "Oidc[provider=" + provider + ", idToken=<redacted>]";
        }
    }

    public record RefreshToken(@Schema(requiredMode = REQUIRED) @NotBlank String refreshToken) {

        @Override
        public String toString() {
            return "RefreshToken[<redacted>]";
        }
    }
}
