package za.kaapspoor.server.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.DispatcherType;
import java.net.URI;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.oauth2.server.resource.web.BearerTokenAuthenticationEntryPoint;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class SecurityConfig {

    /** The access token's {@code role} claim, as written by {@code TokenService}. */
    static final String ROLE_CLAIM = "role";

    private static final String AUTH_PATH_PREFIX = "/api/v1/auth/";

    @Bean
    SecurityFilterChain filterChain(
            HttpSecurity http,
            Converter<Jwt, ? extends AbstractAuthenticationToken> jwtAuthenticationConverter,
            BearerTokenResolver bearerTokenResolver,
            ObjectMapper json) throws Exception {
        AuthenticationEntryPoint entryPoint = problemEntryPoint(json);
        http.csrf(csrf -> csrf.disable()) // bearer tokens only, no cookies
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .cors(Customizer.withDefaults())
                .authorizeHttpRequests(auth -> auth
                        // Error and forward dispatches carry a response that is already decided. Authorising
                        // them again turned a 500 on a permitAll path into a 401 for an anonymous caller.
                        .dispatcherTypeMatchers(DispatcherType.ERROR, DispatcherType.FORWARD).permitAll()
                        .requestMatchers("/api/v1/auth/**", "/actuator/health", "/v3/api-docs/**", "/swagger-ui/**")
                        .permitAll()
                        // Route reviews are public reading; the response itself carries no private data.
                        .requestMatchers(HttpMethod.GET, "/api/v1/routes/*/reviews").permitAll()
                        // A route's released reports are public; held ones go through /reports/mine.
                        .requestMatchers(HttpMethod.GET, "/api/v1/routes/*/reports").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(e -> e.authenticationEntryPoint(entryPoint))
                .oauth2ResourceServer(rs -> rs
                        .authenticationEntryPoint(entryPoint)
                        .bearerTokenResolver(bearerTokenResolver)
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(jwtAuthenticationConverter)));
        return http.build();
    }

    /**
     * Ignores the Authorization header on {@code /api/v1/auth/**}. Those paths are public, but the bearer
     * filter validates any header it sees, so a stale access token would 401 the very refresh or login
     * that replaces it.
     */
    @Bean
    BearerTokenResolver bearerTokenResolver() {
        DefaultBearerTokenResolver defaults = new DefaultBearerTokenResolver();
        return request -> {
            String path = request.getRequestURI().substring(request.getContextPath().length());
            return path.startsWith(AUTH_PATH_PREFIX) ? null : defaults.resolve(request);
        };
    }

    /** Maps the {@code role} claim to {@code ROLE_<role>}; the default converter reads only scope/scp. */
    @Bean
    Converter<Jwt, ? extends AbstractAuthenticationToken> jwtAuthenticationConverter() {
        JwtGrantedAuthoritiesConverter roles = new JwtGrantedAuthoritiesConverter();
        roles.setAuthoritiesClaimName(ROLE_CLAIM);
        roles.setAuthorityPrefix("ROLE_");
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(roles);
        return converter;
    }

    /**
     * A 401 as ProblemDetail JSON, like every other error. The bearer entry point still sets the status
     * and the RFC 6750 WWW-Authenticate header; this adds the body.
     */
    private static AuthenticationEntryPoint problemEntryPoint(ObjectMapper json) {
        BearerTokenAuthenticationEntryPoint bearer = new BearerTokenAuthenticationEntryPoint();
        return (request, response, authException) -> {
            bearer.commence(request, response, authException);
            ProblemDetail problem =
                    ProblemDetail.forStatusAndDetail(HttpStatus.UNAUTHORIZED, "Authentication required");
            problem.setInstance(URI.create(request.getRequestURI()));
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            json.writeValue(response.getOutputStream(), problem);
        };
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${kaapspoor.cors.allowed-origins}") List<String> allowedOrigins) {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(allowedOrigins);
        cors.setAllowedMethods(List.of(
                HttpMethod.GET.name(), HttpMethod.POST.name(), HttpMethod.PATCH.name(),
                HttpMethod.PUT.name(), HttpMethod.DELETE.name(), HttpMethod.OPTIONS.name()));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        cors.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cors);
        return source;
    }
}
