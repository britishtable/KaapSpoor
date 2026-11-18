package za.kaapspoor.server;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.core.util.DefaultIndenter;
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfig.class)
@ActiveProfiles("test")
class OpenApiSnapshotTest {

    private static final String CHANGED =
            "API changed: run ./mvnw test -Dtest=OpenApiSnapshotTest -Dopenapi.update=true and npm run gen:api";
    private static final Path SNAPSHOT = Path.of("openapi.json");
    private static final ObjectMapper SORTED =
            new ObjectMapper().enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);

    @Autowired MockMvc mvc;

    @Test
    void specMatchesCommittedSnapshot() throws Exception {
        String body = mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        Object live = SORTED.readValue(body, Object.class);

        if (Boolean.getBoolean("openapi.update")) {
            DefaultPrettyPrinter printer = new DefaultPrettyPrinter();
            printer.indentObjectsWith(new DefaultIndenter("  ", "\n"));
            printer.indentArraysWith(new DefaultIndenter("  ", "\n"));
            Files.writeString(
                    SNAPSHOT, SORTED.writer(printer).writeValueAsString(live) + "\n", StandardCharsets.UTF_8);
            return;
        }

        assertThat(SNAPSHOT).as(CHANGED).exists();
        JsonNode committed = SORTED.readTree(Files.readString(SNAPSHOT, StandardCharsets.UTF_8));
        assertThat((JsonNode) SORTED.valueToTree(live)).as(CHANGED).isEqualTo(committed);
    }
}
