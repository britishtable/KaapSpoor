package za.kaapspoor.server.route;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.nio.file.Paths;
import org.junit.jupiter.api.BeforeEach;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import za.kaapspoor.server.TestcontainersConfig;

@ExtendWith(OutputCaptureExtension.class)
@SpringBootTest
@Import(TestcontainersConfig.class)
@ActiveProfiles("test")
class RouteIndexLoaderTest {

    @Autowired RouteIndexLoader loader;
    @Autowired RouteRepository routes;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PlatformTransactionManager txManager;

    private static Path fixture(String name) {
        return Paths.get("src/test/resources", name);
    }

    @BeforeEach
    void clean() {
        jdbc.update("delete from route");
    }

    @Test
    void loadsAllRoutesButOnlyPreciseLocations() throws Exception {
        loader.load(fixture("routes-index-fixture.json"));

        assertThat(jdbc.queryForObject("select count(*) from route", Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject(
                "select ST_X(location::geometry) from route where id = 'a'", Double.class)).isEqualTo(18.4);
        assertThat(jdbc.queryForObject(
                "select ST_Y(location::geometry) from route where id = 'a'", Double.class)).isEqualTo(-33.9);
        assertThat(jdbc.queryForObject(
                "select count(*) from route where id in ('b','c') and location is null", Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject(
                "select location_source from route where id = 'b'", String.class)).isEqualTo("area-approx");
    }

    @Test
    void warnsWhenNoEntryCarriesGraded(CapturedOutput output) throws Exception {
        loader.load(fixture("routes-index-only-a.json"));
        assertThat(output.getOut()).contains("npm run build:data");

        loader.load(fixture("routes-index-fixture.json")); // has a graded entry
        assertThat(output.getOut().split("npm run build:data", -1)).hasSize(2); // still one warning
    }

    @Test
    void routesMissingFromANewIndexAreRetiredNotDeleted() throws Exception {
        loader.load(fixture("routes-index-fixture.json"));
        var result = loader.load(fixture("routes-index-only-a.json"));

        assertThat(result.retired()).isEqualTo(2);
        assertThat(jdbc.queryForObject("select count(*) from route", Integer.class)).isEqualTo(3);
        assertThat(routes.existsByIdAndRetiredAtIsNull("b")).isFalse();
        assertThat(routes.existsByIdAndRetiredAtIsNull("a")).isTrue();
    }

    @Test
    void reappearingRouteIsUnretired() throws Exception {
        loader.load(fixture("routes-index-fixture.json"));
        loader.load(fixture("routes-index-only-a.json"));
        loader.load(fixture("routes-index-fixture.json"));

        assertThat(routes.existsByIdAndRetiredAtIsNull("b")).isTrue();
    }

    @Test
    void startupRunIsAtomicWhenALaterEntryFails() {
        // Built directly, as the runner is: run() calls load() on itself, with no proxy in between.
        var runner = new RouteIndexLoader(
                jdbc, mapper, txManager, fixture("routes-index-bad-second.json").toString());

        assertThatThrownBy(() -> runner.run(null)).isInstanceOf(Exception.class);

        assertThat(jdbc.queryForObject("select count(*) from route", Integer.class)).isZero();
    }

    @Test
    void emptyIndexIsRefusedAndRetiresNothing() throws Exception {
        loader.load(fixture("routes-index-fixture.json"));

        assertThatThrownBy(() -> loader.load(fixture("routes-index-empty.json")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("no entries");

        assertThat(jdbc.queryForObject(
                "select count(*) from route where retired_at is null", Integer.class)).isEqualTo(3);
    }

    @Test
    void storesGraded() throws Exception {
        loader.load(fixture("routes-index-fixture.json"));

        assertThat(jdbc.queryForObject("select graded from route where id = 'a'", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject("select graded from route where id = 'b'", Boolean.class)).isFalse();
    }
}
