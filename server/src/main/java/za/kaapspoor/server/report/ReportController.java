package za.kaapspoor.server.report;

import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import za.kaapspoor.server.report.ReportDtos.ConfirmationWrite;
import za.kaapspoor.server.report.ReportDtos.MyReport;
import za.kaapspoor.server.report.ReportDtos.PublicReport;
import za.kaapspoor.server.report.ReportDtos.ReportWrite;

@RestController
@RequestMapping(path = "/api/v1/reports", produces = MediaType.APPLICATION_JSON_VALUE)
public class ReportController {

    private final ReportService service;
    private final RouteReportService routeReports;

    ReportController(ReportService service, RouteReportService routeReports) {
        this.service = service;
        this.routeReports = routeReports;
    }

    /** Always 200 with the stored report. A report is written once; a retry returns it unchanged. */
    @PutMapping("/{id}")
    public MyReport put(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody ReportWrite body) {
        return service.file(UUID.fromString(jwt.getSubject()), id, body);
    }

    /** One answer per person per report; a newer answer replaces the older. */
    @PutMapping("/{id}/confirmation")
    public PublicReport confirm(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id,
            @RequestBody ConfirmationWrite body) {
        return routeReports.confirm(UUID.fromString(jwt.getSubject()), id, body.answer());
    }
}
