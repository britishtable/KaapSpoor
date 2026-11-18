package za.kaapspoor.server.auth;

import java.net.URI;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** {@code kaapspoor.oidc.<provider>.*}. Audiences (client ids) default to empty, which rejects every token. */
@ConfigurationProperties("kaapspoor.oidc")
public record OidcProperties(Provider google, Provider apple) {

    public record Provider(List<String> issuers, URI jwksUri, List<String> audiences) {
        public Provider {
            issuers = issuers == null ? List.of() : List.copyOf(issuers);
            audiences = audiences == null ? List.of() : List.copyOf(audiences);
        }
    }

    public Provider of(OidcProvider provider) {
        return switch (provider) {
            case GOOGLE -> google;
            case APPLE -> apple;
        };
    }
}
