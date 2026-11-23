package za.kaapspoor.server.review;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import za.kaapspoor.server.review.RouteReviewDtos.RouteReviews;

@RestController
@RequestMapping(path = "/api/v1/routes", produces = MediaType.APPLICATION_JSON_VALUE)
public class RouteReviewController {

    private final RouteReviewService service;

    RouteReviewController(RouteReviewService service) {
        this.service = service;
    }

    /** Public: no sign-in needed. */
    @GetMapping("/{routeId}/reviews")
    public RouteReviews reviews(@PathVariable String routeId) {
        return service.reviews(routeId);
    }
}
