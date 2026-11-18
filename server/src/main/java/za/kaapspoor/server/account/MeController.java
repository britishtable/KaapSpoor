package za.kaapspoor.server.account;

import java.util.UUID;
import org.springframework.http.HttpStatus;
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
@RequestMapping("/api/v1/me")
public class MeController {

    public record MeResponse(UUID id, String displayName, String initials, String email, Role role) {}

    public record UpdateMeRequest(String displayName) {}

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
