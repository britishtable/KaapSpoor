package za.kaapspoor.server.auth;

import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(path = "/api/v1/auth", produces = MediaType.APPLICATION_JSON_VALUE)
public class AuthController {

    private final PasswordAuthService passwordAuth;
    private final OidcAuthService oidcAuth;
    private final TokenService tokens;

    AuthController(PasswordAuthService passwordAuth, OidcAuthService oidcAuth, TokenService tokens) {
        this.passwordAuth = passwordAuth;
        this.oidcAuth = oidcAuth;
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

    /** 201 when the token's identity created a new user, 200 when it signed in an existing one. */
    @PostMapping("/oidc")
    @ApiResponse(responseCode = "200", description = "Signed in an existing user",
            content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE,
                    schema = @Schema(implementation = TokenPair.class)))
    @ApiResponse(responseCode = "201", description = "Created a new user and signed them in",
            content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE,
                    schema = @Schema(implementation = TokenPair.class)))
    public ResponseEntity<TokenPair> oidc(@Valid @RequestBody AuthRequests.Oidc request) {
        OidcAuthService.SignIn signIn = oidcAuth.signIn(request);
        return ResponseEntity.status(signIn.created() ? HttpStatus.CREATED : HttpStatus.OK).body(signIn.tokens());
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
