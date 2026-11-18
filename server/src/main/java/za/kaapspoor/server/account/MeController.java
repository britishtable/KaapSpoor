package za.kaapspoor.server.account;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping(path = "/api/v1/me", produces = MediaType.APPLICATION_JSON_VALUE)
public class MeController {

    /** email is null for a provider account whose email was unverified or already taken. */
    public record MeResponse(
            @Schema(requiredMode = REQUIRED) UUID id,
            @Schema(requiredMode = REQUIRED) String displayName,
            @Schema(requiredMode = REQUIRED) String initials,
            String email,
            @Schema(requiredMode = REQUIRED) Role role) {}

    /** displayName is validated by {@link DisplayNames#validate}, which rejects a missing one. */
    public record UpdateMeRequest(@Schema(requiredMode = REQUIRED) String displayName) {}

    private final AppUserRepository users;

    MeController(AppUserRepository users) {
        this.users = users;
    }

    @GetMapping
    public MeResponse get(@AuthenticationPrincipal Jwt jwt) {
        return toResponse(current(jwt));
    }

    @PatchMapping
    @Transactional
    public MeResponse update(@AuthenticationPrincipal Jwt jwt, @RequestBody UpdateMeRequest request) {
        AppUser user = current(jwt);
        user.rename(DisplayNames.validate(request.displayName()));
        return toResponse(user);
    }

    private AppUser current(Jwt jwt) {
        return users.findById(UUID.fromString(jwt.getSubject()))
                .filter(u -> u.getDeletedAt() == null)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
    }

    private static MeResponse toResponse(AppUser u) {
        return new MeResponse(
                u.getId(), u.getDisplayName(), DisplayNames.initials(u.getDisplayName()), u.getEmail(), u.getRole());
    }
}
