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
import za.kaapspoor.server.report.ReportDtos.MyReport;
import za.kaapspoor.server.report.ReportDtos.ReportWrite;

@RestController
@RequestMapping(path = "/api/v1/reports", produces = MediaType.APPLICATION_JSON_VALUE)
public class ReportController {

    private final ReportService service;

    ReportController(ReportService service) {
        this.service = service;
    }

    /** Always 200 with the stored report. A report is written once; a retry returns it unchanged. */
    @PutMapping("/{id}")
    public MyReport put(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @RequestBody ReportWrite body) {
        return service.file(UUID.fromString(jwt.getSubject()), id, body);
    }
}
