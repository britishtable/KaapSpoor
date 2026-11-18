package za.kaapspoor.server.hike;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HikeRepository extends JpaRepository<Hike, UUID> {

    List<Hike> findByUserIdAndRevisionGreaterThanOrderByRevisionAsc(UUID userId, long revision, Pageable page);
}
