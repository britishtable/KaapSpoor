package za.kaapspoor.server.web;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.servers.Server;
import org.springframework.context.annotation.Configuration;

/** Pins the server URL so the generated spec (and its committed snapshot) does not embed the host or test port. */
@Configuration(proxyBeanMethods = false)
@OpenAPIDefinition(servers = @Server(url = "/"))
class OpenApiConfig {}
