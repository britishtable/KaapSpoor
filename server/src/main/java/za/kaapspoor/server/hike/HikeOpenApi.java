package za.kaapspoor.server.hike;

import io.swagger.v3.oas.models.media.Schema;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * OpenAPI 3.1 cannot say "a $ref or null" through annotations (a sibling type next to a $ref is
 * ignored by the client generator), so the nullable plan is spelled out as oneOf [HikePlan, null].
 */
@Configuration(proxyBeanMethods = false)
class HikeOpenApi {

    @Bean
    OpenApiCustomizer nullablePlan() {
        return openApi -> {
            for (String name : new String[] {"Hike", "HikeWrite"}) {
                Schema<?> schema = openApi.getComponents().getSchemas().get(name);
                if (schema == null || schema.getProperties() == null) {
                    continue;
                }
                schema.getProperties().put("plan", new Schema<>()
                        .addOneOfItem(new Schema<>().$ref("#/components/schemas/HikePlan"))
                        .addOneOfItem(new Schema<>().types(Set.of("null"))));
            }
        };
    }
}
