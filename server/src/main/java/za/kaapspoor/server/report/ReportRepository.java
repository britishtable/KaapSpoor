package za.kaapspoor.server.report;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReportRepository extends JpaRepository<Report, UUID> {

    List<Report> findByRouteIdAndUserId(String routeId, UUID userId);
}
