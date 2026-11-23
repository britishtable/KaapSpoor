package za.kaapspoor.server.report;

import io.swagger.v3.oas.models.media.Schema;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The author's report has a position that may be null; spell it as oneOf [Position, null]. */
@Configuration(proxyBeanMethods = false)
class ReportOpenApi {

    @Bean
    OpenApiCustomizer nullableReportPosition() {
        return openApi -> {
            for (String name : new String[] {"MyReport", "ReportWrite"}) {
                Schema<?> schema = openApi.getComponents().getSchemas().get(name);
                if (schema == null || schema.getProperties() == null) {
                    continue;
                }
                schema.getProperties().put("position", new Schema<>()
                        .addOneOfItem(new Schema<>().$ref("#/components/schemas/Position"))
                        .addOneOfItem(new Schema<>().types(Set.of("null"))));
            }
        };
    }
}
