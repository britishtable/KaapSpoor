package za.kaapspoor.server.auth;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final PasswordAuthService passwordAuth;
    private final TokenService tokens;

    AuthController(PasswordAuthService passwordAuth, TokenService tokens) {
        this.passwordAuth = passwordAuth;
        this.tokens = tokens;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public TokenPair register(@Valid @RequestBody AuthRequests.Register request) {
        return passwordAuth.register(request);
    }

    @PostMapping("/login")
    public TokenPair login(@Valid @RequestBody AuthRequests.Login request) {
        return passwordAuth.login(request);
    }

    @PostMapping("/refresh")
    public TokenPair refresh(@Valid @RequestBody AuthRequests.RefreshToken request) {
        return tokens.refresh(request.refreshToken());
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@Valid @RequestBody AuthRequests.RefreshToken request) {
        tokens.revoke(request.refreshToken());
    }
}
