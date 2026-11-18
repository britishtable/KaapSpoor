package za.kaapspoor.server.route;

import org.springframework.data.jpa.repository.JpaRepository;

public interface RouteRepository extends JpaRepository<Route, String> {

    boolean existsByIdAndRetiredAtIsNull(String id);
}
