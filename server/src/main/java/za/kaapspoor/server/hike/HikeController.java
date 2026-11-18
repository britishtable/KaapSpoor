package za.kaapspoor.server.hike;

import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import za.kaapspoor.server.hike.HikeDtos.Hike;
import za.kaapspoor.server.hike.HikeDtos.HikeChanges;
import za.kaapspoor.server.hike.HikeDtos.HikeWrite;

@RestController
@RequestMapping(path = "/api/v1/hikes", produces = MediaType.APPLICATION_JSON_VALUE)
public class HikeController {

    private final HikeService service;

    HikeController(HikeService service) {
        this.service = service;
    }

    /** Always 200 with the server's current hike, whether or not this write won. */
    @PutMapping("/{id}")
    public Hike put(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody HikeWrite body) {
        return service.upsert(UUID.fromString(jwt.getSubject()), id, body);
    }

    @GetMapping
    public HikeChanges changes(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam(defaultValue = "0") long since,
            @RequestParam(defaultValue = "500") int limit) {
        return service.changes(UUID.fromString(jwt.getSubject()), since, limit);
    }
}
