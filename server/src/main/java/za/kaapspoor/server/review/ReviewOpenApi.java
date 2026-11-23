package za.kaapspoor.server.review;

import io.swagger.v3.oas.models.media.Schema;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Same reason as HikeOpenApi: a summary question is "a $ref or null", spelled as oneOf [Ref, null]. */
@Configuration(proxyBeanMethods = false)
class ReviewOpenApi {

    @Bean
    OpenApiCustomizer nullableCounts() {
        return openApi -> {
            Schema<?> schema = openApi.getComponents().getSchemas().get("ReviewSummary");
            if (schema == null || schema.getProperties() == null) {
                return;
            }
            for (String question : new String[] {"difficulty", "enjoyment", "safety", "navigation", "water"}) {
                schema.getProperties().put(question, new Schema<>()
                        .addOneOfItem(new Schema<>().$ref("#/components/schemas/Counts"))
                        .addOneOfItem(new Schema<>().types(Set.of("null"))));
            }
        };
    }
}
