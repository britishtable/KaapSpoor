package za.kaapspoor.server.report;

import java.util.List;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import za.kaapspoor.server.report.ReportDtos.MyReport;
import za.kaapspoor.server.report.ReportDtos.RouteReports;

@RestController
@RequestMapping(path = "/api/v1", produces = MediaType.APPLICATION_JSON_VALUE)
public class RouteReportController {

    private final RouteReportService service;

    RouteReportController(RouteReportService service) {
        this.service = service;
    }

    /** Public: no sign-in needed. Held reports never appear here. */
    @GetMapping("/routes/{routeId}/reports")
    public RouteReports reports(@PathVariable String routeId) {
        return service.forRoute(routeId);
    }

    /** The caller's own reports on a route that are still held; kept apart so the public path reads no token. */
    @GetMapping("/reports/mine")
    public List<MyReport> mine(@AuthenticationPrincipal Jwt jwt, @RequestParam String routeId) {
        return service.myHeld(UUID.fromString(jwt.getSubject()), routeId);
    }
}
