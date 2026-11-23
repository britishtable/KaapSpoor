package za.kaapspoor.server.route;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Seeds the route table from the app's build/data/routes-index.json. */
@Component
public class RouteIndexLoader implements ApplicationRunner {

    public record LoadResult(int upserted, int retired) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Coords(double lat, double lon) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Entry(String id, String title, List<String> area, Coords coords, String coordsSource, boolean graded) {}

    private static final String UPSERT = """
            insert into route (id, title, area, location, location_source, graded, retired_at, updated_at)
            values (?, ?, ?, case when ?::double precision is null then null
                                  else ST_SetSRID(ST_MakePoint(?::double precision, ?::double precision), 4326)::geography end,
                    ?, ?, null, now())
            on conflict (id) do update set
                title = excluded.title,
                area = excluded.area,
                location = excluded.location,
                location_source = excluded.location_source,
                graded = excluded.graded,
                retired_at = null,
                updated_at = now()
            """;

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final TransactionTemplate tx;
    private final String indexPath;

    public RouteIndexLoader(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            PlatformTransactionManager txManager,
            @Value("${kaapspoor.routes-index:}") String indexPath) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.tx = new TransactionTemplate(txManager);
        this.indexPath = indexPath;
    }

    @Override
    public void run(ApplicationArguments args) throws IOException {
        if (!indexPath.isBlank()) {
            load(Path.of(indexPath));
        }
    }

    public LoadResult load(Path indexJson) throws IOException {
        List<Entry> entries = mapper.readValue(
                indexJson.toFile(),
                mapper.getTypeFactory().constructCollectionType(List.class, Entry.class));
        if (entries.isEmpty()) {
            // An empty or truncated index would retire every route; refuse rather than wipe the table.
            throw new IllegalStateException("Route index " + indexJson + " has no entries; refusing to load it");
        }
        // run() calls this on `this`, bypassing any proxy, so the transaction is explicit.
        return tx.execute(status -> upsertAndRetire(entries));
    }

    private LoadResult upsertAndRetire(List<Entry> entries) {

        for (Entry e : entries) {
            // area-approx coordinates are a region centroid, not a trailhead: keep them out of spatial queries.
            boolean precise = e.coords() != null && !"area-approx".equals(e.coordsSource());
            Double lon = precise ? e.coords().lon() : null;
            Double lat = precise ? e.coords().lat() : null;
            jdbc.update(con -> {
                var ps = con.prepareStatement(UPSERT);
                ps.setString(1, e.id());
                ps.setString(2, e.title());
                ps.setArray(3, con.createArrayOf("text", e.area().toArray()));
                ps.setObject(4, lon);
                ps.setObject(5, lon);
                ps.setObject(6, lat);
                ps.setString(7, e.coordsSource());
                ps.setBoolean(8, e.graded());
                return ps;
            });
        }

        String[] ids = entries.stream().map(Entry::id).toArray(String[]::new);
        int retired = jdbc.update(con -> {
            var ps = con.prepareStatement(
                    "update route set retired_at = now(), updated_at = now()"
                            + " where retired_at is null and not (id = any (?))");
            ps.setArray(1, con.createArrayOf("text", ids));
            return ps;
        });
        return new LoadResult(entries.size(), retired);
    }
}
